'use strict';
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH, DATA, LIMITS } = require('./config');
const { mkdirp } = require('./util');

mkdirp(DATA);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  ram_mib       INTEGER NOT NULL DEFAULT ${LIMITS.ramMiB},
  disk_mib      INTEGER NOT NULL DEFAULT ${LIMITS.diskMiB},
  cpu_percent   INTEGER NOT NULL DEFAULT ${LIMITS.cpuPercent},
  start_cmd     TEXT NOT NULL DEFAULT 'node index.js',
  auto_start    INTEGER NOT NULL DEFAULT 0,
  suspended     INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  detail  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit(at DESC);
`);

// Hard clamp: DB rows can never hold a limit above the host policy.
db.exec(`UPDATE users SET
  ram_mib     = MIN(COALESCE(NULLIF(ram_mib,0), ${LIMITS.ramMiB}), ${LIMITS.ramMiB}),
  disk_mib    = MIN(COALESCE(NULLIF(disk_mib,0), ${LIMITS.diskMiB}), ${LIMITS.diskMiB}),
  cpu_percent = MIN(COALESCE(NULLIF(cpu_percent,0), ${LIMITS.cpuPercent}), ${LIMITS.cpuPercent})`);

const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  allUsers: db.prepare('SELECT * FROM users ORDER BY role DESC, username ASC'),
  countUsers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'"),
  countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
  insertUser: db.prepare(`INSERT INTO users
      (username, pass_hash, pass_salt, role, ram_mib, disk_mib, cpu_percent, start_cmd, auto_start, note, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
  pass: db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?'),
  patch: db.prepare('UPDATE users SET start_cmd = ?, auto_start = ?, suspended = ?, note = ? WHERE id = ?'),
  touchLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM users WHERE id = ?'),
  insSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ua) VALUES (?,?,?,?,?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  delUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  gcSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  insAudit: db.prepare('INSERT INTO audit (at, actor, action, target, detail) VALUES (?,?,?,?,?)'),
  audit: db.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT ?'),
};

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    limits: { ramMiB: u.ram_mib, diskMiB: u.disk_mib, cpuPercent: u.cpu_percent },
    startCmd: u.start_cmd,
    autoStart: !!u.auto_start,
    suspended: !!u.suspended,
    note: u.note,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

function audit(actor, action, target, detail) {
  try {
    q.insAudit.run(Date.now(), String(actor || 'system'), action, String(target || ''), String(detail || '').slice(0, 400));
  } catch { /* non critical */ }
}

module.exports = { db, q, publicUser, audit, fs };
