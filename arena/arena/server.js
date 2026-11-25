import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 3001;
const app = express();
app.get('/health', (_q, s) => s.send('ok'));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*' } });

// ---- config ----
const WEAPONS = {
  rifle:   { name: 'Assault Rifle', dmg: 25, rate: 100,  mag: 30, reload: 2000, auto: true,  spread: 0.012, pellets: 1, range: 150 },
  smg:     { name: 'SMG',           dmg: 14, rate: 65,   mag: 35, reload: 1700, auto: true,  spread: 0.025, pellets: 1, range: 100 },
  shotgun: { name: 'Shotgun',       dmg: 13, rate: 850,  mag: 6,  reload: 2600, auto: false, spread: 0.07,  pellets: 8, range: 40 },
  sniper:  { name: 'Sniper',        dmg: 100,rate: 1300, mag: 5,  reload: 3000, auto: false, spread: 0,     pellets: 1, range: 300 },
  pistol:  { name: 'Pistol',        dmg: 22, rate: 280,  mag: 12, reload: 1400, auto: false, spread: 0.008, pellets: 1, range: 100 },
  knife:   { name: 'Knife',         dmg: 55, rate: 550,  mag: 0,  reload: 0,    auto: false, spread: 0,     pellets: 1, range: 2.2 },
};
const MAX_PLAYERS = 12, HEAD_MULT = 2.5, RESPAWN_MS = 3000;

// ---- maps (generated server-side, sent to clients) ----
function genMap(id) {
  const b = []; const add = (x, y, z, w, h, d) => b.push([x, y, z, w, h, d]);
  add(0, 0, -40, 80, 8, 1); add(0, 0, 40, 80, 8, 1); add(-40, 0, 0, 1, 8, 80); add(40, 0, 0, 1, 8, 80);
  let sd = id * 97 + 7; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const stairs = (x, z, dir, n) => { for (let i = 0; i < n; i++) add(x + dir * i, 0, z, 1, .5 * (i + 1), 3); };
  if (id === 0) { // Urban City: buildings, rooftops (corner roofs have stairs), cars
    for (let gx = -26; gx <= 26; gx += 26) for (let gz = -26; gz <= 26; gz += 26) {
      if (!gx && !gz) continue; const low = gx && gz; add(gx, 0, gz, 14, low ? 3.5 : 6 + r() * 7, 14);
      if (low) { const sg = gx > 0 ? -1 : 1; stairs(gx + sg * 13.5, gz, -sg, 7); }
    }
    for (let i = 0; i < 12; i++) { const a = r() < .5; add((r() - .5) * 66, 0, (r() - .5) * 66, a ? 4.2 : 2, 1.4, a ? 2 : 4.2); }
  } else if (id === 1) { // Desert Military Base: containers, barracks, towers
    for (let i = 0; i < 16; i++) { const h = r() < .5; add((r() - .5) * 66, 0, (r() - .5) * 66, h ? 6 : 2.5, 2.6, h ? 2.5 : 6); }
    add(-22, 0, -22, 16, 3.5, 7); stairs(-7.5, -22, -1, 7); add(22, 0, 22, 16, 3.5, 7); add(22, 0, -22, 7, 3.5, 16);
    add(-10, 0, 10, 4, 10, 4); add(10, 0, -10, 4, 10, 4);
  } else { // Industrial Warehouse: indoor, two floors, corridors
    add(0, 8, 0, 80, 1, 80);
    add(-24, 3, 0, 24, .5, 50); add(24, 3, 0, 24, .5, 50); stairs(-5.5, 10, -1, 7); stairs(5.5, -10, 1, 7);
    for (let i = 0; i < 14; i++) add((r() - .5) * 70, 0, (r() - .5) * 70, 2.5 + r() * 2, 1.5 + r() * 1.5, 2.5 + r() * 2);
    add(0, 0, 15, 20, 5, 1); add(0, 0, -15, 20, 5, 1);
  }
  return b;
}
function setMap(r, id) { r.mapId = id; r.boxes = genMap(id); r.bx = r.boxes.map(([x, y, z, w, h, d]) => [[x - w / 2, y, z - d / 2], [x + w / 2, y + h, z + d / 2]]); }

// ---- geometry helpers ----
function rayBox(o, d, mn, mx) {
  let t0 = 0, t1 = 1e9;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return null; }
    else {
      let a = (mn[i] - o[i]) / d[i], b = (mx[i] - o[i]) / d[i]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null;
    }
  }
  return t0;
}
function raySphere(o, d, c, r) {
  const m = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const b = m[0] * d[0] + m[1] * d[1] + m[2] * d[2], cc = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); return t >= 0 ? t : cc < 0 ? 0 : null;
}
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const inBox = (r, x, y, z) => r.bx.some(([a, b]) => x > a[0] - .6 && x < b[0] + .6 && z > a[2] - .6 && z < b[2] + .6 && a[1] < y + 1.7 && b[1] > y);
function spawnPoint(r) { for (let i = 0; i < 200; i++) { const x = (Math.random() - .5) * 74, z = (Math.random() - .5) * 74; if (!inBox(r, x, 0, z)) return [x, 0, z]; } return [0, 0, 0]; }

// ---- rooms ----
const rooms = new Map();
const makeCode = () => { let c; do { c = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); } while (rooms.has(c)); return c; };
const clean = n => String(n || 'Player').replace(/[^\w \-]/g, '').slice(0, 16) || 'Player';

function newPlayer(id, name) {
  return { id, name: clean(name), team: 0, ready: false, k: 0, d: 0, a: 0, armor: 0, dmg: {}, token: '', gone: false, shots: 0, hits: 0, streak: 0, hp: 100, alive: false,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, w: 'rifle', ammo: {}, nextShot: 0, reloadUntil: 0, lastMove: Date.now() };
}
const fillAmmo = p => { for (const k in WEAPONS) p.ammo[k] = WEAPONS[k].mag; };
const pub = r => ({ code: r.code, host: r.host, state: r.state, mode: r.mode, mapId: r.mapId, scoreLimit: r.scoreLimit, duration: r.duration,
  teamScore: r.teamScore, endsAt: r.endsAt, public: r.public,
  players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, k: p.k, d: p.d, hp: p.hp, alive: p.alive, streak: p.streak, a: p.a, armor: p.armor })) });
const push = r => io.to(r.code).emit('room', pub(r));

function createRoom(pubFlag) {
  const r = { code: makeCode(), host: null, state: 'lobby', mode: 'tdm', mapId: 0, scoreLimit: 30, duration: 300, teamScore: [0, 0], endsAt: 0, players: new Map(), public: pubFlag };
  rooms.set(r.code, r); setMap(r, 0); return r;
}
function spawn(r, p) {
  const [x, y, z] = spawnPoint(r); Object.assign(p, { x, y, z, hp: 100, armor: 50, dmg: {}, alive: true, reloadUntil: 0 }); fillAmmo(p);
  io.to(r.code).emit('spawn', { id: p.id, x, y, z });
  io.to(p.id).emit('ammo', { all: p.ammo });
}
function smallerTeam(r) { let c = [0, 0, 0]; r.players.forEach(p => c[p.team]++); return c[1] <= c[2] ? 1 : 2; }
function startMatch(r) {
  if (r.state === 'playing') return;
  r.state = 'playing'; r.teamScore = [0, 0]; r.endsAt = Date.now() + r.duration * 1000;
  const list = [...r.players.values()].sort(() => Math.random() - .5);
  list.forEach((p, i) => { p.k = p.d = p.a = p.shots = p.hits = p.streak = 0; p.team = r.mode === 'tdm' ? 1 + (i % 2) : 0; });
  io.to(r.code).emit('start'); list.forEach(p => spawn(r, p)); push(r);
}
function endMatch(r) {
  if (r.state !== 'playing') return; r.state = 'ended';
  const rank = [...r.players.values()].sort((a, b) => b.k - a.k || a.d - b.d).map(p => ({ id: p.id, name: p.name, team: p.team, k: p.k, d: p.d, a: p.a, acc: p.shots ? Math.round(100 * p.hits / p.shots) : 0, score: p.k * 100 }));
  let winner = rank[0] ? rank[0].name : '-';
  if (r.mode === 'tdm') winner = r.teamScore[0] === r.teamScore[1] ? 'Draw' : (r.teamScore[0] > r.teamScore[1] ? 'Red Team' : 'Blue Team');
  io.to(r.code).emit('end', { rank, winner, mode: r.mode, teamScore: r.teamScore }); push(r);
}
function enter(s, r, name) {
  const p = newPlayer(s.id, name); p.token = String(s.handshake.auth?.token || '').slice(0, 40); r.players.set(s.id, p); if (!r.host) r.host = s.id;
  s.join(r.code); s.data.code = r.code;
  if (r.mode === 'tdm') p.team = smallerTeam(r);
  s.emit('init', { id: s.id, boxes: r.boxes, mapId: r.mapId, weapons: WEAPONS });
  io.to(r.code).emit('toast', `${p.name} joined`);
  if (r.state === 'playing') { s.emit('start'); spawn(r, p); }
  if (r.public && r.state === 'lobby' && r.players.size >= 2 && !r.auto) r.auto = setTimeout(() => { r.auto = null; startMatch(r); }, 8000), io.to(r.code).emit('toast', 'Quick match starts in 8s');
  push(r);
}
const getRoom = s => rooms.get(s.data.code);

// ---- combat ----
function trace(r, shooter, o, dir, range) {
  let wallT = range; for (const [a, b] of r.bx) { const t = rayBox(o, dir, a, b); if (t !== null && t < wallT) wallT = t; }
  if (dir[1] < -1e-6) { const t = -o[1] / dir[1]; if (t > 0 && t < wallT) wallT = t; }
  let best = null, bt = wallT;
  r.players.forEach(v => {
    if (v === shooter || !v.alive || v.gone || (r.mode === 'tdm' && v.team === shooter.team)) return;
    const head = raySphere(o, dir, [v.x, v.y + 1.62, v.z], .22);
    if (head !== null && head < bt) { bt = head; best = { v, head: true }; }
    const body = rayBox(o, dir, [v.x - .4, v.y, v.z - .4], [v.x + .4, v.y + 1.4, v.z + .4]);
    if (body !== null && body < bt) { bt = body; best = { v, head: false }; }
  });
  return { t: bt, hit: best };
}
function damage(r, shooter, v, amount, head, w) {
  let hpDmg = amount;
  if (v.armor > 0) { const ab = Math.min(v.armor, Math.round(amount * .5)); v.armor -= ab; hpDmg -= ab; }
  hpDmg = Math.min(hpDmg, v.hp); v.hp -= hpDmg; v.dmg[shooter.id] = (v.dmg[shooter.id] || 0) + hpDmg;
  io.to(r.code).emit('hit', { v: v.id, hp: v.hp, armor: v.armor, by: shooter.id, head });
  if (v.hp > 0) return;
  v.alive = false; v.d++; v.streak = 0; shooter.k++; shooter.streak++;
  for (const [id, dm] of Object.entries(v.dmg)) if (id !== shooter.id && dm >= 25) { const ap = r.players.get(id); if (ap) ap.a++; }
  if (r.mode === 'tdm') r.teamScore[shooter.team - 1]++;
  io.to(r.code).emit('kill', { killer: shooter.name, victim: v.name, w, head, streak: shooter.streak });
  push(r);
  const top = r.mode === 'tdm' ? Math.max(...r.teamScore) : shooter.k;
  if (top >= r.scoreLimit) return endMatch(r);
  setTimeout(() => { if (r.state === 'playing' && r.players.has(v.id)) { spawn(r, v); push(r); } }, RESPAWN_MS);
}

// ---- sockets ----
io.on('connection', s => {
  let count = 0, tick = Date.now();
  const token = String(s.handshake.auth?.token || '').slice(0, 40);
  if (token) for (const r of rooms.values()) {   // reconnection: reclaim a player who dropped < 20s ago
    const old = [...r.players.values()].find(p => p.token === token && p.gone); if (!old) continue;
    clearTimeout(old.dcTimer); r.players.delete(old.id); if (r.host === old.id) r.host = s.id;
    old.id = s.id; old.gone = false; r.players.set(s.id, old); s.join(r.code); s.data.code = r.code;
    s.emit('init', { id: s.id, boxes: r.boxes, mapId: r.mapId, weapons: WEAPONS });
    if (r.state === 'playing') { s.emit('start'); s.emit('ammo', { all: old.ammo }); if (old.alive) { s.emit('spawn', { id: s.id, x: old.x, y: old.y, z: old.z }); s.emit('hit', { v: s.id, hp: old.hp, armor: old.armor, by: '', head: false }); } }
    io.to(r.code).emit('toast', old.name + ' reconnected'); push(r); break;
  }
  s.use((_pkt, next) => { const n = Date.now(); if (n - tick > 1000) { tick = n; count = 0; } if (++count > 150) return; next(); });

  s.on('ping2', cb => typeof cb === 'function' && cb());
  s.on('create', ({ name }, ack) => { const r = createRoom(false); enter(s, r, name); ack?.({ ok: true }); });
  s.on('join', ({ name, code }, ack) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return ack?.({ error: 'Room not found' });
    if (r.players.size >= MAX_PLAYERS) return ack?.({ error: 'Room full' });
    enter(s, r, name); ack?.({ ok: true });
  });
  s.on('quick', ({ name }, ack) => {
    let r = [...rooms.values()].find(x => x.public && x.state !== 'ended' && x.players.size < MAX_PLAYERS) || createRoom(true);
    enter(s, r, name); ack?.({ ok: true });
  });
  s.on('ready', v => { const r = getRoom(s); if (!r || r.state !== 'lobby') return; r.players.get(s.id).ready = !!v; push(r); });
  s.on('team', t => { const r = getRoom(s); if (!r || r.state !== 'lobby' || r.mode !== 'tdm') return; if (t === 1 || t === 2) { r.players.get(s.id).team = t; push(r); } });
  s.on('cfg', c => {
    const r = getRoom(s); if (!r || r.host !== s.id || r.state !== 'lobby') return;
    if (c.mode === 'tdm' || c.mode === 'ffa') r.mode = c.mode;
    const mi = +c.mapId; if ([0, 1, 2].includes(mi) && mi !== r.mapId) { setMap(r, mi); io.to(r.code).emit('map', { boxes: r.boxes, mapId: mi }); }
    r.scoreLimit = Math.min(100, Math.max(5, +c.scoreLimit || 30)); r.duration = Math.min(1800, Math.max(60, +c.duration || 300));
    r.players.forEach(p => { if (r.mode === 'ffa') p.team = 0; else if (!p.team) p.team = smallerTeam(r); }); push(r);
  });
  s.on('startGame', () => { const r = getRoom(s); if (r && r.host === s.id && r.state === 'lobby') startMatch(r); });
  s.on('rematch', () => { const r = getRoom(s); if (r && r.host === s.id && r.state === 'ended') { r.state = 'lobby'; r.players.forEach(p => { p.ready = false; p.alive = false; }); io.to(r.code).emit('lobby'); push(r); } });

  s.on('m', a => {
    const r = getRoom(s); const p = r?.players.get(s.id); if (!p || r.state !== 'playing' || !p.alive || !Array.isArray(a) || a.some(x => !Number.isFinite(x))) return;
    const now = Date.now(), dt = Math.max(0.02, (now - p.lastMove) / 1000); p.lastMove = now;
    const dist = Math.hypot(a[0] - p.x, a[2] - p.z);
    if (dist > 14 * dt + 1 || Math.abs(a[0]) > 41 || Math.abs(a[2]) > 41) return s.emit('tp', { x: p.x, y: p.y, z: p.z });
    [p.x, p.y, p.z, p.yaw, p.pitch] = a;
  });
  s.on('sw', w => { const p = getRoom(s)?.players.get(s.id); if (p && WEAPONS[w]) p.w = w; });
  s.on('rl', () => {
    const r = getRoom(s); const p = r?.players.get(s.id); if (!p || !p.alive) return; const W = WEAPONS[p.w];
    if (!W.mag || p.ammo[p.w] === W.mag || Date.now() < p.reloadUntil) return;
    p.reloadUntil = Date.now() + W.reload; const w = p.w;
    setTimeout(() => { if (p.alive) { p.ammo[w] = W.mag; io.to(p.id).emit('ammo', { w, n: W.mag }); } }, W.reload);
  });
  s.on('shoot', ({ d }) => {
    const r = getRoom(s); const p = r?.players.get(s.id);
    if (!p || r.state !== 'playing' || !p.alive || !Array.isArray(d) || d.length !== 3 || d.some(x => !Number.isFinite(x))) return;
    const W = WEAPONS[p.w], now = Date.now();
    if (now < p.nextShot || now < p.reloadUntil || (W.mag && p.ammo[p.w] <= 0)) return;
    p.nextShot = now + W.rate - 10; if (W.mag) p.ammo[p.w]--; p.shots++;
    s.emit('ammo', { w: p.w, n: p.ammo[p.w] });
    const o = [p.x, p.y + 1.6, p.z], base = norm(d), ends = []; let landed = false;
    for (let i = 0; i < W.pellets; i++) {
      const dir = norm(base.map(c => c + (Math.random() - .5) * 2 * W.spread));
      const { t, hit } = trace(r, p, o, dir, W.range);
      ends.push(o.map((c, k) => +(c + dir[k] * t).toFixed(2)));
      if (hit) { landed = true; damage(r, p, hit.v, Math.round(W.dmg * (hit.head ? HEAD_MULT : 1)), hit.head, p.w); if (!hit.v.alive) break; }
    }
    if (landed) p.hits++;
    io.to(r.code).emit('shot', { id: p.id, o, ends, w: p.w });
  });
  s.on('disconnect', () => {
    const r = getRoom(s); const p = r?.players.get(s.id); if (!p) return;
    const remove = () => {
      r.players.delete(p.id); io.to(r.code).emit('toast', `${p.name} left`);
      if (!r.players.size) { clearTimeout(r.auto); rooms.delete(r.code); return; }
      if (r.host === p.id) r.host = ([...r.players.values()].find(x => !x.gone) || [...r.players.values()][0]).id; push(r);
    };
    if (!p.token) return remove();
    p.gone = true; p.dcTimer = setTimeout(remove, 20000); io.to(r.code).emit('toast', `${p.name} disconnected`);
  });
});

// 20 Hz snapshots + match timer
setInterval(() => {
  rooms.forEach(r => {
    if (r.state !== 'playing') return;
    if (Date.now() >= r.endsAt) return endMatch(r);
    io.to(r.code).volatile.emit('s', [...r.players.values()].map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3)]));
  });
}, 50);

server.listen(PORT, () => console.log('FPS server on', PORT));
