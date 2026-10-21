// Script Debugger and Data Viewer, like FileMaker Pro's: run a script paused,
// step into, over and out, set breakpoints by clicking beside a step, and watch
// variables and formulas while it waits. Needs a full-access account.
//
// debugger.html?script=Name&layout=Name starts on that script and layout.
//
// Record run (time travel, not in FileMaker): the script runs to the end on a scratch copy while the server notes
// where it stood before each step; then the debugger steps backwards and forwards through it, and jumps to the step
// where a chosen field changed.

import { discardLegacyWatches, openWatches, watchAccessDenied } from '../watch-storage.ts';
import { h, button, toast } from '../design/dom.ts';
import { AssistantPanel, assistantInfo, type AssistantContext } from '../assistant.ts';
import { describeChange, fieldChanges, variablesAt, type Recording } from './replay.ts';
import { httpProblem } from '../http-problem.ts';
import { plainMessage } from '../http-problem.ts';

interface ScriptInfo { id: number; name: string; steps: { line: string; enabled: boolean }[] }
interface OrderItem { id: number; name: string; kind: 'item' | 'folder' | 'separator' | 'folder-end' | 'unknown'; depth: number }
interface Breakpoint { script: string; index: number }
interface Paused {
  script: string; index: number; line: string; stack: { script: string; index: number }[]; lastError: number;
  previousError?: { script: string; index: number; line: string; code: number; message?: string };
  layout?: string; foundCount: number; recordId?: number; mode: string;
  variables: { locals: Record<string, string>; globals: Record<string, string> };
}
interface RunView {
  id: string; script: string; breakpoints: Breakpoint[]; pauseOnError?: boolean;
  /** It works on a throwaway copy of the file. */
  scratch?: boolean;
  paused?: Paused;
  done?: { result: string; error: number; halted: boolean; steps: number; layout?: string; foundCount: number };
  error?: { code: number; message: string };
  /** Where the run's time went so far (time paused here isn't counted). */
  profile?: RunProfile;
}
interface RunProfile {
  totalMs: number;
  steps: number;
  scripts: { script: string; calls: number; ownMs: number; totalMs: number }[];
  slowest: { script: string; index: number; line: string; count: number; ms: number; maxMs: number; errors: number }[];
  summary: string[];
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} s` : n >= 10 ? `${Math.round(n)} ms` : `${Math.round(n * 100) / 100} ms`);

class DebugError extends Error {
  readonly code: number;
  readonly status?: number;
  constructor(code: number, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const app = document.getElementById('app')!;

function session(): { db: string; token: string } | undefined {
  try {
    const saved = sessionStorage.getItem('tabularius.session');
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

function stored<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Apple keys on a Mac, Ctrl and Alt elsewhere, as FileMaker shows them. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const keys = (mac: string, other: string) => (MAC ? mac : other);

function store(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private windows: breakpoints and watches last only this page
  }
}

async function start(): Promise<void> {
  const s = session();
  if (!s) {
    app.replaceChildren(h('p', { class: 'empty' }, 'Log in to a file first, then open the Script Debugger. ', h('a', { href: './' }, 'Log in')));
    return;
  }
  discardLegacyWatches(s.db);
  let watches: string[] = [];
  let stopped = false;
  let shared: Awaited<ReturnType<typeof openWatches>> | undefined;
  const deny = (message: string) => {
    stopped = true;
    watches = [];
    for (const input of app.querySelectorAll('input, textarea')) (input as HTMLInputElement).value = '';
    app.replaceChildren(h('p', { class: 'empty', role: 'alert' }, message));
  };
  const base = `/tabularius/debug/v1/databases/${encodeURIComponent(s.db)}`;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    if (stopped || (shared && !shared.active())) throw new DebugError(952, 'Your session ended.');
    const r = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await r.json().catch(() => ({}));
    if (shared && !shared.active()) throw new DebugError(952, 'Your session ended.');
    if (!r.ok) {
      const error = new DebugError(json.error?.code ?? r.status, json.error?.message ?? httpProblem(r.status), r.status);
      if (watchAccessDenied(error)) {
        if (shared) shared.deny(error.message); else deny(error.message);
      }
      throw error;
    }
    return json as T;
  };

  let scripts: ScriptInfo[] = [];
  let order: OrderItem[] | undefined;
  try {
    shared = await openWatches(s, deny, async () => {
      ({ scripts, order } = await call<{ scripts: ScriptInfo[]; order?: OrderItem[] }>('GET', '/scripts'));
    });
  } catch (e) {
    const msg = e instanceof DebugError && e.code === 952 ? 'Your session ended. Log in again, then open the Script Debugger.' : (e as Error).message;
    app.replaceChildren(h('p', { class: 'empty' }, msg, ' ', h('a', { href: './' }, 'Back to the file')));
    return;
  }

  const params = new URLSearchParams(location.search);
  const bpKey = `tabularius.debug.breakpoints.${s.db}`;
  // One watch list with the Data Viewer window, as in FileMaker.
  const watchKey = shared.key;
  let breakpoints: Breakpoint[] = stored(bpKey, []);
  watches = shared.get();
  let pauseOnError: boolean = stored(`tabularius.debug.pauseOnError.${s.db}`, false);
  /** The step chosen for Set Next Step (click a step's text). */
  let chosen: number | undefined;
  // The Data Viewer window follows the paused script.
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`tabularius.debug.${s.db}`) : undefined;
  const announce = () => channel?.postMessage({ type: 'run', id: run?.id, paused: !!run?.paused });
  if (channel) channel.onmessage = (e) => {
    if (e.data?.type === 'hello') announce();
  };
  window.addEventListener('storage', (e) => {
    if (e.key !== watchKey) return;
    if (e.newValue === null) { shared!.deny('Your session ended. Open this tool again from the file.'); return; }
    watches = shared!.get();
    render();
  });
  let shown = scripts.find((x) => x.name === params.get('script'))?.name ?? scripts[0]?.name ?? '';
  let run: RunView | undefined;
  let busy = false;

  // --- header: script, layout, parameter -------------------------------------
  const picker = h('select', { 'aria-label': 'Script' });
  const byId = new Map(scripts.map((x) => [x.id, x]));
  const listed = new Set<number>();
  let group: HTMLElement = picker;
  for (const item of order ?? []) {
    if (item.kind === 'folder') {
      group = h('optgroup', { label: item.name });
      picker.append(group);
    } else if (item.kind === 'folder-end') group = picker;
    else if (item.kind === 'item' && byId.has(item.id)) {
      group.append(h('option', { value: byId.get(item.id)!.name }, byId.get(item.id)!.name));
      listed.add(item.id);
    }
  }
  for (const x of scripts) if (!listed.has(x.id)) picker.append(h('option', { value: x.name }, x.name));
  picker.value = shown;
  picker.addEventListener('change', () => {
    shown = picker.value;
    render();
  });
  const layout = h('input', { placeholder: 'Layout', 'aria-label': 'Layout' });
  // The layout to start on: from the link, else the one the web client last showed.
  layout.value = params.get('layout') ?? (() => {
    try {
      return sessionStorage.getItem(`tabularius.layout.${s.db}`) ?? '';
    } catch {
      return '';
    }
  })();
  const parameter = h('input', { placeholder: 'Script parameter', 'aria-label': 'Script parameter' });
  const runBtn = button('Debug', () => void begin(true), { class: 'primary' });
  const runToBp = button('Run to breakpoint', () => void begin(false), { title: `Run until a breakpoint (${keys('⌥F8', 'Alt+F8')})` });
  const recordBtn = button('Record run', () => void recordRun(), {
    title: 'Run the whole script on a scratch copy, offline, then step backwards and forwards through it and jump to where a field changed',
  });

  // --- controls ---------------------------------------------------------------
  // FileMaker Pro's names and keys (Claris's Script Debugger keyboard shortcuts).
  const into = button('Step Into', () => void command('into'), { title: 'Run this step; stop at the first step of a subscript (F6)' });
  const over = button('Step Over', () => void command('over'), { title: 'Run this step, and any subscript it performs, then stop (F5)' });
  const out = button('Step Out', () => void command('out'), { title: 'Run to the end of this script, then stop in the one that performed it (F7)' });
  const cont = button('Continue', () => void command('continue'), { title: `Run to the next breakpoint or the end (${keys('⌥F8', 'Alt+F8')})` });
  const halt = button('Halt', () => void command('halt'), { title: `Stop the script, like Halt Script (${keys('⌘F8', 'Ctrl+F8')})` });
  const setNext = button('Set Next Step', () => void moveTo(), { title: `Run the chosen step next, without running the steps between; click a step to choose it (${keys('⇧⌘F5', 'Ctrl+Shift+F5')})` });
  const clearAll = button('Remove Breakpoints', () => clearBreakpoints(), { title: `Remove every breakpoint (${keys('⇧⌘F9', 'Ctrl+Shift+F9')})` });
  const editScript = button('Edit Script', () => {
    // Leaving the page ends a paused run, so ask first; the Script Workspace opens on the script shown here.
    if (run?.paused && !confirm('Leave the debugger? The paused run ends.')) return;
    location.href = `design.html#scripts=${encodeURIComponent(shown)}`;
  }, { title: `Open the script in the Script Workspace (${keys('⌘F10', 'Ctrl+F10')})` });
  const onError = h('input', { type: 'checkbox', 'aria-label': 'Pause on error' }) as HTMLInputElement;
  onError.checked = pauseOnError;
  onError.addEventListener('change', () => {
    pauseOnError = onError.checked;
    store(`tabularius.debug.pauseOnError.${s.db}`, pauseOnError);
    if (run && !run.done && !run.error) void call('PUT', `/runs/${run.id}/options`, { pauseOnError }).catch((e) => toast(plainMessage(e)));
  });
  const onErrorLabel = h('label', { class: 'g-check', title: 'Pause after any step that sets an error' }, onError, ' Pause on error');
  // Scratch copy (not in FileMaker): the run works on a throwaway copy of the file, so the hosted records stay as they were.
  let scratch: boolean = stored(`tabularius.debug.scratch.${s.db}`, true);
  const onScratch = h('input', { type: 'checkbox', 'aria-label': 'Run on a scratch copy' }) as HTMLInputElement;
  onScratch.checked = scratch;
  onScratch.addEventListener('change', () => {
    scratch = onScratch.checked;
    store(`tabularius.debug.scratch.${s.db}`, scratch);
  });
  const scratchLabel = h('label', { class: 'g-check', title: 'Run on a throwaway copy of the file, offline, so records the script changes on the hosted file stay as they were. Takes effect at the next Debug.' }, onScratch, ' Scratch copy');
  const status = h('span', { class: 'g-status' });

  const steps = h('div', { class: 'g-steps', role: 'list' });
  const side = h('aside', { class: 'g-side' });

  const header = h('header', { class: 'g-header' },
    h('h1', { class: 'g-title' }, 'Script Debugger'), h('span', {}, s.db),
    picker, layout, parameter, scratchLabel, runBtn, runToBp, recordBtn,
    h('span', { class: 'g-spacer' }),
    h('a', { href: './' }, 'Back to browse'),
  );
  // "Explain with AI" for a step that set an error, when the server has the assistant.
  const explain = button('Explain with AI', () => {
    const p = run?.paused;
    const where = p ? `is paused at step ${p.index + 1}${p.script === picker.value ? '' : ` of the subscript "${p.script}"`} (${p.line.trim()})` : 'finished';
    const error = run?.paused?.lastError ?? run?.done?.error ?? run?.error?.code;
    assistant?.askAbout(`The script "${picker.value}" ${where} with Get ( LastError ) = ${error}. What does that error mean here, which step caused it, and how do I fix the script?`);
  }, { hidden: '' });
  // Time travel: the controls for stepping through a recorded run take the place of the live ones.
  let replay: { rec: Recording; at: number } | undefined;
  const goTo = (at: number) => {
    if (!replay) return;
    replay.at = Math.max(0, Math.min(at, replay.rec.steps.length - 1));
    render();
  };
  const first = button('⏮', () => goTo(0), { title: 'First step', 'aria-label': 'First step' });
  const back = button('◀ Back', () => goTo((replay?.at ?? 0) - 1), { title: 'The step before (←)' });
  const forward = button('Forward ▶', () => goTo((replay?.at ?? 0) + 1), { title: 'The next step (→)' });
  const last = button('⏭', () => goTo(Infinity), { title: 'Last step', 'aria-label': 'Last step' });
  const slider = h('input', { type: 'range', min: '0', value: '0', 'aria-label': 'Step of the recorded run', class: 'g-slider' }) as HTMLInputElement;
  slider.addEventListener('input', () => goTo(Number(slider.value)));
  const fieldPick = h('select', { 'aria-label': 'Field that changed' }) as HTMLSelectElement;
  const changePick = h('select', { 'aria-label': 'Change to jump to' }) as HTMLSelectElement;
  fieldPick.addEventListener('change', () => {
    fillChanges();
    const step = Number(changePick.value);
    if (Number.isInteger(step)) goTo(step);
  });
  changePick.addEventListener('change', () => goTo(Number(changePick.value)));
  const leave = button('Done', () => {
    replay = undefined;
    render();
  }, { title: 'Leave the recorded run' });
  const replayLabel = h('span', { class: 'g-status' });
  function fillFields(): void {
    const changes = replay ? fieldChanges(replay.rec) : new Map();
    fieldPick.replaceChildren(h('option', { value: '' }, changes.size ? 'Jump to where a field changed…' : 'No field changed'),
      ...[...changes.keys()].map((k) => h('option', { value: k }, k)));
    fieldPick.disabled = !changes.size;
    fillChanges();
  }
  function fillChanges(): void {
    const list = replay && fieldPick.value ? fieldChanges(replay.rec).get(fieldPick.value) ?? [] : [];
    changePick.replaceChildren(...list.map((c) => h('option', { value: String(c.step) }, describeChange(replay!.rec, c))));
    changePick.hidden = !list.length;
  }
  // FileMaker's Script Debugger keys: F5 Step Over, F6 Step Into, F7 Step Out, ⌥F8 Run to Breakpoint, ⌘F8 Halt,
  // ⇧⌘F5 Set Next Step, ⌘F9 Set/Clear Breakpoint (the chosen step, else where it's paused), ⇧⌘F9 Remove Breakpoints,
  // ⌘F10 Edit Script.
  document.addEventListener('keydown', (e) => {
    if (replay || !/^F(5|6|7|8|9|10)$/.test(e.key)) return;
    const mod = e.metaKey || e.ctrlKey;
    // A key whose button can't act now keeps its usual meaning (F5 reloads the page).
    let acted = false;
    const click = (b: HTMLButtonElement) => {
      if (b.disabled) return;
      acted = true;
      b.click();
    };
    if (e.key === 'F5' && mod && e.shiftKey) click(setNext);
    else if (e.key === 'F5' && !mod) click(over);
    else if (e.key === 'F6' && !mod) click(into);
    else if (e.key === 'F7' && !mod) click(out);
    else if (e.key === 'F8' && e.altKey) click(run?.paused ? cont : runToBp);
    else if (e.key === 'F8' && mod) click(halt);
    else if (e.key === 'F9' && mod && e.shiftKey) {
      clearBreakpoints();
      acted = true;
    } else if (e.key === 'F9' && mod) {
      const at = chosen ?? (run?.paused?.script === shown ? run.paused.index : undefined);
      if (at === undefined) return;
      toggle(shown, at);
      acted = true;
    } else if (e.key === 'F10' && mod) click(editScript);
    if (acted) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (!replay || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'ArrowLeft') goTo(replay.at - 1);
    else if (e.key === 'ArrowRight') goTo(replay.at + 1);
    else return;
    e.preventDefault();
  });
  const live = [over, into, out, cont, halt, setNext, clearAll, editScript, onErrorLabel, h('span', { class: 'g-spacer' }), status, explain];
  const travel = [first, back, slider, forward, last, replayLabel, fieldPick, changePick, h('span', { class: 'g-spacer' }), leave];
  const controlsRow = h('div', { class: 'g-controls' }, ...live);
  const shell = h('div', { class: 'g-shell' },
    header,
    controlsRow,
    h('main', { class: 'g-body' }, steps, side),
  );
  app.replaceChildren(shell);
  let assistant: AssistantPanel | undefined;
  void assistantInfo(s.db, s.token).then((info) => {
    if (!info.available) return;
    assistant = new AssistantPanel(s.db, s.token, debugContext);
    header.insertBefore(button('Ask AI', () => assistant!.toggle()), header.lastElementChild);
    shell.classList.add('with-ai');
    shell.append(assistant.element);
    render();
  });

  /** Where the debugger is, for the assistant. */
  function debugContext(): AssistantContext {
    const p = run?.paused;
    const d = run?.done;
    return {
      mode: 'debug',
      ...(p?.layout ?? d?.layout ? { layout: p?.layout ?? d?.layout } : {}),
      ...(p?.recordId !== undefined ? { recordId: p.recordId } : {}),
      debug: {
        script: p?.script ?? picker.value,
        ...(p ? { step: p.index + 1, line: p.line, lastError: p.lastError, stack: p.stack.map((f) => `${f.script} (step ${f.index + 1})`), variables: { ...p.variables.locals, ...p.variables.globals } } : {}),
        ...(d ? { finished: true, lastError: d.error, result: d.result } : {}),
        ...(run?.error ? { lastError: run.error.code, message: run.error.message } : {}),
      },
    };
  }
  document.title = `${s.db} · Script Debugger`;

  async function recordRun(): Promise<void> {
    if (busy) return;
    if (run?.paused) await command('halt');
    busy = true;
    replay = undefined;
    status.textContent = 'Running and recording on a scratch copy…';
    status.className = 'g-status';
    render();
    try {
      const rec = await call<Recording>('POST', '/recordings', {
        script: picker.value,
        ...(layout.value.trim() ? { layout: layout.value.trim() } : {}),
        ...(parameter.value ? { parameter: parameter.value } : {}),
      });
      if (!rec.steps.length) toast('The script ran no steps.');
      else {
        run = undefined;
        replay = { rec, at: 0 };
        slider.max = String(rec.steps.length - 1);
        fillFields();
      }
    } catch (e) {
      toast(plainMessage(e));
    }
    busy = false;
    render();
  }

  async function begin(pauseAtStart: boolean): Promise<void> {
    if (busy) return;
    replay = undefined;
    if (run?.paused) await command('halt');
    await act(() => call<RunView>('POST', '/runs', {
      script: picker.value, pauseAtStart, pauseOnError, breakpoints, scratch,
      ...(layout.value.trim() ? { layout: layout.value.trim() } : {}),
      ...(parameter.value ? { parameter: parameter.value } : {}),
    }));
  }

  async function command(c: string): Promise<void> {
    if (!run?.paused || busy) return;
    const id = run.id;
    await act(() => call<RunView>('POST', `/runs/${id}/${c}`));
  }

  async function moveTo(): Promise<void> {
    if (!run?.paused || busy || chosen === undefined || run.paused.script !== shown) return;
    const id = run.id;
    const index = chosen;
    chosen = undefined;
    await act(() => call<RunView>('POST', `/runs/${id}/next`, { index }));
  }

  async function act(fn: () => Promise<RunView>): Promise<void> {
    busy = true;
    status.textContent = 'Running…';
    status.className = 'g-status';
    controls();
    try {
      run = await fn();
      if (run.paused) shown = run.paused.script;
    } catch (e) {
      toast(plainMessage(e));
    }
    busy = false;
    render();
    announce();
  }

  function clearBreakpoints(): void {
    breakpoints = [];
    store(bpKey, breakpoints);
    if (run?.paused) void call('PUT', `/runs/${run.id}/breakpoints`, { breakpoints }).catch((e) => toast(plainMessage(e)));
    render();
  }

  function toggle(script: string, index: number): void {
    const has = breakpoints.some((b) => b.script === script && b.index === index);
    breakpoints = has ? breakpoints.filter((b) => !(b.script === script && b.index === index)) : [...breakpoints, { script, index }];
    store(bpKey, breakpoints);
    if (run?.paused) void call('PUT', `/runs/${run.id}/breakpoints`, { breakpoints }).catch((e) => toast(plainMessage(e)));
    render();
  }

  function controls(): void {
    const paused = !!run?.paused && !busy;
    for (const b of [into, over, out, cont, halt]) b.disabled = !paused;
    setNext.disabled = !paused || chosen === undefined || run?.paused?.script !== shown || chosen === run?.paused?.index;
    runBtn.disabled = runToBp.disabled = recordBtn.disabled = busy;
    const wanted = replay ? travel : live;
    if (controlsRow.firstChild !== wanted[0]) controlsRow.replaceChildren(...wanted);
  }

  function table(rows: [string, string | Node][]): HTMLElement {
    return h('table', {}, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'g-mono' }, v)))));
  }

  function vars(title: string, values: Record<string, string>): HTMLElement {
    const rows = Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]): [string, string | Node] => [k, v === '' ? h('span', { class: 'g-none' }, 'empty') : v]);
    return h('section', {}, h('h3', {}, title), rows.length ? table(rows) : h('p', { class: 'g-none' }, 'None'));
  }

  async function watchSection(): Promise<HTMLElement> {
    const box = h('section', { class: 'g-watch' }, h('h3', {}, 'Watch (Data Viewer)'));
    const rows: [string, string | Node][] = [];
    for (const [i, formula] of watches.entries()) {
      let value: Node | string = '';
      if (run?.paused) {
        try {
          const r = await call<{ value: string; error?: number; message?: string }>('POST', `/runs/${run.id}/evaluate`, { formula });
          value = r.error ? h('span', { class: 'g-err' }, `${r.value} (error ${r.error}${r.message ? `: ${r.message}` : ''})`) : r.value;
        } catch (e) {
          value = h('span', { class: 'g-err' }, (e as Error).message);
        }
      }
      const remove = button('×', () => {
        watches = watches.filter((_, j) => j !== i);
        shared!.set(watches);
        render();
      }, { class: 'g-x', title: 'Stop watching' });
      rows.push([formula, h('span', {}, value, ' ', remove)]);
    }
    box.append(rows.length ? table(rows) : h('p', { class: 'g-none' }, 'Add a formula to see its value at each pause.'));
    const input = h('textarea', { rows: '1', placeholder: 'Formula, e.g. Get ( FoundCount )', 'aria-label': 'Formula to watch' });
    const form = h('form', {}, input, h('button', { type: 'submit' }, 'Watch'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      watches = [...watches, input.value.trim()];
      shared!.set(watches);
      render();
    });
    box.append(form);
    return box;
  }

  /** The side panel and status for a step of a recorded run. */
  function replaySide(): HTMLElement[] {
    const { rec, at } = replay!;
    const s = rec.steps[at];
    const end = at === rec.steps.length - 1;
    slider.value = String(at);
    first.disabled = back.disabled = at === 0;
    forward.disabled = last.disabled = end;
    replayLabel.textContent = `Run step ${at + 1} of ${rec.steps.length}, before it runs${rec.stopped ? ' (the run was stopped there: too many steps to record)' : ''}`;
    const parts: HTMLElement[] = [];
    const stack = h('ol', { class: 'g-stack' }, ...[...s.stack].reverse().map((f) => {
      const a = h('a', {}, `${f.script} (step ${f.index + 1})`);
      a.addEventListener('click', () => {
        shown = f.script;
        render();
      });
      return h('li', {}, a);
    }));
    parts.push(h('section', {}, h('h3', {}, 'Call stack'), stack));
    parts.push(h('section', {}, h('h3', {}, 'State before this step'), table([
      ['Get ( LastError )', String(s.lastError)],
      ['Layout', s.layout ?? ''],
      ['Mode', s.mode],
      ['Found count', String(s.foundCount)],
      ['Record ID', s.recordId === undefined ? '' : String(s.recordId)],
      ['Found set', s.foundSet.length ? s.foundSet.join(', ') + (s.foundCount > s.foundSet.length ? ` and ${s.foundCount - s.foundSet.length} more` : '') : ''],
    ])));
    const did: [string, string | Node][] = [];
    for (const e of s.edits ?? []) did.push([`Set ${e.table}::${e.field}${e.recordId !== undefined ? ` (record ${e.recordId})` : ''}`, e.value === '' ? h('span', { class: 'g-none' }, 'empty') : e.value]);
    for (const c of s.changes ?? []) {
      const what = c.kind === 'create' ? 'Created' : c.kind === 'delete' ? 'Deleted' : 'Saved';
      if (!c.fields.length) did.push([`${what} ${c.table} record ${c.recordId}`, '']);
      for (const f of c.fields) did.push([`${what} ${c.table}::${f.field} (record ${c.recordId})`, c.kind === 'create' ? f.after : c.kind === 'delete' ? `was ${f.before}` : `${f.before} → ${f.after}`]);
    }
    for (const t of s.emptied ?? []) did.push([`Emptied ${t.table}`, `${t.records} records`]);
    parts.push(h('section', {}, h('h3', {}, 'What this step did to records'), did.length ? table(did) : h('p', { class: 'g-none' }, 'Nothing')));
    const v = variablesAt(rec, at);
    parts.push(vars('Local variables', v.locals), vars('Global variables', v.globals));
    if (end) {
      const d = rec.done;
      parts.push(h('section', {}, h('h3', {}, 'How the run ended'), table([
        ['Exit Script result', d.result],
        ['Get ( LastError )', String(d.error)],
        ['Layout', d.layout ?? ''],
        ['Found count', String(d.foundCount)],
      ])));
    }
    if (rec.incomplete) parts.push(h('p', { class: 'g-none' }, 'The run changed more records than can be listed here; some changes are missing.'));
    return parts;
  }

  let rendering = 0;
  /** Where the time went: a sentence or two, then the scripts and the slowest steps (click one to see it). */
  function timeSection(prof: RunProfile, soFar: boolean): HTMLElement {
    const go = (script: string, index?: number) => {
      shown = script;
      chosen = index;
      render();
    };
    const link = (label: string, script: string, index?: number) => {
      const a = h('a', { href: '#' }, label);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        go(script, index);
      });
      return a;
    };
    const scriptRows = prof.scripts.filter((x) => x.totalMs > 0 || x.ownMs > 0).slice(0, 10).map((x) =>
      h('tr', {}, h('td', {}, link(x.script, x.script)), h('td', { class: 'g-num' }, String(x.calls)), h('td', { class: 'g-num' }, ms(x.totalMs)), h('td', { class: 'g-num' }, ms(x.ownMs))));
    const stepRows = prof.slowest.slice(0, 10).map((x) =>
      h('tr', {}, h('td', {}, link(`${x.script} ${x.index + 1}`, x.script, x.index), h('div', { class: 'g-mono g-faint' }, x.line.trim().slice(0, 80))),
        h('td', { class: 'g-num' }, String(x.count)), h('td', { class: 'g-num' }, ms(x.ms))));
    return h('section', { class: 'g-time' },
      h('h3', {}, soFar ? 'Where the time went, so far' : 'Where the time went'),
      h('p', {}, `${ms(prof.totalMs)} over ${prof.steps.toLocaleString('en-US')} steps. Time paused in the debugger isn't counted.`),
      ...prof.summary.map((line) => h('p', {}, line)),
      scriptRows.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Script'), h('th', { class: 'g-num' }, 'Calls'), h('th', { class: 'g-num', title: 'With the scripts it calls' }, 'Total'), h('th', { class: 'g-num', title: 'Its own steps' }, 'Own'))), h('tbody', {}, ...scriptRows)) : '',
      stepRows.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Slowest steps'), h('th', { class: 'g-num' }, 'Runs'), h('th', { class: 'g-num' }, 'Time'))), h('tbody', {}, ...stepRows)) : '');
  }

  function render(): void {
    if (stopped || !shared!.active()) return;
    const n = ++rendering;
    if (replay) shown = replay.rec.steps[replay.at].script;
    controls();
    picker.value = shown;
    const script = scripts.find((x) => x.name === shown);
    const here = replay ? (replay.rec.steps[replay.at].script === shown ? replay.rec.steps[replay.at].index : -1)
      : run?.paused?.script === shown ? run.paused.index : -1;
    // The run's slowest steps in this script show their time beside them, the slowest strongest.
    const timed = new Map((run?.profile?.slowest ?? []).filter((x) => x.script === shown).map((x) => [x.index, x]));
    const hottest = run?.profile?.slowest[0]?.ms ?? 0;
    steps.replaceChildren(...(script?.steps ?? []).map((st, i) => {
      const bp = breakpoints.some((b) => b.script === shown && b.index === i);
      const gutter = h('span', { class: 'g-bp', title: bp ? 'Remove breakpoint' : 'Set breakpoint', role: 'button', 'aria-label': `Breakpoint on step ${i + 1}` });
      gutter.addEventListener('click', () => toggle(shown, i));
      const text = h('span', { class: 'g-line' }, st.line || ' ');
      text.addEventListener('click', () => {
        chosen = chosen === i ? undefined : i;
        render();
      });
      const t = timed.get(i);
      const time = h('span', { class: `g-ms${t && hottest && t.ms >= hottest * 0.25 ? ' hot' : ''}`, ...(t ? { title: `${t.count} run${t.count === 1 ? '' : 's'}, ${ms(t.ms / t.count)} each, slowest ${ms(t.maxMs)}` } : {}) }, t ? ms(t.ms) : '');
      return h('div', { class: `g-step${bp ? ' bp' : ''}${i === here ? ' current' : ''}${i === chosen ? ' chosen' : ''}${st.enabled ? '' : ' off'}`, role: 'listitem' },
        gutter, h('span', { class: 'g-n' }, String(i + 1)), text, time);
    }));
    steps.querySelector('.current')?.scrollIntoView({ block: 'nearest' });

    const error = run?.paused?.lastError ?? run?.done?.error ?? run?.error?.code ?? 0;
    explain.hidden = busy || !assistant || !error;
    if (busy) return;
    if (replay) {
      side.replaceChildren(...replaySide());
      return;
    }
    if (run?.paused) {
      const p = run.paused;
      status.textContent = `Paused at step ${p.index + 1} of ${p.script}${run.scratch ? ' (scratch copy)' : ''}`;
      status.className = 'g-status';
    } else if (run?.done) {
      const d = run.done;
      status.textContent = `${d.halted ? 'Halted' : 'Finished'} after ${d.steps} step${d.steps === 1 ? '' : 's'}${d.error ? `, last error ${d.error}` : ''}${run.scratch ? '. Changes stayed on the scratch copy.' : ''}`;
      status.className = d.error ? 'g-status bad' : 'g-status';
    } else if (run?.error) {
      status.textContent = `Error ${run.error.code}: ${run.error.message}`;
      status.className = 'g-status bad';
    } else status.textContent = 'Choose a script and click Debug.';

    const parts: HTMLElement[] = [];
    if (run?.paused) {
      const p = run.paused;
      const stack = h('ol', { class: 'g-stack' }, ...[...p.stack].reverse().map((f) => {
        const a = h('a', {}, `${f.script} (step ${f.index + 1})`);
        a.addEventListener('click', () => {
          shown = f.script;
          render();
        });
        return h('li', {}, a);
      }));
      parts.push(h('section', {}, h('h3', {}, 'Call stack'), stack));
      parts.push(h('section', {}, h('h3', {}, 'State'), table([
        ['Get ( LastError )', String(p.lastError)],
        ...(p.previousError ? [['Error from', h('span', { class: 'g-err' }, `${p.previousError.script} step ${p.previousError.index + 1}: error ${p.previousError.code}${p.previousError.message ? ` (${p.previousError.message})` : ''}`)] as [string, Node]] : []),
        ['Layout', p.layout ?? ''],
        ['Mode', p.mode],
        ['Found count', String(p.foundCount)],
        ['Record ID', p.recordId === undefined ? '' : String(p.recordId)],
      ])));
      parts.push(vars('Local variables', p.variables.locals), vars('Global variables', p.variables.globals));
    } else if (run?.done) {
      const d = run.done;
      parts.push(h('section', {}, h('h3', {}, 'Result'), table([
        ['Exit Script result', d.result],
        ['Get ( LastError )', String(d.error)],
        ['Layout', d.layout ?? ''],
        ['Found count', String(d.foundCount)],
      ])));
    }
    const prof = run?.profile;
    if (prof && prof.steps && (run?.done || run?.paused)) parts.push(timeSection(prof, !!run?.paused));
    void watchSection().then((w) => {
      if (!stopped && shared!.active() && n === rendering) side.replaceChildren(...parts, w);
    });
  }

  window.addEventListener('focus', () => {
    if (!stopped) void call('GET', '/scripts').catch((e) => {
      if (!stopped && shared!.active()) toast(plainMessage(e));
    });
  });
  render();
}

start().catch((e) => app.replaceChildren(h('p', { class: 'empty' }, `Couldn't start: ${(e as Error).message}`)));
