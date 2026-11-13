// RTSP 뷰어 서버: ffmpeg로 RTSP를 MJPEG로 변환해 HTTP(multipart)로 브라우저에 전달
const express = require('express');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const CAMERAS_FILE = path.join(__dirname, 'cameras.json');
const IDLE_STOP_MS = 10000; // 시청자가 없으면 10초 후 ffmpeg 종료
const RESTART_DELAY_MS = 3000;

// 시스템 PATH의 ffmpeg 우선, 없으면 ffmpeg-static 사용
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (r.status === 0) return 'ffmpeg';
  return require('ffmpeg-static');
}
const FFMPEG = resolveFfmpeg();

// ---------- 카메라 목록 ----------
function loadCameras() {
  try {
    return JSON.parse(fs.readFileSync(CAMERAS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function saveCameras() {
  fs.writeFileSync(CAMERAS_FILE, JSON.stringify(cameras, null, 2));
}
let cameras = loadCameras();

// 비밀번호를 가린 URL (클라이언트에 노출용)
function maskUrl(url) {
  return url.replace(/(rtsp:\/\/[^:\/@]+:)[^@]*@/i, '$1****@');
}

// ---------- 스트림 관리 (카메라당 ffmpeg 1개를 여러 시청자가 공유) ----------
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

class CameraStream {
  constructor(cam) {
    this.cam = cam;
    this.clients = new Set();
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.lastFrame = null;
    this.lastFrameAt = 0;
    this.status = 'idle'; // idle | connecting | live | error
    this.error = '';
    this.idleTimer = null;
    this.restartTimer = null;
    this.frames = 0;
    this.fps = 0;
    this.fpsTimer = null;
  }

  start() {
    if (this.proc) return;
    clearTimeout(this.restartTimer);
    this.status = 'connecting';
    this.error = '';
    this.buffer = Buffer.alloc(0);

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-timeout', '10000000', // 10초 소켓 타임아웃 (마이크로초)
      '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-i', this.cam.url,
      '-an',
      '-f', 'image2pipe',
      '-c:v', 'mjpeg', '-q:v', '5',
      '-',
    ];
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    this.proc = proc;

    proc.stdout.on('data', (chunk) => this.onData(chunk));
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    proc.on('error', (err) => {
      this.error = err.message;
    });
    proc.on('close', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      clearInterval(this.fpsTimer);
      this.fps = 0;
      const lines = stderr.trim().split('\n').filter(Boolean);
      this.error = this.error || lines[lines.length - 1] || `ffmpeg 종료 (code ${code})`;
      this.status = 'error';
      console.log(`[${this.cam.name}] ffmpeg 종료: ${this.error}`);
      if (this.clients.size > 0) {
        this.restartTimer = setTimeout(() => this.start(), RESTART_DELAY_MS);
      }
    });

    this.frames = 0;
    this.fpsTimer = setInterval(() => {
      this.fps = this.frames;
      this.frames = 0;
    }, 1000);
    console.log(`[${this.cam.name}] ffmpeg 시작`);
  }

  stop() {
    clearTimeout(this.restartTimer);
    clearTimeout(this.idleTimer);
    clearInterval(this.fpsTimer);
    this.fps = 0;
    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      p.kill('SIGKILL');
      console.log(`[${this.cam.name}] ffmpeg 중지`);
    }
    this.status = 'idle';
  }

  // ffmpeg 출력에서 JPEG 프레임(FFD8 ~ FFD9) 단위로 잘라냄
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const start = this.buffer.indexOf(SOI);
      if (start < 0) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      const end = this.buffer.indexOf(EOI, start + 2);
      if (end < 0) {
        if (start > 0) this.buffer = this.buffer.subarray(start);
        return;
      }
      const frame = Buffer.from(this.buffer.subarray(start, end + 2));
      this.buffer = this.buffer.subarray(end + 2);
      this.onFrame(frame);
    }
  }

  onFrame(frame) {
    this.lastFrame = frame;
    this.lastFrameAt = Date.now();
    this.status = 'live';
    this.error = '';
    this.frames++;
    for (const res of this.clients) writeFrame(res, frame);
  }

  addClient(res) {
    clearTimeout(this.idleTimer);
    this.clients.add(res);
    if (this.lastFrame && this.status === 'live') writeFrame(res, this.lastFrame);
    this.start();
  }

  removeClient(res) {
    this.clients.delete(res);
    if (this.clients.size === 0) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.stop(), IDLE_STOP_MS);
    }
  }

  info() {
    return {
      status: this.status,
      error: this.error,
      viewers: this.clients.size,
      fps: this.fps,
      lastFrameAt: this.lastFrameAt,
    };
  }
}

const BOUNDARY = 'mjpegframe';
function writeFrame(res, frame) {
  // 느린 클라이언트는 프레임을 건너뜀 (버퍼 폭주 방지)
  if (res.writableLength > 1024 * 1024) return;
  res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
  res.write(frame);
  res.write('\r\n');
}

const streams = new Map();
function getStream(cam) {
  let s = streams.get(cam.id);
  if (!s) {
    s = new CameraStream(cam);
    streams.set(cam.id, s);
  }
  return s;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function publicCamera(cam) {
  const s = streams.get(cam.id);
  return {
    id: cam.id,
    name: cam.name,
    url: maskUrl(cam.url),
    ...(s ? s.info() : { status: 'idle', error: '', viewers: 0, fps: 0, lastFrameAt: 0 }),
  };
}

app.get('/api/cameras', (req, res) => {
  res.json(cameras.map(publicCamera));
});

app.post('/api/cameras', (req, res) => {
  const { name, url } = req.body || {};
  if (!url || !/^rtsps?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'rtsp:// 로 시작하는 주소를 입력하세요.' });
  }
  const cam = {
    id: crypto.randomBytes(4).toString('hex'),
    name: (name || '').trim() || `카메라 ${cameras.length + 1}`,
    url: url.trim(),
  };
  cameras.push(cam);
  saveCameras();
  res.status(201).json(publicCamera(cam));
});

app.delete('/api/cameras/:id', (req, res) => {
  const idx = cameras.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const [cam] = cameras.splice(idx, 1);
  const s = streams.get(cam.id);
  if (s) {
    for (const client of s.clients) client.end();
    s.stop();
    streams.delete(cam.id);
  }
  saveCameras();
  res.json({ ok: true });
});

// MJPEG 라이브 스트림
app.get('/stream/:id', (req, res) => {
  const cam = cameras.find((c) => c.id === req.params.id);
  if (!cam) return res.status(404).end();
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Connection: 'close',
  });
  const s = getStream(cam);
  s.addClient(res);
  req.on('close', () => s.removeClient(res));
});

// 현재 프레임 스냅샷
app.get('/snapshot/:id', (req, res) => {
  const s = streams.get(req.params.id);
  if (!s || !s.lastFrame) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-cache');
  res.send(s.lastFrame);
});

app.listen(PORT, () => {
  console.log(`RTSP 뷰어: http://localhost:${PORT}`);
  console.log(`ffmpeg: ${FFMPEG}`);
});

function shutdown() {
  for (const s of streams.values()) s.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
