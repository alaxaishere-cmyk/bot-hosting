'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const files = require('./files');
const runtime = require('./runtime');
const { q, publicUser, audit } = require('./db');
const auth = require('./auth');
const { LIMITS, SERVER, TEMPLATES_DIR, USERS_DIR } = require('./config');
const { mkdirp, dirSize, humanBytes, now, dur } = require('./util');

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message || 'Bad request' }); } };

const api = express.Router();

/* ------------------------------------------------------------------- auth */
api.post('/login', (req, res) => {
  auth.login(req, res, req.body && req.body.username, req.body && req.body.password);
});

api.post('/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });

api.get('/session', (req, res) => {
  const user = auth.userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ user: publicUser(user), limits: LIMITS, server: SERVER });
});

api.get('/server', (req, res) => {
  const users = q.allUsers.all();
  let online = 0;
  for (const u of users) if (runtime.getState(u).running) online++;
  res.json({
    server: SERVER,
    limits: LIMITS,
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cpus: os.cpus().length,
      cpuModel: (os.cpus()[0] || {}).model || 'unknown',
      load: os.loadavg().map((x) => +x.toFixed(2)),
      memTotal: os.totalmem(),
      memFree: os.freemem(),
      uptime: dur(os.uptime() * 1000),
      node: process.version,
    },
    allocation: {
      users: users.length,
      online,
      ramReservedMiB: users.reduce((s, u) => s + Math.min(u.ram_mib, LIMITS.ramMiB), 0),
      diskReservedMiB: users.reduce((s, u) => s + Math.min(u.disk_mib, LIMITS.diskMiB), 0),
      diskUsedMiB: Math.round(dirSize(USERS_DIR) / 1048576),
    },
  });
});

/* ---------------------------------------------------------------- self */
const self = express.Router();
self.use(auth.requireAuth);

self.get('/', (req, res) => {
  res.json({
    user: publicUser(req.user),
    state: runtime.getState(req.user),
    limits: LIMITS,
    server: SERVER,
    blockedFor: 0,
  });
});

self.get('/state', (req, res) => res.json(runtime.getState(req.user)));
self.get('/buffer', (req, res) => res.json({ buffer: runtime.ring(req.user) }));
self.post('/console/clear', wrap((req, res) => res.json(runtime.clearBuffer(req.user))));

self.post('/power', wrap((req, res) => {
  const action = String(req.body?.action || '');
  let out;
  if (action === 'start') out = runtime.start(req.user, req.body?.cmd);
  else if (action === 'stop') out = runtime.stop(req.user, 'int');
  else if (action === 'term') out = runtime.stop(req.user, 'term');
  else if (action === 'kill') out = runtime.stop(req.user, 'kill');
  else if (action === 'restart') {
    runtime.stop(req.user, 'kill');
    setTimeout(() => runtime.start(req.user), 350);
    out = { ok: true, note: 'restarting' };
  } else if (action === 'send') out = runtime.writeStdin(req.user, String(req.body?.data ?? ''));
  else out = { error: 'Unknown action' };
  if (out && out.error) return res.status(400).json(out);
  res.json(out || { ok: true });
}));

self.patch('/settings', wrap((req, res) => {
  const startCmd = req.body?.startCmd !== undefined ? String(req.body.startCmd).trim() : req.user.start_cmd;
  const check = runtime.validateCmd(startCmd);
  if (check.error) { const e = new Error(check.error); e.status = 400; throw e; }
  const autoStart = req.body?.autoStart === undefined ? !!req.user.auto_start : !!req.body.autoStart;
  q.patch.run(startCmd, autoStart ? 1 : 0, req.user.suspended, req.user.note, req.user.id);
  audit(req.user.username, 'settings', req.user.username, startCmd);
  res.json({ ok: true, user: publicUser(q.userById.get(req.user.id)) });
}));

self.post('/password', wrap((req, res) => {
  const current = String(req.body?.current || '');
  const password = String(req.body?.password || '');
  if (!auth.verifyPassword(current, req.user.pass_salt, req.user.pass_hash)) {
    return res.status(403).json({ error: 'Current password is wrong' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const { salt, hash } = auth.hashPassword(password);
  q.pass.run(hash, salt, req.user.id);
  audit(req.user.username, 'self.password', req.user.username, '');
  res.json({ ok: true });
}));

/* files */
self.get('/files', wrap((req, res) => res.json(files.list(req.user, req.query.path || ''))));
self.get('/files/search', wrap((req, res) => res.json({ results: files.search(req.user, req.query.q) })));
self.get('/file', wrap((req, res) => res.json(files.read(req.user, String(req.query.path || '')))));
self.put('/file', wrap((req, res) => {
  const out = files.write(req.user, String(req.body?.path || ''), req.body?.content);
  runtime.refreshDisk(req.user);
  res.json(out);
}));
self.post('/file', wrap((req, res) => {
  const out = files.createEntry(req.user, String(req.body?.path || ''), req.body?.dir ? 'dir' : 'file');
  runtime.refreshDisk(req.user);
  res.json(out);
}));
self.post('/file/delete', wrap((req, res) => {
  const out = files.remove(req.user, String(req.body?.path || ''));
  runtime.refreshDisk(req.user);
  res.json(out);
}));
self.post('/file/rename', wrap((req, res) => {
  const out = files.rename(req.user, String(req.body?.from || ''), String(req.body?.to || ''));
  runtime.refreshDisk(req.user);
  res.json(out);
}));
self.get('/file/download', (req, res) => {
  try {
    const full = files.abs(req.user, String(req.query.path || ''));
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return res.status(404).json({ error: 'Not a file' });
    res.download(full, path.basename(full));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
self.post('/file/upload', (req, res, next) => {
  files.upload.array('files', 32)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 128 MiB' : err.message });
    try {
      const out = files.commitUploads(req.user, req.files);
      runtime.refreshDisk(req.user);
      res.json({ uploaded: out });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
});

/* ---------------------------------------------------------------- admin */
const admin = express.Router();
admin.use(auth.requireAdmin);

admin.get('/users', wrap((req, res) => {
  const rows = q.allUsers.all().map((u) => {
    const st = runtime.getState(u);
    return {
      ...publicUser(u),
      running: st.running,
      status: st.status,
      uptime: st.uptime,
      throttled: st.throttled,
      oomKills: st.oomKills,
      usage: st.usage,
      home: `/data/users/${u.username}`,
      filesBytes: dirSize(path.join(USERS_DIR, u.username)),
    };
  });
  res.json({ users: rows, limits: LIMITS });
}));

admin.post('/users', wrap((req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username: 3-24 chars, lowercase letters, numbers, "-" or "_" only' });
  }
  if (['admin', 'root', 'panel', 'bot', 'node', 'system'].includes(username) && !q.userByName.get(username)) {
    return res.status(400).json({ error: 'That username is reserved' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (q.userByName.get(username)) return res.status(409).json({ error: 'Username already exists' });

  const startCmd = String(req.body?.startCmd || 'node index.js').trim();
  const check = runtime.validateCmd(startCmd);
  if (check.error) return res.status(400).json({ error: check.error });

  const { salt, hash } = auth.hashPassword(password);
  const info = q.insertUser.run(
    username, hash, salt, 'user',
    LIMITS.ramMiB, LIMITS.diskMiB, LIMITS.cpuPercent, // locked — admin cannot override
    startCmd, req.body?.autoStart ? 1 : 0, String(req.body?.note || '').slice(0, 200), now(),
  );
  const id = Number(info.lastInsertRowid);
  const dir = mkdirp(path.join(USERS_DIR, username));

  // starter files so the panel is never empty
  if (req.body?.scaffold !== false) {
    for (const name of fs.readdirSync(TEMPLATES_DIR)) {
      const src = path.join(TEMPLATES_DIR, name);
      const dest = path.join(dir, name);
      try { fs.copyFileSync(src, dest); } catch { /* skip */ }
    }
  }
  audit(req.user.username, 'user.create', username, `${LIMITS.ramMiB}MiB RAM / ${LIMITS.diskMiB}MiB disk / ${LIMITS.cpuPercent}% CPU`);
  res.json({ ok: true, user: publicUser(q.userById.get(id)), limits: LIMITS });
}));

admin.patch('/users/:id', wrap((req, res) => {
  const target = q.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'No such user' });
  const startCmd = req.body?.startCmd !== undefined ? String(req.body.startCmd).trim() : target.start_cmd;
  const check = runtime.validateCmd(startCmd);
  if (check.error) return res.status(400).json({ error: check.error });
  const autoStart = req.body?.autoStart === undefined ? !!target.auto_start : !!req.body.autoStart;
  const suspended = req.body?.suspended === undefined ? !!target.suspended : !!req.body.suspended;
  const note = req.body?.note === undefined ? target.note : String(req.body.note).slice(0, 200);
  if (suspended && target.role === 'admin') return res.status(400).json({ error: 'Cannot suspend an admin' });
  q.patch.run(startCmd, autoStart ? 1 : 0, suspended ? 1 : 0, note, target.id);
  if (suspended) runtime.stop(target, 'kill');
  audit(req.user.username, 'user.update', target.username, `start=${startCmd} auto=${autoStart} suspended=${suspended}`);
  res.json({ ok: true, user: publicUser(q.userById.get(target.id)) });
}));

admin.post('/users/:id/password', wrap((req, res) => {
  const target = q.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'No such user' });
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const { salt, hash } = auth.hashPassword(password);
  q.pass.run(hash, salt, target.id);
  audit(req.user.username, 'user.password', target.username, '');
  res.json({ ok: true });
}));

admin.post('/users/:id/power', wrap((req, res) => {
  const target = q.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'No such user' });
  const action = String(req.body?.action || '');
  let out;
  if (action === 'start') out = runtime.start(target);
  else if (action === 'stop') out = runtime.stop(target, 'int');
  else if (action === 'kill') out = runtime.stop(target, 'kill');
  else if (action === 'restart') { runtime.stop(target, 'kill'); setTimeout(() => runtime.start(target), 350); out = { ok: true }; }
  else out = { error: 'Unknown action' };
  if (out && out.error) return res.status(400).json(out);
  audit(req.user.username, `admin.power.${action}`, target.username, '');
  res.json(out || { ok: true });
}));

admin.delete('/users/:id', wrap((req, res) => {
  const target = q.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'No such user' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Admin accounts are not deleted here' });
  runtime.stop(target, 'kill');
  if (req.query.files === '1') {
    try { fs.rmSync(path.join(USERS_DIR, target.username), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  q.delUserSessions.run(target.id);
  q.del.run(target.id);
  audit(req.user.username, 'user.delete', target.username, req.query.files === '1' ? 'files deleted too' : 'files kept');
  res.json({ ok: true });
}));

admin.get('/audit', wrap((req, res) => {
  const rows = q.audit.all(Math.min(300, Math.max(10, Number(req.query.limit) || 80)));
  res.json({ events: rows });
}));

api.use('/admin', admin);
api.use('/me', self);

module.exports = { api };
