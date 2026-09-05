'use strict';
/** Sandboxed file manager for a single user's directory, with hard quota. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { LIMITS, USERS_DIR } = require('./config');
const { dirSize, mkdirp, cleanRelPath, isInside, humanBytes } = require('./util');

const EDIT_MAX = 1024 * 1024; // 1 MiB — above this we refuse to open in the editor
const HIDDEN = new Set(['.tmp']);

function root(user) { return path.join(USERS_DIR, user.username); }
function quotaBytes(user) { return Math.min(user.disk_mib || LIMITS.diskMiB, LIMITS.diskMiB) * 1048576; }

function abs(user, rel) {
  const r = cleanRelPath(rel);
  const bad = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
  if (r === null) bad('Invalid path');
  const base = root(user);
  const target = path.resolve(base, r || '.');
  if (!isInside(base, target)) bad('Path escapes the sandbox');
  // walk up to the nearest existing ancestor, remembering the missing tail,
  // so a symlinked folder can never hop outside the user's home
  let probe = target;
  const missing = [];
  while (probe !== base && !fs.existsSync(probe)) {
    missing.unshift(path.basename(probe));
    const up = path.dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  let real;
  try { real = fs.realpathSync(probe); } catch { real = probe; }
  const baseReal = fs.realpathSync(base);
  if (!isInside(baseReal, real)) bad('Path escapes the sandbox');
  return path.join(real, ...missing);
}

function freeBytes(user) {
  return quotaBytes(user) - dirSize(root(user));
}

function assertQuota(user, incoming) {
  const free = freeBytes(user);
  if (incoming > free) {
    const e = new Error(`Disk limit reached — ${humanBytes(incoming)} needed, ${humanBytes(Math.max(0, free))} left of ${humanBytes(quotaBytes(user))}`);
    e.status = 507;
    throw e;
  }
}

function statEntry(user, full, name) {
  const st = fs.statSync(full);
  const rel = path.relative(root(user), full).split(path.sep).join('/');
  return {
    name,
    path: rel,
    dir: st.isDirectory(),
    size: st.isDirectory() ? 0 : st.size,
    mtime: Math.round(st.mtimeMs),
    mode: (st.mode & 0o777).toString(8),
    editable: st.isFile() && st.size <= EDIT_MAX,
  };
}

function list(user, rel) {
  const base = root(user);
  mkdirp(base);
  const target = abs(user, rel);
  if (!fs.existsSync(target)) { const e = new Error('Folder not found'); e.status = 404; throw e; }
  if (!fs.statSync(target).isDirectory()) { const e = new Error('Not a folder'); e.status = 400; throw e; }
  const entries = [];
  for (const name of fs.readdirSync(target)) {
    if (HIDDEN.has(name)) continue;
    let full;
    try { full = path.join(target, name); fs.statSync(full); } catch { continue; }
    try { entries.push(statEntry(user, full, name)); } catch { /* ignore */ }
  }
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const used = dirSize(base);
  return {
    path: path.relative(base, target).split(path.sep).join('/'),
    entries,
    parent: target === fs.realpathSync(base) ? null : path.relative(base, path.dirname(target)).split(path.sep).join('/'),
    usage: { used, quota: quotaBytes(user), free: quotaBytes(user) - used },
  };
}

function read(user, rel) {
  const full = abs(user, rel);
  const st = fs.statSync(full);
  if (st.isDirectory()) { const e = new Error('That is a folder'); e.status = 400; throw e; }
  if (st.size > EDIT_MAX) { const e = new Error(`File is ${humanBytes(st.size)} — download it to edit`); e.status = 413; throw e; }
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) { const e = new Error('Binary file — use download instead'); e.status = 415; throw e; }
  return { path: rel, content: buf.toString('utf8'), size: st.size, mtime: Math.round(st.mtimeMs) };
}

function write(user, rel, content) {
  const full = abs(user, rel);
  const body = Buffer.from(String(content ?? ''), 'utf8');
  const existed = fs.existsSync(full) ? fs.statSync(full).size : 0;
  assertQuota(user, body.length - existed);
  mkdirp(path.dirname(full));
  fs.writeFileSync(full, body);
  return { path: rel, size: body.length };
}

function createEntry(user, rel, kind) {
  const full = abs(user, rel);
  if (fs.existsSync(full)) { const e = new Error('Already exists'); e.status = 409; throw e; }
  assertQuota(user, 0);
  mkdirp(path.dirname(full));
  if (kind === 'dir') mkdirp(full);
  else { fs.closeSync(fs.openSync(full, 'wx')); fs.writeFileSync(full, defaultFor(full)); }
  return statEntry(user, full, path.basename(full));
}

function defaultFor(full) {
  const ext = path.extname(full).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return '// My bot\nconsole.log("Hello from my bot!");\n';
  }
  if (ext === '.json') return '{\n  "name": "my-bot",\n  "version": "1.0.0",\n  "main": "index.js"\n}\n';
  if (ext === '.env' || ext === '.txt' || ext === '.md') return '';
  return '';
}

function remove(user, rel) {
  const full = abs(user, rel);
  const base = fs.realpathSync(root(user));
  if (full === base) { const e = new Error('Cannot delete the bot root'); e.status = 400; throw e; }
  if (!fs.existsSync(full)) { const e = new Error('Not found'); e.status = 404; throw e; }
  fs.rmSync(full, { recursive: true, force: true });
  return { removed: rel };
}

function rename(user, from, to) {
  const a = abs(user, from);
  const b = abs(user, to);
  if (!fs.existsSync(a)) { const e = new Error('Not found'); e.status = 404; throw e; }
  if (fs.existsSync(b)) { const e = new Error('Target already exists'); e.status = 409; throw e; }
  mkdirp(path.dirname(b));
  fs.renameSync(a, b);
  return { from, to };
}

function search(user, needle) {
  const base = root(user);
  const q = String(needle || '').toLowerCase();
  const out = [];
  const stack = [''];
  while (stack.length && out.length < 200) {
    const rel = stack.pop();
    let names = [];
    try { names = fs.readdirSync(path.join(base, rel)); } catch { continue; }
    for (const name of names) {
      if (HIDDEN.has(name)) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.statSync(path.join(base, childRel)); } catch { continue; }
      if (st.isDirectory()) stack.push(childRel);
      else if (!q || name.toLowerCase().includes(q)) out.push({ path: childRel, name, size: st.size, mtime: Math.round(st.mtimeMs) });
      if (out.length >= 200) break;
    }
  }
  return out;
}

/* uploads stream to the user's own .tmp then get moved into place */
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(root(req.user), '.tmp');
      mkdirp(dir);
      cb(null, dir);
    },
    filename(req, file, cb) {
      const safe = (file.originalname || 'file').replace(/[\/\\\x00-\x1f]/g, '_').slice(-140) || 'file';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
    },
  }),
  limits: { fileSize: 128 * 1024 * 1024, files: 32 },
});

function commitUploads(user, files) {
  const results = [];
  let total = 0;
  for (const f of files || []) total += f.size;
  try {
    assertQuota(user, total);
    for (const f of files || []) {
      const rel = cleanRelPath(f.originalname || 'file');
      const target = abs(user, rel);
      mkdirp(path.dirname(target));
      fs.renameSync(f.path, target);
      results.push({ path: rel, size: f.size });
    }
  } catch (e) {
    for (const f of files || []) { try { fs.unlinkSync(f.path); } catch { /* gone */ } }
    throw e;
  }
  for (const f of files || []) { try { fs.unlinkSync(f.path); } catch { /* moved */ } }
  return results;
}

module.exports = {
  root, list, read, write, createEntry, remove, rename, search, statEntry,
  upload, commitUploads, freeBytes, quotaBytes, assertQuota, abs, HIDDEN,
};
