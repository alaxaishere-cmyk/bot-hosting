/* Bot Hosting Panel — front end (no build step, plain ES modules) */
'use strict';

/* ------------------------------------------------------------------ tiny dom */
const el = (tag, props = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
};
const $ = (sel, root = document) => root.querySelector(sel);
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

const PATHS = {
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10.5 10.5h3v3h-3z"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M18 6l-2 2M6 18l2-2M18 18l-2-2"/>',
  ram: '<rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M7 11v2M12 11v2M17 11v2"/><path d="M6 17v3M12 17v3M18 17v3"/>',
  disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>',
  bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10H12z"/>',
  folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6l1.8 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  fileCode: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m10 12-2 2 2 2M14 12l2 2-2 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 6.5l3 3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M18 20c0-2.6-1-4.2-2.6-5.2"/>',
  shield: '<path d="M12 3 5 5.8v5.4c0 4.3 3 7.6 7 9.1 4-1.5 7-4.8 7-9.1V5.8z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7 10 2.5 2.5L7 15"/><path d="M13 15.5h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12S18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 2 2-2 2-2-2-2 2"/>',
  send: '<path d="M4 12 20 4l-6 16-3-6z"/>',
};
const icon = (name, cls = 'icon') => el('span', { class: 'i', html: `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>` });

/* ------------------------------------------------------------------ helpers */
const fmtBytes = (n) => {
  n = Math.max(0, Number(n) || 0);
  if (n < 1024) return n + ' B';
  const u = ['KiB', 'MiB', 'GiB', 'TiB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2)) + ' ' + u[i];
};
const mib = (bytes) => (bytes / 1048576);
const fmtMiB = (n) => (Number(n) >= 100 ? Number(n).toFixed(0) : Number(n).toFixed(1)) + ' MiB';
const ago = (ts) => {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
const fmtTime = (ts) => new Date(ts).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const ext = (n) => (String(n).split('.').pop() || '').toLowerCase();

function toast(msg, kind = 'info', ms = 4200) {
  const t = el('div', { class: `toast ${kind}` }, [
    icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'bolt'),
    el('div', { class: 'tx', text: msg }),
  ]);
  $('.toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, ms);
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body && !(body instanceof FormData)) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  else if (body) opt.body = body;
  const r = await fetch('/api' + path, opt);
  if (r.status === 401 && S.user) { S.user = null; renderLogin(); throw new Error('Signed out'); }
  if (raw) return r;
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function modal({ title, icon: ic = 'settings', body, ok = 'Save', wide, onOk, onCancel, hideOk }) {
  const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) { close(); onCancel?.(); } } });
  const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  const close = () => scrim.remove();
  const btnOk = el('button', { class: 'btn pri', onclick: async () => {
    btnOk.disabled = true; btnOk.innerHTML = '<span class="spin"></span>';
    try { const r = await onOk?.(); if (r && r.error) throw new Error(r.error); close(); }
    catch (e) { toast(e.message, 'err'); btnOk.disabled = false; btnOk.textContent = ok; }
  } }, [ok]);
  box.append(
    el('div', { class: 'mh' }, [icon(ic), el('h3', { text: title }), el('button', { class: 'x', onclick: close, html: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' })]),
    el('div', { class: 'mb' }, [body]),
    el('div', { class: 'mf' }, [el('button', { class: 'btn ghost', onclick: () => { close(); onCancel?.(); }, text: 'Cancel' }), hideOk ? null : btnOk]),
  );
  scrim.append(box);
  document.body.append(scrim);
  setTimeout(() => box.querySelector('input,textarea')?.focus(), 40);
  return { close, box };
}

const confirmBox = (title, text, { ok = 'Yes, do it', extra = null, danger = true } = {}) => new Promise((resolve) => {
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; resolve(v); } };
  const body = el('div', {}, [
    el('p', { style: 'margin:0 0 12px;font-size:13.5px;line-height:1.6;color:var(--dim)', text }),
    extra || null,
  ]);
  modal({
    title, icon: 'alert', ok, body,
    onOk: async () => { done(true); },
    onCancel: () => done(false),
  });
  return extra;
});

/* ------------------------------------------------------------------ state */
const S = {
  user: null, server: null, limits: null,
  st: null, view: 'console', files: { path: '', entries: [], usage: null, parent: null },
  sel: null, editor: { path: null, content: '', dirty: false, size: 0 },
  ws: null, wsTried: 0, term: null, fitOn: true, hist: [], admins: null,
  poll: null, autoScroll: true,
};
const app = $('#app');

/* ------------------------------------------------------------------ login */
function renderLogin() {
  document.title = 'Sign in · Bot Hosting';
  const err = el('div', { class: 'login-err' });
  const uIn = el('input', { class: 'input', name: 'username', placeholder: 'admin', autocomplete: 'username', spellcheck: 'false' });
  const pIn = el('input', { class: 'input', type: 'password', name: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
  const eye = el('button', { class: 'eye', type: 'button', onclick: () => { pIn.type = pIn.type === 'password' ? 'text' : 'password'; } }, [icon('eye')]);
  const btn = el('button', { class: 'btn pri', type: 'submit' }, [icon('lock'), 'Sign in']);
  const form = el('form', {
    class: 'login-card',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = ''; btn.append(el('span', { class: 'spin' }), 'Signing in…');
      err.classList.remove('show');
      try {
        const d = await api('/login', { method: 'POST', body: { username: uIn.value.trim(), password: pIn.value } });
        S.user = d.user; await boot();
      } catch (ex) {
        err.textContent = ex.message; err.classList.add('show');
        btn.disabled = false; clear(btn).append(icon('lock'), 'Sign in');
        pIn.select();
      }
    },
  }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'brand-mark', text: '⚡' }),
      el('div', {}, [el('h1', { text: 'Bot Hosting Panel' }), el('p', { text: 'Node.js · one server · admin-made accounts' })]),
    ]),
    el('h2', { text: 'Welcome back' }),
    el('p', { class: 'sub', text: 'Sign in to open your bot console.' }),
    err,
    el('label', { class: 'field' }, [el('span', { text: 'Username' }), uIn]),
    el('label', { class: 'field' }, [el('span', { text: 'Password' }), el('div', { class: 'pw-wrap' }, [pIn, eye])]),
    btn,
    el('div', { class: 'login-foot' }, [icon('lock'), 'No sign-up — the admin creates every account.']),
  ]);
  clear(app).append(el('div', { class: 'login' }, [form]));
  setTimeout(() => uIn.focus(), 60);
}

/* ------------------------------------------------------------------ shell */
async function boot() {
  const d = await api('/session');
  S.user = d.user; S.limits = d.limits; S.server = d.server;
  renderShell();
}

const meterRefs = {};
function meterCard(kind, label, ico, unit, ofText) {
  const val = el('b', { text: '0' });
  const unitEl = el('i', { text: unit });
  const of = el('span', { text: ofText || '' });
  const pct = el('div', { class: 'm-pct', text: '0%' });
  const fill = el('i');
  const bar = el('div', { class: 'bar' }, [fill]);
  const canvas = el('canvas', { class: 'spark', width: 260, height: 30 });
  const foot = el('div', { class: 'm-foot' });
  const card = el('div', { class: 'meter', 'data-k': kind }, [
    el('div', { class: 'm-top' }, [el('div', { class: 'm-ico' }, [icon(ico)]), el('div', { class: 'm-name', text: label }), pct]),
    el('div', { class: 'm-val' }, [val, unitEl, of]),
    bar, canvas, foot,
  ]);
  meterRefs[kind] = { card, val, unitEl, of, pct, fill, bar, canvas, foot };
  return card;
}

function paintMeters() {
  const st = S.st; if (!st) return;
  const L = st.limits, U = st.usage;
  const diskPct = (U.diskMiB / L.diskMiB) * 100;
  const ramPct = (U.ramMiB / L.ramMiB) * 100;
  const cpuPct = (U.cpu / L.cpuPercent) * 100;

  const set = (kind, { main, unit, of, pct, p }) => {
    const m = meterRefs[kind]; if (!m) return;
    m.val.textContent = main;
    m.unitEl.textContent = unit;
    m.of.textContent = of;
    m.pct.textContent = pct;
    m.fill.style.width = Math.max(1.5, Math.min(100, p)) + '%';
    m.bar.classList.toggle('hi', p > 88);
  };
  set('cpu', { main: U.cpu.toFixed(1), unit: '%', of: `of ${L.cpuPercent}% · 1 core`, pct: Math.round(cpuPct) + '%', p: cpuPct });
  set('ram', { main: fmtMiB(U.ramMiB).split(' ')[0], unit: 'MiB', of: `of ${L.ramMiB} MiB`, pct: Math.round(ramPct) + '%', p: ramPct });
  set('disk', { main: fmtMiB(U.diskMiB).split(' ')[0], unit: 'MiB', of: `of ${L.diskMiB} MiB`, pct: Math.round(diskPct) + '%', p: diskPct });

  const lockChip = () => el('span', { class: 'lock' }, [icon('lock'), 'locked']);
  clear(meterRefs.cpu.foot).append(
    el('b', { text: st.running ? `pid ${st.pid}` : 'idle' }),
    el('span', { text: st.throttled ? '· frozen — over budget' : `· ${Math.round(L.cpuPercent * 10)} ms CPU/s` }),
    lockChip(),
  );
  clear(meterRefs.ram.foot).append(
    el('b', { text: st.oomKills ? `${st.oomKills} oom kill${st.oomKills > 1 ? 's' : ''}` : 'watchdog armed' }),
    el('span', { text: `· kill above ${L.ramMiB} MiB` }),
    lockChip(),
  );
  const free = Math.max(0, L.diskMiB - U.diskMiB);
  clear(meterRefs.disk.foot).append(
    el('b', { text: fmtMiB(free) + ' free' }),
    el('span', { text: `· ${S.files.count ?? '—'} items in /${S.user.username}` }),
    lockChip(),
  );

  S.hist.push({ cpu: U.cpu, ram: U.ramMiB, disk: U.diskMiB });
  while (S.hist.length > 60) S.hist.shift();
  drawSpark('cpu', 'cpu', L.cpuPercent, '#22d3ee');
  drawSpark('ram', 'ram', L.ramMiB, '#a78bfa');
  drawSpark('disk', 'disk', L.diskMiB, '#ffb020');
}

function drawSpark(kind, key, max, color) {
  const m = meterRefs[kind]; if (!m || !m.canvas.isConnected) return;
  const c = m.canvas, ctx = c.getContext && c.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 260, h = c.clientHeight || 30;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const data = S.hist.map((d) => d[key]);
  if (data.length < 2) return;
  const peak = Math.max(max * 0.55, ...data);
  const step = w / (data.length - 1);
  ctx.beginPath(); ctx.moveTo(0, h - 1);
  data.forEach((v, i) => ctx.lineTo(i * step, h - 1 - Math.min(h - 3, (v / peak) * (h - 4))));
  ctx.lineTo(w, h - 1); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  data.forEach((v, i) => { const x = i * step, y = h - 1 - Math.min(h - 3, (v / peak) * (h - 4)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke();
}

function renderShell() {
  document.title = `${S.user.username} · Bot Hosting`;
  const isAdmin = S.user.role === 'admin';
  const statusPill = el('span', { class: 'pill off', id: 'statusPill' }, [el('i', { class: 'dot' }), 'Offline']);
  const uptimeEl = el('span', { class: 'pill', id: 'uptimePill' }, [icon('clock'), el('b', { text: '—', style: 'font-family:var(--mono)' })]);

  /* --- tabs --- */
  const tabs = el('nav', { class: 'tabs', id: 'tabs' });
  const setView = (v) => {
    S.view = v; location.hash = '#/' + v;
    for (const t of tabs.children) t.classList.toggle('active', t.dataset.v === v);
    $('#mainPane').hidden = v !== 'console';
    $('#editorPane').hidden = v !== 'editor';
    $('#adminPane').hidden = v !== 'admin';
    for (const n of document.querySelectorAll('.nav-i')) n.classList.toggle('active', n.dataset.nav === v);
    if (v === 'console') { setTimeout(() => S.term?.fit?.(), 30); }
    if (v === 'admin') loadAdmin();
  };
  S.setView = setView;
  const mkTab = (v, label, ic) => el('button', { class: 'tab', 'data-v': v, onclick: () => setView(v) }, [icon(ic), label]);
  tabs.append(mkTab('console', 'Console', 'terminal'), mkTab('editor', 'Editor', 'fileCode'));
  if (isAdmin) tabs.append(mkTab('admin', 'Admin', 'shield'));
  S.mkTab = mkTab;

  /* --- user menu --- */
  const menu = el('div', { class: 'menu' });
  const who = el('button', { class: 'who', onclick: (e) => { e.stopPropagation(); menu.classList.toggle('open'); } }, [
    el('div', { class: 'ava', text: S.user.username.slice(0, 2).toUpperCase() }),
    el('div', {}, [el('div', { class: 'nm', text: S.user.username }), el('div', { class: 'rl', text: S.user.role })]),
  ]);
  menu.append(
    el('button', { onclick: () => { menu.classList.remove('open'); myAccount(); } }, [icon('settings'), 'Console settings']),
    el('button', { onclick: () => { menu.classList.remove('open'); changePassword(); } }, [icon('key'), 'Change password']),
    el('hr'),
    el('button', { onclick: async () => { await api('/logout', { method: 'POST' }); location.href = '/'; } }, [icon('logout'), 'Sign out']),
  );
  document.addEventListener('click', () => menu.classList.remove('open'));

  const topbar = el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'brand-mark', text: '⚡' }),
      el('div', {}, [
        el('h1', { text: 'Bot Hosting' }),
        el('p', { text: `${S.server.name} · ${S.server.runtime}` }),
      ]),
    ]),
    tabs,
    el('div', { class: 'spacer' }),
    statusPill, uptimeEl, who, menu,
  ]);

  const meters = el('section', { class: 'meters' }, [
    meterCard('cpu', 'CPU', 'cpu', '%', `of ${S.limits.cpuPercent}% · 1 core`),
    meterCard('ram', 'Memory', 'ram', 'MiB', `of ${S.limits.ramMiB} MiB`),
    meterCard('disk', 'Disk', 'disk', 'MiB', `of ${S.limits.diskMiB} MiB`),
  ]);

  /* --- sidebar: nav + files --- */
  const fileList = el('div', { class: 'files', id: 'fileList' });
  const crumbs = el('div', { class: 'crumbs', id: 'crumbs' });
  const search = el('input', { class: 'input', placeholder: 'Search files…', style: 'margin:0 10px 8px;padding:7px 10px;font-size:12.5px' });
  search.addEventListener('input', () => { S.searchQ = search.value.trim(); paintFiles(); });
  const qFill = el('i', { style: 'width:0%' });
  const qTxt = el('b', { text: '—' });
  const qTot = el('span', { text: '' });
  const side = el('aside', { class: 'card' }, [
    el('div', { class: 'c-head' }, [
      el('span', { class: 'c-title' }, [el('span', { text: 'Files' })]),
      el('div', { class: 'c-actions' }, [
        el('button', { class: 'btn sm ghost', title: 'New file', onclick: () => newEntry(false) }, [icon('file')]),
        el('button', { class: 'btn sm ghost', title: 'New folder', onclick: () => newEntry(true) }, [icon('folder')]),
        el('button', { class: 'btn sm ghost', title: 'Upload', onclick: pickUpload }, [icon('upload')]),
      ]),
    ]),
    el('nav', { class: 'nav' }, [
      el('button', { class: 'nav-i active', 'data-nav': 'console', onclick: () => setView('console') }, [icon('terminal'), 'Console', el('span', { class: 'cnt', text: '/' + S.user.username })]),
      isAdmin ? el('button', { class: 'nav-i', 'data-nav': 'admin', onclick: () => setView('admin') }, [icon('users'), 'Admin', el('span', { class: 'cnt', text: S.limits.ramMiB + ' MiB' })]) : null,
    ]),
    search, crumbs, fileList,
    el('div', { class: 'drop', id: 'drop' }, [icon('upload'), ' Drop files here to upload']),
    el('div', { class: 'side-foot' }, [
      el('div', { class: 'q-top' }, [qTxt, el('span', { text: 'used' }), qTot]),
      el('div', { class: 'bar' }, [qFill]),
    ]),
  ]);
  S.qFill = qFill; S.qTxt = qTxt; S.qTot = qTot;

  /* drag & drop */
  const drop = side.querySelector('#drop');
  const uploadFiles = (list) => doUpload(list, drop);
  ['dragenter', 'dragover'].forEach((ev) => side.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((ev) => side.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || !side.contains(e.relatedTarget)) drop.classList.remove('hot'); }));
  side.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files); });

  /* --- console --- */
  const termHost = el('div', { id: 'term', class: 'xterm' });
  const btnStart = el('button', { class: 'btn ok', onclick: () => power('start') }, [icon('play'), 'Start']);
  const btnRestart = el('button', { class: 'btn', onclick: () => power('restart') }, [icon('restart'), 'Restart']);
  const btnStop = el('button', { class: 'btn warn', onclick: () => power('stop') }, [icon('stop'), 'Stop']);
  const btnKill = el('button', { class: 'btn bad', onclick: () => power('kill') }, [icon('bolt')]);
  S.btnStart = btnStart; S.btnStop = btnStop; S.btnRestart = btnRestart; S.btnKill = btnKill; S.statusPill = statusPill; S.uptimeEl = uptimeEl;

  const cmdIn = el('input', { class: 'input', placeholder: 'Type here and press Enter — the line is sent to your running bot (stdin)', spellcheck: 'false', autocomplete: 'off' });
  cmdIn.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && cmdIn.value.length) {
      const line = cmdIn.value; cmdIn.value = '';
      const r = await send(line + '\r');
      if (r?.error) toast(r.error, 'err');
    }
  });
  const consoleCard = el('section', { class: 'card', id: 'mainPane' }, [
    el('div', { class: 'c-head' }, [
      el('span', { class: 'c-title', text: 'Bot console' }),
      el('span', { class: 'pill', id: 'cmdChip', title: 'Start command' }, [el('code', { style: 'font-family:var(--mono);font-size:11.5px', text: S.user.startCmd })]),
      el('div', { class: 'c-actions' }, [
        el('label', { class: 'pill', style: 'cursor:pointer', title: 'Follow new output' }, [
          el('input', { type: 'checkbox', checked: true, style: 'accent-color:var(--green);width:13px;height:13px', onchange: (e) => { S.autoScroll = e.target.checked; } }),
          'autoscroll',
        ]),
        el('button', { class: 'btn sm ghost', title: 'Clear the screen', onclick: () => { S.term?.clear?.(); api('/me/console/clear', { method: 'POST' }); } }, [icon('x'), 'Clear']),
        el('button', { class: 'btn sm ghost', title: 'Settings: start command, autostart', onclick: myAccount }, [icon('settings')]),
      ]),
    ]),
    el('div', { class: 'power' }, [
      el('span', { class: 'pill off', id: 'runPill' }, [el('i', { class: 'dot' }), 'Offline']),
      el('span', { class: 'pill', id: 'runUptime' }, [icon('clock'), '—']),
      el('span', { class: 'spacer' }),
      btnStart, btnRestart, btnStop, btnKill,
    ]),
    el('div', { class: 'console' }, [
      el('div', { class: 'termwrap' }, [termHost]),
      el('div', { class: 'cmdbar' }, [
        el('span', { class: 'pfx', text: '›' }), cmdIn,
        el('button', { class: 'btn', onclick: () => send('\x03'), title: 'Send Ctrl-C to the bot (interrupt)' }, [icon('stop'), 'Ctrl-C']),
        el('button', { class: 'btn pri', onclick: () => { const v = cmdIn.value; cmdIn.value = ''; send(v + '\r'); } }, [icon('send'), 'Send']),
      ]),
      el('p', { class: 'note', html: `<b>Live limits on your account:</b> ${S.limits.ramMiB} MiB RAM · ${S.limits.diskMiB} MiB disk · ${S.limits.cpuPercent}% CPU. One shared server, no upgrades — go over the RAM line and the panel kills the bot.` }),
    ]),
  ]);

  /* --- editor --- */
  const edName = el('span', { class: 'ed-name', text: 'no file open' });
  const edMeta = el('span', { class: 'ed-meta', text: '' });
  const edGutter = el('div', { class: 'ed-gutter', text: '1' });
  const edTa = el('textarea', { class: 'ed-ta', spellcheck: 'false', wrap: 'off' });
  const edSave = el('button', { class: 'btn pri', disabled: true, onclick: saveFile }, [icon('check'), 'Save']);
  S.edName = edName; S.edMeta = edMeta; S.edGutter = edGutter; S.edTa = edTa; S.edSave = edSave;
  edTa.addEventListener('input', () => { S.editor.dirty = true; S.editor.content = edTa.value; paintEditorState(); });
  edTa.addEventListener('scroll', () => { edGutter.scrollTop = edTa.scrollTop; });
  edTa.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const s = edTa.selectionStart; edTa.setRangeText('  ', s, edTa.selectionEnd, 'end'); edTa.dispatchEvent(new Event('input')); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); }
  });
  const editorCard = el('section', { class: 'card', id: 'editorPane', hidden: true }, [
    el('div', { class: 'ed-bar' }, [
      icon('fileCode'), edName, el('span', { class: 'spacer' }), edMeta,
      el('button', { class: 'btn sm ghost', onclick: () => runThisFile(), title: 'Set as start command and restart' }, [icon('play'), 'Run']),
      el('button', { class: 'btn sm ghost', onclick: () => downloadFile(S.editor.path), title: 'Download' }, [icon('download')]),
      edSave,
    ]),
    el('div', { class: 'editor' }, [
      el('div', { class: 'ed-area', id: 'edArea' }, [edGutter, edTa]),
      el('div', { class: 'ed-empty', id: 'edEmpty', hidden: true }, [
        icon('fileCode', 'icon lg'),
        el('div', { text: 'Open a file from the left panel to edit it' }),
        el('span', { class: 'hint', text: 'Ctrl+S saves · the Run button sets it as your start command' }),
      ]),
    ]),
  ]);
  S.editorCard = editorCard;

  const adminPane = el('section', { class: 'card', id: 'adminPane', hidden: true }, [el('div', { class: 'page', id: 'adminBody' }, [el('div', { class: 'err404', text: 'loading…' })])]);

  const body = el('div', { class: 'body' }, [side, el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-height:0' }, [consoleCard, editorCard, adminPane])]);

  clear(app).append(el('div', { class: 'shell' }, [topbar, meters, body]));
  $('#boot')?.classList.add('gone');

  initTerminal(termHost);
  connectWs();
  refreshState();
  loadFiles('');
  S.loadFiles = loadFiles;

  const view = (location.hash.replace('#/', '') || 'console');
  setView(isAdmin || view !== 'admin' ? view : 'console');
  let lastBuf = -1, lastBufAt = 0;
  S.poll = setInterval(async () => {
    if (S.ws && S.ws.readyState === 1) return;
    refreshState();
    const now = Date.now();
    if (now - lastBufAt < 1400) return;
    lastBufAt = now;
    try {
      const { buffer } = await api('/me/buffer');
      if ((buffer || '').length !== lastBuf) { lastBuf = (buffer || '').length; S.term?.reset?.(); if (buffer) writeTerm(buffer); }
    } catch { /* signed out */ }
  }, 1500);
}

/* ------------------------------------------------------------------ terminal */
function initTerminal(host) {
  if (!window.Terminal) { host.append(el('div', { class: 'err404', text: 'xterm.js failed to load' })); return; }
  const term = new window.Terminal({
    fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.35, cursorBlink: true,
    theme: { background: '#060a11', foreground: '#dbe6fb', cursor: '#4f8cff', selectionBackground: '#25406b' },
    scrollback: 4000, convertEol: false, macOptionIsMeta: true,
  });
  term.open(host);
  term.attachCustomKeyEventHandler((e) => {
    if (e.ctrlKey && e.key === 'l' && e.type === 'keydown') { term.clear(); return false; }
    return !(e.ctrlKey && ['s', 'p', 'f'].includes(e.key.toLowerCase()));
  });
  term.onData((data) => sendNoEcho(data));
  S.term = term;
  const fit = () => {
    const cols = Math.max(40, Math.floor(host.clientWidth / 7.6));
    const rows = Math.max(8, Math.floor(host.clientHeight / 17.2));
    if (term.cols !== cols || term.rows !== rows) { try { term.resize(cols, rows); } catch { /* ignore */ } }
  };
  term.fit = fit;
  new ResizeObserver(() => requestAnimationFrame(fit)).observe(host);
  window.addEventListener('resize', fit);
  setTimeout(fit, 60);
}

function writeTerm(s) {
  if (!S.term) return;
  S.term.write(s);
  if (S.autoScroll) S.term.scrollToBottom();
}

/* ------------------------------------------------------------------ websocket */
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => { S.wsTried = 0; };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'term') writeTerm(m.s);
    else if (m.t === 'hello') {
      if (m.buffer) { S.term?.reset?.(); }
      writeTerm(m.buffer || '');
      if (!m.buffer && !m.state.running) writeTerm('\x1b[38;5;245m  console is empty — press \x1b[37mStart\x1b[38;5;245m to run \x1b[37m' + (m.state.user.startCmd || 'your bot') + '\x1b[0m\x1b[38;5;245m.\x1b[0m\r\n');
      paintState(m.state);
    }
    else if (m.t === 'state') paintState(m.s);
    else if (m.t === 'status') { paintStatus(m.status); if (m.status === 'offline' || m.status === 'oom') refreshState(); }
    else if (m.t === 'error') toast(m.error, 'err');
  };
  ws.onclose = () => {
    S.ws = null;
    S.wsTried++;
    setTimeout(connectWs, Math.min(15000, 900 * S.wsTried));
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}
const sendNoEcho = (s) => { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ t: 'send', s })); else api('/me/power', { method: 'POST', body: { action: 'send', data: s } }).catch(() => {}); };
async function send(line) {
  if (S.ws?.readyState === 1) { S.ws.send(JSON.stringify({ t: 'send', s: line })); return null; }
  try { await api('/me/power', { method: 'POST', body: { action: 'send', data: line } }); } catch (e) { return { error: e.message }; }
  return null;
}

/* ------------------------------------------------------------------ state */
function paintState(st) {
  if (!st) return;
  S.st = st;
  paintMeters(); paintStatus(st.running ? (st.throttled ? 'throttled' : 'running') : st.status);
  const c = $('#cmdChip code'); if (c) c.textContent = st.user.startCmd;
}
function paintStatus(status) {
  const map = {
    running: ['on', '● Online'], throttled: ['thr', 'Throttled'], offline: ['off', '○ Offline'], oom: ['bad', '✖ OOM killed'],
  };
  const [cls, label] = map[status] || map.offline;
  for (const p of [S.statusPill, $('#runPill')]) {
    if (!p) continue;
    p.className = 'pill ' + cls;
    clear(p).append(el('i', { class: 'dot' }), label);
  }
  const off = status !== 'running' && status !== 'throttled';
  S.btnStart.disabled = !off; S.btnStop.disabled = off; S.btnRestart.disabled = off; S.btnKill.disabled = off;
  const up = $('#runUptime');
  if (up) clear(up).append(icon('clock'), S.st && !off ? S.st.uptime : '—');
}
async function refreshState() {
  try { paintState(await api('/me/state')); } catch { /* signed out */ }
}
function paintUptime() {
  if (!S.st) return;
  const txt = S.st.running ? S.st.uptime : '—';
  for (const n of [S.uptimeEl, $('#runUptime')]) { if (n) clear(n).append(icon('clock'), el('b', { text: txt, style: 'font-family:var(--mono)' })); }
}
setInterval(paintUptime, 1000);

async function power(action, extra = {}) {
  try {
    const r = await api('/me/power', { method: 'POST', body: { action, ...extra } });
    if (r.error) return toast(r.error, 'err');
    toast({ start: 'Starting bot…', stop: 'Stop signal sent', kill: 'Process killed', restart: 'Restarting…', term: 'SIGTERM sent' }[action] || 'ok', 'ok', 2200);
    if (action === 'start' || action === 'restart') { S.term?.clear?.(); }
    setTimeout(refreshState, 400);
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------------ files */
async function loadFiles(p = S.files.path) {
  try {
    const d = await api('/me/files?path=' + encodeURIComponent(p || ''));
    S.files = { ...d, count: d.entries.length };
    paintFiles();
  } catch (e) { toast(e.message, 'err'); }
}
function paintFiles() {
  const host = $('#fileList'); if (!host) return;
  clear(host);
  // breadcrumb
  const cr = $('#crumbs'); clear(cr);
  const segs = (S.files.path || '').split('/').filter(Boolean);
  cr.append(el('button', { onclick: () => loadFiles(''), text: '~' }));
  let acc = '';
  segs.forEach((s, i) => {
    acc = acc ? acc + '/' + s : s;
    const p = acc;
    cr.append(el('span', { text: '/', style: 'opacity:.4' }));
    cr.append(i === segs.length - 1 ? el('span', { class: 'cur', text: s }) : el('button', { text: s, onclick: () => loadFiles(p) }));
  });
  if (segs.length) cr.prepend(el('button', { class: 'up', title: 'Up', onclick: () => loadFiles(S.files.parent || ''), html: '<svg class="icon" style="width:13px;height:13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>' }));

  let entries = S.files.entries || [];
  if (S.searchQ) entries = entries.filter((e) => e.name.toLowerCase().includes(S.searchQ.toLowerCase()));
  if (!entries.length) {
    host.append(el('div', { class: 'err404', text: S.searchQ ? 'No match in this folder' : 'Empty folder — add files or press Start' }));
  }
  for (const e of entries) {
    const ic = e.dir ? 'folder' : /\.(js|mjs|cjs|json)$/.test(e.name) ? 'fileCode' : /\.(md|txt|env|log)$/.test(e.name) ? 'file' : 'file';
    const cls = e.dir ? 'f dir' : 'f ' + (['js', 'mjs', 'cjs'].includes(ext(e.name)) ? 'js' : ext(e.name) === 'json' ? 'json' : ext(e.name) === 'md' ? 'md' : e.size > 1024 * 1024 ? 'bin' : '');
    const row = el('div', {
      class: cls + (S.sel === e.path ? ' sel' : ''), 'data-p': e.path,
      onclick: () => { S.sel = e.path; paintFiles(); },
      ondblclick: () => (e.dir ? loadFiles(e.path) : openFile(e.path)),
    }, [
      el('span', { class: 'fi' }, [icon(ic)]),
      el('span', { class: 'nm', text: e.name }),
      el('span', { class: 'sz', text: e.dir ? '' : fmtBytes(e.size) }),
      el('button', { class: 'more', title: 'Actions', onclick: (ev) => { ev.stopPropagation(); fileMenu(ev, e, row); } }, [el('span', { text: '⋯' })]),
    ]);
    row.title = e.dir ? 'Double-click to open' : 'Double-click to edit';
    host.append(row);
  }
  // quota bar
  const u = S.files.usage;
  if (u) {
    const pct = Math.min(100, (u.used / u.quota) * 100);
    S.qFill.style.width = Math.max(1.5, pct) + '%';
    S.qFill.parentElement.classList.toggle('hi', pct > 88);
    S.qTxt.textContent = fmtMiB(mib(u.used));
    S.qTot.textContent = '/ ' + fmtMiB(mib(u.quota));
    S.qTot.style.color = pct > 88 ? 'var(--red)' : '';
  }
  // nav counts
  const navFiles = document.querySelector('.nav-i[data-nav="console"] .cnt');
  if (navFiles) navFiles.textContent = (S.files.count || 0) + ' items';
}

function fileMenu(ev, e, row) {
  document.querySelector('.fmenu')?.remove();
  const mk = (label, ic, fn, danger) => el('button', { class: danger ? 'danger' : '', onclick: () => { m.remove(); fn(); } }, [icon(ic), label]);
  const items = e.dir
    ? [mk('Open folder', 'chevR', () => loadFiles(e.path)), mk('New file inside', 'file', () => newEntry(false, e.path)), mk('Rename', 'edit', () => renameEntry(e)), mk('Delete folder', 'trash', () => deleteEntry(e), true)]
    : [
      mk('Edit', 'fileCode', () => openFile(e.path)),
      mk('Set as start command', 'play', () => setStartCmd(e.path)),
      mk('Rename', 'edit', () => renameEntry(e)),
      mk('Download', 'download', () => downloadFile(e.path)),
      mk('Delete', 'trash', () => deleteEntry(e), true),
    ];
  const m = el('div', { class: 'fmenu' }, items);
  document.body.append(m);
  const r = row.getBoundingClientRect();
  m.style.left = Math.min(window.innerWidth - 210, r.right - 190) + 'px';
  m.style.top = Math.min(window.innerHeight - 40 - items.length * 36, r.bottom + 6) + 'px';
  const kill = () => { m.remove(); document.removeEventListener('click', kill); };
  setTimeout(() => document.addEventListener('click', kill), 0);
}

function newEntry(dir, base = S.files.path) {
  const nameIn = el('input', { class: 'input mono', placeholder: dir ? 'my-folder' : 'bot.js', spellcheck: 'false' });
  const where = el('div', { class: 'hint', text: 'in /' + (base || '') });
  modal({
    title: dir ? 'New folder' : 'New file', icon: dir ? 'folder' : 'file', ok: 'Create',
    body: el('div', {}, [el('label', { class: 'field' }, [el('span', { text: 'Name' }), nameIn]), where]),
    onOk: async () => {
      const name = nameIn.value.trim().replace(/^\/+/, '');
      if (!name) throw new Error('Give it a name');
      const path = (base ? base + '/' : '') + name;
      await api('/me/file', { method: 'POST', body: { path, dir } });
      toast(dir ? 'Folder created' : 'File created', 'ok', 1800);
      await loadFiles(base);
      if (!dir) openFile(path);
    },
  });
}

async function deleteEntry(e) {
  if (!await confirmBox(`Delete ${e.dir ? 'folder' : 'file'}?`, `“${e.path}”${e.dir ? ' and everything inside it' : ''} will be removed. This cannot be undone.`)) return;
  try {
    await api('/me/file/delete', { method: 'POST', body: { path: e.path } });
    if (S.editor.path === e.path) { S.editor = { path: null, content: '', dirty: false, size: 0 }; paintEditorState(); }
    toast('Deleted', 'ok', 1600); loadFiles();
  } catch (err) { toast(err.message, 'err'); }
}

function renameEntry(e) {
  const to = el('input', { class: 'input mono', value: e.name });
  modal({
    title: 'Rename', icon: 'edit', ok: 'Rename',
    body: el('div', {}, [el('label', { class: 'field' }, [el('span', { text: 'New name (same folder)' }), to]), el('p', { class: 'hint', text: 'Use a path like docs/notes.md to move it too.' })]),
    onOk: async () => {
      const base = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/') + 1) : '';
      const v = to.value.trim();
      if (!v) throw new Error('Empty name');
      await api('/me/file/rename', { method: 'POST', body: { from: e.path, to: base + v } });
      if (S.editor.path === e.path) S.editor.path = base + v;
      toast('Renamed', 'ok', 1600); loadFiles();
    },
  });
}

const downloadFile = (p) => { if (!p) return; const a = document.createElement('a'); a.href = '/api/me/file/download?path=' + encodeURIComponent(p); a.download = ''; a.click(); };

function pickUpload() {
  const inp = el('input', { type: 'file', multiple: true, style: 'display:none' });
  inp.onchange = () => doUpload(inp.files);
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 1000);
}

async function doUpload(list, dropEl) {
  const files = [...(list || [])];
  if (!files.length) return;
  if (dropEl) dropEl.innerHTML = '<span class="spin"></span> uploading…';
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  try {
    const r = await api('/me/file/upload', { method: 'POST', body: fd });
    toast(`Uploaded ${r.uploaded.length} file${r.uploaded.length > 1 ? 's' : ''}`, 'ok', 2200);
    await loadFiles();
  } catch (e) { toast(e.message, 'err', 6000); }
  if (dropEl) dropEl.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.9 stroke-linecap=round><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg> Drop files here to upload';
}

async function setStartCmd(p) {
  const cmd = `node ${p}`;
  try {
    await api('/me/settings', { method: 'PATCH', body: { startCmd: cmd } });
    S.user.startCmd = cmd;
    toast('Start command → ' + cmd, 'ok', 2600);
    refreshState();
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------------ editor */
async function openFile(p) {
  try {
    const d = await api('/me/file?path=' + encodeURIComponent(p));
    S.editor = { path: p, content: d.content, dirty: false, size: d.size };
    S.edTa.value = d.content;
    S.setView('editor');
    paintEditorState();
  } catch (e) { toast(e.message, 'err'); }
}
function paintEditorState() {
  const { path, dirty, content } = S.editor;
  S.edName.textContent = path ? path : 'no file open';
  if (dirty) S.edName.append(el('span', { class: 'dirty', text: ' •' }));
  S.edMeta.textContent = path ? `${fmtBytes(new Blob([content || '']).size)} · ${content ? content.split('\n').length : 0} lines` : '';
  S.edSave.disabled = !dirty;
  const lines = (content || '').split('\n').length;
  S.edGutter.textContent = Array.from({ length: Math.max(1, lines) }, (_, i) => i + 1).join('\n');
  const area = $('#edArea'), empty = $('#edEmpty');
  if (area) area.hidden = !path;
  if (empty) empty.hidden = !!path;
  const tab = document.querySelector('.tab[data-v="editor"]');
  if (tab) tab.classList.toggle('active', S.view === 'editor' && !!path);
}
async function saveFile() {
  if (!S.editor.path) return;
  try {
    await api('/me/file', { method: 'PUT', body: { path: S.editor.path, content: S.edTa.value } });
    S.editor.dirty = false; S.editor.size = new Blob([S.edTa.value]).size;
    paintEditorState(); toast('Saved ' + S.editor.path, 'ok', 1800); loadFiles(S.files.path);
  } catch (e) { toast(e.message, 'err'); }
}
async function runThisFile() {
  if (!S.editor.path) return;
  if (S.editor.dirty) await saveFile();
  await setStartCmd(S.editor.path);
  await power('restart');
  S.setView('console');
}

/* ------------------------------------------------------------------ modals: account */
function myAccount() {
  const cmd = el('input', { class: 'input mono', value: S.user.startCmd });
  const auto = el('input', { type: 'checkbox' });
  auto.checked = !!S.user.autoStart;
  modal({
    title: 'Console settings', icon: 'settings', ok: 'Apply',
    body: el('div', {}, [
      el('label', { class: 'field' }, [el('span', { text: 'Start command' }), cmd]),
      el('p', { class: 'hint', text: 'Node.js only — must start with node, npm or npx. No pipes, redirects or shell operators.' }),
      el('label', { class: 'sw', style: 'margin-top:12px' }, [auto, el('span', { text: 'Autostart this bot when the server boots' })]),
      el('div', { class: 'chips', style: 'margin:14px 0 0' }, S.limits && [
        chip('RAM', S.limits.ramMiB + ' MiB'), chip('Disk', S.limits.diskMiB + ' MiB'), chip('CPU', S.limits.cpuPercent + '%'),
      ]),
    ]),
    onOk: async () => {
      const r = await api('/me/settings', { method: 'PATCH', body: { startCmd: cmd.value.trim(), autoStart: auto.checked } });
      S.user = r.user; toast('Settings saved', 'ok', 1800); refreshState(); loadFiles();
    },
  });
}
function changePassword() {
  const a = el('input', { class: 'input', type: 'password', placeholder: 'current password' });
  const b = el('input', { class: 'input', type: 'password', placeholder: 'new password (min 8 chars)' });
  modal({
    title: 'Change password', icon: 'key', ok: 'Change',
    body: el('div', {}, [
      el('label', { class: 'field' }, [el('span', { text: 'Current' }), a]),
      el('label', { class: 'field', style: 'margin-bottom:0' }, [el('span', { text: 'New' }), b]),
    ]),
    onOk: async () => { await api('/me/password', { method: 'POST', body: { current: a.value, password: b.value } }); toast('Password changed', 'ok'); },
  });
}

/* ------------------------------------------------------------------ admin */
const chip = (label, val) => el('div', { class: 'chip' }, [el('span', { style: 'color:var(--dim2)', text: label }), el('b', { text: val }), icon('lock', 'icon lk')]);

async function loadAdmin() {
  const host = $('#adminBody'); if (!host) return;
  try {
    const [users, server, audit] = await Promise.all([
      api('/admin/users'), api('/server'), api('/admin/audit?limit=40'),
    ]);
    clear(host).append(
      el('div', { class: 'page-head' }, [
        el('div', {}, [el('h2', { text: 'Admin' }), el('p', { text: `${server.allocation.users} accounts · ${server.allocation.online} online · ${server.host.hostname}` })]),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn ghost', onclick: () => loadAdmin() }, [icon('restart'), 'Refresh']),
        el('button', { class: 'btn pri', onclick: () => createUser() }, [icon('plus'), 'New user']),
      ]),
      el('div', { class: 'policy' }, [
        icon('lock'),
        el('div', { html: `Every account is capped at <b>${server.limits.ramMiB} MiB RAM</b>, <b>${server.limits.diskMiB} MiB disk</b> and <b>${server.limits.cpuPercent}% CPU</b> — enforced by the runtime, not the UI. Limits are locked, there is <b>one server</b>, and <b>self sign-up is disabled</b>.` }),
      ]),
      el('div', { class: 'grid4' }, [
        mini('Users', server.allocation.users, `${server.allocation.online} running`, 'users'),
        mini('RAM reserved', server.allocation.ramReservedMiB + ' MiB', `${Math.round((server.allocation.ramReservedMiB / (server.host.memTotal / 1048576)) * 100)}% of host ${Math.round(server.host.memTotal / 1048576)} MiB`, 'ram'),
        mini('Disk used', server.allocation.diskUsedMiB + ' MiB', `of ${server.allocation.diskReservedMiB} MiB allocated`, 'disk'),
        mini('Host CPU', (server.host.load[0]).toFixed(2) + ' load', `${server.host.cpus} cores · ${server.host.node}`, 'cpu'),
      ]),
      usersTable(users.users),
      el('div', { style: 'height:14px' }),
      el('div', { class: 'card' }, [
        el('div', { class: 'c-head' }, [icon('clock', 'icon'), el('span', { class: 'c-title', text: 'Activity' })]),
        el('div', { style: 'max-height:260px;overflow:auto' }, audit.events.map((e) => el('div', { class: 'evt' }, [
          el('time', { text: fmtTime(e.at) }),
          el('span', { class: 'who2', text: e.actor }),
          el('span', { class: 'tag pill', text: e.action }),
          el('span', { class: 'd', text: (e.target ? e.target + ' ' : '') + (e.detail || '') }),
        ]))),
      ]),
    );
  } catch (e) { clear(host).append(el('div', { class: 'err404', text: e.message })); }
}

const mini = (k, v, s, ic) => el('div', { class: 'mini' }, [
  el('div', { class: 'k' }, [icon(ic, 'icon'), k]), el('div', { class: 'v', text: String(v) }), el('div', { class: 's', text: s }),
]);

function usersTable(users) {
  const tb = el('tbody');
  for (const u of users) {
    const ramPct = (u.usage.ramMiB / u.limits.ramMiB) * 100;
    const cpuPct = (u.usage.cpu / u.limits.cpuPercent) * 100;
    const diskPct = (u.usage.diskMiB / u.limits.diskMiB) * 100;
    const bar = (pct) => {
      const i = el('i', { style: `width:${Math.max(1.5, Math.min(100, pct))}%` });
      return el('div', { class: 'bar' + (pct > 88 ? ' hi' : '') }, [i]);
    };
    tb.append(el('tr', {}, [
      el('td', {}, [el('div', { class: 'u-name' }, [
        el('div', { class: 'ava', text: u.username.slice(0, 2).toUpperCase() }),
        el('div', {}, [document.createTextNode(u.username), el('small', { text: u.role === 'admin' ? 'administrator' : u.home })]),
      ])]),
      el('td', {}, [
        u.suspended
          ? el('span', { class: 'pill bad' }, [el('i', { class: 'dot' }), 'Suspended'])
          : u.running
            ? el('span', { class: 'pill on' }, [el('i', { class: 'dot' }), u.throttled ? 'Throttled' : 'Online'])
            : el('span', { class: 'pill off' }, [el('i', { class: 'dot' }), u.status === 'oom' ? 'OOM killed' : 'Offline']),
        el('div', {
          style: 'font-size:11px;color:var(--dim2);margin-top:4px;font-family:var(--mono)',
          text: u.running ? 'up ' + u.uptime : 'login ' + ago(u.lastLoginAt),
        }),
      ]),
      el('td', {}, [el('div', { class: 'cellbar cb-ram' }, [bar(ramPct), el('span', { text: `${u.usage.ramMiB.toFixed(0)}/${u.limits.ramMiB}` })])]),
      el('td', {}, [el('div', { class: 'cellbar cb-cpu' }, [bar(cpuPct), el('span', { text: `${u.usage.cpu.toFixed(0)}/${u.limits.cpuPercent}%` })])]),
      el('td', {}, [el('div', { class: 'cellbar cb-disk' }, [bar(diskPct), el('span', { text: `${u.usage.diskMiB.toFixed(0)}/${u.limits.diskMiB}` })])]),
      el('td', {}, [el('code', { style: 'font-family:var(--mono);font-size:11.5px;color:var(--dim)', text: u.startCmd })]),
      el('td', {}, [el('div', { class: 'rowbtns' }, [
        el('button', { class: 'btn sm ' + (u.running ? 'warn' : 'ok'), title: u.running ? 'Stop' : 'Start', onclick: () => adminPower(u.id, u.running ? 'stop' : 'start') }, [icon(u.running ? 'stop' : 'play')]),
        el('button', { class: 'btn sm ghost', title: 'Edit', onclick: () => editUser(u) }, [icon('settings')]),
        el('button', { class: 'btn sm ghost', title: 'Reset password', onclick: () => resetPw(u) }, [icon('key')]),
        u.role === 'admin' ? null : el('button', { class: 'btn sm bad', title: 'Delete user', onclick: () => deleteUser(u) }, [icon('trash')]),
      ])]),
    ]));
  }
  return el('div', { class: 'tbl-wrap' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, ['User', 'Status', 'RAM', 'CPU', 'Disk', 'Start command', ''].map((h) => el('th', { class: 'th', text: h })))]),
    tb,
  ])]);
}

async function adminPower(id, action) {
  try { await api(`/admin/users/${id}/power`, { method: 'POST', body: { action } }); toast(action === 'start' ? 'Starting…' : 'Stopping…', 'ok', 1800); setTimeout(loadAdmin, 600); }
  catch (e) { toast(e.message, 'err'); }
}

function genPw() {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(14));
  return 'Bot-' + [...b].map((x) => abc[x % abc.length]).join('');
}

function createUser() {
  const u = el('input', { class: 'input mono', placeholder: 'player1', spellcheck: 'false', autocomplete: 'off' });
  const p = el('input', { class: 'input mono', value: genPw(), autocomplete: 'new-password' });
  const c = el('input', { class: 'input mono', value: 'node index.js' });
  const n = el('input', { class: 'input', placeholder: 'optional note' });
  const auto = el('input', { type: 'checkbox', checked: true });
  const scaffold = el('input', { type: 'checkbox', checked: true });
  const pwBtn = el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { p.value = genPw(); } }, [icon('restart'), 'Regenerate']);
  modal({
    title: 'Create user', icon: 'users', ok: 'Create account', wide: true,
    body: el('div', {}, [
      el('div', { class: 'grid2' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Username' }), u]),
        el('label', { class: 'field' }, [el('span', { text: 'Password' }), el('div', { style: 'display:flex;gap:7px' }, [p, pwBtn])]),
      ]),
      el('label', { class: 'field' }, [el('span', { text: 'Start command' }), c]),
      el('label', { class: 'field' }, [el('span', { text: 'Note' }), n]),
      el('label', { class: 'sw' }, [auto, el('span', { text: 'Autostart on server boot' })]),
      el('label', { class: 'sw' }, [scaffold, el('span', { text: 'Add starter index.js + package.json' })]),
      el('div', { class: 'chips' }, [chip('RAM', S.limits.ramMiB + ' MiB'), chip('Disk', S.limits.diskMiB + ' MiB'), chip('CPU', S.limits.cpuPercent + '%')]),
      el('p', { class: 'hint', text: 'These limits are locked for every account and cannot be changed from the panel. The new user gets one isolated folder and one bot process.' }),
    ]),
    onOk: async () => {
      const r = await api('/admin/users', { method: 'POST', body: { username: u.value.trim(), password: p.value, startCmd: c.value.trim(), note: n.value.trim(), autoStart: auto.checked, scaffold: scaffold.checked } });
      toast(`Created ${r.user.username} — share the password now, it is not shown again`, 'ok', 8000);
      await navigator.clipboard?.writeText(`${r.user.username} / ${p.value}`).catch(() => {});
      loadAdmin();
    },
  });
}

function editUser(usr) {
  const c = el('input', { class: 'input mono', value: usr.startCmd });
  const auto = el('input', { type: 'checkbox' }); auto.checked = usr.autoStart;
  const susp = el('input', { type: 'checkbox' }); susp.checked = usr.suspended;
  const note = el('input', { class: 'input', value: usr.note || '' });
  modal({
    title: usr.username, icon: 'settings', ok: 'Save', wide: true,
    body: el('div', {}, [
      el('label', { class: 'field' }, [el('span', { text: 'Start command' }), c]),
      el('label', { class: 'field' }, [el('span', { text: 'Note' }), note]),
      el('label', { class: 'sw' }, [auto, el('span', { text: 'Autostart on boot' })]),
      el('label', { class: 'sw' }, [susp, el('span', { text: 'Suspend account (kills the bot, blocks sign-in)' })]),
      el('div', { class: 'chips' }, [chip('RAM', usr.limits.ramMiB + ' MiB'), chip('Disk', usr.limits.diskMiB + ' MiB'), chip('CPU', usr.limits.cpuPercent + '%')]),
      el('p', { class: 'hint', text: 'Disk used: ' + fmtMiB(mib(usr.filesBytes)) + ` · created ${fmtTime(usr.createdAt)} · last login ${ago(usr.lastLoginAt)}` }),
    ]),
    onOk: async () => {
      await api('/admin/users/' + usr.id, { method: 'PATCH', body: { startCmd: c.value.trim(), autoStart: auto.checked, suspended: susp.checked, note: note.value.trim() } });
      toast('Saved', 'ok', 1600); loadAdmin();
    },
  });
}

function resetPw(usr) {
  const p = el('input', { class: 'input mono', value: genPw() });
  modal({
    title: 'Reset password · ' + usr.username, icon: 'key', ok: 'Set password',
    body: el('div', {}, [el('label', { class: 'field', style: 'margin-bottom:0' }, [el('span', { text: 'New password' }), p]), el('p', { class: 'hint', text: 'Their current session is not forced out until it expires.' })]),
    onOk: async () => {
      await api(`/admin/users/${usr.id}/password`, { method: 'POST', body: { password: p.value } });
      navigator.clipboard?.writeText(`${usr.username} / ${p.value}`).catch(() => {});
      toast('Password set (copied to clipboard)', 'ok', 4000);
    },
  });
}

async function deleteUser(usr) {
  const keep = el('input', { type: 'checkbox' });
  const yes = await confirmBox('Delete ' + usr.username + '?',
    'The account and all its sessions are removed, and the bot is killed. This cannot be undone.',
    {
      ok: 'Delete account',
      extra: el('label', { class: 'sw', style: 'margin-bottom:0' }, [keep, el('span', { text: `Also delete /data/users/${usr.username} (${fmtMiB(mib(usr.filesBytes))} of bot files)` })]),
    });
  if (!yes) return;
  try {
    await api('/admin/users/' + usr.id + (keep.checked ? '?files=1' : ''), { method: 'DELETE' });
    toast('Account deleted', 'ok', 2000); loadAdmin();
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------------ start */
(async () => {
  try { await boot(); }
  catch (e) { if (String(e.message) === 'Signed out') return; renderLogin(); }
  finally { $('#boot')?.classList.add('gone'); setTimeout(() => $('#boot')?.remove(), 400); }
})();
