import * as THREE from 'three';
const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('tok'); if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('tok', token); }
const socket = io({ auth: { token } });
let armor = 0, mapId = 0, W = {}, room = null, myId = null, boxes = [], playing = false, hp = 100, weapon = 'rifle', ammo = {}, mouse = false, nextShot = 0, ping = 0;
const keys = {}, others = new Map(), tracers = [];
const P = { pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0 };
const order = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'knife'];
const DEF = { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft', reload: 'KeyR' };
const B = { ...DEF, ...JSON.parse(localStorage.getItem('binds') || '{}') };
const S = { xh: '#ffffff', xs: 6, fov: 75, shadows: true, res: 1, ...JSON.parse(localStorage.getItem('set') || '{}') };

// ---- three setup ----
const ren = new THREE.WebGLRenderer({ antialias: true }); ren.setPixelRatio(Math.min(devicePixelRatio, 2)); ren.setSize(innerWidth, innerHeight); ren.shadowMap.enabled = true; document.body.prepend(ren.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9ec7e8); scene.fog = new THREE.Fog(0x9ec7e8, 40, 130);
const cam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .05, 300); cam.rotation.order = 'YXZ'; scene.add(cam);
const hemi = new THREE.HemisphereLight(0xffffff, 0x556655, .8); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(30, 50, 20); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 150 }); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x6b7a5a })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const mapG = new THREE.Group(); scene.add(mapG);
const GUN = { rifle: { s: [.08, .1, .6], c: 0x2b2b30 }, smg: { s: [.07, .09, .4], c: 0x383838 }, shotgun: { s: [.09, .09, .75], c: 0x5a3b20 }, sniper: { s: [.06, .08, 1], c: 0x1f2a1f }, pistol: { s: [.06, .13, .25], c: 0x444444 }, knife: { s: [.02, .03, .4], c: 0xcccccc } };
const gun = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x222222 })); gun.position.x = .25; gun.position.y = -.22; cam.add(gun);
function setGun(w) { const d = GUN[w]; gun.scale.set(...d.s); gun.material.color.setHex(d.c); gun.userData.rz = -.25 - d.s[2] / 2; gun.position.z = gun.userData.rz; }
setGun('rifle');
const flash = new THREE.PointLight(0xffaa55, 0, 8); flash.position.set(.25, -.2, -1.2); cam.add(flash);
addEventListener('resize', () => { ren.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });

const THEME = [{ sky: 0x9ec7e8, gr: 0x55595e, hue: .6, hemi: .8 }, { sky: 0xe8c99a, gr: 0xd8b878, hue: .1, hemi: .9 }, { sky: 0x20252b, gr: 0x4a4a4a, hue: .08, hemi: 1.2 }];
function buildMap() {
  const T = THEME[mapId] || THEME[0]; scene.background = new THREE.Color(T.sky); scene.fog.color.setHex(T.sky); ground.material.color.setHex(T.gr); hemi.intensity = T.hemi;
  mapG.clear();
  boxes.forEach(([x, y, z, w, h, d], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(T.hue + (i % 5) * .015, .2, .3 + (i % 4) * .07) }));
    m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; mapG.add(m);
  });
}
const teamColor = t => t === 1 ? 0xd9472b : t === 2 ? 0x2b7bd9 : 0xd9a02b;
function makeAvatar(t) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: teamColor(t) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(.7, 1.3, .45), mat); body.position.y = .7; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.22), new THREE.MeshStandardMaterial({ color: 0xe0b89a })); head.position.y = 1.62;
  g.add(body, head); g.userData.mat = mat; scene.add(g); return g;
}

// ---- audio (synth) ----
let ac; const vol = () => $('vol').value / 10;
function beep(f, d, type = 'square', g = .15) {
  try { ac ||= new AudioContext(); const o = ac.createOscillator(), a = ac.createGain(); o.type = type; o.frequency.value = f; a.gain.value = g * vol();
    o.connect(a); a.connect(ac.destination); o.start(); a.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d); o.stop(ac.currentTime + d); } catch {}
}

// ---- UI / net ----
$('name').value = localStorage.getItem('pname') || '';
const name = () => { const n = $('name').value.trim() || 'Player' + Math.floor(Math.random() * 900 + 100); localStorage.setItem('pname', n); return n; };
const enterCb = r => { if (r?.error) $('err').textContent = r.error; };
$('quick').onclick = () => socket.emit('quick', { name: name() }, enterCb);
$('create').onclick = () => socket.emit('create', { name: name() }, enterCb);
$('join').onclick = () => socket.emit('join', { name: name(), code: $('code').value }, enterCb);
$('rd').onclick = () => { const me = room.players.find(p => p.id === myId); socket.emit('ready', !me.ready); };
$('tm').onclick = () => { const me = room.players.find(p => p.id === myId); socket.emit('team', me.team === 1 ? 2 : 1); };
$('go').onclick = () => socket.emit('startGame');
$('rem').onclick = () => socket.emit('rematch');
['mode', 'map', 'limit', 'dur'].forEach(id => $(id).onchange = () => socket.emit('cfg', { mode: $('mode').value, mapId: $('map').value, scoreLimit: $('limit').value, duration: $('dur').value }));
const toast = t => { const e = document.createElement('div'); e.id = 'toast'; e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 2500); };

socket.on('init', d => { myId = d.id; boxes = d.boxes; mapId = d.mapId; W = d.weapons; buildMap(); $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden'); });
socket.on('toast', toast);
socket.on('map', m => { boxes = m.boxes; mapId = m.mapId; buildMap(); });
socket.on('room', r => {
  room = r; const isHost = r.host === myId;
  $('rc').textContent = r.code; $('map').value = r.mapId; $('hostctl').style.display = isHost ? '' : 'none'; $('go').style.display = isHost ? '' : 'none'; $('rem').style.display = isHost ? '' : 'none';
  $('plist').innerHTML = r.players.map(p => `<tr><td class="${p.team === 1 ? 'red' : p.team === 2 ? 'blue' : ''}">${p.name}${p.id === r.host ? ' ★' : ''}</td><td>${p.ready ? '✔ ready' : ''}</td></tr>`).join('');
  hudUpdate();
});
socket.on('start', () => { playing = true; $('lobby').classList.add('hidden'); $('res').classList.add('hidden'); $('hud').classList.remove('hidden'); $('pause').classList.remove('hidden'); });
socket.on('lobby', () => { playing = false; $('res').classList.add('hidden'); $('hud').classList.add('hidden'); $('lobby').classList.remove('hidden'); });
socket.on('spawn', s => {
  if (s.id === myId) { P.pos.set(s.x, s.y, s.z); P.vy = 0; hp = 100; armor = 50; $('death').classList.add('hidden'); hudUpdate(); }
});
socket.on('tp', s => P.pos.set(s.x, s.y, s.z));
socket.on('s', arr => arr.forEach(([id, x, y, z, yaw]) => {
  if (id === myId) return; let o = others.get(id);
  if (!o) { const pl = room?.players.find(p => p.id === id); o = { g: makeAvatar(pl?.team || 0), t: new THREE.Vector3(x, y, z), teamSeen: pl?.team }; o.g.position.set(x, y, z); o.g.add(label(pl?.name || '?')); others.set(id, o); }
  o.t.set(x, y, z); o.yaw = yaw;
}));
socket.on('hit', h => {
  if (h.v === myId) { hp = h.hp; armor = h.armor ?? armor; $('flash').style.opacity = .5; setTimeout(() => $('flash').style.opacity = 0, 150); beep(120, .15, 'sawtooth'); if (hp <= 0) $('death').classList.remove('hidden'); }
  const vo = others.get(h.v); if (vo) puff(vo.g.position.clone().setY(vo.g.position.y + 1.2), 0xaa0000, 6);
  if (h.by === myId) { $('hm').style.opacity = 1; $('hm').style.color = h.head ? '#f33' : '#fff'; setTimeout(() => $('hm').style.opacity = 0, 120); beep(900, .06, 'sine'); }
  hudUpdate();
});
socket.on('kill', k => { const d = document.createElement('div'); d.textContent = `${k.killer} [${k.w}${k.head ? ' HS' : ''}] ${k.victim}${k.streak >= 3 ? ` 🔥${k.streak}` : ''}`; $('feed').prepend(d); setTimeout(() => d.remove(), 5000); });
socket.on('ammo', a => { if (a.all) ammo = a.all; else ammo[a.w] = a.n; hudUpdate(); });
socket.on('shot', s => {
  s.ends.forEach(e => { puff(new THREE.Vector3(...e), 0xddddbb, 3); const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...s.o).add(new THREE.Vector3(0, -.1, 0)), new THREE.Vector3(...e)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffdd66, transparent: true })); scene.add(l); tracers.push({ l, t: 0.08 }); });
  if (s.id !== myId) beep(s.w === 'sniper' ? 90 : 160, .08, 'sawtooth', .08);
});
socket.on('end', e => {
  playing = false; document.exitPointerLock(); $('hud').classList.add('hidden'); $('death').classList.add('hidden'); $('pause').classList.add('hidden'); $('res').classList.remove('hidden');
  $('win').textContent = 'Winner: ' + e.winner;
  $('rank').innerHTML = '<tr><th>#</th><th>Name</th><th>K</th><th>D</th><th>A</th><th>Acc</th><th>Score</th></tr>' + e.rank.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.k}</td><td>${p.d}</td><td>${p.a}</td><td>${p.acc}%</td><td>${p.score}</td></tr>`).join('');
});
socket.on('disconnect', () => toast('Disconnected - reconnecting…'));
setInterval(() => { const t = performance.now(); socket.emit('ping2', () => { ping = Math.round(performance.now() - t); }); }, 2000);

function hudUpdate() {
  if (!room) return; const me = room.players.find(p => p.id === myId); if (!me) return;
  $('hp').textContent = '❤ ' + hp + '   🛡 ' + armor; const Wd = W[weapon]; $('ammo').innerHTML = `${Wd?.name}<br>${Wd?.mag ? (ammo[weapon] ?? 0) + ' / ' + Wd.mag : '∞'}`;
  $('stat').textContent = `K ${me.k}  D ${me.d}  A ${me.a}  Ping ${ping}ms  ${socket.connected ? '●' : '○ offline'}`;
  others.forEach((o, id) => { const pl = room.players.find(p => p.id === id); if (!pl) { scene.remove(o.g); others.delete(id); return; } o.g.visible = pl.alive; if (o.teamSeen !== pl.team) { o.g.userData.mat.color.setHex(teamColor(pl.team)); o.teamSeen = pl.team; } });
}
setInterval(() => { if (!room || !playing) return; const left = Math.max(0, Math.round((room.endsAt - Date.now()) / 1000));
  $('top').innerHTML = (room.mode === 'tdm' ? `<span class="red">${room.teamScore[0]}</span> : <span class="blue">${room.teamScore[1]}</span>  ` : '') + `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; hudUpdate(); }, 500);

// ---- input ----
$('pause').onclick = () => ren.domElement.requestPointerLock();
document.addEventListener('pointerlockchange', () => { const l = document.pointerLockElement === ren.domElement; $('pause').classList.toggle('hidden', l || !playing); });
addEventListener('mousemove', e => { if (document.pointerLockElement !== ren.domElement) return; const s = $('sens').value * .0006 * (cam.fov < 40 ? .4 : 1); P.yaw -= e.movementX * s; P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - e.movementY * s)); });
addEventListener('mousedown', e => { if (e.button === 0) { mouse = true; fire(); } if (e.button === 2 && weapon === 'sniper') cam.fov = 20, cam.updateProjectionMatrix(); });
addEventListener('mouseup', e => { if (e.button === 0) mouse = false; if (e.button === 2) { cam.fov = S.fov; cam.updateProjectionMatrix(); } });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  keys[e.code] = true; if (e.code === 'Space' || e.code === 'ControlLeft') e.preventDefault();
  if (e.code === B.reload && playing) socket.emit('rl');
  const n = +e.key; if (n >= 1 && n <= 6 && playing) { weapon = order[n - 1]; setGun(weapon); socket.emit('sw', weapon); hudUpdate(); }
});
addEventListener('keyup', e => keys[e.code] = false);
function fire() {
  if (!playing || hp <= 0 || document.pointerLockElement !== ren.domElement) return;
  const now = performance.now(), Wd = W[weapon]; if (now < nextShot) return; if (Wd.mag && !ammo[weapon]) return;
  nextShot = now + Wd.rate; const d = new THREE.Vector3(0, 0, -1).applyEuler(cam.rotation);
  socket.emit('shoot', { d: [d.x, d.y, d.z] }); P.pitch += .012; gun.position.z = gun.userData.rz + .08; flash.intensity = 4; beep(Wd.name === 'Sniper' ? 110 : 220, .09, 'sawtooth');
}

// ---- movement ----
const HALF = .35, H = 1.7;
const hits = p => boxes.some(([cx, y, cz, w, h, d]) => Math.abs(p.x - cx) < w / 2 + HALF && Math.abs(p.z - cz) < d / 2 + HALF && p.y < y + h - .01 && p.y + H > y);
let stepT = 0, wasG = true;
function step(dt) {
  const crouch = keys[B.crouch], sp = crouch ? 2.5 : keys[B.sprint] ? 8 : 5;
  const fx = (keys[B.right] ? 1 : 0) - (keys[B.left] ? 1 : 0), fz = (keys[B.back] ? 1 : 0) - (keys[B.fwd] ? 1 : 0); const l = Math.hypot(fx, fz) || 1;
  const dx = (fx * Math.cos(P.yaw) + fz * Math.sin(P.yaw)) / l * sp * dt, dz = (-fx * Math.sin(P.yaw) + fz * Math.cos(P.yaw)) / l * sp * dt;
  const p = P.pos; P.vy -= 22 * dt; let grounded = false; p.y += P.vy * dt;
  if (p.y <= 0) { p.y = 0; P.vy = 0; grounded = true; }
  for (const [cx, y, cz, w, h, d] of boxes) if (Math.abs(p.x - cx) < w / 2 + HALF && Math.abs(p.z - cz) < d / 2 + HALF && p.y < y + h - .01 && p.y + H > y) { if (P.vy <= 0) { p.y = y + h; P.vy = 0; grounded = true; } else { p.y = y - H; P.vy = 0; } }
  if (keys[B.jump] && grounded) { P.vy = 7.5; beep(320, .08, 'sine', .1); }
  const mv = (ax, d) => { p[ax] += d; if (hits(p)) { p.y += .6; if (hits(p)) { p.y -= .6; p[ax] -= d; } } };  // auto step-up onto stairs
  mv('x', dx); mv('z', dz);
  p.x = Math.max(-39, Math.min(39, p.x)); p.z = Math.max(-39, Math.min(39, p.z));
  if (grounded && !wasG) beep(60, .1, 'sine', .2); wasG = grounded;
  if (grounded && (fx || fz)) { stepT -= dt; if (stepT <= 0) { stepT = keys[B.sprint] ? .28 : .42; beep(70 + Math.random() * 20, .05, 'triangle', .1); } }
  return crouch ? 1.2 : 1.6;
}
let last = performance.now(), sendT = 0;
function loop(t) {
  requestAnimationFrame(loop); const dt = Math.min(.05, (t - last) / 1000); last = t; let eye = 1.6;
  if (playing && hp > 0 && document.pointerLockElement === ren.domElement) {
    eye = step(dt); sendT += dt; if (sendT > .05) { sendT = 0; socket.volatile.emit('m', [P.pos.x, P.pos.y, P.pos.z, P.yaw, P.pitch]); }
    if (mouse && W[weapon]?.auto) fire();
  }
  cam.position.set(P.pos.x, P.pos.y + eye, P.pos.z); cam.rotation.set(P.pitch, P.yaw, 0); gun.position.z += (gun.userData.rz - gun.position.z) * Math.min(1, dt * 15);
  others.forEach(o => { o.g.position.lerp(o.t, Math.min(1, dt * 12)); o.g.rotation.y = o.yaw ?? 0; });
  for (let i = tracers.length - 1; i >= 0; i--) { tracers[i].t -= dt; if (tracers[i].t <= 0) { scene.remove(tracers[i].l); tracers.splice(i, 1); } }
  flash.intensity = Math.max(0, flash.intensity - dt * 40);
  pool.forEach(o => { if (o.t > 0) { o.t -= dt; o.m.position.addScaledVector(o.v, dt); o.v.y -= 9 * dt; o.m.material.opacity = Math.max(0, o.t * 2); if (o.t <= 0) o.m.visible = false; } });
  if (playing) mini();
  ren.render(scene, cam);
}
requestAnimationFrame(loop);

// ---- particles (pooled), labels, minimap ----
const pool = []; let pi = 0;
for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.07, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })); m.visible = false; scene.add(m); pool.push({ m, t: 0, v: new THREE.Vector3() }); }
function puff(p, color, n = 4) { for (let i = 0; i < n; i++) { const o = pool[pi++ % pool.length]; o.m.position.copy(p); o.m.material.color.setHex(color); o.m.visible = true; o.t = .5; o.v.set((Math.random() - .5) * 3, Math.random() * 3, (Math.random() - .5) * 3); } }
function label(txt) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = 'bold 32px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 5; x.strokeText(txt, 128, 44); x.fillText(txt, 128, 44);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })); sp.scale.set(1.6, .4, 1); sp.position.y = 2.1; return sp;
}
const mmc = $('mm').getContext('2d');
function mini() {
  const k = 150 / 80, c = mmc; c.clearRect(0, 0, 150, 150); c.fillStyle = '#8aa';
  boxes.slice(4).forEach(([x, y, z, w, h, d]) => { if (y >= 7) return; c.fillRect((x - w / 2 + 40) * k, (z - d / 2 + 40) * k, w * k, d * k); });
  const me = room?.players.find(p => p.id === myId);
  if (room?.mode === 'tdm' && me) others.forEach((o, id) => { const pl = room.players.find(p => p.id === id); if (pl && pl.alive && pl.team === me.team) { c.fillStyle = pl.team === 1 ? '#f65' : '#58f'; c.beginPath(); c.arc((o.g.position.x + 40) * k, (o.g.position.z + 40) * k, 3, 0, 7); c.fill(); } });
  c.save(); c.translate((P.pos.x + 40) * k, (P.pos.z + 40) * k); c.rotate(-P.yaw); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.fill(); c.restore();
}

// ---- settings ----
function applyS() {
  ren.setPixelRatio(Math.min(devicePixelRatio, 2) * S.res); ren.setSize(innerWidth, innerHeight); sun.castShadow = S.shadows; cam.fov = S.fov; cam.updateProjectionMatrix();
  const c = $('cross'); c.style.borderColor = S.xh; c.style.width = c.style.height = S.xs + 'px'; c.style.margin = -S.xs / 2 + 'px'; localStorage.setItem('set', JSON.stringify(S));
}
function buildBinds() {
  const el = $('binds'); el.innerHTML = '';
  for (const k in DEF) { const b = document.createElement('button'); b.className = 'alt'; b.textContent = `${k}: ${B[k]}`;
    b.onclick = () => { b.textContent = k + ': press a key…'; const h = e => { e.preventDefault(); e.stopImmediatePropagation(); B[k] = e.code; localStorage.setItem('binds', JSON.stringify(B)); removeEventListener('keydown', h, true); buildBinds(); }; addEventListener('keydown', h, true); };
    el.append(b); }
}
$('s_fov').value = S.fov; $('s_xh').value = S.xh; $('s_xs').value = S.xs; $('s_q').value = S.res; $('s_sh').checked = S.shadows;
const bindS = (id, k, f = v => v) => $(id).oninput = e => { S[k] = f(e.target.type === 'checkbox' ? e.target.checked : e.target.value); applyS(); };
bindS('s_fov', 'fov', Number); bindS('s_xh', 'xh'); bindS('s_xs', 'xs', Number); bindS('s_q', 'res', Number); bindS('s_sh', 'shadows');
const openS = e => { e.stopPropagation(); $('set').classList.remove('hidden'); };
$('setbtn').onclick = openS; $('setbtn2').onclick = openS; $('s_x').onclick = () => $('set').classList.add('hidden');
$('s_fs').onclick = () => document.documentElement.requestFullscreen?.();
buildBinds(); applyS();

// ---- UI sounds + generative menu/ambient music ----
addEventListener('click', () => beep(600, .03, 'sine', .05));
setInterval(() => { if (!ac) return; const sc = [196, 220, 262, 294, 330]; if (!playing) beep(sc[Math.random() * 5 | 0], .6, 'sine', .06); else if (Math.random() < .3) beep(55, 1.2, 'sine', .05); }, 700);
