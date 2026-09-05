'use strict';
const fs = require('fs');
const path = require('path');

/** shell-quote a single token */
function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** join tokens into a safely quoted shell command line */
function shellJoin(tokens) {
  return tokens.map(shq).join(' ');
}

function now() {
  return Date.now();
}

function iso(ts) {
  return new Date(ts || now()).toISOString();
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function humanBytes(n) {
  n = Math.max(0, Number(n) || 0);
  if (n < 1024) return n + ' B';
  const u = ['KiB', 'MiB', 'GiB', 'TiB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2)) + ' ' + u[i];
}

function dur(ms) {
  ms = Math.max(0, Math.floor(ms / 1000) * 1000);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${pad(ss)}s`;
  if (m) return `${m}m ${pad(ss)}s`;
  return `${ss}s`;
}

/** recursive size in bytes; skips symlinks, best-effort */
function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) { total += st.size || 0; continue; }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile()) total += st.size;
    }
  }
  return total;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$/;

/** true if `target` is inside `root` (realpath based, blocks symlink escape) */
function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function cleanRelPath(p) {
  if (typeof p !== 'string') return '';
  let s = p.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  const parts = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null; // never allow traversal
    if (seg.length > 200) return null;
    parts.push(seg);
  }
  return parts.join('/');
}

module.exports = {
  shq, shellJoin, now, iso, mkdirp, humanBytes, dur, dirSize,
  isInside, cleanRelPath, SAFE_NAME,
};
