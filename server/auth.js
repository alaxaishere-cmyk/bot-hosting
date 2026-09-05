'use strict';
const crypto = require('crypto');
const { q, audit } = require('./db');
const { COOKIE, SESSION_TTL_MS } = require('./config');
const { now } = require('./util');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, user, ua) {
  const token = crypto.randomBytes(32).toString('hex');
  const at = now();
  q.insSession.run(token, user.id, at, at + SESSION_TTL_MS, String(ua || '').slice(0, 200));
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
  return token;
}

function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) q.delSession.run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function userFromRequest(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const sess = q.getSession.get(token);
  if (!sess) return null;
  if (sess.expires_at < now()) { q.delSession.run(token); return null; }
  const user = q.userById.get(sess.user_id);
  if (!user || user.suspended) return null;
  return user;
}

function tokenFromRequest(req) {
  return parseCookies(req)[COOKIE] || null;
}

/* ---- login throttling (per ip+username) ---- */
const attempts = new Map();
const MAX_ATTEMPTS = 6;
const BLOCK_MS = 60_000;

function throttleKey(req, username) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString().split(',')[0].trim();
  return `${ip}|${String(username || '').toLowerCase()}`;
}

function blockedFor(req, username) {
  const rec = attempts.get(throttleKey(req, username));
  if (!rec) return 0;
  if (rec.fails < MAX_ATTEMPTS) return 0;
  const left = rec.until - now();
  return left > 0 ? left : 0;
}

function noteFailure(req, username) {
  const key = throttleKey(req, username);
  const rec = attempts.get(key) || { fails: 0, until: 0 };
  rec.fails += 1;
  if (rec.fails >= MAX_ATTEMPTS) rec.until = now() + BLOCK_MS;
  attempts.set(key, rec);
}

function clearFailures(req, username) {
  attempts.delete(throttleKey(req, username));
}

function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

function login(req, res, username, password) {
  username = String(username || '').trim();
  const wait = blockedFor(req, username);
  if (wait) {
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${Math.ceil(wait / 1000)}s`,
    });
  }
  const user = q.userByName.get(username);
  const ok = user && !user.suspended && verifyPassword(String(password || ''), user.pass_salt, user.pass_hash);
  if (!ok) {
    noteFailure(req, username);
    if (user && user.suspended) audit(username, 'login.blocked', username, 'account suspended');
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  clearFailures(req, username);
  q.touchLogin.run(now(), user.id);
  createSession(res, user, req.headers['user-agent']);
  audit(user.username, 'login', user.username, '');
  res.json({ ok: true, user: require('./db').publicUser(user) });
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, userFromRequest,
  tokenFromRequest, parseCookies, requireAuth, requireAdmin, login, blockedFor,
};
