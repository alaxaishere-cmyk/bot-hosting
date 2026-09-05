# ⚡ Bot Hosting Panel

A small, clean **bot hosting panel**: one server, one login box, and after sign-in a plain
console with your files on the left and your bot's live output in front of you.

Every account is capped at **308 MiB RAM · 719 MiB disk · 25% CPU**. Those numbers are not
settings — they are compiled into the runtime, there is **no upgrade path**, there is **only one
server**, and **nobody can sign up by themselves**: accounts are created in the admin panel only.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⚡ Bot Hosting   [Console][Editor][Admin]              ● Online  3m12s │
├────────────────────────────────────────────────────────────────────────┤
│  ┌── CPU ──────────┐  ┌── MEMORY ────────┐  ┌── DISK ─────────┐        │
│  │ 6.2%  of 25%    │  │ 44.6 MiB of 308  │  │ 1.2 MiB of 719  │        │
│  │ ▁▂▅▃▇▃▂▁  🔒     │  │ ▁▁▃▅▆▅▃▄  🔒      │  │ ▁▁▁▂▂▁▁▁  🔒     │        │
│  └─────────────────┘  └──────────────────┘  └─────────────────┘        │
├───────────────┬────────────────────────────────────────────────────────┤
│ FILES         │  ▶ node index.js   (ram 308 · disk 719 · cpu 25%)      │
│  ~ /demo      │  🤖 my-bot is online                                     │
│  ▸ index.js   │  [heartbeat] tick 4 — all good                          │
│  ▸ package.js │  …                                                       │
│  ⌕ search     │                                                          │
│  1.2/719 MiB  │  › type a line for the bot's stdin           [Send]     │
└───────────────┴────────────────────────────────────────────────────────┘
```

## Run it

```bash
npm install          # express, ws, multer, @xterm/xterm  (node ≥ 22.5, Linux)
npm start            # http://localhost:3000
```

On the very first boot the panel creates the one and only admin account and prints it:

```
  ── first admin account (created automatically) ──
     username: admin
     password: <generated>
```

It is also written to `data/ADMIN_CREDENTIALS.txt` (chmod 600, git-ignored). To pick your own:

```bash
PANEL_ADMIN_USER=admin PANEL_ADMIN_PASS='change-me-please' npm start
```

Everything lives in `data/` (sqlite DB, per-user folders, per-user console logs) — delete the
folder for a factory reset.

| Env | default | meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | listen address |
| `PANEL_ADMIN_USER` / `PANEL_ADMIN_PASS` | `admin` / generated | first-boot admin |
| `BOT_DATA_DIR` | `./data` | db + user homes + logs |
| `CONSOLE_COLS` / `CONSOLE_ROWS` | `140` / `38` | pty size handed to the bot |

## What you get

**Sign in** — username + password, nothing else. Wrong passwords are rate-limited (6 tries, then a
60 s cooldown). There is no sign-up form and no `/api/register` route at all.

**Console** — a real terminal (`xterm.js`) wired to a real process over a WebSocket. Start /
Restart / Stop / Kill, an input line for the bot's stdin, a `Ctrl-C` button, autoscroll, and the
whole transcript is also saved to `data/logs/<user>.log`.

**Files (left)** — browse, create, rename, delete, download, upload (drag & drop works), a search
box, a built-in editor (Ctrl+S to save), and a live quota bar. Every action is checked against the
quota, and `Set as start command` on any `.js` file wires it straight into Start.

**Admin** — create users (username, password, start command, note, autostart, optional starter
files), live usage per user, power control, password reset, suspend, delete (with optional file
wipe), plus an activity log. The limit chips in the create dialog are read-only on purpose.

## How the three limits are actually enforced

No Docker and no cgroups are required, so enforcement is done in the panel's own supervisor loop
(`server/runtime.js`), which samples `/proc` for the **whole process tree** every 60 ms.

| Limit | How |
| --- | --- |
| **308 MiB RAM** | Sum of `VmRSS` over the bot's process tree. Cross the cap for >500 ms → the tree gets `SIGKILL` and the console prints why; the meter turns red before that. Node also starts with `--max-old-space-size=<80% of cap>` so a V8 heap blows up inside the box rather than outside it. |
| **25% CPU** | 1-second windows. The tree may spend `250 ms` of CPU per window; the moment the budget is gone it is `SIGSTOP`ped and only `SIGCONT`ed when the window rolls over. The budget self-corrects each window so the long-run average sits on 25% instead of drifting over it. |
| **719 MiB disk** | `ulimit -f` inside the bot (the kernel refuses the write, `EFBIG`/`SIGXFSZ`), *and* every panel file operation is rejected with `507` once the folder is full. Usage is a real recursive size of `data/users/<name>`, and `TMPDIR` is pointed inside the same folder so `npm install` cannot hide its cache elsewhere. |

The limits are clamped in three places on purpose: `server/config.js` (`LIMITS`), the SQL defaults
and a `MIN()` clamp in `server/db.js`, and the create-user handler in `server/routes.js`, which
ignores any `ramMiB`/`diskMiB`/`cpuPercent` a caller sends. The unit test proves a request asking
for 99999 MiB still gets 308.

**Command policy** — the start command must start with `node`, `npm` or `npx` and may not contain
`;` `|` `&` `$` backticks, redirects or quotes, so a bot can't turn the console into a shell.
`PATH` is inherited but `HOME`, `TMPDIR` and the cwd are pinned to the user's folder, and secrets
from the panel's environment are not passed down.

## Honest limitations

* Users run as the same OS uid as the panel. The quota, the pty and the process tree are per-user,
  and the file API is path-pinned (symlink escapes are resolved and rejected) — but a *malicious*
  bot with 308 MiB of ambition could still `rm` another user's folder, because that is what the
  filesystem allows. For hostile multi-tenant use, run one container/uid per user (the panel
  already isolates per folder, so it maps cleanly) and put it behind TLS.
* `RLIMIT_FSIZE` caps a *single file*; the total folder size is enforced by the panel on write
  paths and by the disk meter for the bot's own files.
* Sampling `/proc` at 60 ms means a burst can overshoot the CPU cap by a few percent before the
  freeze lands; the average is corrected on the next window.
* The bot's pty size is fixed at `CONSOLE_COLS × CONSOLE_ROWS` (no `TIOCSWINSZ` from the browser
  through `script`), so very wide terminals wrap at 140 columns.
* If the panel dies, the bots die with it (`stopAll` on SIGTERM). Autostart-on-boot brings back any
  account that has "autostart" ticked.

## Tests

```bash
npm test        # syntax check
npm run smoke   # 54 API + live-enforcement checks against a running panel
npm run test:ui # 58 jsdom checks that render public/app.js and click the real UI
```

`npm run smoke` really starts bots: a CPU hog (must be throttled to ~25%), a memory hog (must be
OOM-killed near 308 MiB) and a disk hog (must hit `EFBIG` at ~719 MiB), then cleans up. It needs the
panel running and ~1.5 GB of free disk for the quota checks.

## Making it a real public link

The panel has no built-in tunnel — put any HTTPS reverse proxy in front of port 3000 and share
that domain. Two things matter: **TLS** (so the session cookie is `Secure`) and **WebSocket
upgrade** (the live console streams over `/ws`).

**Caddy** (auto HTTPS, 4 lines — `caddy reverse-proxy` style):

```caddy
bot.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**nginx**:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;      # console websocket
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host       $host;
    proxy_set_header X-Forwarded-Proto $scheme;     # Secure cookie
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;                        # long-running bots keep streaming
}
```

**Docker**:

```bash
echo 'PANEL_ADMIN_PASS=make-it-long-and-random' > .env
docker compose up -d --build          # data persists in ./data
```

Then set `PANEL_ALLOWED_HOSTS=bot.example.com` to lock it to your domain. `trust proxy` is already
on, so login throttling keys off the real client IP instead of the proxy.

**Before you expose it to the whole internet, read “Honest limitations” below.** The panel is
designed for a handful of accounts you personally approved (which is exactly the brief: no sign-up
form, admin creates everyone), not for strangers — a hostile bot can still touch another user's
folder because all bots run as one uid. For strangers: one container per user, or add a
`user: 100xxx` line per account plus per-user quotas, and the panel needs no other change.

## Layout

```
server/
  index.js       express + websocket + first-boot admin seeding
  config.js      THE LIMITS live here (locked)
  db.js          node:sqlite (users, sessions, audit) with clamped defaults
  auth.js        scrypt passwords, cookie sessions, login throttling
  runtime.js     spawn/monitor/limit the bot process tree
  files.js       sandboxed file manager + quota
  routes.js      /api (self + /admin) — no /register
  templates/     starter files copied into a new account
public/          zero-build front end (index.html, app.js, style.css)
scripts/         smoke.js, ui-smoke.js
data/            git-ignored: panel.db, users/<name>/, logs/<name>.log
```
