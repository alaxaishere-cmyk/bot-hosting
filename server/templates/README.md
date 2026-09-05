# Your bot folder

Everything in this folder is **yours** — max **719 MiB** total.

| Resource | Hard limit |
| --- | --- |
| RAM | 308 MiB |
| Disk | 719 MiB |
| CPU | 25% of one core |

- Start command is `node index.js` (change it in Console → Settings).
- `npm install <pkg>` works — packages land in this folder and count toward your 719 MiB.
- If the bot crosses 308 MiB of RAM the panel kills it (you will see why in the console).
- Over 25% CPU the process is frozen for the rest of that second — slow but never dead.

Do not delete this folder's root. Ask the admin for more — the limits are fixed by policy.
