// My Bot — starter file
// This is what runs when you press START (start command: `node index.js`).
// Add your own code, or upload your bot files from the FILES panel on the left.

const started = Date.now();
let ticks = 0;

console.log('🤖 my-bot is online');
console.log(`node ${process.version} · pid ${process.pid}`);
console.log('type `help` in the console box and press Enter for a reply\n');

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  const line = chunk.toString('utf8').trim();
  if (!line) return;
  if (line === 'help') {
    console.log('commands: help · stats · ping · echo <text> · clear');
  } else if (line === 'stats') {
    console.log(`uptime ${Math.round((Date.now() - started) / 1000)}s · ticks ${ticks}`);
  } else if (line === 'ping') {
    console.log('pong');
  } else if (line.startsWith('echo ')) {
    console.log(line.slice(5));
  } else {
    console.log(`you typed: ${line}`);
  }
});

setInterval(() => {
  ticks++;
  console.log(`[heartbeat] tick ${ticks} — all good`);
}, 15000);

process.on('SIGINT', () => {
  console.log('\nshutting down nicely…');
  process.exit(0);
});
