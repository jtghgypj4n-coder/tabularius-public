import { browserFeatures, browserFeatureMessage } from './browser-features.ts';

const list = document.querySelector<HTMLUListElement>('#checks')!;
const output = document.querySelector<HTMLElement>('#results')!;
const copy = document.querySelector<HTMLButtonElement>('#copy')!;
const results: string[] = [];

function report(name: string, ok: boolean, detail: string): void {
  const item = document.createElement('li');
  item.className = `check ${ok ? 'passed' : 'failed'}`;
  const label = document.createElement('strong');
  label.textContent = name;
  item.append(label, document.createTextNode(`${ok ? 'Available' : 'Unavailable'} — ${detail}`));
  list.append(item);
  results.push(`${name}: ${ok ? 'available' : 'unavailable'} — ${detail}`);
}

async function run(): Promise<void> {
  list.replaceChildren();
  for (const feature of browserFeatures()) report(feature.name, feature.available, feature.available ? 'ready' : browserFeatureMessage(feature));

  let storageOK = false;
  try {
    const key = `tabularius.self-check.${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, '1');
    storageOK = localStorage.getItem(key) === '1';
    localStorage.removeItem(key);
  } catch { /* storage can be denied by browser policy or private mode */ }
  report('Local storage', storageOK, storageOK ? 'write and read succeeded' : 'unavailable; allow site storage in browser settings');

  const session = (() => {
    try {
      const value = sessionStorage.getItem('tabularius.session');
      return value ? 'present' : 'absent';
    } catch { return 'unavailable'; }
  })();
  report('Session state', session !== 'unavailable', `${session}; token value is not read or copied`);

  const before = Date.now();
  try {
    const response = await fetch('/tabularius/health', { cache: 'no-store' });
    const received = Date.now();
    if (!response.ok) throw new Error(`server returned HTTP ${response.status}`);
    const body = await response.json() as { status?: string; serverTime?: string };
    if (!body.serverTime) throw new Error('server did not report its clock');
    const serverTime = Date.parse(body.serverTime);
    if (!Number.isFinite(serverTime)) throw new Error('server clock value was invalid');
    const skewMs = Math.round(serverTime - (before + received) / 2);
    report('Server round trip', true, `connected; status ${body.status ?? 'unknown'}; clock estimate ${skewMs} ms ${skewMs < 0 ? 'behind' : 'ahead'}`);
  } catch (error) {
    report('Server round trip', false, error instanceof Error ? error.message : 'request failed');
  }

  output.textContent = results.join('\n');
  copy.disabled = false;
}

copy.addEventListener('click', () => {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) { copy.textContent = 'Clipboard unavailable — select the results above'; return; }
  void clipboard.writeText(output.textContent ?? '').then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Copy unavailable — select the results above'; });
});
void run();
