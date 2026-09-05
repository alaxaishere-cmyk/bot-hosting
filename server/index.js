'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const { PORT, HOST, PUBLIC_DIR, DATA, USERS_DIR, LOGS_DIR, LIMITS, SERVER, TEMPLATES_DIR, ROOT } = require('./config');
const { mkdirp } = require('./util');
const auth = require('./auth');
const runtime = require('./runtime');
const files = require('./files');
const { q, publicUser, audit } = require('./db');
const { api } = require('./routes');

mkdirp(USERS_DIR);
mkdirp(LOGS_DIR);

const app = express();
app.disable('x-powered-by');
// a reverse proxy (nginx / caddy / fly) in front is the normal public setup; set
// PANEL_TRUST_PROXY=0 if you expose the port directly to the internet
app.set('trust proxy', process.env.PANEL_TRUST_PROXY !== '0');
if (process.env.PANEL_ALLOWED_HOSTS) {
  const allow = process.env.PANEL_ALLOWED_HOSTS.split(',').map((s) => s.trim());
  app.use((req, res, next) => (allow.includes(req.hostname) ? next() : res.status(400).json({ error: 'Host not allowed' })));
}
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, server: SERVER.id, users: q.allUsers.all().length }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
}, api);

/* static panel */
const XTERM = path.join(ROOT, 'node_modules', '@xterm', 'xterm');
app.use('/vendor/xterm', express.static(XTERM, { maxAge: '1h' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[panel] http error:', err && err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

/* ------------------------------------------------------------------ seed */
function seed() {
  const admins = q.countAdmins.get().n;
  if (admins > 0) return null;
  const username = (process.env.PANEL_ADMIN_USER || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'admin';
  const generated = !process.env.PANEL_ADMIN_PASS;
  const password = process.env.PANEL_ADMIN_PASS || ('Bot' + crypto.randomBytes(6).toString('base64url'));
  const { salt, hash } = auth.hashPassword(password);
  q.insertUser.run(username, hash, salt, 'admin', LIMITS.ramMiB, LIMITS.diskMiB, LIMITS.cpuPercent, 'node index.js', 0, 'founder', Date.now());
  // the admin gets a normal bot folder too (same locked limits as everyone else)
  const { USERS_DIR, TEMPLATES_DIR } = require('./config');
  const home = mkdirp(path.join(USERS_DIR, username));
  for (const name of fs.readdirSync(TEMPLATES_DIR)) {
    try { fs.copyFileSync(path.join(TEMPLATES_DIR, name), path.join(home, name)); } catch { /* ignore */ }
  }
  const note = [
    '— BOT HOSTING PANEL: first admin account —',
    `username: ${username}`,
    `password: ${password}`,
    generated ? '(auto-generated — change it inside the admin panel)' : '(taken from PANEL_ADMIN_PASS env)',
    `created:  ${new Date().toISOString()}`,
    '',
    'Sign in at http://localhost:3000 with these credentials.',
  ].join('\n');
  try { fs.writeFileSync(path.join(DATA, 'ADMIN_CREDENTIALS.txt'), note + '\n', { mode: 0o600 }); } catch { /* ignore */ }
  audit('system', 'seed.admin', username, '');
  return { username, password, generated, note };
}

/* ------------------------------------------------------------ ws console */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const user = auth.userFromRequest(req);
  if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
});

wss.on('connection', (ws, req, user) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const send = (obj) => { if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); };

  const unsubscribe = runtime.subscribe(user.id, (raw) => { if (ws.readyState === 1) ws.send(raw); });
  send({ t: 'hello', buffer: runtime.ring(user), state: runtime.getState(user), limits: LIMITS, server: SERVER });

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (msg.t === 'send') runtime.writeStdin(user, String(msg.s ?? ''));
    else if (msg.t === 'power') {
      const action = String(msg.action || '');
      let out;
      if (action === 'start') out = runtime.start(user, msg.cmd);
      else if (action === 'stop') out = runtime.stop(user, 'int');
      else if (action === 'term') out = runtime.stop(user, 'term');
      else if (action === 'kill') out = runtime.stop(user, 'kill');
      else if (action === 'restart') { runtime.stop(user, 'kill'); setTimeout(() => runtime.start(user), 350); out = { ok: true }; }
      else out = { error: 'Unknown action' };
      if (out && out.error) send({ t: 'error', error: out.error });
    } else if (msg.t === 'clear') runtime.clearBuffer(user);
    else if (msg.t === 'ping') send({ t: 'pong' });
  });

  ws.on('close', () => unsubscribe());
  ws.on('error', () => unsubscribe());
});

const pinger = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* gone */ }
  }
}, 25000);
pinger.unref();

/* ------------------------------------------------------------------ boot */
const creds = seed();
runtime.boot();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  ⚡ Bot Hosting Panel  —  ${SERVER.name} (${SERVER.runtime} runtime)`);
  console.log(`  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  per-user limits: ${LIMITS.ramMiB} MiB RAM · ${LIMITS.diskMiB} MiB disk · ${LIMITS.cpuPercent}% CPU (locked)`);
  console.log(`  data: ${DATA}`);
  if (creds) {
    console.log('');
    console.log('  ── first admin account (created automatically) ──');
    console.log(`     username: ${creds.username}`);
    console.log(`     password: ${creds.password}`);
  }
  console.log('');
});

const bye = () => {
  console.log('[panel] shutting down, stopping bots…');
  clearInterval(pinger);
  runtime.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
