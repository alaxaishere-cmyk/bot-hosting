'use strict';
/**
 * UI smoke test — runs public/app.js inside jsdom against a live panel.
 * Catches render/runtime errors in the front end (which the API test can't see).
 *   npm start   then   npm run test:ui
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.PANEL_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');
const DATA = process.env.BOT_DATA_DIR || path.join(ROOT, 'data');
const credsFile = fs.existsSync(path.join(DATA, 'ADMIN_CREDENTIALS.txt')) ? fs.readFileSync(path.join(DATA, 'ADMIN_CREDENTIALS.txt'), 'utf8') : '';
const ADMIN_PASS = process.env.PANEL_ADMIN_PASS || (credsFile.match(/password: (.+)/) || [])[1]?.trim();
const ADMIN_USER = process.env.PANEL_ADMIN_USER || 'admin';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${name}${extra ? ' \x1b[90m' + extra + '\x1b[0m' : ''}`); }
  else { fail++; console.log(`  \x1b[31m✖\x1b[0m ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (node) => node?.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

(async () => {
  // 1. real login to obtain a session cookie
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
  const cookie = (loginRes.headers.getSetCookie()[0] || '').split(';')[0];

  // 2. build the page, then execute app.js with fetch/websocket stubs
  const html = await (await fetch(BASE + '/')).text();
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { const m = String(e.message || e); if (!/getContext|Not implemented/.test(m)) errors.push(m); });
  vc.on('error', (m) => errors.push(String(m)));
  const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  global.window = dom.window;
  const win = dom.window;

  win.fetch = (url, opt = {}) => fetch(new URL(url, BASE).href, {
    ...opt, headers: { ...(opt.headers || {}), cookie },
  }).then((r) => new Response(r.body, { status: r.status, statusText: r.statusText, headers: Object.fromEntries(r.headers) }));

  class FakeSocket {
    static OPEN = 1;
    constructor(url) { FakeSocket.last = url; this.readyState = 1; this.sent = []; setTimeout(() => this.onopen?.(), 0); sockets.push(this); }
    send(s) { this.sent.push(s); }
    close() { this.readyState = 3; }
  }
  const sockets = [];
  win.WebSocket = FakeSocket;
  win.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  const termLog = [];
  win.Terminal = class {
    constructor(o) { this.cols = 80; this.rows = 24; this.opts = o; }
    open() { this._open = true; }
    write(s) { termLog.push(String(s)); }
    clear() { termLog.length = 0; }
    reset() { termLog.length = 0; }
    resize(c, r) { this.cols = c; this.rows = r; }
    scrollToBottom() {}
    onData(fn) { this._onData = fn; }
    attachCustomKeyEventHandler() {}
  };

  const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  win.eval(appSrc.replace(/^import[^\n]*\n/gm, ''));
  const doc = win.document;
  const q = (s) => doc.querySelector(s);
  const qa = (s) => [...doc.querySelectorAll(s)];
  const text = (s) => (q(s)?.textContent || '').trim();

  await sleep(700);

  console.log('\n\x1b[1m▸ shell renders\x1b[0m');
  ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('signed-in shell rendered', !!q('.shell'));
  ok('no login form when authenticated', !q('.login-card'));
  ok('brand in topbar', /Bot Hosting/.test(text('.topbar .brand h1')));
  ok('server chip shows one server', /Node 01/.test(text('.topbar .brand p')), text('.topbar .brand p'));
  ok('user chip shows username', /admin/.test(text('.who .nm')));

  console.log('\n\x1b[1m▸ top meters (cpu / ram / disk)\x1b[0m');
  ok('three meters', qa('.meter').length === 3, qa('.meter').map((m) => m.dataset.k).join(','));
  ok('cpu card labelled', /CPU/i.test(text('.meter[data-k=cpu] .m-name')));
  ok('memory card labelled', /Memory/i.test(text('.meter[data-k=ram] .m-name')));
  ok('disk card labelled', /Disk/i.test(text('.meter[data-k=disk] .m-name')));
  ok('ram shows the 308 MiB cap', /of 308 MiB/.test(text('.meter[data-k=ram] .m-val')), text('.meter[data-k=ram] .m-val'));
  ok('disk shows the 719 MiB cap', /of 719 MiB/.test(text('.meter[data-k=disk] .m-val')));
  ok('cpu shows the 25% cap', /of 25%/.test(text('.meter[data-k=cpu] .m-val')));
  ok('each meter is marked locked', qa('.meter .lock').length === 3);
  ok('bars + sparklines present', qa('.meter .bar i').length === 3 && qa('.meter canvas.spark').length === 3);
  ok('ws opened for live usage', sockets.length === 1, FakeSocket.last || '');

  // push a fake live state over the socket and make sure the meters repaint
  const fake = {
    user: { username: 'admin', role: 'admin', startCmd: 'node index.js', limits: { ramMiB: 308, diskMiB: 719, cpuPercent: 25 } },
    running: true, status: 'running', pid: 4242, uptime: '3m 12s', throttled: false, oomKills: 1,
    usage: { cpu: 18.4, ramMiB: 201.5, diskMiB: 360.2, diskBytes: 360 * 1048576, history: [] },
    limits: { ramMiB: 308, diskMiB: 719, cpuPercent: 25 },
  };
  sockets[0].onmessage({ data: JSON.stringify({ t: 'hello', buffer: 'hello \x1b[32mworld\x1b[0m\r\n', state: fake }) });
  await sleep(120);
  ok('meter values repaint from live state', /20[12]/.test(text('.meter[data-k=ram] .m-val')), text('.meter[data-k=ram] .m-val'));
  ok('disk meter repaints', /360/.test(text('.meter[data-k=disk] .m-val')));
  ok('cpu percent label repaints', /74%/.test(text('.meter[data-k=cpu] .m-pct')), text('.meter[data-k=cpu] .m-pct'));
  ok('status pill flips online', /Online/.test(text('#statusPill')), text('#statusPill'));
  ok('terminal got the buffered output', termLog.join('').includes('hello'), termLog.join('').slice(0, 40));
  ok('start cmd chip repaints', /node index.js/.test(text('#cmdChip')));

  console.log('\n\x1b[1m▸ power buttons + stdin\x1b[0m');
  const btns = qa('.c-actions .btn').length + qa('.cmdbar .btn').length;
  ok('console toolbar has buttons', btns >= 4, `${btns} buttons`);
  ok('power bar has start / restart / stop / kill', qa('.power .btn').length === 4 && ['Start', 'Restart', 'Stop', ''].every((b, i) => i === 3 || qa('.power .btn')[i].textContent.includes(b)), qa('.power .btn').map((x) => x.textContent.trim() || 'icon').join('|'));
  ok('stdin box exists', !!q('.cmdbar input'));
  const input = q('.cmdbar input');
  input.value = 'ping';
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(150);
  ok('enter sends a line over the socket', sockets[0].sent.some((s) => JSON.parse(s).s === 'ping\r'), JSON.stringify(sockets[0].sent));
  const ctrl = qa('.cmdbar .btn').find((b) => /Ctrl-C/.test(b.textContent));
  click(ctrl);
  await sleep(120);
  ok('ctrl-c button sends 0x03', sockets[0].sent.some((s) => JSON.parse(s).s === '\x03'));

  console.log('\n\x1b[1m▸ left file panel\x1b[0m');
  ok('files card in the left column', !!q('.files'));
  ok('file rows render', qa('.f').length > 0, `${qa('.f').length} rows`);
  ok('starter index.js listed', qa('.f .nm').some((n) => n.textContent === 'index.js'), qa('.f .nm').map((n) => n.textContent).join(','));
  ok('quota bar renders', /MiB/.test(text('.side-foot')), text('.side-foot'));
  ok('file actions: new file / folder / upload', qa('.c-actions .btn').length >= 3);
  const jsRow = qa('.f').find((r) => r.querySelector('.nm')?.textContent === 'index.js');
  jsRow.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
  await sleep(400);
  ok('double-click opens the editor', /index\.js/.test(text('.ed-name')), text('.ed-name'));
  ok('editor textarea filled', (q('.ed-ta')?.value || '').includes('console.log'));
  ok('line gutter numbers rendered', /^[1-9]/m.test(q('.ed-gutter')?.textContent || ''));
  const ta = q('.ed-ta');
  ta.value += '\n// touched by ui test\n';
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(50);
  ok('dirty state enables save', q('.ed-bar .btn.pri')?.disabled === false, text('.ed-bar .btn.pri'));
  click(q('.ed-bar .btn.pri'));
  await sleep(500);
  ok('save succeeded (dirty clears)', /save/i.test(text('.toast')) || q('.ed-bar .btn.pri')?.disabled === true, text('.toast'));
  ok('tab switcher has console + editor + admin', qa('.tab').length === 3, qa('.tab').map((t) => t.textContent).join('|'));
  click(qa('.tab').find((t) => /Admin/.test(t.textContent)));
  await sleep(900);

  console.log('\n\x1b[1m▸ admin page\x1b[0m');
  ok('admin pane visible', q('#adminPane')?.hidden === false);
  ok('policy banner states the locked limits', /308 MiB RAM/.test(text('.policy')) && /719 MiB disk/.test(text('.policy')) && /25% CPU/.test(text('.policy')), (text('.policy') || '').slice(0, 70));
  ok('banner says self sign-up is disabled', /sign-up is disabled/i.test(text('.policy')));
  ok('stat cards render', qa('.mini').length === 4);
  ok('user table renders rows', qa('tbody tr').length >= 1, `${qa('tbody tr').length} rows`);
  ok('every row shows ram/cpu/disk bars', qa('tbody tr .cellbar').length >= 3);
  ok('activity feed renders', qa('.evt').length > 0, `${qa('.evt').length} events`);
  click(qa('.page-head .btn.pri')[0]);
  await sleep(250);
  ok('create-user modal opens', !!q('.scrim .modal'), text('.mh h3'));
  ok('modal shows the fixed limits as locked chips', qa('.scrim .chip').length === 3 && qa('.scrim .chip .lk').length === 3);
  ok('limit chips read 308/719/25', /308 MiB/.test(text('.scrim .chips')) && /719 MiB/.test(text('.scrim .chips')) && /25%/.test(text('.scrim .chips')), text('.scrim .chips'));
  ok('no way to change limits in the modal', !qa('.scrim .mb input').some((i) => /ram|disk|cpu|limit|memory/i.test(`${i.placeholder}${i.name}${i.id}`)) && qa('.scrim .chips .lk').length === 3);
  const inputs = qa('.scrim .mb input');
  inputs[0].value = 'uitester';
  inputs[1].value = 'uitestpass1';
  inputs[2].value = 'node index.js';
  const okBtn = qa('.scrim .mf .btn').find((b) => /Create/.test(b.textContent));
  click(okBtn);
  await sleep(900);
  ok('account created from the UI', /Created uitester/.test(doc.body.textContent), (text('.toast') || '').slice(0, 60));
  await sleep(900);
  ok('new user appears in the table', qa('tbody tr').some((r) => /uitester/.test(r.textContent)));
  const row = qa('tbody tr').find((r) => /uitester/.test(r.textContent));
  click([...row.querySelectorAll('.rowbtns .btn')].pop());
  await sleep(250);
  ok('delete asks for confirmation', /Delete uitester/.test(text('.mh h3')), text('.mh h3'));
  const danger = qa('.scrim .mf .btn').find((b) => /Delete account/.test(b.textContent));
  click(danger);
  await sleep(1400);
  ok('user deleted from the UI', !qa('tbody tr').some((r) => /uitester/.test(r.textContent)));

  console.log('\n\x1b[1m▸ login screen (signed out)\x1b[0m');
  errors.length = 0;
  const dom2 = new JSDOM(html, { url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  errors.length = 0;
  dom2.window.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  dom2.window.WebSocket = FakeSocket; dom2.window.ResizeObserver = win.ResizeObserver; dom2.window.Terminal = win.Terminal;
  dom2.window.eval(appSrc);
  await sleep(250);
  const d2 = dom2.window.document;
  ok('signed-out shows the login card', !!d2.querySelector('.login-card'));
  ok('login has username + password only', d2.querySelectorAll('.login-card input').length === 2);
  ok('no sign-up link', !/sign up|register|create account/i.test(d2.querySelector('.login-card').textContent));
  ok('admin-only note present', /admin creates every account/i.test(d2.querySelector('.login-card').textContent));
  ok('no errors on the login screen', errors.length === 0, errors.slice(0, 1).join(''));

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\x1b[31mui test crashed:\x1b[0m', e.message, '\n', e.stack?.split('\n').slice(1, 4).join('\n')); process.exit(2); });
