// Asks a running server's assistant one question and prints each step with the time it arrived, so a slow answer
// shows where the time goes. It calls the real model (it spends tokens): run it only when you mean to.
//   TABULARIUS_PASSWORD=… node --no-warnings scripts/ask-timing.ts --url https://host:8090 --db Name --user admin "who has the highest score"
// A local-CA server needs NODE_EXTRA_CA_CERTS pointing at its CA file.

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : fallback;
  if (!v) throw new Error(`Missing --${name}`);
  return v;
};
const question = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')).join(' ');
if (!question) throw new Error('Give the question as the last argument');

const base = flag('url', 'http://127.0.0.1:8090');
const db = flag('db');
const user = flag('user');
const password = process.env.TABULARIUS_PASSWORD ?? '';
const enc = encodeURIComponent;
const t0 = performance.now();
const at = () => `${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

const login = await fetch(`${base}/fmi/data/vLatest/databases/${enc(db)}/sessions`, {
  method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, 'content-type': 'application/json' }, body: '{}',
});
const token = (await login.json() as { response?: { token?: string } }).response?.token;
if (!token) throw new Error(`Sign-in failed (HTTP ${login.status})`);
console.log(`${at()}  signed in`);

const r = await fetch(`${base}/tabularius/assistant/v1/databases/${enc(db)}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/x-ndjson' },
  body: JSON.stringify({ messages: [{ role: 'user', content: question }], context: { mode: 'browse' } }),
});
console.log(`${at()}  HTTP ${r.status}`);
const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = '';
let wrote = false;
for (;;) {
  const { value, done } = await reader.read();
  buffer += value ?? '';
  const lines = buffer.split('\n');
  buffer = done ? '' : lines.pop()!;
  for (const l of lines.filter((x) => x.trim())) {
    const e = JSON.parse(l);
    if (typeof e.step === 'string') { wrote = false; console.log(`${at()}  step: ${e.step}`); }
    else if (typeof e.text === 'string') { if (!wrote) console.log(`${at()}  answer starts`); wrote = true; }
    else if (e.error) console.log(`${at()}  error: ${e.error.message}`);
    else if (e.done) console.log(`${at()}  done${e.done.usage ? ` (${JSON.stringify(e.done.usage)})` : ''}\n\n${e.done.reply}`);
  }
  if (done) break;
}
