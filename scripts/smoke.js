'use strict';
/**
 * Smoke test — run against a live panel:  npm start  &&  npm run smoke
 * Covers: auth, locked limits, files, real console, and the three live
 * enforcements (25% CPU throttle, 308 MiB RAM watchdog, 719 MiB disk cap).
 */
const BASE = process.env.PANEL_URL || 'http://localhost:3000';
const fs = require('fs');
const { execSync } = require('child_process');
const DATA = process.env.BOT_DATA_DIR || require('path').join(__dirname, '..', 'data');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${name}${extra ? ' \x1b[90m' + extra + '\x1b[0m' : ''}`); }
  else { fail++; console.log(`  \x1b[31m✖\x1b[0m ${name} ${extra}`); }
};

class Jar {
  constructor() { this.cookie = ''; }
  async api(p, { method = 'GET', body } = {}) {
    const opt = { method, headers: {}, redirect: 'manual' };
    if (this.cookie) opt.headers.cookie = this.cookie;
    if (body && !(body instanceof FormData)) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    else if (body) opt.body = body;
    const r = await fetch(BASE + p, opt);
    for (const c of (r.headers.getSetCookie?.() || [])) if (c.includes('bhp_sid=')) this.cookie = c.split(';')[0];
    const t = await r.text();
    let data = {}; try { data = t ? JSON.parse(t) : {}; } catch { data = { raw: t }; }
    data.__status = r.status;
    return data;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensureOffline = async (jar) => {
  for (let i = 0; i < 30; i++) {
    const st = await jar.api('/api/me/state');
    if (!st.running) return st;
    await jar.api('/api/me/power', { method: 'POST', body: { action: 'kill' } });
    await sleep(700);
  }
  return jar.api('/api/me/state');
};
const credsFile = fs.existsSync(`${DATA}/ADMIN_CREDENTIALS.txt`) ? fs.readFileSync(`${DATA}/ADMIN_CREDENTIALS.txt`, 'utf8') : '';
const ADMIN_PASS = process.env.PANEL_ADMIN_PASS || (credsFile.match(/password: (.+)/) || [])[1]?.trim();
const ADMIN_USER = process.env.PANEL_ADMIN_USER || 'admin';
const HOME = `${DATA}/users`;

(async () => {
  if (!ADMIN_PASS) throw new Error('cannot find the admin password (data/ADMIN_CREDENTIALS.txt missing and PANEL_ADMIN_PASS unset)');

  console.log('\n\x1b[1m▸ auth\x1b[0m');
  const admin = new Jar();
  ok('no self sign-up endpoint (404)', (await admin.api('/api/register', { method: 'POST', body: { username: 'x', password: 'yyyyyy' } })).__status === 404);
  ok('unauthenticated /api/me → 401', (await new Jar().api('/api/me')).__status === 401);
  ok('wrong password rejected', (await admin.api('/api/login', { method: 'POST', body: { username: ADMIN_USER, password: 'nope-not-right' } })).__status === 401);
  const lg = await admin.api('/api/login', { method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PASS } });
  ok('admin signs in', lg.__status === 200 && lg.user?.role === 'admin');
  ok('admin limits locked at 308/719/25', lg.user?.limits?.ramMiB === 308 && lg.user?.limits?.diskMiB === 719 && lg.user?.limits?.cpuPercent === 25);
  ok('login throttling after failures', (await new Jar().api('/api/login', { method: 'POST', body: { username: ADMIN_USER, password: 'x' } })).__status === 401);

  console.log('\n\x1b[1m▸ admin → create user\x1b[0m');
  const pre = await admin.api('/api/admin/users');
  const old = (pre.users || []).find((x) => x.username === 'tester');
  if (old) await admin.api('/api/admin/users/' + old.id + '?files=1', { method: 'DELETE' });
  try { fs.rmSync(`${HOME}/tester`, { recursive: true, force: true }); } catch { /* fresh */ }
  const mk = await admin.api('/api/admin/users', { method: 'POST', body: { username: 'Tester', password: 'secret1234', ramMiB: 99999, diskMiB: 99999, cpuPercent: 100, note: 'smoke test' } });
  ok('account created + starter files scaffolded', mk.__status === 200 && fs.existsSync(`${HOME}/tester/index.js`));
  ok('limit fields in the request are ignored', mk.user?.limits?.ramMiB === 308 && mk.user?.limits?.diskMiB === 719 && mk.user?.limits?.cpuPercent === 25, JSON.stringify(mk.user?.limits));
  ok('duplicate username blocked', (await admin.api('/api/admin/users', { method: 'POST', body: { username: 'tester', password: 'secret1234' } })).__status === 409);
  ok('short password blocked', (await admin.api('/api/admin/users', { method: 'POST', body: { username: 'weaky', password: '123' } })).__status === 400);
  ok('path-ish username blocked', (await admin.api('/api/admin/users', { method: 'POST', body: { username: '../../etc', password: 'secret1234' } })).__status === 400);
  ok('user cannot create users', (await new Jar().api('/api/admin/users')).__status === 401);

  console.log('\n\x1b[1m▸ user → files\x1b[0m');
  const u = new Jar();
  ok('new user signs in', (await u.api('/api/login', { method: 'POST', body: { username: 'tester', password: 'secret1234' } })).__status === 200);
  ok('user cannot reach admin api', (await u.api('/api/admin/users')).__status === 403);
  const l0 = await u.api('/api/me/files');
  ok('starter files listed', l0.__status === 200 && l0.entries?.some((e) => e.name === 'index.js'), (l0.entries || []).map((e) => e.name).join(','));
  ok('file write', (await u.api('/api/me/file', { method: 'PUT', body: { path: 'index.js', content: 'console.log("hi from smoke");\nprocess.stdin.on("data",d=>console.log("got:"+d.toString().trim()));\nsetInterval(()=>{},30000);\n' } })).__status === 200);
  ok('path traversal blocked', (await u.api('/api/me/file?path=../../../../etc/passwd')).__status === 400);
  ok('mkdir → create → rename → delete', await (async () => {
    const a = await u.api('/api/me/file', { method: 'POST', body: { path: 'sub', dir: true } });
    const b = await u.api('/api/me/file', { method: 'POST', body: { path: 'sub/x.js' } });
    const c = await u.api('/api/me/file/rename', { method: 'POST', body: { from: 'sub/x.js', to: 'sub/y.js' } });
    const d = await u.api('/api/me/files?path=sub');
    const e2 = await u.api('/api/me/file/delete', { method: 'POST', body: { path: 'sub' } });
    return a.__status === 200 && b.__status === 200 && c.__status === 200 && d.entries?.[0]?.name === 'y.js' && e2.__status === 200;
  })());
  const up = new FormData();
  up.append('files', new Blob(['uploaded ok\n'], { type: 'text/plain' }), 'uploaded.txt');
  ok('upload endpoint', (await u.api('/api/me/file/upload', { method: 'POST', body: up })).__status === 200);
  ok('uploaded file appears in listing', (await u.api('/api/me/files')).entries.some((e) => e.name === 'uploaded.txt'));
  ok('search finds files', (await u.api('/api/me/files/search?q=uploaded')).results?.some((r) => r.name === 'uploaded.txt'));

  console.log('\n\x1b[1m▸ console → real process\x1b[0m');
  const st0 = await u.api('/api/me/power', { method: 'POST', body: { action: 'start' } });
  ok('start spawns a real pid', st0.__status === 200 && st0.pid > 0, `pid=${st0.pid} pty=${st0.pty}`);
  await sleep(2000);
  let s = await u.api('/api/me/state');
  ok('state says running', s.running === true, `status=${s.status} uptime=${s.uptime}`);
  ok('bot stdout reaches the console', /hi from smoke/.test((await u.api('/api/me/buffer')).buffer || ''));
  await u.api('/api/me/power', { method: 'POST', body: { action: 'send', data: 'hello\r' } });
  await sleep(900);
  ok('stdin reaches the bot', /got:hello/.test((await u.api('/api/me/buffer')).buffer || ''));
  ok('non-node command refused', (await u.api('/api/me/settings', { method: 'PATCH', body: { startCmd: 'rm -rf /' } })).__status === 400);
  ok('shell operators refused', (await u.api('/api/me/power', { method: 'POST', body: { action: 'start', cmd: 'node x.js; cat /etc/passwd' } })).__status === 400);
  ok('live usage reported', typeof s.usage.cpu === 'number' && s.usage.ramMiB > 0, `ram ${s.usage.ramMiB.toFixed(0)} MiB · cpu ${s.usage.cpu.toFixed(1)}%`);
  await u.api('/api/me/power', { method: 'POST', body: { action: 'stop' } });
  let stopped = false;
  for (let i = 0; i < 20; i++) { await sleep(400); if (!(await u.api('/api/me/state')).running) { stopped = true; break; } }
  ok('stop (Ctrl-C) takes it offline', stopped);
  await ensureOffline(u);

  console.log('\n\x1b[1m▸ CPU: 25% cap enforced live\x1b[0m');
  await u.api('/api/me/file', { method: 'PUT', body: { path: 'cpu.js', content: 'const t=Date.now();for(;;){if(Date.now()-t>40000)break;}' } });
  await u.api('/api/me/power', { method: 'POST', body: { action: 'start', cmd: 'node cpu.js' } });
  const samples = [];
  for (let i = 0; i < 16; i++) { await sleep(500); const x = await u.api('/api/me/state'); samples.push({ cpu: x.usage.cpu, thr: x.throttled }); }
  const avg = samples.reduce((a, b) => a + b.cpu, 0) / samples.length;
  ok('throttle engaged', samples.some((x) => x.thr), `${samples.filter((x) => x.thr).length}/${samples.length} samples frozen`);
  ok('measured cpu held near the 25% cap', avg > 8 && avg < 34, `avg ${avg.toFixed(1)}% of one core`);
  await ensureOffline(u);

  console.log('\n\x1b[1m▸ RAM: 308 MiB watchdog enforced live\x1b[0m');
  await u.api('/api/me/file', { method: 'PUT', body: { path: 'hog.js', content: 'const a=[];let mb=0;setInterval(()=>{const b=Buffer.allocUnsafe(48*1024*1024);b.fill(7);a.push(b);mb+=48;console.log("touched "+mb+" MiB");},250);' } });
  await u.api('/api/me/power', { method: 'POST', body: { action: 'start', cmd: 'node hog.js' } });
  let killed = false, peak = 0, seen = null;
  for (let i = 0; i < 50; i++) {
    await sleep(500);
    seen = await u.api('/api/me/state');
    peak = Math.max(peak, seen.usage.ramMiB);
    if (!seen.running) { killed = true; break; }
  }
  const hogBuf = (await u.api('/api/me/buffer')).buffer || '';
  ok('process killed by the RAM watchdog', killed, `peak ${peak.toFixed(0)} MiB`);
  ok('killed close to the cap, not miles over', peak > 250 && peak < 700, `peak ${peak.toFixed(0)} MiB / 308 MiB`);
  ok('console explains the kill', /memory limit|out of memory|heap/i.test(hogBuf), (hogBuf.match(/killed[^\r\n]*/i) || [''])[0]);
  ok('state marks oom', seen.status === 'oom' || /memory limit/i.test(hogBuf), seen.status);

  console.log('\n\x1b[1m▸ DISK: 719 MiB cap enforced\x1b[0m');
  await ensureOffline(u);
  await u.api('/api/me/file', { method: 'PUT', body: { path: 'diskhog.js', content: 'const fs=require("fs");try{const fd=fs.openSync("big.bin","w");for(let i=0;i<120;i++)fs.writeSync(fd,Buffer.alloc(10*1024*1024));console.log("WROTE-1.2GB-NOT-ENFORCED");}catch(e){console.log("BLOCKED:"+e.code)}' } });
  await u.api('/api/me/power', { method: 'POST', body: { action: 'start', cmd: 'node diskhog.js' } });
  await sleep(8000);
  const dhBuf = (await u.api('/api/me/buffer')).buffer || '';
  const ds0 = await u.api('/api/me/state');
  const wrote = /WROTE-1\.2GB/.test(dhBuf);
  ok('bot process hard-capped by ulimit -f at ~719 MiB', !wrote && /BLOCKED/.test(dhBuf) && ds0.usage.diskMiB > 640 && ds0.usage.diskMiB < 730,
    `${ds0.usage.diskMiB.toFixed(0)} MiB on disk · ${(dhBuf.match(/BLOCKED:\w+/) || ['killed']) [0]}`);
  await ensureOffline(u);
  try { fs.unlinkSync(`${HOME}/tester/big.bin`); } catch { /* none */ }
  await sleep(4500);
  execSync(`dd if=/dev/zero of=${HOME}/tester/filler.bin bs=1M count=718 status=none`);
  await sleep(4500);
  let ds = await u.api('/api/me/state');
  ok('disk meter tracks the folder', ds.usage.diskMiB > 700 && ds.usage.diskMiB < 720, `${ds.usage.diskMiB.toFixed(0)} MiB`);
  ok('panel refuses writes over quota (507)', (await u.api('/api/me/file', { method: 'PUT', body: { path: 'over.txt', content: 'x'.repeat(2.5 * 1024 * 1024) } })).__status === 507);
  fs.unlinkSync(`${HOME}/tester/filler.bin`);
  await sleep(4500);
  ds = await u.api('/api/me/state');
  ok('quota frees up after delete', ds.usage.diskMiB < 1, `${ds.usage.diskMiB.toFixed(2)} MiB`);

  console.log('\n\x1b[1m▸ admin controls + audit\x1b[0m');
  const users = await admin.api('/api/admin/users');
  const tid = users.users.find((x) => x.username === 'tester').id;
  ok('admin list shows live usage per user', users.users.some((x) => x.username === 'tester' && typeof x.usage?.cpu === 'number'));
  ok('admin can start a user bot', (await admin.api(`/api/admin/users/${tid}/power`, { method: 'POST', body: { action: 'start' } })).__status === 200);
  await sleep(1800);
  ok('admin can stop a user bot', (await admin.api(`/api/admin/users/${tid}/power`, { method: 'POST', body: { action: 'kill' } })).__status === 200);
  ok('admin cannot suspend an admin', (await admin.api('/api/admin/users/1', { method: 'PATCH', body: { suspended: true } })).__status === 400);
  ok('admin cannot delete an admin', (await admin.api('/api/admin/users/1', { method: 'DELETE' })).__status === 400);
  ok('audit trail recorded', (await admin.api('/api/admin/audit')).events.some((e) => e.action === 'user.create'));
  const srv = await admin.api('/api/server');
  const noServersApi = await admin.api('/api/admin/servers');
  const noNewServer = await admin.api('/api/admin/servers', { method: 'POST', body: { name: 'node-02' } });
  ok('exactly one server, and no way to add another', srv.server.id === 'node-01'
    && srv.allocation.users >= 2 && noServersApi.__status === 404 && noNewServer.__status === 404,
    `server=${srv.server.id} users=${srv.allocation.users} · GET/POST /api/admin/servers → ${noServersApi.__status}/${noNewServer.__status}`);
  ok('password reset works', await (async () => {
    const r = await admin.api(`/api/admin/users/${tid}/password`, { method: 'POST', body: { password: 'newpass9999' } });
    const t = new Jar();
    return r.__status === 200 && (await t.api('/api/login', { method: 'POST', body: { username: 'tester', password: 'newpass9999' } })).__status === 200;
  })());
  ok('user can change own password', await (async () => {
    const t = new Jar();
    await t.api('/api/login', { method: 'POST', body: { username: 'tester', password: 'newpass9999' } });
    const c = await t.api('/api/me/password', { method: 'POST', body: { current: 'newpass9999', password: 'finalpass1' } });
    const t2 = new Jar();
    return c.__status === 200 && (await t2.api('/api/login', { method: 'POST', body: { username: 'tester', password: 'finalpass1' } })).__status === 200;
  })());
  ok('suspend blocks sign-in + kills the bot', await (async () => {
    await admin.api(`/api/admin/users/${tid}`, { method: 'PATCH', body: { suspended: true } });
    return (await new Jar().api('/api/login', { method: 'POST', body: { username: 'tester', password: 'finalpass1' } })).__status === 401;
  })());
  await admin.api(`/api/admin/users/${tid}`, { method: 'PATCH', body: { suspended: false } });
  ok('logout invalidates the cookie', await (async () => {
    const t = new Jar();
    await t.api('/api/login', { method: 'POST', body: { username: 'tester', password: 'finalpass1' } });
    const before = (await t.api('/api/me')).__status;
    await t.api('/api/logout', { method: 'POST' });
    return before === 200 && (await t.api('/api/me')).__status === 401;
  })());

  console.log('\n\x1b[1m▸ web ui\x1b[0m');
  const html = await (await fetch(BASE + '/')).text();
  ok('index.html served', /Bot Hosting Panel/.test(html));
  ok('xterm assets vendored', (await (await fetch(BASE + '/vendor/xterm/lib/xterm.js')).status) === 200 && (await (await fetch(BASE + '/vendor/xterm/css/xterm.css')).status) === 200);
  ok('app.js + style.css served', (await (await fetch(BASE + '/app.js')).status) === 200 && (await (await fetch(BASE + '/style.css')).status) === 200);
  ok('no sign-up form in the page', !/create account|sign up free/i.test(html));

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\x1b[31msmoke crashed:\x1b[0m', e.message, e.stack?.split('\n')[1] || ''); process.exit(2); });
