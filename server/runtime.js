'use strict';
/**
 * Runtime manager — one bot process per user.
 *
 * Real execution, no Docker/cgroups needed (this sandbox cannot create them):
 *  • PTY  : util-linux `script -qfc …` gives the bot a real pseudo-terminal, so
 *           node/npm behave interactively (colours, prompts, ^C through the line
 *           discipline, stdin). Falls back to plain pipes if `script` is absent.
 *  • RAM  : the whole process tree is sampled from /proc. RSS over the user's cap
 *           for >500 ms → the tree is killed (watchdog), V8 also gets
 *           --max-old-space-size so a Node heap blows up inside the cap.
 *  • CPU  : 1-second windows. The tree is allowed cpuPercent of one core inside a
 *           window; the moment the budget is spent it is SIGSTOPped until the
 *           window ends, then SIGCONTed. The budget self-corrects each window so
 *           the *average* lands on the cap instead of drifting over it.
 *  • DISK : `ulimit -f` caps what the bot itself can write, and every panel file
 *           operation is refused once the folder reaches the quota.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { LIMITS, LOGS_DIR, USERS_DIR, CONSOLE_COLS, CONSOLE_ROWS } = require('./config');
const { q, publicUser, audit } = require('./db');
const { mkdirp, shq, now, dirSize, dur } = require('./util');

const ALLOWED_BINS = new Set(['node', 'npm', 'npx']);
const TICK_MS = 60;      // enforcement sampling
const EMIT_EVERY = 4;    // ~240 ms: meters + websocket refresh
const DISK_MS = 4000;
const OOM_GRACE_MS = 500;
const RING_MAX = 256 * 1024;
const TREE_TTL = 1000;
const TICK_HZ = 100; // USER_HZ on Linux

const instances = new Map(); // userId -> instance
const listeners = new Map(); // userId -> Set(fn)
const usageCache = new Map(); // userId -> {cpu, ramMiB, diskMiB, history[]}
let heartbeat = null;
let tick = 0;

/* ------------------------------------------------------------------ helpers */
function userDir(u) { return path.join(USERS_DIR, u.username); }

function emit(userId, msg) {
  const set = listeners.get(userId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const fn of set) { try { fn(data); } catch { /* dead socket */ } }
}

function subscribe(userId, fn) {
  if (!listeners.has(userId)) listeners.set(userId, new Set());
  listeners.get(userId).add(fn);
  return () => listeners.get(userId)?.delete(fn);
}

function validateCmd(cmd) {
  const s = String(cmd || '').trim();
  if (!s) return { error: 'Start command is empty' };
  if (s.length > 200) return { error: 'Start command is too long (max 200 chars)' };
  // no shell operators / globbing / redirections — this is not a shell box
  if (/[;&|<>$`\n\r\\*?()[\]{}!#~"'%]/.test(s)) {
    return { error: 'Only a plain command is allowed — no pipes, redirects, quotes or shell operators' };
  }
  const tokens = s.split(/\s+/);
  if (!ALLOWED_BINS.has(path.basename(tokens[0]))) {
    return { error: 'Node.js runtime only — the command must start with node, npm or npx' };
  }
  for (const t of tokens) if (t.split('/').includes('..')) return { error: 'Path traversal is not allowed' };
  return { tokens };
}

function procStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    return { ppid: Number(f[1]), state: f[0], cpuMs: ((Number(f[11]) + Number(f[12])) * 1000) / TICK_HZ };
  } catch { return null; }
}

function procRssKb(pid) {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+) kB/);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

/** every pid in the tree at or below root (root included) */
function tree(rootPid) {
  const pids = [];
  let entries = [];
  try { entries = fs.readdirSync('/proc'); } catch { return [rootPid]; }
  const kids = new Map();
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    const st = procStat(pid);
    if (!st) continue;
    if (pid === rootPid) { pids.push(pid); continue; }
    if (!kids.has(st.ppid)) kids.set(st.ppid, []);
    kids.get(st.ppid).push(pid);
  }
  if (!pids.includes(rootPid)) pids.push(rootPid);
  let frontier = pids.slice();
  const seen = new Set(pids);
  while (frontier.length) {
    const next = [];
    for (const pid of frontier) {
      for (const child of kids.get(pid) || []) {
        if (!seen.has(child)) { seen.add(child); pids.push(child); next.push(child); }
      }
    }
    frontier = next;
  }
  return pids;
}

/** one cheap measurement of the whole tree: cumulative cpu + resident memory */
function measure(state) {
  const t = now();
  if (!state.pid) return { t, cpuMs: 0, rssKb: 0, stopped: false, pids: 0 };
  if (!state._tree || t - state._treeAt > TREE_TTL) { state._tree = tree(state.pid); state._treeAt = t; }
  let cpuMs = 0; let rssKb = 0; let stopped = false; let found = 0;
  for (const pid of state._tree) {
    const st = procStat(pid);
    if (!st) { state._tree = tree(state.pid); state._treeAt = t; } // a pid vanished: refresh once
    else { found++; cpuMs += st.cpuMs; rssKb += procRssKb(pid); if (st.state === 'T') stopped = true; }
  }
  if (cpuMs < (state.lastCpuMs || 0)) { cpuMs = state.lastCpuMs; } // pid recycled: never go backwards
  return { t, cpuMs, rssKb, stopped, pids: found };
}

/** signal every pid in the tree, then the group too (script() starts a new session) */
function killTree(rootPid, signal) {
  if (!rootPid) return 0;
  for (const pid of tree(rootPid)) { try { process.kill(pid, signal); } catch { /* gone */ } }
  try { process.kill(-rootPid, signal); } catch { /* not a group leader */ }
  return 1;
}

const sendCtrlC = (state) => { try { state.child.stdin.write('\x03'); return true; } catch { return false; } };

function hasPty() {
  if (hasPty.cached === undefined) hasPty.cached = spawnSync('sh', ['-c', 'command -v script'], { encoding: 'utf8' }).status === 0;
  return hasPty.cached;
}

/* ------------------------------------------------------------------- usage */
function seedUsage(u) {
  if (!usageCache.has(u.id)) {
    usageCache.set(u.id, {
      cpu: 0, ramMiB: 0, diskBytes: 0, diskMiB: 0,
      history: Array.from({ length: 60 }, () => ({ cpu: 0, ram: 0 })),
    });
  }
  return usageCache.get(u.id);
}

function updateUsage(u, state) {
  const cache = seedUsage(u);
  const t = now();
  let cpu = 0; let ramMiB = 0;
  if (state && state.status === 'running' && state.pid) {
    ramMiB = (state.lastRssKb || 0) / 1024;
    state.cpuPoints = (state.cpuPoints || []).filter((p) => t - p.t <= 1500);
    state.cpuPoints.push({ t, ms: state.lastCpuMs || 0 });
    const first = state.cpuPoints[0];
    const span = t - first.t;
    if (span > 150) cpu = ((state.lastCpuMs - first.ms) / span) * 100;
  } else if (state) {
    state.cpuPoints = [];
    ramMiB = 0; cpu = 0;
  }
  cache.cpu = Math.max(0, Math.min(cpu, 400));
  cache.ramMiB = ramMiB;
  cache.overRam = ramMiB > Math.min(u.ram_mib, LIMITS.ramMiB);
  cache.history.push({ cpu: +cache.cpu.toFixed(1), ram: +ramMiB.toFixed(1) });
  while (cache.history.length > 60) cache.history.shift();
}

function refreshDisk(u) {
  const cache = seedUsage(u);
  const bytes = dirSize(userDir(u));
  cache.diskBytes = bytes;
  cache.diskMiB = bytes / 1048576;
  return bytes;
}

function getState(u) {
  const inst = instances.get(u.id);
  const usage = usageCache.get(u.id) || { cpu: 0, ramMiB: 0, diskMiB: 0, history: [] };
  const running = !!(inst && inst.status === 'running');
  return {
    user: publicUser(u),
    running,
    status: running ? (inst.throttled ? 'throttled' : 'running') : (inst ? inst.status : 'offline'),
    pid: running ? inst.pid : null,
    startedAt: running ? inst.startedAt : null,
    uptimeMs: running ? now() - inst.startedAt : 0,
    uptime: running ? dur(now() - inst.startedAt) : '—',
    exit: inst ? inst.exit : null,
    restarts: inst ? inst.restarts : 0,
    throttled: !!(inst && inst.throttled),
    oomKills: inst ? inst.oomKills : 0,
    cpuSeconds: inst ? +(Math.round((inst.lastCpuMs || 0) - (inst.cpuAtStart || 0)) / 1000).toFixed(1) : 0,
    usage: {
      cpu: +usage.cpu.toFixed(1),
      ramMiB: +usage.ramMiB.toFixed(1),
      diskMiB: +(usage.diskMiB || 0).toFixed(1),
      diskBytes: usage.diskBytes || 0,
      history: usage.history || [],
    },
    limits: {
      ramMiB: Math.min(u.ram_mib, LIMITS.ramMiB),
      diskMiB: Math.min(u.disk_mib, LIMITS.diskMiB),
      cpuPercent: Math.min(u.cpu_percent, LIMITS.cpuPercent),
    },
  };
}

/* --------------------------------------------------------------- lifecycle */
function banner(state, text) {
  state.ring = (state.ring + text).slice(-RING_MAX);
  try { fs.appendFileSync(state.logFile, text); } catch { /* ignore */ }
  emit(state.userId, { t: 'term', s: text });
}

function start(u, overrideCmd) {
  const prev = instances.get(u.id);
  if (prev && prev.status === 'running') return { error: 'Bot is already running — stop it first' };
  if (u.suspended) return { error: 'Account is suspended' };

  const cmd = String(overrideCmd || u.start_cmd || 'node index.js').trim();
  const parsed = validateCmd(cmd);
  if (parsed.error) return { error: parsed.error };

  const dir = mkdirp(userDir(u));
  mkdirp(path.join(dir, '.tmp'));

  const ramLimit = Math.min(u.ram_mib, LIMITS.ramMiB);
  const diskLimit = Math.min(u.disk_mib, LIMITS.diskMiB);
  const cpuLimit = Math.min(u.cpu_percent, LIMITS.cpuPercent);
  const heapMb = Math.max(64, Math.floor(ramLimit * 0.8));
  const fileBlocks = Math.floor(diskLimit * 2048); // bash `ulimit -f` counts 512-byte blocks

  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    TMPDIR: path.join(dir, '.tmp'),
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${heapMb}`.trim(),
    BOT_USER: u.username,
    BOT_PANEL: '1',
  };

  const inner =
    `stty cols ${CONSOLE_COLS} rows ${CONSOLE_ROWS} 2>/dev/null; ` +
    `ulimit -f ${fileBlocks} 2>/dev/null; ulimit -c 0 2>/dev/null; ` +
    `exec nice -n 10 ${parsed.tokens.map(shq).join(' ')}`;

  const usePty = hasPty();
  let child;
  try {
    child = spawn(usePty ? 'script' : parsed.tokens[0],
      usePty ? ['-q', '-f', '-c', inner, '/dev/null'] : parsed.tokens.slice(1),
      { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  } catch (e) {
    return { error: 'Failed to launch: ' + e.message };
  }

  const state = {
    userId: u.id, username: u.username, pid: child.pid, child, dir, cmd, pty: usePty,
    status: 'running', startedAt: now(),
    ring: prev ? prev.ring : '',
    logFile: path.join(mkdirp(LOGS_DIR), `${u.username}.log`),
    throttled: false, stopCount: 0, oomKills: prev ? prev.oomKills : 0, restarts: prev ? prev.restarts + 1 : 0,
    exit: null, lastKillReason: null, lastRssKb: 0, lastCpuMs: 0, cpuPoints: [], _tree: null, _treeAt: 0,
    winStart: now(), winCpu: 0, overRamSince: 0, dirty: true,
    limits: { ramLimit, diskLimit, cpuLimit, cpuBudgetMs: (cpuLimit / 100) * 1000 },
  };
  state.effBudget = state.limits.cpuBudgetMs;
  instances.set(u.id, state);
  const m0 = measure(state);
  state.lastCpuMs = m0.cpuMs; state.cpuAtStart = m0.cpuMs; state.winCpu = m0.cpuMs;

  const onData = (buf) => {
    let text = buf.toString('utf8');
    if (!state.pty) text = text.replace(/\n/g, '\r\n');
    state.ring = (state.ring + text).slice(-RING_MAX);
    try { fs.appendFileSync(state.logFile, text); } catch { /* ignore */ }
    emit(u.id, { t: 'term', s: text });
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  banner(state, `\x1b[38;5;245m▶ ${cmd}\x1b[0m  \x1b[38;5;245m(ram ${ramLimit} MiB · disk ${diskLimit} MiB · cpu ${cpuLimit}%)\x1b[0m\r\n`);

  child.on('exit', (code, sig) => {
    if (state.throttled) { try { killTree(state.pid, 'SIGCONT'); } catch { /* gone */ } state.throttled = false; }
    const oom = state.lastKillReason === 'oom';
    const why = oom
      ? `\x1b[31m✖ killed — exceeded the ${ramLimit} MiB memory limit (RAM watchdog)\x1b[0m`
      : sig
        ? `\x1b[38;5;214m■ stopped by signal ${sig}\x1b[0m`
        : `\x1b[38;5;245m■ process exited — code ${code ?? 0}\x1b[0m`;
    banner(state, why + '\r\n');
    state.status = oom ? 'oom' : 'offline';
    state.exit = { code, sig, at: now(), oom };
    state.pid = null;
    updateUsage(u, state);
    emit(u.id, { t: 'status', status: state.status, exit: state.exit });
    emit(u.id, { t: 'state', s: getState(q.userById.get(u.id) || u) });
  });
  child.on('error', (e) => {
    banner(state, `\x1b[31m✖ spawn error: ${e.message}\x1b[0m\r\n`);
    state.status = 'offline';
    emit(u.id, { t: 'status', status: 'offline', exit: { error: e.message, at: now() } });
  });

  ensureHeartbeat();
  audit(u.username, 'power.start', u.username, cmd);
  emit(u.id, { t: 'status', status: 'running' });
  emit(u.id, { t: 'state', s: getState(u) });
  return { ok: true, pid: child.pid, pty: usePty };
}

function stop(u, mode = 'int') {
  const state = instances.get(u.id);
  if (!state || state.status !== 'running') return { error: 'Nothing is running' };
  state.lastKillReason = mode === 'kill' ? 'manual-kill' : 'manual';
  if (mode === 'kill') {
    killTree(state.pid, 'SIGKILL');
    audit(u.username, 'power.kill', u.username, '');
    return { ok: true };
  }
  banner(state, `\x1b[38;5;245m⏹ ${mode === 'term' ? 'sending SIGTERM…' : 'sending Ctrl-C…'}\x1b[0m\r\n`);
  if (mode === 'term') killTree(state.pid, 'SIGTERM');
  else if (!sendCtrlC(state)) killTree(state.pid, 'SIGINT');
  // escalate: grace period, then we take the tree down ourselves
  setTimeout(() => {
    if (instances.get(u.id) !== state || state.status !== 'running') return;
    banner(state, '\x1b[38;5;214m⚠ still running — SIGTERM to the process tree\x1b[0m\r\n');
    killTree(state.pid, 'SIGTERM');
  }, 5000).unref?.();
  setTimeout(() => {
    if (instances.get(u.id) !== state || state.status !== 'running') return;
    banner(state, '\x1b[31m⚠ forcing SIGKILL on the process tree\x1b[0m\r\n');
    killTree(state.pid, 'SIGKILL');
  }, 9000).unref?.();
  audit(u.username, 'power.stop', u.username, mode);
  return { ok: true };
}

function writeStdin(u, text) {
  const state = instances.get(u.id);
  if (!state || state.status !== 'running') return { error: 'Start the bot first' };
  try { state.child.stdin.write(text); return { ok: true }; } catch (e) { return { error: e.message }; }
}

function clearBuffer(u) {
  const state = instances.get(u.id);
  if (state) state.ring = '';
  return { ok: true };
}

const ring = (u) => instances.get(u.id)?.ring || '';

/* ------------------------------------------------------ enforcement loop */
function enforce(state, u) {
  const m = measure(state);
  state.lastCpuMs = m.cpuMs;
  state.lastRssKb = m.rssKb;
  state.dirty = true;
  const t = m.t;

  /* ---- CPU: 1 s window, freeze the tree once the budget is gone ---- */
  if (t - state.winStart >= 1000) {
    const used = Math.max(0, m.cpuMs - state.winCpu);
    if (used > state.limits.cpuBudgetMs) {
      // aim the next window low enough that the long-run average sits on the cap
      const want = state.limits.cpuBudgetMs * (state.limits.cpuBudgetMs / used);
      state.effBudget = Math.max(state.limits.cpuBudgetMs * 0.4, Math.min(state.limits.cpuBudgetMs, want));
    } else {
      state.effBudget = Math.min(state.limits.cpuBudgetMs, state.effBudget * 1.1 + 3);
    }
    if (state.throttled) { killTree(state.pid, 'SIGCONT'); state.throttled = false; }
    state.winStart = t;
    state.winCpu = m.cpuMs;
  } else if (!state.throttled && (m.cpuMs - state.winCpu) > state.effBudget) {
    killTree(state.pid, 'SIGSTOP');
    state.throttled = true;
    state.stopCount++;
    if (state.stopCount === 1 || state.stopCount % 60 === 0) {
      banner(state, `\x1b[38;5;214m⚠ CPU throttled — hard limit is ${state.limits.cpuLimit}% of one core\x1b[0m\r\n`);
    }
  }

  /* ---- RAM watchdog ---- */
  const rss = m.rssKb / 1024;
  if (rss > state.limits.ramLimit) {
    if (!state.overRamSince) state.overRamSince = t;
    else if (t - state.overRamSince >= OOM_GRACE_MS) {
      state.lastKillReason = 'oom';
      state.oomKills++;
      state.overRamSince = 0;
      banner(state, `\r\n\x1b[31m⚠ ${rss.toFixed(0)} MiB used of ${state.limits.ramLimit} MiB — killing the process tree\x1b[0m\r\n`);
      audit('system', 'limit.oom', u.username, `${rss.toFixed(0)}MiB > ${state.limits.ramLimit}MiB`);
      if (state.throttled) killTree(state.pid, 'SIGCONT');
      killTree(state.pid, 'SIGKILL');
    }
  } else {
    state.overRamSince = 0;
  }
}

function ensureHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    tick++;
    const emitTick = tick % EMIT_EVERY === 0;
    for (const [userId, state] of instances) {
      const u = q.userById.get(userId);
      if (!u) { instances.delete(userId); usageCache.delete(userId); continue; }
      if (state.status !== 'running' || !state.pid) {
        if (state.dirty) {
          state.dirty = false;
          updateUsage(u, state);
          emit(userId, { t: 'state', s: getState(u) });
        }
        continue;
      }
      enforce(state, u);
      if (emitTick) {
        updateUsage(u, state);
        emit(userId, { t: 'state', s: getState(u) });
      }
    }
  }, TICK_MS);
  heartbeat.unref?.();

  setInterval(() => {
    for (const u of q.allUsers.all()) {
      const bytes = refreshDisk(u);
      emit(u.id, { t: 'state', s: getState(u) });
      if (bytes > Math.min(u.disk_mib, LIMITS.diskMiB) * 1048576) {
        audit('system', 'limit.disk', u.username, `${(bytes / 1048576).toFixed(0)}MiB over quota`);
      }
    }
  }, DISK_MS).unref?.();
}

function stopAll() {
  for (const [, state] of instances) if (state.status === 'running') killTree(state.pid, 'SIGKILL');
}

function boot() {
  mkdirp(USERS_DIR);
  for (const u of q.allUsers.all()) {
    seedUsage(u);
    refreshDisk(u);
    if (u.auto_start && !u.suspended) {
      const r = start(u);
      if (r.error) console.warn(`[runtime] autostart ${u.username}: ${r.error}`);
    }
  }
  ensureHeartbeat();
}

module.exports = {
  start, stop, writeStdin, clearBuffer, ring, getState, subscribe, boot, stopAll,
  validateCmd, userDir, refreshDisk, usageCache, ALLOWED_BINS,
};
