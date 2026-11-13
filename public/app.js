const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const tpl = document.getElementById('tile-tpl');
const tiles = new Map(); // id -> { el, img, overlay, badge }

const STATUS_TEXT = { idle: '대기', connecting: '연결 중', live: 'LIVE', error: '오류' };
let viewLimitSec = 30;

function showOverlay(tile, text, replay = false) {
  tile.overlay.hidden = false;
  tile.overlay.replaceChildren(document.createTextNode(text));
  if (replay) {
    const btn = document.createElement('button');
    btn.className = 'btn-replay';
    btn.textContent = '▶ 다시 보기';
    btn.onclick = () => connect(tile, tile.id);
    tile.overlay.append(btn);
  }
}

function connect(tile, id) {
  clearTimeout(tile.limitTimer);
  clearTimeout(tile.retryTimer);
  tile.stopped = false;
  showOverlay(tile, '연결 중…');
  // 캐시 방지를 위해 쿼리 추가
  tile.img.src = `/stream/${id}?t=${Date.now()}`;
  if (viewLimitSec > 0) {
    tile.endAt = Date.now() + viewLimitSec * 1000;
    tile.limitTimer = setTimeout(() => stopView(tile), viewLimitSec * 1000);
  } else {
    tile.endAt = 0;
  }
}

// 시청 시간 종료: 마지막 화면은 남겨두고 스트림 연결만 끊음
function stopView(tile) {
  clearTimeout(tile.limitTimer);
  clearTimeout(tile.retryTimer);
  tile.stopped = true;
  tile.endAt = 0;
  if (tile.img.naturalWidth) {
    const canvas = document.createElement('canvas');
    canvas.width = tile.img.naturalWidth;
    canvas.height = tile.img.naturalHeight;
    canvas.getContext('2d').drawImage(tile.img, 0, 0);
    tile.img.src = canvas.toDataURL('image/jpeg');
  } else {
    tile.img.removeAttribute('src');
  }
  tile.badge.className = 'badge idle';
  tile.badge.textContent = '정지';
  showOverlay(tile, `${viewLimitSec}초 시청 시간이 끝났습니다.`, true);
}

function createTile(cam) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  const tile = {
    id: cam.id,
    el,
    img: el.querySelector('img'),
    overlay: el.querySelector('.overlay'),
    badge: el.querySelector('.badge'),
  };
  el.querySelector('.name').textContent = cam.name;
  el.querySelector('.url').textContent = cam.url;
  el.querySelector('.url').title = cam.url;
  tile.img.alt = cam.name;

  tile.img.addEventListener('load', () => {
    if (!tile.stopped) tile.overlay.hidden = true;
  });
  tile.img.addEventListener('error', () => {
    if (tile.stopped) return;
    // 시청 시간이 거의 끝났으면 재연결하지 않음
    if (tile.endAt && tile.endAt - Date.now() < 4000) return stopView(tile);
    showOverlay(tile, '스트림 연결 끊김 — 재연결 중…');
    tile.retryTimer = setTimeout(() => connect(tile, cam.id), 3000);
  });

  el.querySelector('.btn-reload').onclick = () => connect(tile, cam.id);
  el.querySelector('.btn-full').onclick = () => {
    const v = el.querySelector('.video');
    if (document.fullscreenElement) document.exitFullscreen();
    else v.requestFullscreen();
  };
  el.querySelector('.btn-snap').onclick = async () => {
    const r = await fetch(`/snapshot/${cam.id}`);
    if (!r.ok) return alert('아직 프레임이 없습니다.');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cam.name}_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  el.querySelector('.btn-del').onclick = async () => {
    if (!confirm(`'${cam.name}' 카메라를 삭제할까요?`)) return;
    stopView(tile);
    await fetch(`/api/cameras/${cam.id}`, { method: 'DELETE' });
    refresh();
  };

  grid.appendChild(el);
  tiles.set(cam.id, tile);
  connect(tile, cam.id);
}

function updateStatus(cam) {
  const tile = tiles.get(cam.id);
  if (!tile) return;
  tile.cam = cam;
  if (tile.stopped) return;
  renderBadge(tile);
  if (cam.status === 'error' && cam.error) {
    showOverlay(tile, `오류: ${cam.error}`);
  } else if (cam.status === 'live' && tile.img.complete && tile.img.naturalWidth) {
    tile.overlay.hidden = true;
  }
}

function renderBadge(tile) {
  const cam = tile.cam;
  if (!cam || tile.stopped) return;
  const left = tile.endAt ? ` · ${Math.max(0, Math.ceil((tile.endAt - Date.now()) / 1000))}초` : '';
  tile.badge.className = `badge ${cam.status}`;
  tile.badge.textContent = cam.status === 'live'
    ? `LIVE · ${cam.fps} fps${left}`
    : (STATUS_TEXT[cam.status] || cam.status) + left;
}

async function refresh() {
  let list;
  try {
    const r = await fetch('/api/cameras');
    if (r.status === 401) return location.replace('/login');
    list = await r.json();
  } catch {
    return;
  }
  const ids = new Set(list.map((c) => c.id));
  for (const [id, tile] of tiles) {
    if (!ids.has(id)) {
      stopView(tile);
      tile.el.remove();
      tiles.delete(id);
    }
  }
  for (const cam of list) {
    if (!tiles.has(cam.id)) createTile(cam);
    updateStatus(cam);
  }
  empty.hidden = list.length > 0;
}

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('form-msg');
  msg.textContent = '';
  const r = await fetch('/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('cam-name').value,
      url: document.getElementById('cam-url').value,
    }),
  });
  if (!r.ok) {
    msg.textContent = (await r.json()).error || '추가 실패';
    return;
  }
  e.target.reset();
  refresh();
});

document.querySelectorAll('.layout-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.layout-buttons button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    grid.className = `grid cols-${btn.dataset.cols}`;
    try { localStorage.setItem('cols', btn.dataset.cols); } catch {}
  });
});
try {
  const saved = localStorage.getItem('cols');
  if (saved) document.querySelector(`.layout-buttons button[data-cols="${saved}"]`)?.click();
} catch {}

// 서버 설정(config.json) 변경을 새로고침 없이 반영. 보고 있는 화면은 다음 연결부터 적용
async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    if (r.ok) viewLimitSec = (await r.json()).viewLimitSec;
  } catch {}
}

(async () => {
  await loadSettings();
  refresh();
  setInterval(() => { loadSettings(); refresh(); }, 2000);
  setInterval(() => tiles.forEach(renderBadge), 1000);
})();
