const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const tpl = document.getElementById('tile-tpl');
const tiles = new Map(); // id -> { el, img, overlay, badge }

const STATUS_TEXT = { idle: '대기', connecting: '연결 중', live: 'LIVE', error: '오류' };

function connect(tile, id) {
  tile.overlay.hidden = false;
  tile.overlay.textContent = '연결 중…';
  // 캐시 방지를 위해 쿼리 추가
  tile.img.src = `/stream/${id}?t=${Date.now()}`;
}

function createTile(cam) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  const tile = {
    el,
    img: el.querySelector('img'),
    overlay: el.querySelector('.overlay'),
    badge: el.querySelector('.badge'),
  };
  el.querySelector('.name').textContent = cam.name;
  el.querySelector('.url').textContent = cam.url;
  el.querySelector('.url').title = cam.url;
  tile.img.alt = cam.name;

  tile.img.addEventListener('load', () => { tile.overlay.hidden = true; });
  tile.img.addEventListener('error', () => {
    tile.overlay.hidden = false;
    tile.overlay.textContent = '스트림 연결 끊김 — 재연결 중…';
    setTimeout(() => connect(tile, cam.id), 3000);
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
    tile.img.src = '';
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
  tile.badge.className = `badge ${cam.status}`;
  tile.badge.textContent = cam.status === 'live'
    ? `LIVE · ${cam.fps} fps`
    : STATUS_TEXT[cam.status] || cam.status;
  if (cam.status === 'error' && cam.error) {
    tile.overlay.hidden = false;
    tile.overlay.textContent = `오류: ${cam.error}`;
  } else if (cam.status === 'live' && tile.img.complete && tile.img.naturalWidth) {
    tile.overlay.hidden = true;
  }
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
      tile.img.src = '';
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

refresh();
setInterval(refresh, 2000);
