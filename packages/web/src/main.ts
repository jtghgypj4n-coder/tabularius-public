// The app shell: pick a database, log in, then browse its layouts with a
// status toolbar like FileMaker's (records, find, sort, form/list/table view).

// The server's "sign in with your passkey" answer (store/src/error-codes.ts: PASSKEY_SECOND_FACTOR_REQUIRED). The web
// client is served from packages/web only, so it keeps its own copy instead of importing the store.
const PASSKEY_SECOND_FACTOR_REQUIRED = 9000;

import { ViewerState, viewerKey, viewerMessage, restoreViewer, type ViewerAction } from './web-viewer.ts';
import { mergeObjectState, mergeObjectRecord, mergeFoundObjectRows, refreshMatches, checkpointCache, foundPortalPage, foundPortalRange } from './refresh.ts';
import { Api, ApiError, PIECED_FROM, listDatabases, retryableRequest, retrying, unreachableRequest, type ExportFormat } from './api.ts';
import { OfflineCopy, copyKey, deriveBits, exportKey, importKey, indexedDbShelf, newSalt, type OfflineKey, type QueuedEdit } from './offline.ts';
import { passkeySupported, signInWithPasskey, signInWithPasskeyFactor, signInWithRecoveryCode, type PasskeyLogin } from './webauthn.ts';
import { scriptFailureMessage } from './script-error.ts';
import { signInError212 } from './sign-in-error.ts';
import { ABOUT_RECORD, AssistantPanel, assistantInfo } from './assistant.ts';
import { forgetAssistantHistory } from './assistant-chat.ts';
import { calendarDialog } from './calendar-dialog.ts';
import { readUrlState, writeUrlState, writeAddress, addsHistoryEntry, pageTitle, type UrlState } from './url-state.ts';
import { importTablesDialog } from './import-tables-dialog.ts';
import { importDialog, importTooLarge, type ImportFound } from './import-dialog.ts';
import { LayoutRenderer, containerKind, callWebViewer, answerPageCalls, tellPages, previewStyled, type Host, type Mode, type RowContext } from './layout.ts';
import { editRuns, formatAt, restyleRange, type TextFormat } from './styled.ts';
import { LockedError, Locks, Presence, currentLocks, currentViewers, listen, type Change } from './live.ts';
import { relayedChange, relayedFrom, type Relayed } from './change-relay.ts';
import { mergePrefs } from './prefs-merge.ts';
import { showExplanation } from './explain.ts';
import { showRecordHistory } from './record-history.ts';
import { fromDevice, locate, scanBarcode, signature, takePhoto, type DeviceType } from './device.ts';
import { returnFocus } from './return-focus.ts';
import { MenuBar, commands, shortcutItem, shortcutText, standardMenus, withoutTabAlt } from './menubar.ts';
import { buildFindRequests, FIND_OPERATORS, findName, matchingCriterion, type SavedFind } from './finds.ts';
import { PREVIEW_MAX, pageNumbers, pageSize, paginate, paginateColumns, printLimitNotice, slide, type SlideBox } from './preview.ts';
import { responsiveDesign, stackBreakpoint } from './responsive.ts';
import type { RefreshData, CustomMenu, CustomMenuItem, DataRecord, FindRequest, GroupRun, LayoutDesign, LayoutMeta, LayoutPart, LayoutObject, MenuItem, PortalRow, ScriptRun, ScriptsMenuEntry, ScriptWindow, SortSpec, Value, FormulaState } from './types.ts';
import { moveCaret } from './caret.ts';
import { linkedScript } from './url-script.ts';
import { macroScript, type MacroAction } from './macro.ts';
import { macroDialog } from './macro-view.ts';
import type { ScriptDryRun } from './design/client.ts';
import { PRODUCT_NAME, lockup } from './brand.ts';
import { digestApi, type Digest, type DigestList } from './dashboards/digest.ts';
import { idsAt, pagesHolding } from './updating.ts';
import { keepFocusOnPress } from './keep-focus.ts';
import { triggerKeystroke } from './keystrokes.ts';
import { pinnedToast, progressToast, toast, toastUndo } from './toast.ts';
import { httpProblem } from './http-problem.ts';
import { browserFeatures, browserFeatureMessage } from './browser-features.ts';
import { announce } from './announcer.ts';

type View = 'form' | 'list' | 'table';
type OpenPopover = { id: number; el: HTMLElement; button: number; parent?: OpenPopover };
type FoundPortalRequest = { positions: Set<number>; records: Set<string> };
type FoundPortalVersion = { generation: number; modId?: string };
type FoundPortalRows = {
  rows: (PortalRow | undefined)[]; page: number; asked: Set<number>; top: number;
  stale?: Set<string>; requests?: Set<FoundPortalRequest>; rejections?: Map<string, number>;
  displaced?: Map<string, PortalRow>;
  generation?: number; versions?: Map<string, FoundPortalVersion>;
  failures?: Map<string | number, number>; failed?: Map<string | number, unknown>;
};
type FieldPlace = { id?: string; record?: string; row?: string; rep: number; fresh?: boolean };
/** A Find mode request: criteria by field key, and whether it omits what it matches. */
type FindModeRequest = { criteria: Record<string, string>; omit: boolean };

const PAGE = 50;
/** The tallest a long list is drawn, in pixels; longer ones scroll proportionally. */
const MAX_DRAWN = 15_000_000;
const SCOPE = 'fm-layout';
/** Script triggers that run before their event, and cancel it when the script exits with False. */
const PRE_EVENTS = new Set(['OnLayoutExit', 'OnModeExit', 'OnRecordCommit', 'OnRecordRevert', 'OnPanelSwitch', 'OnObjectValidate', 'OnObjectKeystroke', 'OnLayoutKeystroke']);

// "Available menu commands" (a UI guard, not a security boundary). Commands that
// change record data or the found set are withheld at the `minimum` level;
// structural commands (import/export, managing the database) are withheld at
// `editing` and below. Everything else (navigating, finding, viewing) is always
// offered. Names match the FileMaker menu commands menuCommand() handles.
const EDITING_COMMANDS = new Set(['New Record', 'Delete Record', 'Duplicate Record', 'Omit Record', 'Show Omitted Only', 'Sort Records', 'Unsort',
  'Plain', 'Bold', 'Italic', 'Underline', 'Word Underline', 'Double Underline', 'Strikethrough', 'Highlight', 'Small Caps', 'Uppercase', 'Lowercase', 'Title Case', 'Superscript', 'Subscript']);
// What FileMaker's "Allow printing" and "Allow exporting" cover (Claris, Editing other privileges).
const PRINT_COMMANDS = new Set(['Print', 'Save Records as PDF']);
const EXPORT_COMMANDS = new Set(['Export Records', 'Save Records as Excel']);
const STRUCTURAL_COMMANDS = new Set(['Layout Mode', 'Import Records', 'Import Calendar', 'Import Tables', 'Manage Calendar Feeds', 'Export Records', 'Save Records as Excel', 'Save Records as PDF', 'Manage Database', 'Manage Security', 'Manage Layouts']);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

/** A date as the web client shows dates: 10/12/2026. */
function usDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A time as the web client shows times: 14:05:09. */
function clockTime(d: Date): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** A container's file in a sheet over the window: the picture, the PDF in the browser's viewer, or the video playing. */
async function previewContainer(url: string, filename: string, kind: 'image' | 'video' | 'audio' | 'pdf' | 'file'): Promise<void> {
  if (kind === 'pdf') {
    // Shown in the page only when the server says it is a PDF (the name alone is the uploader's word): otherwise saved.
    const type = await fetch(url, { method: 'HEAD' }).then((r) => (r.ok ? r.headers.get('content-type') ?? '' : ''), () => '');
    if (!/^application\/pdf\b/i.test(type)) {
      downloadContainer(url, filename);
      return;
    }
  }
  const body = kind === 'image' ? h('img', { src: url, alt: filename })
    : kind === 'video' ? h('video', { src: url, controls: '', autoplay: '', playsinline: '' })
    : kind === 'pdf' ? h('iframe', { src: url, title: filename, referrerpolicy: 'no-referrer' })
    : h('audio', { src: url, controls: '', autoplay: '' });
  const dialog = h('dialog', { class: 'container-preview', 'aria-label': filename }) as HTMLDialogElement;
  dialog.append(
    h('div', { class: 'preview-head' }, h('h2', {}, filename), button('Download', () => downloadContainer(url, filename)), button('Done', () => dialog.close(), { class: 'primary' })),
    h('div', { class: `preview-body ${kind}` }, body),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  document.body.append(dialog);
  dialog.showModal();
}

/** Saves a container's file under its own name (the server sends it to show in place, so the link asks to save it). */
function downloadContainer(url: string, filename: string): void {
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

/** Asks the person for a file, as FileMaker's Insert File dialog does; undefined when they cancel. */
function chooseFile(title?: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'file-dialog', 'aria-labelledby': 'choose-file-title' }) as HTMLDialogElement;
    const input = h('input', { type: 'file', 'aria-label': title || 'File to insert' }) as HTMLInputElement;
    let chosen: File | undefined;
    const ok = button('Insert', () => {
      chosen = input.files?.[0];
      dialog.close();
    }, { class: 'primary' });
    ok.disabled = true;
    input.addEventListener('change', () => (ok.disabled = !input.files?.length));
    dialog.append(
      h('h2', { id: 'choose-file-title' }, title || 'Insert File'),
      input,
      h('div', { class: 'actions' }, button('Cancel', () => dialog.close()), ok),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(chosen);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** View Index: the field's values, to pick one from (Insert > From Index and the Insert from Index step). Undefined for Cancel. */
function viewIndex(values: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'replace-dialog index-dialog', 'aria-label': 'View Index' }) as HTMLDialogElement;
    const filter = h('input', { type: 'search', placeholder: 'Type to find a value', 'aria-label': 'Find in index' }) as HTMLInputElement;
    const list = h('select', { size: '12', 'aria-label': 'Index values' }) as HTMLSelectElement;
    const fill = () => {
      const f = filter.value.toLowerCase();
      list.replaceChildren(...values.filter((v) => v.toLowerCase().startsWith(f)).map((v) => h('option', { value: v }, v)));
      if (list.options.length) list.selectedIndex = 0;
    };
    let picked: string | undefined;
    const paste = () => {
      picked = list.value || undefined;
      dialog.close();
    };
    filter.addEventListener('input', fill);
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); paste(); }
      if (e.key === 'ArrowDown' && list.options.length) { e.preventDefault(); list.focus(); }
    });
    list.addEventListener('dblclick', paste);
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); paste(); }
    });
    dialog.append(
      h('h2', {}, 'View Index'),
      values.length ? filter : h('p', {}, 'The index is empty: no record has a value in this field yet.'),
      ...(values.length ? [list] : []),
      h('div', { class: 'actions' }, h('span', { class: 'spacer' }), button('Cancel', () => dialog.close()), button('Paste', paste, { class: 'primary' })),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(picked);
    });
    fill();
    document.body.append(dialog);
    dialog.showModal();
    filter.focus();
  });
}

/**
 * Paste in a script with nothing copied in it: the text on the person's clipboard. The browser may let the page
 * read it (it may ask first); when it won't, the person pastes into a box (⌘V or Ctrl+V). Undefined for Cancel.
 */
async function personClipboard(): Promise<string | undefined> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return pasteBox();
  }
}

function pasteBox(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'replace-dialog', 'aria-label': 'Paste' }) as HTMLDialogElement;
    const box = h('textarea', { rows: '6', 'aria-label': 'Text to paste' }) as HTMLTextAreaElement;
    let pasted: string | undefined;
    const ok = () => {
      pasted = box.value;
      dialog.close();
    };
    dialog.append(
      h('h2', {}, 'Paste'),
      h('p', {}, `A script is pasting, and the browser didn't let it read the clipboard. Paste here with ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}V.`),
      box,
      h('div', { class: 'actions' }, h('span', { class: 'spacer' }), button('Cancel', () => dialog.close()), button('Paste', ok, { class: 'primary' })),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(pasted);
    });
    document.body.append(dialog);
    dialog.showModal();
    box.focus();
  });
}

/**
 * Show Custom Dialog: the title, message, input fields and buttons, with the
 * first button on the right as the default, as FileMaker draws it. Escape
 * closes it without a button (the server takes the last one, as for Cancel).
 */
function customDialog(w: NonNullable<ScriptRun['waiting']>): Promise<{ button: number; inputs: string[] } | undefined> {
  return new Promise((resolve) => {
    // Named by its title, else its message, so a screen reader says what it asks.
    const dialog = h('dialog', { class: 'file-dialog custom-dialog', 'aria-label': w.title || w.message || 'Dialog' }) as HTMLDialogElement;
    let answer: { button: number; inputs: string[] } | undefined;
    const fields = (w.inputs ?? []).map((x) => {
      const input = h('input', { type: x.password ? 'password' : 'text', value: x.value }) as HTMLInputElement;
      input.value = x.value;
      return { label: h('label', {}, h('span', {}, x.label), input), input };
    });
    const labels = w.buttons?.length ? w.buttons : ['OK'];
    const buttons = labels
      .map((label, i) => ({ label, n: i + 1 }))
      .filter((b) => b.label !== '')
      .reverse()
      .map((b) => button(b.label, () => {
        answer = { button: b.n, inputs: fields.map((f) => f.input.value) };
        dialog.close();
      }, b.n === 1 ? { class: 'primary' } : {}));
    const form = h('form', { method: 'dialog' }, ...fields.map((f) => f.label)) as HTMLFormElement;
    // Enter in an input chooses the first button.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      answer = { button: 1, inputs: fields.map((f) => f.input.value) };
      dialog.close();
    });
    dialog.append(
      ...(w.title ? [h('h2', {}, w.title)] : []),
      ...(w.message ? [h('p', { class: 'message' }, w.message)] : []),
      form,
      h('div', { class: 'actions' }, ...buttons),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    (fields[0]?.input ?? buttons[buttons.length - 1])?.focus();
  });
}

function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

/** The status toolbar's icons: line drawings on a 20-point grid, in the text color. */
const svg = (body: string) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TOOL_ICONS = {
  prev: svg('<path d="M10 4.5c-2-1.3-4.5-1.5-7-1v12c2.5-.5 5-.3 7 1z"/><path d="M7 9.5h-2.5m0 0 1.5-1.5m-1.5 1.5 1.5 1.5"/>'),
  next: svg('<path d="M10 4.5c2-1.3 4.5-1.5 7-1v12c-2.5-.5-5-.3-7 1z"/><path d="M13 9.5h2.5m0 0-1.5-1.5m1.5 1.5-1.5 1.5"/>'),
  showAll: svg('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>'),
  newRecord: svg('<path d="M11.5 3H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5V7z"/><path d="M11.5 3v4h4M10 9.5v5M7.5 12h5"/>'),
  newRequest: svg('<circle cx="9" cy="9" r="4.5"/><path d="m12.5 12.5 4 4M9 7v4M7 9h4"/>'),
  delete: svg('<path d="M3.5 5.5h13M8 5.5V4h4v1.5M5.5 5.5l.8 10.1a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-10.1M8.5 8.5v5.5M11.5 8.5v5.5"/>'),
  find: svg('<circle cx="8.5" cy="8.5" r="5"/><path d="m12.3 12.3 4.2 4.2"/>'),
  sort: svg('<path d="M6 3.5v13m0 0-2.5-2.5M6 16.5l2.5-2.5M14 16.5v-13m0 0-2.5 2.5M14 3.5l2.5 2.5"/>'),
  cancel: svg('<circle cx="10" cy="10" r="6.5"/><path d="m7.5 7.5 5 5m0-5-5 5"/>'),
  constrain: svg('<circle cx="8.5" cy="8.5" r="5"/><path d="m12.3 12.3 4.2 4.2M6.5 8.5h4"/>'),
  extend: svg('<circle cx="8.5" cy="8.5" r="5"/><path d="m12.3 12.3 4.2 4.2M8.5 6.5v4M6.5 8.5h4"/>'),
  exit: svg('<path d="M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3M12 6.5 15.5 10 12 13.5M15.5 10H7.5"/>'),
  print: svg('<path d="M6 7V3.5h8V7M6 14H4.5A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7h11A1.5 1.5 0 0 1 17 8.5v4a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M6 11.5h8v5H6z"/>'),
  pdf: svg('<path d="M11.5 3H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5V7z"/><path d="M11.5 3v4h4M10 9v5.5m0 0-2-2m2 2 2-2"/>'),
  form: svg('<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M6.5 7h3M6.5 10h7M6.5 13h5"/>'),
  list: svg('<rect x="3.5" y="3.5" width="13" height="5" rx="1"/><rect x="3.5" y="11.5" width="13" height="5" rx="1"/>'),
  table: svg('<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M3.5 8h13M3.5 12.3h13M8.5 3.5v13"/>'),
  toolbar: svg('<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 8h14"/>'),
} as const;

/** A status toolbar button: its icon over its name, as FileMaker draws them. */
function tool(label: string, icon: keyof typeof TOOL_ICONS, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = button('', onClick, { class: 'tb', ...attrs });
  b.innerHTML = `${TOOL_ICONS[icon]}<span class="tb-label">${label}</span>`;
  return b;
}

const app = document.getElementById('app')!;

/** Saves a file to the person's downloads, as the browser does with a link. */
function saveDownload(name: string, file: Blob | string): void {
  const a = h('a', { href: typeof file === 'string' ? file : URL.createObjectURL(file), download: name }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof file !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** A file a script sent as base64, as a blob to save. */
/** Beep: a short tone, as the computer's alert sound would be (silent where the browser has no audio). */
function beep(): void {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.1;
    tone.frequency.value = 880;
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.15);
    tone.onended = () => void audio.close();
  } catch {
    // no audio here
  }
}

function base64Blob(data: string): Blob {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes]);
}

/** A text field or other control that takes typing, where ⌘Z belongs to the browser. */
function editable(el: Element | null): boolean {
  return !!el?.matches?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

/** A message the administrator sent to this client: stays until dismissed, like FileMaker's message dialog. */
function adminNotice(text: string): void {
  const notice = h('div', { class: 'admin-notice', role: 'alertdialog', 'aria-label': 'Message from the administrator' });
  notice.append(
    h('div', { class: 'admin-notice-head' }, 'Message from the administrator'),
    h('div', { class: 'admin-notice-text' }, text),
    button('Dismiss', () => {
      notice.remove();
      if (document.activeElement === document.body || !document.activeElement) before?.focus();
    }, { class: 'admin-notice-close' }),
  );
  // It is an alert dialog: focus goes to it, and back where it was once dismissed.
  const before = document.activeElement as HTMLElement | null;
  document.body.append(notice);
  notice.querySelector<HTMLElement>('.admin-notice-close')?.focus();
}

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 503) return 'Server busy. Try again shortly.';
  if (unreachableRequest(e)) return "Can't reach the server. Check the connection and try again.";
  if (e instanceof ApiError) return `${e.message} (error ${e.code})${e.denial ? ` ${e.denial.explanation}` : ''}`;
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- start / login

async function start(): Promise<void> {
  const required = browserFeatures().find((feature) => feature.name === 'structuredClone' && !feature.available);
  if (required) {
    const root = document.querySelector<HTMLElement>('#app');
    if (root) root.replaceChildren(h('section', { class: 'fatal', role: 'alert' }, h('h1', {}, 'This browser cannot run Tabularius'), h('p', {}, browserFeatureMessage(required)), h('p', {}, 'Update your browser and reload this page.'), h('a', { href: 'self-check.html' }, 'Run browser self-check')));
    return;
  }
  // Back from an identity provider: the server put the session (or an error) in the fragment.
  const back = new URLSearchParams(location.hash.slice(1));
  if (back.has('token') || back.has('error')) {
    history.replaceState(null, '', location.pathname + location.search);
    if (back.has('error')) {
      showLogin(back.get('error')!);
      return;
    }
    sessionStorageSet('tabularius.session', JSON.stringify({ db: back.get('db') ?? '', token: back.get('token') }));
  }
  // Window > New Window: the window it came from, to show the same found set and record.
  let from: WindowSnapshot | undefined;
  if (back.has('window')) {
    history.replaceState(null, '', location.pathname + location.search);
    try {
      from = JSON.parse(back.get('window')!) as WindowSnapshot;
    } catch {
      from = undefined;
    }
  }
  // Back from Layout mode or Design: the same layout, found set and record (once).
  if (!from) {
    const back = sessionStorageGet(RETURN_KEY);
    sessionStorageSet(RETURN_KEY, undefined);
    try {
      from = back ? JSON.parse(back) as WindowSnapshot : undefined;
    } catch {
      from = undefined;
    }
  }
  const saved = sessionStorageGet('tabularius.session');
  if (saved) {
    try {
      const { db, token, offline } = JSON.parse(saved) as { db: string; token: string; offline?: OfflineKey };
      const api = new Api(db, token);
      await restoreOffline(api, offline);
      const session = new Session(api);
      await session.open(from);
      showBrowserFeatureNotice();
      return;
    } catch {
      sessionStorageSet('tabularius.session', undefined);
    }
  }
  await showLogin();
  showBrowserFeatureNotice();
}

/** Features whose absence changes what the page can do for a person; the rest (clipboard, ResizeObserver) have a plain fallback and are only on the self-check page. */
const NOTICE_FEATURES = new Set(['Modules', 'IndexedDB', 'WebAuthn', 'Service workers']);

function showBrowserFeatureNotice(): void {
  const unavailable = browserFeatures().filter((feature) => !feature.available && NOTICE_FEATURES.has(feature.name));
  if (!unavailable.length) return;
  const dismiss = h('button', { type: 'button' }, 'Dismiss');
  const notice = h('aside', { class: 'browser-support-banner', role: 'status', 'aria-label': 'Browser feature support' },
    h('strong', {}, 'Some browser features are unavailable'),
    ...unavailable.map((feature) => h('p', {}, browserFeatureMessage(feature))),
    h('a', { href: 'self-check.html' }, 'Run browser self-check'),
    ' ',
    dismiss,
  );
  dismiss.addEventListener('click', () => notice.remove());
  Object.assign(notice.style, { position: 'fixed', zIndex: '20000', inset: '0 0 auto', padding: '12px 20px', background: '#fff4dc', color: '#33270c', borderBottom: '1px solid #7a4a00', maxHeight: '35vh', overflow: 'auto' });
  document.body.append(notice);
}

/** What a new window copies from the window it was opened from. */
const PREF_NAMES = ['finds', 'sorts', 'recent'] as const;
/** How far to pull down at the top of the window before letting go refreshes it. */
const PULL_TO_REFRESH = 64;
type PrefName = typeof PREF_NAMES[number];
interface SavedSort { name: string; layout: string; sort: SortSpec[] }
interface RecentRecord { layout: string; recordId: string; title: string }
/** What a window shows while another window is in front of it (New Window in a script). */
interface WindowState {
  meta?: LayoutMeta; renderer?: LayoutRenderer; view: View; mode: Mode; preview: boolean; query?: FindRequest[]; sort?: SortSpec[]; ids?: number[];
  foundCount: number; totalCount: number; cache: Map<number, DataRecord>; index: number; lastTable?: string; requests: FindModeRequest[]; request: number;
  panels: Map<number, number>; scroll: number;
}
interface WindowSnapshot { layout: string; view: View; query?: FindRequest[]; sort?: SortSpec[]; ids?: number[]; index: number; recordId?: string; number?: number; /** Coming back from Layout mode: the mode to go on in. */ mode?: 'browse' | 'find' | 'preview' }

/** Where this window was when it went to Layout mode or Design, to come back to the same found set and record. */
const RETURN_KEY = 'tabularius.return';
/** A found-set portal fetches the rows it shows and this many more, at first and each time it scrolls. */
const FOUND_ROWS_SPARE = 5;

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionStorageSet(key: string, value: string | undefined): void {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // private mode: the session just won't survive a reload
  }
}

async function showLogin(message?: string): Promise<void> {
  document.title = PRODUCT_NAME;
  // Whoever signs in next does not get the last person's conversation with the assistant.
  forgetAssistantHistory();
  // Without a connection, the files this browser keeps offline copies of can still be opened, with their password.
  let unreachable = false;
  let busy = false;
  const online = await listDatabases().catch((e) => { if (e instanceof ApiError && e.status === 503) busy = true; else unreachable = true; return [] as string[]; });
  if (busy) {
    showBusyScreen();
    return;
  }
  const copies = unreachable && shelf ? await OfflineCopy.list(shelf).catch(() => []) : [];
  const dbs = unreachable ? [...new Set(copies.map((c) => c.db))] : online;
  // No file is open while signing in.
  offlineHooks = undefined;
  showOnline();
  // The server lists its files only to a caller who has signed in (unless it was started with --list-files-publicly), so with none listed the name is typed.
  const typed = !dbs.length && !unreachable;
  const select = (typed ? h('input', { name: 'db', required: '', autocomplete: 'off', spellcheck: 'false' }) : h('select', { name: 'db', required: '' })) as HTMLSelectElement;
  if (!typed) for (const d of dbs) select.append(h('option', { value: d }, d));
  // A link to one file (/app/?db=Name, as the admin console opens a file it has just hosted) picks it.
  const wanted = new URLSearchParams(location.search).get('db');
  const last = wanted ?? localStorageGet('openhbam.db');
  if (last && (typed || dbs.includes(last))) select.value = last;
  const fileName = () => select.value.trim();
  const account = h('input', { name: 'account', autocomplete: 'username', required: '', value: localStorageGet('openhbam.account') ?? 'Admin' });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password' });
  const otp = h('input', { name: 'otp', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', placeholder: '123456' });
  const otpLabel = h('label', { class: 'login-otp', hidden: '' }, 'Authenticator code', otp);
  const passkeyFactorButton = button('Use your passkey', () => void usePasskeyFactor(), { class: 'login-alt', hidden: '' });
  const error = h('p', { class: 'login-error', role: 'alert' }, message ?? '');
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Open');
  // Identity providers set up on the server (external accounts).
  const providers = await fetch('/tabularius/auth/v1/providers').then((r) => r.json()).then((b) => (b.providers ?? []) as { name: string; start: string }[]).catch(() => []);
  const external = providers.map((p) => {
    const b = h('button', { type: 'button' }, `Sign in with ${p.name}`);
    b.addEventListener('click', () => {
      localStorageSet('openhbam.db', fileName());
      location.href = `${p.start}?db=${encodeURIComponent(fileName())}`;
    });
    return b;
  });
  // Passwordless sign-in, when the browser supports passkeys: sign in with a
  // passkey, or fall back to a one-time recovery code. Both use the account name
  // typed above; a passkey is checked against this file, a recovery code too.
  const passwordless = passkeySupported() ? [
    h('p', { class: 'login-or' }, 'or'),
    button('Sign in with a passkey', () => void usePasskey(), { class: 'login-alt' }),
    button('Use a recovery code', () => void useRecoveryCode(), { class: 'login-link' }),
  ] : [];
  const form = h('form', { class: 'login', 'aria-labelledby': 'login-title' },
    lockup('div'),
    h('h1', { id: 'login-title' }, 'Open a file'),
    ...(unreachable ? [h('p', { class: 'login-empty' }, dbs.length
      ? "The server can't be reached, so only the files this browser keeps offline copies of can be opened. Changes to fields are sent once the connection is back."
      : "The server can't be reached, and this browser keeps no offline copies. The list of files comes back with the connection.")] : []),
    dbs.length || typed ? h('label', {}, 'File', select) : '',
    h('label', {}, 'Account name', account),
    h('label', {}, 'Password', password),
    otpLabel,
    passkeyFactorButton,
    error,
    h('a', { href: '/docs/troubleshooting-web-client#sign-in-stays-on-the-sign-in-screen' }, 'Sign-in help'),
    h('a', { href: '/docs/troubleshooting-web-client#a-passkey-prompt-is-cancelled-missing-or-does-not-sign-in' }, 'Passkey help'),
    submit,
    ...((dbs.length || typed) && !unreachable ? external : []),
    ...((dbs.length || typed) && !unreachable ? passwordless : []),
  );
  /** Opens the file once a sign-in returns a token; sends a must-change account to set a new password first. */
  const complete = async (api: Api, currentPassword: string | undefined): Promise<void> => {
    localStorageSet('openhbam.db', fileName());
    localStorageSet('openhbam.account', account.value);
    // Account Options / password policy: the account must set a new password
    // before it can go any further, as FileMaker prompts at sign-in. Changing it
    // needs the current password, so a passwordless sign-in can't finish the
    // change — send them back to sign in with their password to do it.
    let password = currentPassword;
    let previous: OfflineCopy | undefined;
    if (api.passwordChangeRequired) {
      if (currentPassword === undefined) {
        await api.logout().catch(() => {});
        throw new ApiError(212, 'This account must change its password. Sign in with your password to set a new one.');
      }
      // A copy made with the old password moves to the new one, with any changes still waiting in it.
      previous = (await openCopyWith(api.db, account.value, currentPassword).catch(() => undefined))?.copy;
      password = await changePasswordScreen(api, currentPassword);
    }
    if (password !== undefined) api.offlineKey = await offlineKeyFor(api, account.value, password, previous);
    sessionStorageSet('tabularius.session', JSON.stringify({ db: api.db, token: api.token, ...(api.offlineKey ? { offline: api.offlineKey } : {}) }));
    // The welcome page's "also make modern layouts" box sends the person on to Modernize interfaces once they're in.
    if (new URLSearchParams(location.search).get('modernize') === '1') {
      location.href = 'design.html#modernize';
      return;
    }
    await new Session(api).open();
  };
  const fromPasswordless = (login: PasskeyLogin): Api => {
    const api = new Api(login.db, login.token);
    api.passwordChangeRequired = login.passwordChangeRequired;
    return api;
  };
  const usePasskey = async (): Promise<void> => {
    error.textContent = '';
    if (!account.value.trim()) { error.textContent = 'Enter your account name, then choose a passkey.'; account.focus(); return; }
    try {
      await complete(fromPasswordless(await signInWithPasskey(fileName(), account.value.trim())), undefined);
    } catch (err) {
      // A cancelled or absent authenticator throws NotAllowedError; don't scold.
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) error.textContent = 'Passkey sign-in was cancelled.';
      else error.textContent = errorText(err);
    }
  };
  const usePasskeyFactor = async (): Promise<void> => {
    error.textContent = '';
    try {
      await complete(fromPasswordless(await signInWithPasskeyFactor(fileName(), account.value.trim(), password.value)), password.value);
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) error.textContent = 'Passkey sign-in was cancelled.';
      else error.textContent = errorText(err);
    }
  };
  const useRecoveryCode = async (): Promise<void> => {
    error.textContent = '';
    if (!account.value.trim()) { error.textContent = 'Enter your account name first.'; account.focus(); return; }
    const code = await askText('Recovery code', 'Recovery code', '', 'Sign In', 'Enter one of your recovery codes.');
    if (!code) return;
    try {
      await complete(fromPasswordless(await signInWithRecoveryCode(fileName(), account.value.trim(), code.trim())), undefined);
    } catch (err) {
      error.textContent = err instanceof ApiError && err.code === 212 ? 'That recovery code is not valid.' : errorText(err);
    }
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    if (unreachable) {
      try {
        const api = await openOfflineCopy(fileName(), account.value, password.value);
        if (api) {
          localStorageSet('openhbam.db', fileName());
          localStorageSet('openhbam.account', account.value);
          await new Session(api).open();
          return;
        }
        error.textContent = 'The account name or password is wrong, or this browser keeps no offline copy of the file for that account.';
      } catch (err) {
        error.textContent = errorText(err);
      }
      submit.disabled = false;
      return;
    }
    try {
      const api = await Api.login(fileName(), account.value, password.value, otpLabel.hidden ? undefined : otp.value.trim());
      await complete(api, password.value);
    } catch (err) {
      if (err instanceof ApiError && err.code === 1211) {
        // The account has two-factor sign-in: ask for the code and keep the password.
        otpLabel.hidden = false;
        error.textContent = otp.value.trim() ? 'That code is not valid; check your authenticator app.' : 'Enter the code from your authenticator app.';
        otp.focus();
      } else if (err instanceof ApiError && err.code === PASSKEY_SECOND_FACTOR_REQUIRED) {
        // The account's second factor is a passkey, not an authenticator code: offer it, keeping the password.
        passkeyFactorButton.hidden = false;
        error.textContent = 'This account signs in with a passkey as its second factor.';
      } else {
        error.textContent = err instanceof ApiError && err.code === 212 ? signInError212(err.message) : errorText(err);
      }
      submit.disabled = false;
    }
  });
  app.replaceChildren(h('main', { class: 'login-screen' }, form));
  (typed ? (select.value ? (account.value ? password : account) : select) : dbs.length ? (account.value ? password : account) : account).focus();
}

/**
 * The account owes a password change (must-change, or an expired password):
 * ask for a new one before the file opens. Resolves once it is changed; the
 * current password, kept from the sign-in, verifies the change.
 */
function changePasswordScreen(api: Api, currentPassword: string): Promise<string> {
  return new Promise((resolve) => {
    const next = h('input', { name: 'new', type: 'password', autocomplete: 'new-password', required: '' });
    const confirm = h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: '' });
    const error = h('p', { class: 'login-error', role: 'alert' }, 'Your password must be changed before you can continue.');
    const submit = h('button', { type: 'submit', class: 'primary' }, 'Change password');
    const form = h('form', { class: 'login', 'aria-labelledby': 'login-title' },
      lockup('div'),
      h('h1', { id: 'login-title' }, 'New password'),
      h('label', {}, 'New password', next),
      h('label', {}, 'Confirm new password', confirm),
      error,
      submit,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (next.value !== confirm.value) { error.textContent = 'The two passwords do not match.'; confirm.focus(); return; }
      submit.disabled = true;
      error.textContent = '';
      try {
        await api.changePassword(currentPassword, next.value);
        resolve(next.value);
      } catch (err) {
        error.textContent = errorText(err);
        submit.disabled = false;
      }
    });
    app.replaceChildren(h('main', { class: 'login-screen' }, form));
    next.focus();
  });
}

function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------- offline copy

/** Where this browser keeps offline copies (IndexedDB); browsers allow the encryption they need only over HTTPS or on this computer. */
const shelf = typeof indexedDB !== 'undefined' && isSecureContext && globalThis.crypto?.subtle ? indexedDbShelf() : undefined;

/**
 * After a password sign-in: the password's key for the file's offline copy. Opens the copy when the account keeps
 * one, and is kept for the session so one can be started from the File menu without asking for the password again.
 * A copy made with an earlier password can't be opened: `previous` (that copy, opened before a change of password
 * at sign-in) moves to the new key; otherwise one still holding changes waits for the old password (staleCopy),
 * and one without starts again.
 */
async function offlineKeyFor(api: Api, account: string, password: string, previous?: OfflineCopy): Promise<OfflineKey | undefined> {
  if (!shelf) return undefined;
  try {
    const salt = await OfflineCopy.saltOf(shelf, api.db, account) ?? newSalt();
    const bits = await deriveBits(password, salt);
    const key = await copyKey(bits);
    const found = await OfflineCopy.open(shelf, api.db, account, key);
    if (found !== 'wrong') api.offline = found;
    else if (previous) api.offline = await previous.moveTo(salt, key);
    else if (await OfflineCopy.waitingIn(shelf, api.db, account)) api.staleCopy = true;
    else api.offline = await OfflineCopy.create(shelf, api.db, account, salt, key);
    return exportKey(account, salt, bits);
  } catch {
    return undefined;
  }
}

/** A reload: the session's key opens the copy again. */
async function restoreOffline(api: Api, saved: OfflineKey | undefined): Promise<void> {
  if (!shelf || !saved) return;
  try {
    const k = await importKey(saved);
    api.offlineKey = saved;
    const found = await OfflineCopy.open(shelf, api.db, k.account, k.key);
    if (found instanceof OfflineCopy) api.offline = found;
    else if (found === 'wrong' && await OfflineCopy.waitingIn(shelf, api.db, k.account)) api.staleCopy = true;
  } catch {
    // Opens without the copy.
  }
}

/** The file's offline copy for this account, if this password opens it. */
async function openCopyWith(db: string, account: string, password: string): Promise<{ copy: OfflineCopy; key: OfflineKey } | undefined> {
  if (!shelf) return undefined;
  const salt = await OfflineCopy.saltOf(shelf, db, account);
  if (!salt) return undefined;
  const bits = await deriveBits(password, salt);
  const copy = await OfflineCopy.open(shelf, db, account, await copyKey(bits));
  return copy instanceof OfflineCopy ? { copy, key: exportKey(account, salt, bits) } : undefined;
}

/** Opens a file's offline copy without the server: the password must open it. */
async function openOfflineCopy(db: string, account: string, password: string): Promise<Api | undefined> {
  const opened = await openCopyWith(db, account, password);
  if (!opened) return undefined;
  const api = new Api(db, '');
  api.offline = opened.copy;
  api.offlineKey = opened.key;
  return api;
}

/**
 * Asks for the password a copy was made with, when changes made offline wait in it under an earlier password.
 * Resolves with the copy opened by it, 'discard' to drop the changes, or undefined to decide later.
 */
function oldPasswordDialog(db: string, account: string, waiting: number): Promise<OfflineCopy | 'discard' | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'file-dialog custom-dialog', 'aria-labelledby': 'old-password-title' }) as HTMLDialogElement;
    let answer: OfflineCopy | 'discard' | undefined;
    const input = h('input', { type: 'password', autocomplete: 'off' }) as HTMLInputElement;
    const error = h('p', { class: 'login-error', role: 'alert' });
    const form = h('form', { method: 'dialog' }, h('label', {}, h('span', {}, 'Earlier password'), input), error) as HTMLFormElement;
    const save = button('Save Changes', () => form.requestSubmit(), { class: 'primary' });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      const opened = await openCopyWith(db, account, input.value).catch(() => undefined);
      save.disabled = false;
      if (!opened) {
        error.textContent = "That isn't the password the copy was made with.";
        input.select();
        return;
      }
      answer = opened.copy;
      dialog.close();
    });
    dialog.append(
      h('h2', { id: 'old-password-title' }, 'Changes made offline are waiting'),
      h('p', { class: 'message' }, `This browser holds ${waiting === 1 ? 'a change' : `${waiting} changes`} made offline in this file, in an offline copy that opens with the password this account had then. Enter that password to save ${waiting === 1 ? 'it' : 'them'}, or discard ${waiting === 1 ? 'it' : 'them'}.`),
      form,
      h('div', { class: 'actions' },
        button('Decide Later', () => dialog.close()),
        button('Discard Changes', () => {
          void askConfirm('Discard changes?', `Discard ${waiting === 1 ? 'the change' : `the ${waiting} changes`} made offline? This can't be undone.`, 'Discard').then((yes) => {
            if (!yes) return;
            answer = 'discard';
            dialog.close();
          });
        }),
        save),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

/** FileMaker's alert when a find matches nothing: Modify Find goes back to the requests, Cancel to the found set from before. */
function noMatchDialog(): Promise<'modify' | 'cancel'> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'file-dialog no-match-dialog', 'aria-labelledby': 'no-match-title' }) as HTMLDialogElement;
    let answer: 'modify' | 'cancel' = 'cancel';
    dialog.append(
      h('h2', { id: 'no-match-title' }, 'No records match this set of find requests'),
      h('div', { class: 'actions' },
        button('Cancel', () => dialog.close()),
        button('Modify Find', () => { answer = 'modify'; dialog.close(); }, { class: 'primary' })),
    );
    dialog.addEventListener('close', () => { dialog.remove(); resolve(answer); });
    document.body.append(dialog);
    dialog.showModal();
    (dialog.querySelector('button.primary') as HTMLElement | null)?.focus();
  });
}

/**
 * A yes/no question in the page, where the browser's confirm() would be. A browser may suppress a native dialog without
 * a word (which would cancel Delete All Records silently), and one can't be named or tested. Enter chooses `ok`, Escape cancels.
 */
async function askConfirm(title: string, message: string, ok = 'OK'): Promise<boolean> {
  return (await customDialog({ run: '', step: 'Confirm', title, message, buttons: [ok, 'Cancel'] }))?.button === 1;
}

/** One line of text asked for in the page, where prompt() would be: the text typed, or null when cancelled. Enter chooses `ok`, Escape cancels. */
async function askText(title: string, label: string, value = '', ok = 'OK', message = ''): Promise<string | null> {
  const answer = await customDialog({ run: '', step: 'Ask', title, message, buttons: [ok, 'Cancel'], inputs: [{ label, value, password: false }] });
  return answer?.button === 1 ? answer.inputs[0] : null;
}

/** Asks which to keep when a change made offline clashes with the record on the server: 'mine', 'theirs', or undefined to decide later. */
function clashDialog(edit: QueuedEdit, label: (key: string) => string): Promise<'mine' | 'theirs' | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'file-dialog clash-dialog', 'aria-labelledby': 'clash-title' }) as HTMLDialogElement;
    let answer: 'mine' | 'theirs' | undefined;
    const choose = (a: 'mine' | 'theirs') => () => { answer = a; dialog.close(); };
    const gone = !!edit.conflict?.gone;
    // Refused (a validation or privilege): the server's record isn't the question, only whether to drop the change.
    const refused = !!edit.conflict?.refused;
    const mineOnly = gone || refused;
    const shown = (v: unknown): string => (v === undefined ? '' : String(v));
    const rows = Object.entries(edit.fieldData).map(([key, mine]) => h('tr', {},
      h('th', { scope: 'row' }, label(key)), h('td', {}, shown(mine)), ...(mineOnly ? [] : [h('td', {}, shown(edit.conflict?.server?.[key]))])));
    dialog.append(
      h('h2', { id: 'clash-title' }, gone ? 'This record was deleted' : refused ? "The server didn't save your changes" : 'This record changed while you were offline'),
      h('p', { class: 'message' }, gone
        ? `Record ${edit.recordId} on ${edit.layout} was deleted on the server, so the changes you made to it offline can't be saved.`
        : refused ? `The changes you made offline to record ${edit.recordId} on ${edit.layout} weren't saved: ${edit.conflict?.message ?? 'the server refused them'}.`
        : `Your changes to record ${edit.recordId} on ${edit.layout} weren't saved, because the record was changed on the server first (${edit.conflict?.message ?? 'it changed'}). Choose which to keep.`),
      h('div', { class: 'clash-table' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Field'), h('th', { scope: 'col' }, 'Yours'), ...(mineOnly ? [] : [h('th', { scope: 'col' }, 'On the server now')]))),
        h('tbody', {}, ...rows))),
      h('div', { class: 'actions' },
        button('Decide Later', () => dialog.close()),
        ...(mineOnly ? [button('Discard My Changes', choose('theirs'), { class: 'primary' })]
          : [button('Keep Theirs', choose('theirs')), button('Keep Mine', choose('mine'), { class: 'primary' })])),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Another user changed a field while it was being typed in: shows theirs and yours, with a box to combine them.
 * Answers the text to save, or undefined to keep theirs.
 */
function mergeDialog(field: string, theirs: string, mine: string, by: string | undefined): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'file-dialog merge-dialog', 'aria-labelledby': 'merge-title' }) as HTMLDialogElement;
    let answer: string | undefined;
    const who = by ?? 'Another user';
    const text = (v: string) => v.replace(/\r\n?/g, '\n');
    const merged = h('textarea', { class: 'merge-text', rows: '4', 'aria-label': 'Value to save' }) as HTMLTextAreaElement;
    merged.value = text(mine);
    const use = (v: string) => () => {
      merged.value = text(v);
      merged.focus();
    };
    dialog.append(
      h('h2', { id: 'merge-title' }, `${who} changed ${field}`),
      h('p', { class: 'message' }, `${who} changed ${field} while you were typing in it. Choose which to keep, or combine them below before saving.`),
      h('div', { class: 'merge-sides' },
        h('section', {}, h('h3', {}, 'Theirs'), h('pre', { class: 'merge-value' }, text(theirs) || '(empty)'), button('Use Theirs', use(theirs))),
        h('section', {}, h('h3', {}, 'Yours'), h('pre', { class: 'merge-value' }, text(mine) || '(empty)'), button('Use Yours', use(mine)))),
      h('label', { class: 'merge-label' }, 'Value to save', merged),
      h('div', { class: 'actions' },
        button('Keep Theirs', () => dialog.close()),
        button('Save', () => {
          answer = merged.value.replace(/\n/g, '\r');
          dialog.close();
        }, { class: 'primary' })),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    merged.focus();
  });
}

/** The open file, for the connection banner: its copy's state, and what it does when the connection is back. */
let offlineHooks: { api: Api; online: () => void; signIn: () => void; send: () => void } | undefined;

// ---------------------------------------------------------------- session

/** One open file: the layout shown, its found set, and the toolbar. */
class Session implements Host {
  readonly api: Api;
  get offline(): boolean {
    return this.api.isOffline || this.api.copyOnly;
  }
  menuItems: MenuItem[] = [];
  meta?: LayoutMeta;
  renderer?: LayoutRenderer;
  view: View = 'form';
  mode: Mode = 'browse';
  /** The found set: a find request (or all records) and sort order. */
  query?: FindRequest[];
  sort?: SortSpec[];
  /** A found set a script left behind, as record ids in order (instead of query and sort). */
  ids?: number[];
  foundCount = 0;
  totalCount = 0;
  /** Records of the found set fetched so far, by 0-based position. */
  cache = new Map<number, DataRecord>();
  index = 0;
  /** Find mode's requests, each with its criteria by field key and whether it omits; `request` is the one showing. */
  requests: FindModeRequest[] = [{ criteria: {}, omit: false }];
  /** The requests Find with AI filled in and the words they came from, so saving that find names it by the words. */
  private aiFind?: { words: string; requests: string };
  request = 0;
  /** The requests of the last find, for Modify Last Find. */
  lastFind?: FindModeRequest[];
  get criteria(): Record<string, string> { return this.requests[this.request].criteria; }
  set criteria(c: Record<string, string>) { this.requests[this.request].criteria = c; }
  get omit(): boolean { return this.requests[this.request].omit; }
  set omit(v: boolean) { this.requests[this.request].omit = v; }
  panels = new Map<number, number>();
  popover?: OpenPopover;
  /** The layout's formulas (hide conditions, tooltips, placeholders) worked out per record id. */
  states = new Map<string, FormulaState>();
  findState?: FormulaState;
  /** Browse mode with no records: formulas still run, with no record to read. */
  emptyState?: FormulaState;
  /** Sub-summary groups of the sorted found set (null: the layout shows none for this sort). */
  groups?: { fields: string[]; runs: GroupRun[][] } | null;
  private groupsPending?: Promise<void>;
  private groupsGeneration = 0;

  private toolbar = h('div', { class: 'toolbar' });
  private windowChannel?: BroadcastChannel;
  /** This file's windows in this browser (Window > Show Window), kept up to date over a BroadcastChannel. */
  private windows = new Map<string, { title: string }>();
  private windowsChannel?: BroadcastChannel;
  private readonly windowId = Math.random().toString(36).slice(2);
  /** Windows this one opened with New Window, by number, so Show Window can bring them forward. */
  private opened = new Map<number, Window>();
  // The layout is the page's main content, the target of the skip link past menus and toolbar.
  private content = h('main', { class: 'content', id: 'content', tabindex: '-1', 'aria-label': 'Layout' });
  /** The window's area under the toolbar: windows behind the front one (pictures of them), then the front one's frame. */
  private frame = h('div', { class: 'window-frame' }, this.content);
  private stage = h('div', { class: 'stage' }, this.frame);
  /** The front window, when a script opened one in this browser window (New Window); otherwise this window itself. */
  private front?: ScriptWindow;
  /** The windows behind it, each with what it showed (layout, found set, record) and a picture of how it looked. */
  private behind: { win: ScriptWindow; state: WindowState; backdrop: HTMLElement }[] = [];
  /** Phones: the records navigator at the bottom of the screen, within reach of a thumb, as on FileMaker Go. */
  private bottomBar = h('nav', { class: 'bottom-bar', 'aria-label': 'Records' });
  private windowBar = h('div', { class: 'window-bar' });
  private statusToolbarHidden = false;
  /** Show/Hide Toolbars with Lock: the person can't show or hide the toolbar until a script unlocks it. */
  private toolbarLocked = false;
  /** Set Zoom Level with Lock: the person can't zoom until a script unlocks it. */
  private zoomLocked = false;
  private assistant?: AssistantPanel;
  /** The account may see scripts' steps and variables, so "Why?" can explain a script error. */
  private canExplainScripts = false;
  /** The account can change the design (full access), so Layout mode is offered. */
  private canDesign = false;
  private loading = 0;

  constructor(api: Api) {
    this.api = api;
    this.locks = new Locks(api);
    this.presence = new Presence(api);
    // Closing the tab says so at once, rather than leaving others seeing this window until it times out.
    // One session at a time: signing in again replaces the last one's handlers.
    livePresences.add(this.presence);
    pageHandlers = { show: () => this.renderToolbar() };
    answerPageCalls((id, method, args) => this.pageCall(id, method, args));
    api.onExpired = () => {
      // The session is gone: nothing here may keep talking to the server (presence, lock renewals), and the keys are the login page's.
      this.teardown();
      this.locks.dispose();
      offlineHooks = undefined;
      sessionStorageSet('tabularius.session', undefined);
      showLogin('Your session ended. Please log in again.');
    };
    let wasOffline = this.offline;
    api.onOfflineChange = () => {
      showOnline();
      // Portals' empty rows come and go with the connection.
      if (wasOffline !== this.offline && this.meta?.portals.some((p) => p.create)) this.renderKeepingFocus();
      wasOffline = this.offline;
    };
    api.onReconnect = () => {
      void this.sendWaiting();
      this.sendPrefs();
    };
    offlineHooks = {
      api,
      online: () => {
        api.markOnline();
        void this.sendWaiting();
        this.sendPrefs();
      },
      // Opened from the copy alone: sign in to the server to send what waits.
      signIn: () => {
        offlineHooks = undefined;
        showOnline();
        void showLogin();
      },
      send: () => void this.sendWaiting(),
    };
    // Typing in a record locks it, as in FileMaker, so two people can't edit it at once.
    window.addEventListener('message', (e) => {
      if (!e.data || !['navigation', 'scroll'].includes(e.data.tabularius)) return;
      if (e.data.tabularius === 'navigation' && (typeof e.data.hash !== 'string' || e.data.hash.length > 4096)) return;
      const frame = [...this.content.querySelectorAll<HTMLIFrameElement>('iframe.fm-webviewer')].find((f) => f.contentWindow === e.source);
      if (!frame?.dataset.viewerKey || !viewerMessage(e, frame)) return;
      const state = this.viewerStates.get(frame.dataset.viewerKey);
      if (String(state?.generation) !== frame.dataset.viewerGeneration) return;
      if (e.data.tabularius === 'scroll') state?.scrolled(e.data.x, e.data.y);
      else state?.navigate(e.data.hash, { x: e.data.x, y: e.data.y }, e.data.previous);
    });
    this.content.addEventListener('input', (e) => this.editStart(e.target as HTMLElement), true);
    this.content.addEventListener('compositionstart', () => (this.composing = true), true);
    this.content.addEventListener('compositionend', () => (this.composing = false), true);
    this.content.addEventListener('focusout', () => void this.editEnd());
    // Where the cursor was in the last field, for the Insert menu (opening a menu takes the focus).
    this.content.addEventListener('focusout', (e) => {
      const t = e.target as HTMLElement;
      if (t.matches('input.fm-input, textarea.fm-input')) {
        const box = t as HTMLInputElement;
        this.lastInput = { el: box, ...this.placeOf(box), start: box.selectionStart ?? box.value.length, end: box.selectionEnd ?? box.value.length };
      }
    });
    // The field the cursor was last in, for the assistant ("explain this field").
    this.content.addEventListener('focusin', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      const o = el && this.renderer?.objectById(Number(el.dataset.id));
      this.focusedField = o ? this.renderer!.fieldKey(o) : undefined;
      this.activeObjectId = Number((e.target as HTMLElement).closest<HTMLElement>('.fm[data-id]')?.dataset.id) || undefined;
      this.portalRow = (e.target as HTMLElement).closest<HTMLElement>('.fm-portal-row[data-row]') ?? undefined;
    });
    this.content.addEventListener('contextmenu', (e) => this.fieldMenu(e));
    this.content.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // ⌘C with no field active and nothing selected copies the record, as Edit > Copy does.
    document.addEventListener('copy', (e) => {
      const active = document.activeElement;
      if (!this.meta || active?.matches('input, textarea, select, [contenteditable]') || active?.closest('dialog, .dialog')) return;
      if (!document.getSelection()?.isCollapsed) return;
      e.preventDefault();
      void this.copyRecord();
    });
    // Clicking in a portal row selects it, even on a field that can't be entered; clicking elsewhere deselects it.
    this.content.addEventListener('mousedown', (e) => {
      this.activeObjectId = Number((e.target as HTMLElement).closest<HTMLElement>('.fm[data-id]')?.dataset.id) || undefined;
      this.portalRow = (e.target as HTMLElement).closest<HTMLElement>('.fm-portal-row[data-row]') ?? undefined;
    });
    // As in FileMaker, clicking anywhere outside an open popover closes it (its button toggles it itself).
    this.content.addEventListener('pointerdown', (e) => {
      let p = this.popover;
      const t = e.target as HTMLElement;
      // Clicking outside a field leaves no field active: Edit > Copy then copies the record.
      // (After the field it leaves has noted where its cursor was.)
      if (!t.closest('input.fm-input, textarea.fm-input')) setTimeout(() => { this.lastInput = undefined; });
      while (p && !p.el.contains(t) && !t.closest(`[data-id="${p.button}"]`)) p = p.parent;
      if (p !== this.popover) this.closePopover(p?.id);
    });
  }

  /** The field the cursor was last in on this layout. */
  private focusedField?: string;
  /** The last field box left, with its selection, for the Insert menu. */
  private lastInput?: FieldPlace & { el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number };
  /** The standard Scripts menu: scripts marked "Include in menu" that the account can run. */
  private scriptsMenu: ScriptsMenuEntry[] = [];
  /** The signed-in account, for Insert > Current User Name. */
  private accountName = '';
  /** The record shown now and the one shown before it, for Insert > From Last Visited Record. */
  private visiting?: string;
  private lastVisited?: string;
  /** The layouts those two records were shown on: a script started now is told the last visited record's. */
  private visitingLayout?: string;
  private lastVisitedLayout?: string;
  /** The portal row the cursor was last in, when its portal allows deleting rows (the toolbar takes the focus). */
  private portalRow?: HTMLElement;

  // ---------------------------------------------------------- other users

  readonly locks: Locks;
  /** Which record this window shows, told to the server so others see it. */
  private readonly presence: Presence;
  /** Other people looking at the current record. */
  private viewers: string[] = [];
  /** Other people looking at each record of this layout's table: "file/table/id" -> accounts. */
  private others = new Map<string, string[]>();
  private viewersTimer?: ReturnType<typeof setTimeout>;
  private stopLive?: () => void;
  /** Records other people are editing: "file/table/id" -> account. */
  private lockedBy = new Map<string, string>();
  /** Records whose lock was refused: their typing is dropped, not saved. */
  private refused = new Set<string>();
  private pendingIds = new Set<string>();
  /** Pages of the found set to fetch again (by first index), for values the server was still working out. */
  private pendingPages = new Set<number>();
  /** Records showing a value the server is still working out, and how often each was fetched again for it. */
  private updatingTries = new Map<string, number>();
  private pendingReload = false;
  /** Who last changed each record shown, for the merge prompt. */
  private changedBy = new Map<string, string>();
  /** Fields another user changed while they were being typed in ("record\0field"): the person chooses on leaving the field. */
  private conflicts = new Map<string, { theirs: string; by?: string }>();
  /** Field values handed to save() and not yet saved ("record\0field"), so a redraw before then keeps them. */
  private unsaved = new Map<string, string>();
  private flushTimer?: ReturnType<typeof setTimeout>;

  private lockKey(file: string, table: string, id: string | number): string {
    return `${file.toLowerCase()}\u0000${table}\u0000${id}`;
  }

  /** The file and table this layout's records live in. */
  private home(): { file: string; table: string } | undefined {
    return this.meta && { file: this.meta.layout.file ?? this.api.db, table: this.meta.layout.table };
  }

  /** The record an element shows: its list or table row, or the current record. */
  private recordAt(el: Element | null): DataRecord | undefined {
    const row = this.view !== 'form' ? el?.closest<HTMLElement>('[data-index]') : null;
    return row ? this.cache.get(Number(row.dataset.index)) : this.record;
  }

  /** Who else is editing a record, if anyone. */
  lockedByOther(rec?: DataRecord): string | undefined {
    const home = this.home();
    return rec && home ? this.lockedBy.get(this.lockKey(home.file, home.table, rec.recordId)) : undefined;
  }

  private editStart(target: HTMLElement): void {
    if (this.mode !== 'browse' || !this.meta) return;
    const rec = this.recordAt(target);
    if (!rec) return;
    const layout = this.meta.layout.name;
    if (this.locks.holds(layout, rec.recordId)) return;
    this.locks.acquire(layout, rec.recordId).catch((e) => {
      if (!(e instanceof LockedError)) return;
      this.refused.add(rec.recordId);
      toast(`${e.message}. Try again when they're done.`);
      // Put the stored values back; the typing is not saved.
      (document.activeElement as HTMLElement | null)?.blur();
      this.render();
    });
  }

  private viewersAsked = 0;

  /** Who else has records of this table open: the current one for the toolbar, every one for list and table rows. */
  private async refreshViewers(): Promise<void> {
    const home = this.home();
    if (!home) return;
    const asked = ++this.viewersAsked;
    const all = await currentViewers(this.api);
    // A slower, older answer doesn't undo a newer one.
    if (asked !== this.viewersAsked || this.home()?.table !== home.table) return;
    const others = new Map<string, string[]>();
    for (const v of all) {
      if (v.self || v.file.toLowerCase() !== home.file.toLowerCase() || v.table !== home.table) continue;
      const key = this.lockKey(v.file, v.table, v.recordId);
      const names = others.get(key) ?? [];
      if (!names.includes(v.account)) others.set(key, [...names, v.account]);
    }
    this.others = others;
    this.markRows();
    const rec = this.record;
    const names = rec ? others.get(this.lockKey(home.file, home.table, rec.recordId)) ?? [] : [];
    if (names.join('\u0000') === this.viewers.join('\u0000')) return;
    this.viewers = names;
    this.renderToolbar();
  }

  /** Others come and go in bursts (a whole office opening the file): ask once they settle. */
  private viewersChanged(): void {
    clearTimeout(this.viewersTimer);
    this.viewersTimer = setTimeout(() => void this.refreshViewers(), 300);
  }

  /** List and table rows: avatars of who else has each record open, ringed when they're editing it. */
  private markRows(): void {
    const home = this.home();
    for (const row of this.content.querySelectorAll<HTMLElement>('[data-index]')) {
      const rec = this.cache.get(Number(row.dataset.index));
      const key = rec && home ? this.lockKey(home.file, home.table, rec.recordId) : '';
      const editor = rec ? this.lockedByOther(rec) : undefined;
      const names = [...new Set([...(editor ? [editor] : []), ...(this.others.get(key) ?? [])])];
      const sig = names.join('\u0000') + (editor ? '\u0001' : '');
      const old = row.querySelector<HTMLElement>(':scope > .row-presence, :scope > td > .row-presence');
      if ((old?.dataset.sig ?? '') === sig) continue;
      old?.parentElement?.classList.remove('has-presence');
      old?.remove();
      if (!names.length) continue;
      const label = editor ? `${editor} is editing this record${names.length > 1 ? `; also here: ${names.slice(1).join(', ')}` : ''}` : `Also here: ${names.join(', ')}`;
      const badge = h('span', { class: 'row-presence', role: 'img', 'aria-label': label, title: label }, ...avatars(names, editor));
      badge.dataset.sig = sig;
      // Table cells make room for as many avatars as there are (up to three and "+N").
      badge.style.setProperty('--avatars', String(Math.min(names.length, 4)));
      // In table view they sit at the start of the row's first cell, in list view at the row's top right.
      const host = row instanceof HTMLTableRowElement ? row.querySelector<HTMLElement>(':scope > td') : row;
      host?.classList.add('has-presence');
      host?.style.setProperty('--avatars', String(Math.min(names.length, 4)));
      host?.append(badge);
    }
  }

  /** After leaving a record's fields and saving: let others edit it again. */
  private async editEnd(): Promise<void> {
    await this.saving;
    await new Promise((ok) => setTimeout(ok, 0)); // focus has moved by now
    if (!this.meta) return;
    // The layout itself takes focus (the skip link, a click on its background): that is outside every record.
    const active = document.activeElement;
    const still = active && active !== this.content && this.content.contains(active) ? this.recordAt(active) : undefined;
    for (const rec of this.cache.values()) {
      if (rec !== still && this.locks.holds(this.meta.layout.name, rec.recordId)) void this.locks.release(this.meta.layout.name, rec.recordId);
    }
  }

  /** The live stream came back after a gap: what others changed meanwhile was not delivered, so read the found set and record again, and who holds which lock. */
  private async resync(): Promise<void> {
    if (!this.meta) return;
    this.pendingReload = true;
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 150);
    try {
      const locks = await currentLocks(this.api);
      this.lockedBy.clear();
      for (const l of locks) if (!l.self) this.lockedBy.set(this.lockKey(l.file, l.table, l.recordId), l.account);
      this.markRows();
      this.renderToolbar();
    } catch {
      // Left as it was; the next lock or unlock event corrects it.
    }
  }

  /** Someone changed something: refresh what this window shows of it. */
  private changed(c: Change): void {
    // Design mode's own changes and presence (design.html listens to those).
    if (c.table === '_design' || c.table.startsWith('_design/')) return;
    const home = this.home();
    if (!home) return;
    const key = c.recordId === undefined ? '' : this.lockKey(c.file, c.table, c.recordId);
    if (c.kind === 'view' || c.kind === 'leave') {
      if (!c.self && c.file.toLowerCase() === home.file.toLowerCase() && c.table === home.table) this.viewersChanged();
      return;
    }
    if (c.kind === 'lock' || c.kind === 'unlock') {
      if (c.self) return;
      if (c.kind === 'lock') this.lockedBy.set(key, c.account ?? 'another user');
      else this.lockedBy.delete(key);
      if (this.record && key === this.lockKey(home.file, home.table, this.record.recordId)) this.renderToolbar();
      this.markRows();
      return;
    }
    if (c.self) return;
    const same = c.file.toLowerCase() === home.file.toLowerCase() && c.table === home.table;
    if (same && c.kind === 'create') {
      this.totalCount++;
      this.renderToolbar();
      return;
    }
    if (same && (c.kind === 'delete' || c.kind === 'truncate')) {
      this.pendingReload = true;
    } else if (same) {
      for (const rec of this.cache.values()) if (rec.recordId === String(c.recordId)) this.pendingIds.add(rec.recordId);
      if (c.account && c.recordId !== undefined) this.changedBy.set(String(c.recordId), c.account);
    } else if (this.meta!.portals.length || Object.keys(this.meta!.fields).length > 1) {
      // A related record changed: portals and related fields on what's shown may show it.
      const ids = this.visibleIds();
      if (ids.length > 5) this.pendingReload = true;
      else for (const id of ids) this.pendingIds.add(id);
    }
    if (!this.pendingReload && !this.pendingIds.size) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 150);
  }

  private visibleIds(): string[] {
    if (this.mode !== 'browse') return [];
    if (this.view === 'form') return this.record ? [this.record.recordId] : [];
    const win = this.rowWindow();
    const from = win ? win.from : this.index - (this.index % PAGE);
    const out: string[] = [];
    for (let i = from; i < Math.min(this.foundCount, win ? win.to : from + PAGE); i++) {
      const r = this.cache.get(i);
      if (r) out.push(r.recordId);
    }
    return out;
  }

  private async flush(): Promise<void> {
    if (!this.meta || this.mode !== 'browse') return;
    const active = document.activeElement;
    const typing = !!active && active !== document.body && active !== this.content && this.content.contains(active);
    if (typing && this.view === 'form' && !this.pendingReload && this.typingIn(active)) return this.flushWhileTyping();
    if (typing) {
      // Don't redraw under someone's cursor; try again once they leave the field.
      this.content.addEventListener('focusout', () => setTimeout(() => void this.flush(), 0), { once: true });
      return;
    }
    if (this.pendingReload) {
      this.pendingReload = false;
      this.pendingIds.clear();
      this.pendingPages.clear();
      await this.reload(this.record?.recordId);
      return;
    }
    const pages = [...this.pendingPages];
    this.pendingPages.clear();
    for (const start of pages) {
      const was = idsAt(this.cache, start, PAGE);
      try {
        await this.fetch(start);
      } catch {
        // shown as it is; the next change fetches it again
        continue;
      }
      // Records added, deleted or re-sorted meanwhile: the found set is read again rather than shifting under the user.
      const now = idsAt(this.cache, start, PAGE);
      if (was.some((id, i) => id !== undefined && id !== now[i])) this.pendingReload = true;
      // Hide conditions, tooltips and the like are worked out again from the new values.
      for (const id of now) if (id !== undefined) this.states.delete(id);
    }
    if (this.pendingReload) return this.flush();
    const ids = [...this.pendingIds];
    this.pendingIds.clear();
    const layout = this.meta.layout.name;
    for (const id of ids) {
      try {
        const fresh = await this.api.record(layout, id);
        for (const rec of this.cache.values()) {
          if (rec.recordId !== id) continue;
          freshen(rec, fresh);
        }
        this.recheckUpdating([fresh]);
        this.states.delete(id);
      } catch (e) {
        if (e instanceof ApiError && e.code === 101) this.pendingReload = true;
      }
    }
    if (this.pendingReload) return this.flush();
    await this.loadStates();
    this.render();
  }

  /** The record's own field being typed in (not a portal row's), if that's where the cursor is. */
  private typingIn(el: Element | null): (HTMLInputElement | HTMLTextAreaElement) | undefined {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || !el.matches('.fm-input') || !el.dataset.key) return undefined;
    return this.content.contains(el) && !el.closest('.fm-portal-row, .fm-portal-new') ? el : undefined;
  }

  /**
   * Another user's changes, shown while this person types in a field of the record: everything else on the layout
   * updates and what they've typed stays. When the other user changed the same field, the person chooses which to
   * keep as they leave it (save() asks).
   */
  private async flushWhileTyping(): Promise<void> {
    // A save under way first, so the records fetched aren't older than it.
    await this.saving;
    const ids = [...this.pendingIds];
    this.pendingIds.clear();
    const layout = this.meta!.layout.name;
    const fresh: DataRecord[] = [];
    for (const id of ids) {
      try {
        fresh.push(await this.api.record(layout, id));
      } catch (e) {
        if (e instanceof ApiError && e.code === 101) this.pendingReload = true;
      }
    }
    // Deleted under the cursor: drawn again once the person leaves the field.
    if (this.pendingReload) {
      this.content.addEventListener('focusout', () => setTimeout(() => void this.flush(), 0), { once: true });
      return;
    }
    const box = this.typingIn(document.activeElement);
    const rec = this.record;
    const mine = rec && box ? fresh.find((f) => f.recordId === rec.recordId) : undefined;
    if (rec && box && mine) {
      const key = box.dataset.key!;
      const shown = box.dataset.shown ?? '';
      const theirs = String(mine.fieldData[key] ?? '').replace(/\r\n?/g, '\n');
      if (box.value !== shown && theirs !== shown && theirs !== box.value) {
        const by = this.changedBy.get(rec.recordId);
        this.conflicts.set(`${rec.recordId}\0${key}`, { theirs: String(mine.fieldData[key] ?? ''), ...(by ? { by } : {}) });
        toast(`${by ?? 'Another user'} changed ${key} while you were typing. You'll choose which to keep when you leave the field.`, 'info');
      }
    }
    for (const f of fresh) {
      for (const r of this.cache.values()) if (r.recordId === f.recordId) freshen(r, f);
      this.states.delete(f.recordId);
    }
    this.recheckUpdating(fresh);
    await this.loadStates();
    if (this.mode !== 'browse') return;
    this.renderKeepingTyping();
  }

  /** Draws the layout again, keeping the cursor and anything typed but not yet saved in the field it's in. */
  private renderKeepingTyping(): void {
    const box = this.typingIn(document.activeElement);
    const place = box ? this.placeOf(box) : undefined;
    const recordId = place?.record;
    // Typed and not yet left, or left and its save not done yet (the new box would show the older value).
    const keep = box && (box.value !== box.dataset.shown || this.unsaved.get(`${recordId}\0${box.dataset.key}`) === box.value.replace(/\n/g, '\r'));
    const typed = box && keep ? { key: box.dataset.key, value: box.value, start: box.selectionStart, end: box.selectionEnd } : undefined;
    // The box being replaced would save what's typed as it goes away (a change event): the new box saves it instead.
    if (box && typed) box.dataset.replaced = '1';
    this.renderKeepingFocus();
    const el = this.typingIn(document.activeElement);
    if (!typed || !el || !place || this.inputAt(place) !== el || el.dataset.key !== typed.key) return;
    el.value = typed.value;
    if (typed.start !== null && typed.end !== null) el.setSelectionRange(typed.start, typed.end);
    // Put back by the window, not typed, so the browser wouldn't save it on leaving: this does.
    el.addEventListener('blur', () => {
      if (el.value !== el.dataset.shown) el.dispatchEvent(new Event('change'));
      // Typed back to what it showed: nothing to choose between any more.
      else this.conflicts.delete(`${recordId}\0${typed.key}`);
    }, { once: true });
  }

  get record(): DataRecord | undefined {
    return this.mode === 'browse' ? this.cache.get(this.index) : undefined;
  }

  get recordNumber(): number {
    return this.index + 1;
  }

  get state(): FormulaState | undefined {
    if (this.mode === 'find') return this.findState;
    return this.record ? this.states.get(this.record.recordId) : this.emptyState;
  }

  /** A window opened with New Window: closing it doesn't log out, as the other windows share the session. */
  private secondary?: number;

  async open(from?: WindowSnapshot): Promise<void> {
    // Back and Forward are heard from the start; their restores wait until the file has finished opening.
    this.onPop = () => this.popped();
    window.addEventListener('popstate', this.onPop);
    // An unavailable link ends the opening early; what the person opens next still adds history entries.
    try { await this.openFile(from); } finally { this.urlReady = true; this.openDone(); }
  }

  /** Removed in teardown: a session that ended must not restore screens, with its dead token, over the one that replaces it. */
  private onPop?: () => void;

  private popped(): void {
    if (!this.urlReady) this.popDuringOpen = true;
    if (this.scripting) this.popDuringScript = true;
    // A restore waits for the file to open and for a running script to end, so neither carries on from a screen it did not draw.
    this.urlRestores = this.urlRestores.then(() => this.scriptEnded).then(() => this.restoreUrlState()).catch(() => undefined);
  }

  private async openFile(from?: WindowSnapshot): Promise<void> {
    const linkedState = readUrlState(location.search);
    this.secondary = from?.number;
    if (!from) {
      try {
        localStorage.setItem('openhbam.windows', '1');
      } catch {
        // Only numbers window titles.
      }
    }
    const menu = await this.api.menu();
    this.menuItems = menu.layouts;
    this.menuCommandLevel = menu.menuCommands ?? 'all';
    this.printing = menu.printing !== false;
    this.exporting = menu.exporting !== false;
    this.accountName = menu.account ?? '';
    this.scriptsMenu = menu.scripts ?? [];
    void this.loadPrefs();
    // Opened from the offline copy alone: nothing to listen to until someone signs in.
    if (!this.api.copyOnly) {
      this.stopLive = listen(this.api, (c) => this.changed(c), () => this.api.onExpired(), (text) => adminNotice(text), {
        onReconnect: () => void this.resync(),
        onState: (live) => {
          if (liveDown === !live) return;
          liveDown = !live;
          showOnline();
        },
      });
    }
    this.relayChanges();
    if (this.api.offline) void this.api.countWaiting().then(() => this.sendWaiting(), () => {});
    if (this.api.staleCopy) void this.recoverStaleCopy();
    showOnline();
    currentLocks(this.api).then((locks) => {
      for (const l of locks) if (!l.self) this.lockedBy.set(this.lockKey(l.file, l.table, l.recordId), l.account);
      this.renderToolbar();
    }, () => {});
    this.windowName = from ? `${menu.database} - ${from.number}` : menu.database;
    document.title = menu.database;
    this.joinWindows();
    this.statusToolbarHidden = localStorageGet(`openhbam.statusToolbar.${this.api.db}`) === 'hidden';
    const shell = h('div', { class: 'shell' }, this.toolbar, this.stage, this.windowBar, this.bottomBar);
    this.touchGestures();
    // The menu bar above the status toolbar: the file's custom menu set, or FileMaker's standard menus.
    if (menu.customMenus) this.menuSetId = this.savedMenuSet();
    this.menuBar = new MenuBar({
      command: (name, run) => this.menuCommand(name, run),
      script: (item) => void this.menuScript(item),
      builtin: (name) => this.builtinMenu(name),
    }, () => this.loadMenus());
    const skip = h('a', { class: 'skip', href: '#content' }, 'Skip to layout');
    // Focus the layout without putting #content in the address (its fragment carries sign-in hand-offs).
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      this.content.focus();
    });
    shell.prepend(skip, this.menuBar.element);
    app.replaceChildren(shell);
    void this.digestNotice();
    // The AI assistant, when the server has one and the account has AI access.
    assistantInfo(this.api.db, this.api.token).then((info) => {
      if (info.canDesign !== this.canDesign) {
        this.canDesign = info.canDesign;
        if (this.menuBar && !this.customMenus) this.menuBar.set(this.standardMenuSet());
        this.renderToolbar();
      }
      if (!info.available) return;
      this.canExplainScripts = info.canExplainScripts;
      this.assistant = new AssistantPanel(this.api.db, this.api.token, () => ({
        layout: this.meta?.layout.name,
        recordId: this.mode === 'browse' && this.record ? Number(this.record.recordId) : undefined,
        field: this.mode === 'browse' ? this.focusedField : undefined,
        mode: this.mode === 'find' ? 'find' : 'browse',
        foundSet: this.mode === 'browse' ? { query: this.query, sort: this.sort, foundCount: this.foundCount, recordIds: this.ids } : undefined,
      }), info.canDesign ? (changes) => this.applyDesign(changes) : undefined,
        info.canDesign ? async (undo) => !!(await this.applyDesign(undo, 'Undone')) : undefined);
      this.assistant.show = (found) => this.showFoundSet(found.layout, found.query as FindRequest[], found.sort as SortSpec[] | undefined);
      this.assistant.editFind = (layout, requests, words) => this.editFind(layout, requests as FindRequest[], words);
      shell.classList.add('with-ai');
      shell.append(this.assistant.element);
      this.renderToolbar();
    }, () => {});
    window.addEventListener('resize', () => {
      this.render();
      // OnLayoutSizeChange: once the window has stopped changing size, as FileMaker runs it after a resize.
      clearTimeout(this.resized);
      this.resized = setTimeout(() => {
        // Not while someone types: a phone's keyboard opening resizes the window too.
        const active = document.activeElement as HTMLElement | null;
        if (active && this.content.contains(active) && active.matches('input, textarea, select, [contenteditable]')) return;
        void this.fire('OnLayoutSizeChange');
      }, 300);
    });
    // Turning a phone or tablet: hide conditions such as Get ( WindowOrientation ) = 1 are worked out again.
    matchMedia('(orientation: landscape)').addEventListener('change', () => void this.windowChanged());
    window.addEventListener('keydown', this.onKeys);
    // A new login opens like FileMaker opens the file: on the layout File Options
    // names, then its OnFirstWindowOpen script. A reload keeps the layout it was on.
    const opening = sessionStorageGet('tabularius.opened') !== this.api.token;
    // A WebDirect-style link (/fmi/webd/File?script=Name&param=...&$var=...) lands here with its script: run it once the file is open.
    const linked = linkedScript();
    sessionStorageSet('tabularius.opened', this.api.token);
    const remembered = from?.layout ?? linkedState.layout ?? (opening ? menu.openLayout : sessionStorageGet(`tabularius.layout.${this.api.db}`));
    this.onLastWindowClose = !!menu.onLastWindowClose;
    this.onWindowClose = !!menu.onWindowClose;
    const first = this.menuItems.find((m) => m.open && m.name === remembered) ?? this.menuItems.find((m) => m.open);
    if (linkedState.layout && !this.menuItems.some((m) => m.open && m.name === linkedState.layout)) {
      this.content.replaceChildren(h('p', { class: 'empty', role: 'status' }, 'This link is not available to your account.'));
      this.renderToolbar();
      return;
    }
    if (!first) {
      const design = h('a', { href: 'design.html' }, 'Open Design');
      this.content.replaceChildren(h('p', { class: 'empty' }, 'This file has no layouts the web client can show yet. ', design, ' to add tables and layouts.'));
      this.renderToolbar();
      return;
    }
    await this.goToLayout(first.name);
    if (!from && linkedState.layout && linkedState.layout === first.name) {
      if (linkedState.view && this.allows(linkedState.view)) this.view = linkedState.view;
      if (linkedState.mode === 'find') await this.enterFind();
      else if (linkedState.mode === 'preview') await this.enterPreview();
      if (linkedState.record) {
        const requested = linkedState.record;
        await this.reload(requested);
        if (this.record?.recordId !== requested) this.showMissingRecord(requested);
      }
    }
    if (from && first.name === from.layout) {
      // The same found set, sort, view and record as the window it came from.
      this.view = from.view;
      this.query = from.query;
      this.sort = from.sort;
      this.ids = from.ids;
      this.index = Math.max(0, from.index);
      await this.reload(from.recordId);
      this.render();
      if (from.mode === 'find') await this.enterFind();
      else if (from.mode === 'preview') await this.enterPreview();
    }
    if (opening && menu.onFirstWindowOpen && !this.api.copyOnly) await this.fileTrigger('OnFirstWindowOpen');
    // Every window opened, the first and those New Window makes, then (Claris's order) OnWindowOpen; a reload is not an opening.
    if ((opening || from) && menu.onWindowOpen && !this.api.copyOnly) await this.fileTrigger('OnWindowOpen');
    if (linked && !this.api.copyOnly) {
      try {
        await this.runButton(undefined, undefined, undefined, { urlScript: true, ...linked });
      } catch (e) {
        toast(errorText(e));
      }
    }
    // A Back or Forward pressed while the file opened moved the address; that restore (queued) says what the screen shows, so the opening does not write over it.
    if (!this.popDuringOpen) this.writeScreenUrl(false, true);
    this.urlReady = true;
  }

  private showMissingRecord(id: string): void {
    this.content.replaceChildren(h('p', { class: 'empty', role: 'status' }, `Record ${id} no longer exists or is not available to this account.`));
  }

  private restoringUrlState = false;
  /** Back and Forward pressed quickly queue up: each restore finishes before the next starts, and none starts before the file has opened. */
  private openDone!: () => void;
  private urlRestores: Promise<void> = new Promise((resolve) => { this.openDone = resolve; });
  private popDuringOpen = false;
  /** Back or Forward pressed while a script runs: the script's end then leaves the address as the browser moved it. */
  private popDuringScript = false;
  /** Settles when the running script ends (already settled when none runs). */
  private scriptEnded: Promise<void> = Promise.resolve();

  /** False while the file is still opening: the address is rewritten in place then, so the first Back leaves the app. */
  private urlReady = false;

  /** What scripts call this window (Select Window [ Name: ]); the tab title shown to people can follow the title pattern without renaming it. */
  private windowName = '';

  private screenUrlState(): UrlState {
    return {
      db: this.api.db,
      ...(this.meta ? { layout: this.meta.layout.name } : {}),
      ...(this.mode === 'browse' && this.record ? { record: this.record.recordId } : {}),
      ...(this.meta ? { mode: this.preview ? 'preview' : this.mode, view: this.view, found: this.foundCount, total: this.totalCount } : {}),
      ...(this.mode === 'find' ? { find: true } : {}),
    };
  }

  private writeScreenUrl(push = true, opened = false): void {
    if (!this.api) return;
    const next = writeUrlState(location.pathname, location.search, location.hash, this.screenUrlState());
    const current = location.pathname + location.search + location.hash;
    // While Back or Forward is being drawn the address already is the state being restored; writing it from half-drawn state would overwrite another entry.
    // While the file opens only the end of the opening writes: its steps on the way would leave an entry holding a half-drawn screen.
    if (next !== current && !this.restoringUrlState && !this.popDuringOpen && (this.urlReady || opened)) {
      // A script that moves through records must not flood the history (browsers limit pushState), so its moves replace the address.
      writeAddress(history, next, addsHistoryEntry({ push, ready: this.urlReady, scripting: this.scripting }));
    }
    this.showTitle();
  }

  private showTitle(fileOnly = false): void {
    const title = pageTitle(localStorageGet('tabularius.titlePattern'), fileOnly ? { file: this.api.db } : { file: this.api.db, layout: this.meta?.layout.name, record: this.record ? this.index + 1 : undefined });
    document.title = this.secondary === undefined ? title : `${title} - ${this.secondary}`;
  }

  private async restoreUrlState(): Promise<void> {
    this.popDuringOpen = false;
    // A field being typed in belongs to the record it was typed in: it is saved there before the screen moves (Cancel in the save dialog leaves the screen as it is).
    // The commit trigger's script ends with the screen's own address write, which would put back the address Back just moved to: it runs inside the restore.
    this.restoringUrlState = true;
    let committed = false;
    try { committed = await this.commit(); } finally { this.restoringUrlState = false; }
    if (!committed) return;
    const state = readUrlState(location.search);
    if (state.db && state.db !== this.api.db) { location.reload(); return; }
    const startedAt = location.search + location.hash;
    this.restoringUrlState = true;
    let showAll = false;
    try {
      if (state.layout && state.layout !== this.meta?.layout.name) {
        const allowed = this.menuItems.some((item) => item.open && item.name === state.layout);
        if (!allowed) {
          this.content.replaceChildren(h('p', { class: 'empty', role: 'status' }, 'This link is not available to your account.'));
          this.showTitle(true);
          return;
        }
        await this.goToLayout(state.layout);
      }
      if (state.view && this.allows(state.view)) this.view = state.view;
      // The mode changes go through the same steps as a person's, which an edit not yet saved can refuse.
      if (state.mode === 'preview' && !this.preview) await this.enterPreview();
      else if (state.mode === 'find' && this.mode !== 'find') await this.enterFind();
      else if ((!state.mode || state.mode === 'browse') && (this.mode !== 'browse' || this.preview)) await this.enterBrowse();
      // A step that refused (an unsaved edit) leaves the old mode on screen: the address is not rewritten over the entry Back just chose.
      if (this.windowMode !== (state.mode === 'preview' || state.mode === 'find' ? state.mode : 'browse')) return;
      // The found set is not in the address, only its size: an entry that showed every record is restored by showing every record.
      if (this.meta && this.mode === 'browse' && !this.preview && state.found !== undefined && state.found === state.total && state.found !== this.foundCount && (this.query || this.ids)) {
        this.query = undefined;
        this.ids = undefined;
        showAll = true;
      }
      if (state.record && this.meta) {
        await this.reload(state.record);
        if (this.record?.recordId !== state.record) {
          // A message that says the record is gone, and an address left as the browser moved it, not rewritten to another record.
          this.showMissingRecord(state.record);
          this.showTitle();
          return;
        }
      } else if (showAll) {
        this.index = 0;
        await this.reload();
      } else this.render();
      if (state.view && this.allows(state.view)) this.view = state.view;
      this.render();
      // A smaller found set cannot be rebuilt from its size: the screen stays on the set it has and the entry keeps what it says.
      if (state.found !== undefined && state.found !== this.foundCount) { this.showTitle(); return; }
    } finally { this.restoringUrlState = false; }
    // Written only when the screen was drawn from this address and no later Back or Forward has moved it on; a refused or failed restore returned above and leaves the address to say where the person went.
    if (location.search + location.hash === startedAt) this.writeScreenUrl(false);
  }

  /** Window > New Window: another browser window on the same session, showing what this one shows. */
  private newWindow(): void {
    if (!this.meta) return;
    let n = 2;
    try {
      n = Number(localStorage.getItem('openhbam.windows') ?? '1') + 1;
      localStorage.setItem('openhbam.windows', String(n));
    } catch {
      // A number is only for the title.
    }
    const snapshot: WindowSnapshot = {
      layout: this.meta.layout.name, view: this.view, query: this.query, sort: this.sort, ids: this.ids,
      index: this.index, recordId: this.record?.recordId, number: n,
    };
    // The new window gets a copy of this one's session storage, so it signs in as this one is.
    const w = window.open(`${location.pathname}#window=${encodeURIComponent(JSON.stringify(snapshot))}`, '_blank');
    if (w) this.opened.set(n, w);
    if (!w) toast('The browser blocked the new window. Allow pop-ups for this site to open more windows.');
  }

  private changesChannel?: BroadcastChannel;
  private readonly onKeys = (e: KeyboardEvent): void => this.keys(e);

  /** Stops everything this window does on its own, for a session that ended or a window that closed. Locks are the caller's: released when the session is still good. */
  private teardown(): void {
    this.stopLive?.();
    this.stopLive = undefined;
    this.presence.stop();
    livePresences.delete(this.presence);
    pageHandlers = undefined;
    this.changesChannel?.close();
    this.changesChannel = undefined;
    this.api.wrote = undefined;
    window.removeEventListener('keydown', this.onKeys);
    if (this.onPop) window.removeEventListener('popstate', this.onPop);
    liveDown = false;
    showOnline();
  }

  /**
   * Windows of one session share its token, so the server counts a sibling's edits as this window's own (self) and the
   * live stream skips them. Each window says what it changed over a channel instead, and hears its siblings' the same way.
   */
  private relayChanges(): void {
    if (typeof BroadcastChannel === 'undefined' || this.changesChannel || this.api.copyOnly) return;
    const channel = this.changesChannel = new BroadcastChannel(`tabularius.changes.${this.api.db}`);
    channel.onmessage = (e) => {
      const heard = relayedFrom(e.data, this.api.token);
      if (heard) this.changed(relayedChange(heard));
    };
    this.api.wrote = (w) => {
      const home = this.home();
      if (home) channel.postMessage({ ...w, token: this.api.token, file: home.file, table: home.table } satisfies Relayed);
    };
  }

  /** Tells this file's other windows in the browser that this one is open, and keeps the list of theirs. */
  private joinWindows(): void {
    this.windows.set(this.windowId, { title: this.windowName });
    if (typeof BroadcastChannel === 'undefined' || this.windowsChannel) return;
    const channel = this.windowsChannel = new BroadcastChannel(`tabularius.windows.${this.api.db}`);
    const here = () => channel.postMessage({ type: 'here', id: this.windowId, title: this.windowName, number: this.secondary });
    channel.onmessage = (e) => {
      const m = e.data as { type?: string; id?: string; title?: string };
      if (typeof m?.id !== 'string') return;
      if (m.type === 'who') here();
      if (m.type === 'here' && typeof m.title === 'string') this.windows.set(m.id, { title: m.title });
      if (m.type === 'gone') this.windows.delete(m.id);
      if (m.type === 'focus' && m.id === this.windowId) window.focus();
    };
    channel.postMessage({ type: 'who', id: this.windowId });
    here();
    addEventListener('pagehide', () => channel.postMessage({ type: 'gone', id: this.windowId }));
    addEventListener('pageshow', (e) => { if (e.persisted) here(); });
  }

  /** Window > Show Window: brings that window forward (the browser may only let the window that opened it do so). */
  private showWindow(id: string): void {
    if (id === this.windowId) return window.focus();
    const title = this.windows.get(id)?.title ?? '';
    const n = Number(/ - (\d+)$/.exec(title)?.[1]);
    const handle = this.opened.get(n);
    if (handle && !handle.closed) handle.focus();
    else if (!/ - \d+$/.test(title) && window.opener) (window.opener as Window).focus();
    this.windowsChannel?.postMessage({ type: 'focus', id });
  }

  /** File > Close: a window opened with New Window just closes; the first one logs out. */
  private async closeWindow(): Promise<void> {
    if (this.secondary === undefined) return this.logout();
    if (!(await this.commit())) return;
    if (!(await this.windowCloseAllowed())) return;
    this.teardown();
    await this.locks.releaseAll();
    window.close();
  }

  // ---------------------------------------------------------- custom menus

  private menuBar?: MenuBar;
  /** The custom menus last worked out for this window; undefined with FileMaker's standard menus. */
  private customMenus?: CustomMenu[];

  /** The menu set an Install Menu Set step (or a layout's own set) put in place for this window; undefined = the file's default. */
  private menuSetId?: number;
  /** The installed set came from the layout's Layout Setup, so leaving for a layout without one goes back to the file's default. */
  private menuSetFromLayout = false;

  /** The installed menu set saved for this session, so a reload keeps it. */
  private savedMenuSet(): number | undefined {
    try {
      const saved = JSON.parse(sessionStorageGet('tabularius.menuSet') ?? 'null');
      if (saved?.token !== this.api.token || typeof saved.id !== 'number') return undefined;
      this.menuSetFromLayout = !!saved.layout;
      return saved.id;
    } catch {
      return undefined;
    }
  }

  /** Install Menu Set: the bar shows that set (1 is FileMaker's standard menus) until another is installed. */
  private installMenuSet(id: number | undefined, fromLayout = false): void {
    this.menuSetId = id;
    this.menuSetFromLayout = fromLayout;
    sessionStorageSet('tabularius.menuSet', JSON.stringify(id === undefined ? null : { token: this.api.token, id, ...(fromLayout ? { layout: true } : {}) }));
  }

  /**
   * A layout whose Layout Setup names a menu set installs it on arrival; a
   * layout set to the file's default puts the default back when the set came
   * from a layout, and keeps one a script installed.
   */
  private layoutMenuSet(): void {
    const own = this.meta?.design.menuSetId;
    if (own !== undefined) this.installMenuSet(own, true);
    else if (this.menuSetFromLayout) this.installMenuSet(undefined);
  }

  /** Asks the server for the custom menus as they stand for this record, and redraws the bar. */
  private async loadMenus(): Promise<CustomMenu[]> {
    if (!this.menuBar || !this.meta) return this.customMenus ?? [];
    try {
      const rec = this.record;
      this.customMenus = await this.api.menus(this.meta.layout.name, {
        recordId: rec ? Number(rec.recordId) : undefined, mode: this.windowMode, view: this.view,
        foundCount: this.foundCount, totalCount: this.totalCount, number: rec ? this.index + 1 : undefined,
        ...(this.menuSetId !== undefined ? { menuSet: this.menuSetId } : {}),
      });
      // Files on [Standard FileMaker Menus] get FileMaker's own menus.
      this.standardMode = this.customMenus ? undefined : this.mode;
      this.menuBar.set(this.customMenus ?? this.standardMenuSet());
      this.renderToolbar();
    } catch (e) {
      console.warn('Custom menus failed', e);
    }
    return this.customMenus ?? this.standardMenuSet();
  }

  /** The mode the standard menus were drawn for (Find mode has Requests where Browse mode has Records). */
  private standardMode?: Mode;

  /** The account's "Available menu commands" level; limits what the UI offers. */
  private menuCommandLevel: 'all' | 'editing' | 'minimum' = 'all';
  /** The privilege set's "Allow printing" (Print, Save Records as PDF) and "Allow exporting" (Export Records, Save Records as Excel). */
  private printing = true;
  private exporting = true;

  /**
   * Whether this account's menu-command level offers a command. `editing` drops
   * structural commands; `minimum` also drops the ones that change record data
   * or the found set. A UI guard only — record, field and script privileges are
   * enforced on the server whatever this says.
   */
  private commandAllowed(name: string): boolean {
    // The privilege set's "Allow printing" and "Allow exporting" (the server refuses these anyway).
    if (!this.printing && PRINT_COMMANDS.has(name)) return false;
    if (!this.exporting && EXPORT_COMMANDS.has(name)) return false;
    if (this.menuCommandLevel === 'all') return true;
    if (STRUCTURAL_COMMANDS.has(name)) return false;
    if (this.menuCommandLevel === 'editing') return true;
    return !EDITING_COMMANDS.has(name);
  }

  /** FileMaker's standard menus for this mode; Manage > Calendar Feeds only for an account with Full Access. */
  private standardMenuSet(): CustomMenu[] {
    return standardMenus(this.mode, this.scriptsMenu, { feeds: this.canDesign, tables: this.canDesign });
  }

  /** Whether the menu set has a command (FileMaker's standard menus have them all) and the account's level offers it. */
  private hasCommand(name: string): boolean {
    return this.commandAllowed(name) && (!this.customMenus || commands(this.customMenus).has(name));
  }

  /** Does a command, or runs the script the menu set puts in its place. */
  private doCommand(name: string): void {
    const item = this.customMenus && commands(this.customMenus).get(name);
    if (item?.run) void this.menuScript(item);
    else if (!this.customMenus || item) this.menuCommand(name, true);
  }

  /** The web client's version of a FileMaker menu command; returns whether it has one. */
  private menuCommand(name: string, run: boolean): boolean {
    // The account's menu-command level withholds some commands from the UI.
    if (!this.commandAllowed(name)) return false;
    const find = this.mode === 'find';
    const actions: Record<string, (() => unknown) | undefined> = {
      'Open Quickly': () => this.openQuickly(),
      'Browse Mode': () => this.enterBrowse(),
      'Preview Mode': () => this.enterPreview(),
      'Layout Mode': this.canDesign && this.meta ? () => this.enterLayout() : undefined,
      'Print': find ? undefined : () => this.print(),
      'Import Records': find ? undefined : () => this.importRecords(),
      'Export Records': find || !this.foundCount ? undefined : () => this.openExportDialog('csv'),
      'Save Records as Excel': find || !this.foundCount ? undefined : () => this.openExportDialog('xlsx'),
      'Save Records as PDF': find || !this.foundCount ? undefined : () => this.openPdfDialog(),
      'Find Mode': () => this.enterFind(),
      'Modify Last Find': () => this.enterFind(true),
      'Perform Find': find ? () => this.performFind() : undefined,
      'Constrain Found Set': find ? () => this.constrainFind(false) : undefined,
      'Extend Found Set': find ? () => this.constrainFind(true) : undefined,
      'New Record': find ? () => this.newRequest() : () => this.newRecord(),
      'New Request': find ? () => this.newRequest() : undefined,
      'Duplicate Request': find ? () => this.newRequest(true) : undefined,
      'Delete Request': find ? () => this.deleteRequest() : undefined,
      'Delete Record': find ? () => this.deleteRequest() : !this.record ? undefined : () => this.deleteRecord(),
      'Show All Records': () => this.showAll(),
      'Duplicate Record': find ? () => this.newRequest(true) : !this.record ? undefined : () => this.recordCommand('Duplicate Record'),
      // Find mode: the Omit button, ⌘T. It marks the request showing as one whose matches are left out (Claris, Requests menu).
      'Omit Request': find ? () => this.toggleOmit() : undefined,
      'Omit Record': find || !this.record ? undefined : () => this.recordCommand('Omit Record'),
      'Show Omitted Only': find ? undefined : () => this.recordCommand('Show Omitted Only'),
      'Omit Multiple': find || !this.record ? undefined : () => this.omitMultiple(),
      'Delete All Records': find || !this.foundCount ? undefined : () => this.deleteAllRecords(),
      'Replace Field Contents': find || !this.record || !this.focusedField ? undefined : () => this.openReplaceDialog(this.focusedField!),
      'Sort Records': find ? undefined : () => this.openSortDialog(this.sortFields()),
      'Unsort': find || !this.sort ? undefined : () => this.sortRecords(undefined),
      'Refresh Window': () => this.refreshWindow(),
      'Relookup Field Contents': find || !this.record || !this.focusedField ? undefined : () => this.relookup(this.focusedField!),
      'Revert Record': find || !this.record ? undefined : () => this.revertRecord(),
      'Record History': find || !this.record || this.api.isOffline ? undefined : () => this.openRecordHistory(),
      'Undo': () => this.editCommand('undo'),
      'Redo': () => this.editCommand('redo'),
      'Cut': () => this.editCommand('cut'),
      'Copy': () => this.editCommand('copy'),
      'Paste': () => this.paste(),
      'Clear': () => this.editCommand('delete'),
      'Select All': () => this.editCommand('selectAll'),
      'Find/Replace': find || this.preview ? undefined : () => this.openFindReplace(),
      'Find Again': find || this.preview || !this.findReplace.find ? undefined : () => this.findNext(),
      'Replace & Find Again': find || this.preview || !this.findReplace.find ? undefined : () => this.replaceAndFind(),
      'Current Date': () => this.insertText((this.meta?.fileMode === 'native' ? isoDate : usDate)(new Date())),
      'Current Time': () => this.insertText(clockTime(new Date())),
      'Current User Name': () => this.insertText(this.accountName),
      'From Index': () => this.insertFromIndex(),
      'From Last Visited Record': find || !this.lastVisited ? undefined : () => this.insertFromLastVisited(),
      'Bar Code': () => this.insertFromDevice(() => scanBarcode()),
      'Current Location': () => this.insertFromDevice(async () => {
        const at = await locate();
        if (!at) toast("The device's location isn't available: it wasn't allowed, or can't be found.");
        return at && `${at.latitude},${at.longitude}`;
      }),
      'View as Form': !this.allows('form') ? undefined : () => this.setView('form'),
      'Zoom In': this.zoomLocked ? undefined : () => this.setZoom(1),
      'Zoom Out': this.zoomLocked ? undefined : () => this.setZoom(-1),
      'View as List': find || !this.allows('list') ? undefined : () => this.setView('list'),
      'View as Table': find || !this.allows('table') ? undefined : () => this.setView('table'),
      'Status Toolbar': this.toolbarLocked ? undefined : () => this.toggleStatusToolbar(),
      'Manage Database': () => this.openDesign(),
      'Manage Security': () => this.openSecurity(),
      'Manage Layouts': () => this.openDesign('#layouts'),
      'Manage Calendar Feeds': this.canDesign ? () => void calendarDialog(this.api, 'feeds', this.meta?.layout.name) : undefined,
      'Import Calendar': () => void calendarDialog(this.api, 'import', this.meta?.layout.name),
      'Import Tables': this.canDesign ? () => void importTablesDialog(this.api, () => void this.api.menu().then((menu) => { this.menuItems = menu.layouts; this.scriptsMenu = menu.scripts ?? []; }, () => {})) : undefined,
      'Script Workspace': () => this.openDesign('#scripts'),
      'Script Debugger': () => this.openDebugger(),
      'Data Viewer': () => this.openDataViewer(),
      'Record Script': () => this.toggleRecording(),
      'Ask AI': !this.assistant ? undefined : () => this.assistant!.toggle(true),
      'Dashboards': () => this.openDashboards(),
      'Automations': () => this.openAutomations(),
      'Clean Up Data': () => this.openCleanup(),
      // The guides the server serves (every page of docs/), in a new tab.
      'Next Record': !this.foundCount && !find ? undefined : () => (find ? this.showRequest(this.request + 1) : this.goTo(this.index + 1)),
      'Previous Record': !this.foundCount && !find ? undefined : () => (find ? this.showRequest(this.request - 1) : this.goTo(this.index - 1)),
      'Go to Record Number': find ? () => this.goToRequestNumber() : !this.foundCount ? undefined : () => this.goToRecordNumber(),
      'Documentation': () => void window.open('/docs', '_blank', 'noopener'),
      'Keyboard Shortcuts': () => this.shortcutsSheet(),
      'About': async () => {
        const { version, commit } = await this.api.menu();
        await customDialog({ run: '', step: 'About', title: `About ${PRODUCT_NAME}`, message: `${PRODUCT_NAME} ${version ?? ''}${commit ? ` (${commit})` : ''}`.trim(), buttons: ['OK'] });
      },
      'Log Out': () => this.logout(),
      'Close': () => this.closeWindow(),
      'Close Window': () => this.closeWindow(),
      'New Window': () => this.newWindow(),
      ...(find ? {} : Object.fromEntries(Object.entries(STYLE_COMMANDS).map(([command, bits]) => [command, () => this.formatText((f) => ({ ...f, style: bits ? (f.style ?? 0) ^ bits : 0 }), bits)]))),
    };
    const fn = actions[name];
    if (fn && run) void Promise.resolve(fn()).catch((e) => toast(errorText(e)));
    return !!fn;
  }

  /** A Records menu command the server does as its script step would (Duplicate Record, Omit Record, ...). */
  private async recordCommand(command: string, options: Record<string, unknown> = {}): Promise<void> {
    const previousFoundCount = this.foundCount;
    await this.runButton(undefined, undefined, undefined, { command, ...options });
    if (this.foundCount !== previousFoundCount) announce(`Found ${this.foundCount} record${this.foundCount === 1 ? '' : 's'}.`);
  }

  /** The field box an Insert menu command types into: the focused one, else the last one left (a menu took the focus). */
  private insertTarget(): HTMLInputElement | HTMLTextAreaElement | undefined {
    const active = document.activeElement as HTMLElement | null;
    if (active?.matches('input.fm-input, textarea.fm-input') && this.content.contains(active)) return active as HTMLInputElement;
    const last = this.lastInput;
    if (!last) return undefined;
    // Leaving the field saved it, which may have drawn the record again: find the same field.
    let el: HTMLInputElement | HTMLTextAreaElement | undefined = last.el;
    if (!el.isConnected && last.id) {
      el = this.inputAt(last);
    }
    if (!el?.isConnected || el.readOnly || el.disabled) return undefined;
    el.focus();
    el.setSelectionRange(Math.min(last.start, el.value.length), Math.min(last.end, el.value.length));
    return el;
  }

  /** A field's object, parent record, portal row and repetition, to find the same cell once redrawn. */
  private placeOf(box: HTMLElement): FieldPlace {
    const obj = box.closest<HTMLElement>('[data-id]');
    const reps = obj ? [...obj.querySelectorAll('input.fm-input, textarea.fm-input')] : [];
    return { id: obj?.dataset.id, record: box.closest<HTMLElement>('.fm-part[data-record]')?.dataset.record,
      row: box.closest<HTMLElement>('.fm-portal-row')?.dataset.row, rep: Math.max(0, reps.indexOf(box)), fresh: !!box.closest('.fm-portal-new') };
  }

  private inputAt(place: FieldPlace, scope: HTMLElement = this.content): HTMLInputElement | HTMLTextAreaElement | undefined {
    return [...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input.fm-input, textarea.fm-input')].find((box) => {
      const at = this.placeOf(box);
      return at.id === place.id && at.record === place.record && at.row === place.row && at.rep === place.rep && at.fresh === place.fresh;
    });
  }

  /** Types text into the field at the cursor (replacing the selection, or all of it), as the Insert menu does. */
  /** Insert > Bar Code and Current Location: asks the device, then types the answer where the cursor was. */
  private async insertFromDevice(ask: () => Promise<string | undefined>): Promise<void> {
    const box = this.insertTarget();
    if (!box || box.readOnly) {
      toast('Click in a field first.');
      return;
    }
    const at = { start: box.selectionStart, end: box.selectionEnd };
    const text = await ask();
    if (text === undefined) return;
    // Leaving the field for the sheet saved it, which may have drawn it again.
    const target = box.isConnected ? box : this.insertTarget();
    if (!target) return;
    target.focus();
    if (at.start !== null && at.end !== null) target.setSelectionRange(at.start, at.end);
    this.insertText(text);
  }

  private insertText(text: string, all = false): void {
    const box = this.insertTarget();
    if (!box || box.readOnly) {
      toast('Click in a field first.');
      return;
    }
    if (all) box.select();
    // As typing, so it can be undone and is saved when the field is left.
    if (!document.execCommand('insertText', false, text)) {
      box.setRangeText(text, box.selectionStart ?? box.value.length, box.selectionEnd ?? box.value.length, 'end');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /** An Edit menu command on the field being edited (the focused one, else the last one left), as the browser does it. */
  private editCommand(command: 'undo' | 'redo' | 'cut' | 'copy' | 'delete' | 'selectAll'): void {
    if (command === 'undo' && !editable(document.activeElement) && toastUndo()) return;
    const box = this.insertTarget();
    if (!box && command === 'copy') {
      void this.copyRecord();
      return;
    }
    if (!box) {
      toast('Click in a field first.');
      return;
    }
    if (command === 'selectAll') {
      box.select();
      return;
    }
    if (box.readOnly && command !== 'copy') return;
    if (!document.execCommand(command)) toast(`Use the keyboard to ${command === 'delete' ? 'clear' : command}.`);
  }

  /**
   * Copy with no field active: the record's fields on this layout, separated by
   * tabs, as FileMaker copies them (Copy Record/Request on the server).
   */
  private async copyRecord(): Promise<void> {
    if (this.windowMode !== 'browse' || !this.record) {
      toast('Click in a field first.');
      return;
    }
    await this.recordCommand('Copy Record');
  }

  /**
   * File > Open Quickly (⌘K), as in FileMaker Pro: type part of a name to go to a layout, run a
   * script, or open another hosted file. Beyond FileMaker it also finds menu commands and
   * Tabularius's other screens, and offers to search the records or ask the assistant.
   */
  private openQuickly(): void {
    if (document.querySelector('dialog.quick-open')) return;
    type Hit = { title: string; kind: string; run: () => unknown; keys?: string };
    const items: Hit[] = [];
    for (const m of this.listedLayouts()) {
      if (m.kind === 'item' && m.open && m.name !== this.meta?.layout.name) items.push({ title: m.name, kind: 'Layout', run: () => this.goToLayout(m.name) });
    }
    const scripts = (entries: ScriptsMenuEntry[]) => {
      for (const e of entries) {
        if ('items' in e) scripts(e.items);
        else if ('id' in e) items.push({ title: e.name, kind: 'Script', run: () => this.menuScript({ kind: 'command', title: e.name, scriptId: e.id }) });
      }
    };
    scripts(this.scriptsMenu);
    // Beyond FileMaker: the finds saved in Saved Finds, and the recent ones.
    const finds = this.findStore();
    for (const [list, kind] of [[finds.saved, 'Saved Find'], [finds.recent, 'Recent Find']] as const) {
      for (const f of list) items.push({ title: f.name, kind, run: () => this.runSavedFind(f) });
    }
    for (const x of this.sortStore()) items.push({ title: x.name, kind: 'Saved Sort', run: () => this.runSavedSort(x) });
    // The records last looked at come first when nothing is typed yet.
    const recentRecords = (Array.isArray(this.prefs.recent) ? this.prefs.recent : []).filter((r) => r.recordId !== this.record?.recordId || r.layout !== this.meta?.layout.name)
      .filter((r) => this.menuItems.some((m) => m.kind === 'item' && m.name === r.layout && m.open))
      .map((r) => ({ title: r.title, kind: `Recent · ${r.layout}`, run: () => this.openRecentRecord(r) }));
    items.unshift(...recentRecords);
    const seen = new Set<string>(['Open Quickly']);
    const walk = (list: CustomMenuItem[]) => {
      for (const it of list) {
        if (it.items) walk(it.items);
        const title = (it.title || it.command || '').replace(/…$/, '');
        if (!title || seen.has(title) || it.kind === 'separator' || it.scriptId !== undefined) continue;
        const keys = it.shortcut ? shortcutText(it.shortcut) : undefined;
        if (it.run) items.push({ title, kind: 'Menu', run: () => this.menuScript(it), keys });
        else if (it.command && this.menuCommand(it.command, false)) items.push({ title, kind: 'Command', run: () => this.doCommand(it.command!), keys });
        else continue;
        seen.add(title);
      }
    };
    for (const m of this.customMenus ?? this.standardMenuSet()) walk(m.items);
    for (const [title, run] of [['Dashboards', () => this.openDashboards()], ['Automations', () => this.openAutomations()], ['Clean Up Data', () => this.openCleanup()],
      ['Design', () => this.openDesign()], ['Security', () => this.openSecurity()], ['Debug Scripts', () => this.openDebugger()], ['Data Viewer', () => this.openDataViewer()]] as const) {
      items.push({ title, kind: 'Screen', run });
    }
    items.push({ title: 'Documentation', kind: 'Help', run: () => void window.open('/docs', '_blank', 'noopener') });
    items.push({ title: 'Keyboard Shortcuts', kind: 'Help', run: () => this.shortcutsSheet(), keys: shortcutText({ key: '/', modifiers: 4 }) });
    void listDatabases().then((dbs) => {
      for (const d of dbs) if (d !== this.api.db) items.push({ title: d, kind: 'File', run: () => window.open(`./?db=${encodeURIComponent(d)}`, '_blank') });
      show();
    }, () => {});

    // Beyond FileMaker: records of this layout whose fields hold what was typed (as Quick Find finds them), a few
    // at a time, looked up once typing pauses; choosing one finds them all and shows that one.
    const browsing = this.mode === 'browse' && !this.preview && !!this.meta;
    let records: Hit[] = [];
    let asked = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lookUp = () => {
      clearTimeout(timer);
      const text = input.value.trim();
      if (!browsing || text.length < 2) {
        records = [];
        asked = '';
        return;
      }
      timer = setTimeout(() => {
        const keys = this.quickFindKeys();
        const layout = this.meta?.layout.name;
        if (!keys.length || !layout || text === asked) return;
        asked = text;
        records = [];
        void this.api.records(layout, { offset: 1, limit: 6, query: keys.map((k) => ({ [k]: text }) as FindRequest), sort: this.sort }).then((found) => {
          if (asked !== text || !dialog.open) return;
          records = found.data.map((rec) => ({
            title: keys.map((k) => String(rec.fieldData[k] ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3).map((v) => (v.length > 40 ? `${v.slice(0, 39)}…` : v)).join(' · ') || `Record ${rec.recordId}`,
            kind: 'Record',
            run: () => this.quickFind(text, rec.recordId),
          }));
          if (found.foundCount > records.length) records.push({ title: `All ${found.foundCount} records with “${text}”`, kind: 'Records', run: () => this.quickFind(text) });
          show();
        }, () => {
          // A field the server can't search, or no connection: no records to offer, Quick Find still is.
          if (asked === text) asked = '';
        });
      }, 250);
    };

    const input = h('input', { type: 'text', class: 'quick-open-input', placeholder: 'Layouts, scripts, finds, records, commands…', 'aria-label': 'Open Quickly', autocomplete: 'off', role: 'combobox', 'aria-controls': 'quick-open-list', 'aria-expanded': 'false', 'aria-autocomplete': 'list' }) as HTMLInputElement;
    const list = h('ul', { id: 'quick-open-list', class: 'quick-open-list', role: 'listbox' });
    const dialog = h('dialog', { class: 'quick-open', 'aria-label': 'Open Quickly' }, input, list) as HTMLDialogElement;
    let shown: Hit[] = [];
    let at = 0;
    const score = (title: string, words: string[]): number => {
      const t = title.toLowerCase();
      let n = 0;
      for (const w of words) {
        const i = t.indexOf(w);
        if (i < 0) return -1;
        n += i === 0 ? 3 : /[\s_\-:(]/.test(t[i - 1]) ? 2 : 1;
      }
      return n;
    };
    const show = () => {
      // "?" asks for the keyboard shortcuts.
      const q = input.value.trim().toLowerCase().replace(/^\?$/, 'keyboard shortcuts');
      const words = q.split(/\s+/).filter(Boolean);
      shown = (words.length
        ? items.map((x) => ({ x, n: score(x.title, words) })).filter((r) => r.n >= 0).sort((a, b) => b.n - a.n).map((r) => r.x)
        : items).slice(0, 60);
      const text = input.value.trim();
      // A number goes to that record of the found set, as the record number box does.
      const n = /^\d+$/.test(text) ? Number(text) : 0;
      if (browsing && n >= 1 && n <= this.foundCount) shown.unshift({ title: `Record ${n} of ${this.foundCount}`, kind: 'Go to Record', run: () => this.goTo(n - 1) });
      // Records come after the best few names, so they show without scrolling past every command that matches.
      if (text && text === asked) shown.splice(Math.min(3, shown.length), 0, ...records);
      else if (text && browsing) shown.push({ title: `Find records with “${text}”`, kind: 'Quick Find', run: () => this.quickFind(text) });
      // A find in plain words ("customers in Ohio with no orders this year"): the assistant fills in the requests
      // from the layout's design, to check before Perform Find. Only where the file has AI on.
      if (text && this.assistant && this.meta && (browsing || this.mode === 'find')) shown.push({ title: `Find with AI: ${text}`, kind: 'Find with AI', run: () => this.assistant!.findInWords(text) });
      if (text && this.assistant) shown.push({ title: `Ask AI: ${text}`, kind: 'Assistant', run: () => { this.assistant!.toggle(true); return this.assistant!.askAbout(text); } });
      at = Math.min(at, Math.max(0, shown.length - 1));
      input.setAttribute('aria-expanded', String(shown.length > 0));
      if (shown.length) input.setAttribute('aria-activedescendant', `quick-open-option-${at}`);
      else input.removeAttribute('aria-activedescendant');
      list.replaceChildren(...(shown.length ? shown.map((x, i) => {
        const li = h('li', { id: `quick-open-option-${i}`, role: 'option', 'aria-selected': String(i === at), class: i === at ? 'current' : '' }, h('span', { class: 'title' }, x.title), ...(x.keys ? [h('kbd', {}, x.keys)] : []), h('span', { class: 'kind' }, x.kind));
        li.addEventListener('mousemove', () => {
          if (at !== i) {
            at = i;
            show();
          }
        });
        li.addEventListener('click', () => choose(i));
        return li;
      }) : [h('li', { class: 'none' }, 'Nothing matches')]));
      list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
    };
    const choose = (i: number) => {
      const hit = shown[i];
      if (!hit) return;
      dialog.close();
      try {
        const r = hit.run();
        if (r instanceof Promise) r.catch((e) => toast(errorText(e)));
      } catch (e) {
        toast(errorText(e));
      }
    };
    input.addEventListener('input', () => {
      at = 0;
      lookUp();
      show();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (shown.length) at = (at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        show();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(at);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        dialog.close();
      }
    });
    dialog.addEventListener('close', () => {
      clearTimeout(timer);
      dialog.remove();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    show();
    dialog.showModal();
    input.focus();
  }

  /** Every keyboard shortcut this window takes: the menus' (custom ones included) and FileMaker's keys outside the menus. */
  private shortcutsSheet(): void {
    if (document.querySelector('dialog.shortcuts-sheet')) return;
    const cmd = (key: string, shift = false) => shortcutText({ key, modifiers: 4 | (shift ? 1 : 0) });
    const groups: { title: string; rows: [string, string][] }[] = [];
    for (const m of this.customMenus ?? this.standardMenuSet()) {
      const rows: [string, string][] = [];
      const walk = (list: CustomMenuItem[]) => {
        for (const it of list) {
          if (it.items) walk(it.items);
          else if (it.shortcut && it.kind !== 'separator') rows.push([(it.title || it.command || '').replace(/…$/, ''), shortcutText(it.shortcut)]);
        }
      };
      walk(m.items);
      if (rows.length) groups.push({ title: m.title, rows });
    }
    groups.push({ title: 'Moving around', rows: [
      ['Next field / previous field', 'Tab / ⇧Tab'],
      ['Next record / previous record', `${cmd('↓')} / ${cmd('↑')}`],
      ['Leave the field, saving it', 'Enter (keypad)'],
      ['Perform Find (Find mode)', 'Return'],
      ['Open Quickly', cmd('K')],
      ['Keyboard Shortcuts', cmd('/')],
    ] });
    const body = h('div', { class: 'shortcuts-groups' }, ...groups.map((g) => h('section', {},
      h('h3', {}, g.title),
      h('dl', {}, ...g.rows.flatMap(([what, keys]) => [h('dt', {}, what), h('dd', {}, h('kbd', {}, keys))])))));
    const close = button('Done', () => dialog.close(), { class: 'primary' });
    const dialog = h('dialog', { class: 'shortcuts-sheet', 'aria-labelledby': 'shortcuts-title' },
      h('h2', { id: 'shortcuts-title' }, 'Keyboard Shortcuts'), body,
      h('p', {}, h('a', { href: '/docs/troubleshooting-web-client#a-keyboard-shortcut-does-nothing' }, 'Keyboard shortcut help')),
      h('div', { class: 'actions' }, close)) as HTMLDialogElement;
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
  }

  /** Edit > Paste: the clipboard's text at the cursor. Browsers ask before a page may read the clipboard. */
  private async paste(): Promise<void> {
    const box = this.insertTarget();
    if (!box || box.readOnly) {
      toast('Click in a field first.');
      return;
    }
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast(`The browser didn't allow reading the clipboard. Use ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}V to paste.`);
      return;
    }
    this.insertText(text);
  }

  /** The field key of a field box on the layout ("Field", "TO::Field" or "Field(2)"). */
  private keyOf(box: HTMLElement): string | undefined {
    const el = box.closest<HTMLElement>('[data-id]');
    const o = el && this.renderer?.objectById(Number(el.dataset.id));
    return o ? this.renderer!.fieldKey(o) : undefined;
  }

  /**
   * A script running on the server: after a moment a note says so and offers
   * to stop it, with its button, Esc or ⌘-period as in FileMaker. A script
   * that turned Allow User Abort off carries on.
   */
  private async whileRunning<T>(work: Promise<T>, label = 'Running a script…'): Promise<T> {
    let note: ReturnType<typeof pinnedToast> | undefined;
    let polling = false;
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      this.api.stopRuns().catch(() => {});
      note?.say('Stopping…');
    };
    const onKey = (e: KeyboardEvent) => {
      // A dialog that is up (another script's, or the browser's own) keeps its Esc.
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape' || (e.key === '.' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        e.stopPropagation();
        stop();
      }
    };
    const timer = setTimeout(() => {
      note = pinnedToast(label, { label: 'Stop', run: stop, title: 'Stop this operation (Esc)' });
      document.addEventListener('keydown', onKey, true);
      progressTimer = setInterval(() => {
        if (polling) return;
        polling = true;
        void this.api.runningProgress().then(({ runs }) => {
          const current = runs.at(-1);
          if (current) note?.say(current.total ? `${current.operation}: ${current.completed.toLocaleString()} of ${current.total.toLocaleString()}` : `${current.operation}: ${current.completed.toLocaleString()} records`);
        }).catch(() => {}).finally(() => { polling = false; });
      }, 500);
    }, 800);
    try {
      return await work;
    } finally {
      clearTimeout(timer);
      if (progressTimer) clearInterval(progressTimer);
      note?.remove();
      document.removeEventListener('keydown', onKey, true);
    }
  }

  /** Insert > From Index: the field's values in every record, to pick one from (View Index). */
  private async insertFromIndex(): Promise<void> {
    const box = this.insertTarget();
    const key = box && this.keyOf(box);
    if (!box || !key || box.readOnly || !this.meta) {
      toast('Click in a field first.');
      return;
    }
    const values = await this.api.fieldIndex(this.meta.layout.name, key, '', 500);
    const start = box.selectionStart ?? box.value.length, end = box.selectionEnd ?? box.value.length;
    const picked = await viewIndex(values);
    this.lastInput = { el: box, ...this.placeOf(box), start, end };
    if (picked === undefined) return;
    // Closing the dialog gives the field its focus back but not its selection: the value
    // replaces what was selected, as in FileMaker, not the field's first characters.
    if (box.isConnected && document.activeElement === box) box.setSelectionRange(start, end);
    this.insertText(picked);
  }

  /** Insert > From Last Visited Record: the field's value in the record shown before this one. */
  private async insertFromLastVisited(): Promise<void> {
    const box = this.insertTarget();
    const key = box && this.keyOf(box);
    if (!box || !key || !this.meta || !this.lastVisited) return;
    const rec = await this.api.record(this.meta.layout.name, this.lastVisited);
    const v = rec.fieldData[key];
    this.lastInput = { el: box, ...this.placeOf(box), start: 0, end: box.value.length };
    this.insertText(v === undefined || v === null ? '' : String(v).replace(/\r\n?/g, '\n'), true);
  }

  /** Notes the record now shown, so the one before it is the last visited. */
  private noteVisit(): void {
    const id = this.record?.recordId;
    if (!id || id === this.visiting) return;
    this.lastVisited = this.visiting;
    this.lastVisitedLayout = this.visitingLayout;
    this.visiting = id;
    this.visitingLayout = this.meta?.layout.name;
    this.noteRecentRecord();
  }

  /** Omit Multiple: omits the number of records asked for, from the current one on. */
  private async omitMultiple(): Promise<void> {
    const answer = await askText('Omit Multiple', 'Number of records to omit', '1', 'Omit', 'Omit how many records, starting with the current one?');
    const count = Math.trunc(Number(answer));
    if (answer === null || !(count >= 1)) return;
    await this.recordCommand('Omit Multiple', { count });
  }

  /** Delete All Records: every record in the found set, after asking as FileMaker does. */
  private async deleteAllRecords(): Promise<void> {
    if (!(await askConfirm('Delete All Records', `Permanently delete ALL ${this.foundCount} record(s) in this found set?`, 'Delete All'))) return;
    await this.recordCommand('Delete All Records');
  }

  /** Relookup Field Contents: the lookups that match on the field the cursor was in copy their values again, in every record of the found set. */
  private async relookup(key: string): Promise<void> {
    const field = key.replace(/\(\d+\)$/, '');
    if (!(await askConfirm('Relookup Field Contents', `Relookup field contents in the ${this.foundCount} record(s) of the current found set? Fields that look up values based on "${field}" will be replaced.`, 'Relookup'))) return;
    await this.recordCommand('Relookup Field Contents', { field });
  }

  /**
   * Import Records: a file the person picks (comma- or tab-separated text, a
   * merge file, Excel or FileMaker XML), its columns matched to the layout table's fields
   * (by name, or by the assistant when it is on) with fixes for their formats,
   * a preview and the rows already in the file (import-dialog.ts). Add, or
   * Update matching records / Replace data in the found set; the records
   * imported become the found set, as in FileMaker, and Undo takes them back.
   */
  private async importRecords(): Promise<void> {
    if (!(await this.commit())) return;
    const pick = h('input', { type: 'file', accept: '.csv,.tab,.tsv,.txt,.mer,.xlsx,.xml' }) as HTMLInputElement;
    const file = await new Promise<File | undefined>((done) => {
      pick.addEventListener('change', () => done(pick.files?.[0]));
      pick.addEventListener('cancel', () => done(undefined));
      pick.click();
    });
    if (!file) return;
    const tooLarge = importTooLarge(file.name, file.size);
    if (tooLarge) {
      toast(tooLarge);
      return;
    }
    const layout = this.meta!.layout.name;
    const ai = !!this.assistant;
    const plan = await this.api.planImport(layout, file, { ai });
    if (!plan.rows) {
      toast(`${file.name} has no records to import.`);
      return;
    }
    // Update and Replace work on the found set showing: its records, in order.
    const found: ImportFound = this.ids ? { ids: this.ids, sort: this.sort } : { query: this.query, sort: this.sort };
    // The dialog names the worksheet each preview and the import read, so a pick still being previewed is never mixed with an older plan.
    const r = await importDialog(file.name, plan, {
      plan: (opts) => this.api.planImport(layout, file, { ...opts, found }),
      apply: (choice, opts) => {
        const request = this.api.applyImport(layout, file, choice, { ...opts, found });
        return opts.action === 'add' ? this.whileRunning(request, 'Importing records…') : request;
      },
    }, { ai, foundCount: this.mode === 'browse' ? this.foundCount : 0 });
    if (!r) return;
    this.ids = r.foundSet;
    this.query = undefined;
    this.sort = undefined;
    this.index = 0;
    this.mode = 'browse';
    await this.reload();
    const skippedCount = r.skippedCount ?? r.skipped.length;
    const skipped = skippedCount ? `; ${skippedCount} left out` : '';
    const pending = r.pendingApproval ? `; ${r.pendingApproval} waiting for approval` : '';
    const updated = r.updated !== undefined ? `Updated ${r.updated} record(s)${r.imported ? ` and added ${r.imported}` : ''}` : `Imported ${r.imported} record(s)`;
    const cantUndo = r.undoable === false ? ' Too many records changed to keep an Undo.' : '';
    toast(`${r.stopped ? 'Stopped: ' : ''}${updated}${skipped}${pending}.${cantUndo}`, 'info', (r.imported || r.updated) && r.undoable !== false ? {
      label: 'Undo',
      run: () => void this.api.undoImport(layout, r.id).then(async (u) => {
        const made = new Set(r.foundSet.slice(r.updated ?? 0));
        this.ids = this.ids?.filter((id) => !made.has(id));
        await this.reload();
        const back = u.restored !== undefined ? `${u.restored} field value(s) put back` : '';
        toast(`Import undone: ${[`${u.deleted} record(s) deleted`, back].filter(Boolean).join(', ')}${u.kept.length ? `; ${u.kept.length} left because they changed since` : ''}.`, 'info');
      }).catch((e) => toast(errorText(e))),
    } : undefined);
  }

  /**
   * Export Records / Save Records as Excel: the found set, in its order, with
   * the fields picked (the layout's, all ticked), downloaded as a file.
   */
  private openExportDialog(format: 'csv' | 'tab' | 'xlsx'): void {
    const layout = this.meta!.layout.name;
    const keys = this.renderer?.fieldKeys() ?? [];
    const dialog = h('dialog', { class: 'replace-dialog export-dialog', 'aria-label': 'Export Records' }) as HTMLDialogElement;
    const list = h('ul', { class: 'export-fields' });
    const boxes = keys.map((k) => {
      const box = h('input', { type: 'checkbox', checked: '' }) as HTMLInputElement;
      list.append(h('li', {}, h('label', {}, box, ' ', k)));
      return box;
    });
    const type = h('select', { 'aria-label': 'Type' },
      h('option', { value: 'csv' }, 'Comma-Separated Values (.csv)'),
      h('option', { value: 'tab' }, 'Tab-Separated Text (.tab)'),
      h('option', { value: 'mer' }, 'Merge (.mer)'),
      h('option', { value: 'xlsx' }, 'Excel Workbook (.xlsx)'),
      h('option', { value: 'xml' }, 'XML (.xml)'),
      h('option', { value: 'html' }, 'HTML Table (.html)')) as HTMLSelectElement;
    type.value = format;
    const name = h('input', { type: 'text', 'aria-label': 'File name' }) as HTMLInputElement;
    name.value = layout;
    const names = h('input', { type: 'checkbox' }) as HTMLInputElement;
    // Excel on Windows reads UTF-8 text with accents correctly only when the file starts with a byte order mark.
    const bom = h('input', { type: 'checkbox' }) as HTMLInputElement;
    // Merge, XML and HTML files always name the fields; only the text formats can start with a byte order mark.
    const named = () => {
      names.disabled = ['mer', 'xml', 'html'].includes(type.value);
      bom.disabled = !['csv', 'tab', 'mer'].includes(type.value);
    };
    type.addEventListener('change', named);
    named();
    const run = async () => {
      const fields = keys.filter((_, i) => boxes[i].checked);
      if (!fields.length) {
        toast('Choose at least one field.');
        return;
      }
      dialog.close();
      if (!(await this.commit())) return;
      const request = this.api.exportRecords(layout, {
        fields, format: type.value as ExportFormat, fieldNames: names.checked, name: name.value, ...(bom.checked && !bom.disabled ? { bom: true } : {}),
        ...(this.ids ? { ids: this.ids } : { query: this.query }), sort: this.sort,
      });
      const file = type.value === 'xlsx' ? await request : await this.whileRunning(request, 'Exporting records…');
      saveDownload(file.name, file.blob);
    };
    dialog.append(
      h('h2', {}, format === 'xlsx' ? 'Save Records as Excel' : 'Export Records'),
      h('p', {}, `The ${this.foundCount} record(s) of the found set, in their order, with these fields:`),
      list,
      h('label', { class: 'row' }, 'Type ', type),
      h('label', { class: 'row' }, 'File name ', name),
      h('label', { class: 'row' }, names, ' Field names in the first row'),
      h('label', { class: 'row' }, bom, ' UTF-8 with byte order mark (for Excel on Windows)'),
      h('div', { class: 'actions' },
        button('All', () => boxes.forEach((b) => (b.checked = true))),
        button('None', () => boxes.forEach((b) => (b.checked = false))),
        h('span', { class: 'spacer' }),
        button('Cancel', () => dialog.close()),
        button('Export', () => void run().catch((e) => toast(errorText(e))), { class: 'primary' }),
      ),
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  /**
   * File > Save Records as PDF: the records being browsed (or the current one) as the
   * layout prints, made on the server by the Save Records as PDF step and downloaded.
   */
  private openPdfDialog(): void {
    const dialog = h('dialog', { class: 'replace-dialog export-dialog', 'aria-label': 'Save Records as PDF' }) as HTMLDialogElement;
    const name = h('input', { type: 'text', 'aria-label': 'File name' }) as HTMLInputElement;
    name.value = `${this.meta!.layout.name}.pdf`;
    const records = h('select', { 'aria-label': 'Save' },
      h('option', { value: 'browsed' }, `Records being browsed (${this.foundCount})`),
      h('option', { value: 'current' }, 'Current record')) as HTMLSelectElement;
    const run = () => {
      dialog.close();
      void this.recordCommand('Save Records as PDF', { name: name.value, records: records.value }).catch((e) => toast(errorText(e)));
    };
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
    });
    dialog.append(
      h('h2', {}, 'Save Records as PDF'),
      h('label', { class: 'row' }, 'File name ', name),
      h('label', { class: 'row' }, 'Save ', records),
      h('div', { class: 'actions' },
        h('span', { class: 'spacer' }),
        button('Cancel', () => dialog.close()),
        button('Save', run, { class: 'primary' }),
      ),
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    name.setSelectionRange(0, name.value.length - 4);
    name.focus();
  }

  /**
   * Replace Field Contents, as FileMaker's dialog: the field the cursor was in gets, in every
   * record of the found set, the value it has here, serial numbers (from the field's entry
   * options or custom values), or a calculated result, which can be tried on this record first.
   * Beyond FileMaker, with the assistant on: what AI writes from an instruction and each record.
   */
  private openReplaceDialog(key: string): void {
    const field = key.replace(/\(\d+\)$/, '');
    const current = this.record?.fieldData[field];
    const dialog = h('dialog', { class: 'replace-dialog replace-contents', 'aria-label': 'Replace Field Contents' }) as HTMLDialogElement;
    const choice = (value: string, label: string) => {
      const input = h('input', { type: 'radio', name: 'replace-with', value }) as HTMLInputElement;
      return { input, row: h('label', { class: 'choice' }, input, label) };
    };
    const value = h('input', { type: 'text', 'aria-label': 'Replace with' }) as HTMLInputElement;
    value.value = current === undefined || current === null ? '' : String(current);
    const withValue = choice('value', 'Replace with:');
    const withSerial = choice('serial', 'Replace with serial numbers:');
    const withCalc = choice('calculation', 'Replace with calculated result:');
    const withAi = choice('ai', 'Replace with what AI writes from each record:');
    withValue.input.checked = true;
    const entryOptions = h('input', { type: 'radio', name: 'replace-serial', value: 'entry', checked: '' }) as HTMLInputElement;
    const custom = h('input', { type: 'radio', name: 'replace-serial', value: 'custom' }) as HTMLInputElement;
    const initial = h('input', { type: 'text', 'aria-label': 'Initial value', value: '1' }) as HTMLInputElement;
    const increment = h('input', { type: 'number', 'aria-label': 'Increment by', value: '1', step: '1' }) as HTMLInputElement;
    const update = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const formula = h('textarea', { 'aria-label': 'Calculation', rows: '4', spellcheck: 'false', placeholder: `For example: Upper ( ${field} )` }) as HTMLTextAreaElement;
    const tried = h('div', { class: 'replace-tried', 'aria-live': 'polite' });
    const tryIt = button('Try on this record', () => {
      const layout = this.meta?.layout.name;
      if (!layout || !formula.value.trim()) return;
      tried.textContent = 'Working…';
      this.api.evaluate(layout, [formula.value], this.record?.recordId).then(({ results: [r] }) => {
        tried.classList.toggle('bad', !!r?.error);
        tried.textContent = r?.error ? (r.message ?? `Error ${r.error}`) : `Result on this record: ${r?.value === '' || r?.value === undefined ? '(empty)' : String(r.value)}`;
      }, (e) => {
        tried.classList.add('bad');
        tried.textContent = errorText(e);
      });
    }, { class: 'quiet' });
    const serialBox = h('div', { class: 'replace-sub' },
      h('label', { class: 'choice' }, entryOptions, 'Use Entry Options'),
      h('label', { class: 'choice' }, custom, 'Custom values'),
      h('div', { class: 'replace-grid' }, h('span', { class: 'label' }, 'Initial value'), initial, h('span', { class: 'label' }, 'Increment by'), increment),
      h('label', { class: 'choice' }, update, 'Update serial number in Entry Options'));
    const calcBox = h('div', { class: 'replace-sub' }, formula, h('div', { class: 'replace-try' }, tryIt, tried));
    // AI: an instruction in words, tried on this record first; the model sees the layout's fields this account can see.
    const ask = h('textarea', { class: 'replace-ask', 'aria-label': 'What AI should write', rows: '3', placeholder: `For example: the city from the address, or Positive, Neutral or Negative from the notes` }) as HTMLTextAreaElement;
    const aiTried = h('div', { class: 'replace-tried', 'aria-live': 'polite' });
    const tryAi = button('Try on this record', () => {
      const layout = this.meta?.layout.name;
      if (!layout || !ask.value.trim() || !this.record) return;
      aiTried.classList.remove('bad');
      aiTried.textContent = 'Asking AI…';
      this.api.aiReplace(layout, { field, instruction: ask.value, preview: true, recordId: this.record.recordId }).then((r) => {
        aiTried.textContent = r.value === null || r.value === undefined ? 'AI couldn’t tell from this record; it would be left as it is.' : `Result on this record: ${r.value === '' ? '(empty)' : r.value}`;
      }, (e) => {
        aiTried.classList.add('bad');
        aiTried.textContent = errorText(e);
      });
    }, { class: 'quiet' });
    const aiBox = h('div', { class: 'replace-sub' }, ask, h('div', { class: 'replace-try' }, tryAi, aiTried),
      h('span', { class: 'label' }, `AI reads this layout’s fields in each record (up to 500 records), not passwords or keys. A record it can’t tell is left as it is.`));
    const offerAi = !!this.assistant && !field.includes('::');
    const valueBox = h('div', { class: 'replace-sub' }, value);
    // Every option's boxes stay usable: typing in one picks that option, and the others dim.
    const sync = () => {
      valueBox.classList.toggle('inactive', !withValue.input.checked);
      serialBox.classList.toggle('inactive', !withSerial.input.checked);
      calcBox.classList.toggle('inactive', !withCalc.input.checked);
      aiBox.classList.toggle('inactive', !withAi.input.checked);
      initial.closest('.replace-grid')!.classList.toggle('inactive', !custom.checked);
    };
    dialog.addEventListener('change', sync);
    const picks = (box: HTMLElement, option: HTMLInputElement, also?: () => void) => box.addEventListener('focusin', (e) => {
      if (e.target === option) return;
      option.checked = true;
      also?.();
      sync();
    });
    picks(valueBox, withValue.input);
    picks(serialBox, withSerial.input, () => {
      if (document.activeElement === initial || document.activeElement === increment) custom.checked = true;
    });
    picks(calcBox, withCalc.input);
    picks(aiBox, withAi.input);
    const replace = () => {
      const options: Record<string, unknown> = { field };
      if (offerAi && withAi.input.checked) {
        if (!ask.value.trim()) { ask.focus(); return; }
        dialog.close();
        void this.replaceWithAi(field, ask.value);
        return;
      }
      if (withSerial.input.checked) {
        options.replaceWith = 'serial';
        options.serial = { ...(custom.checked ? { initial: initial.value, increment: increment.value } : {}), update: update.checked };
      } else if (withCalc.input.checked) {
        if (!formula.value.trim()) { formula.focus(); return; }
        options.replaceWith = 'calculation';
        options.calculation = formula.value;
      } else options.value = value.value;
      dialog.close();
      void this.recordCommand('Replace Field Contents', options).catch((e) => toast(errorText(e)));
    };
    value.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replace(); }
    });
    dialog.append(
      h('h2', {}, 'Replace Field Contents'),
      // Beyond FileMaker: a field of the layout's own table can be put back with Undo afterwards (up to 50,000 records).
      h('p', {}, `Replace the contents of the field “${field}” in all ${this.foundCount} record(s) of the found set?`,
        ...(!field.includes('::') && this.foundCount <= 50_000 ? [h('br'), h('span', { class: 'label' }, 'Undo can put the values back afterwards.')] : [' This can’t be undone.'])),
      withValue.row, valueBox,
      withSerial.row, serialBox,
      withCalc.row, calcBox,
      ...(offerAi ? [withAi.row, aiBox] : []),
      h('div', { class: 'actions' },
        h('span', { class: 'spacer' }),
        button('Cancel', () => dialog.close()),
        button('Replace', replace, { class: 'primary' }),
      ),
    );
    sync();
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    value.select();
  }

  /** Replace Field Contents with AI over the found set; the toast that follows offers Undo. */
  private async replaceWithAi(field: string, instruction: string): Promise<void> {
    const layout = this.meta?.layout.name;
    if (!layout || !(await this.commit())) return;
    toast(`Asking AI for ${field} in ${this.foundCount} record(s)…`, 'info');
    try {
      const r = await this.api.aiReplace(layout, { field, instruction, ...(this.ids ? { ids: this.ids } : { query: this.query }), sort: this.sort });
      await this.reload(this.record?.recordId);
      const left = r.left ? `; ${r.left} left as they were` : '';
      const skipped = r.skipped?.length ? `; ${r.skipped.length} couldn’t be changed (${r.skipped[0].why})` : '';
      const undo = r.undo;
      const stopped = r.stopped ? ` AI stopped partway: ${r.stopped}.` : '';
      toast(`AI replaced ${field} in ${r.changed ?? 0} record(s)${left}${skipped}.${stopped}`, 'info', undo ? { label: 'Undo', run: () => void this.undoChange(undo.id) } : undefined);
    } catch (e) {
      toast(errorText(e));
    }
  }

  /** Edit > Find/Replace: what was typed and the options picked, kept while the window is open (Find Again uses them). */
  private findReplace = { find: '', replace: '', direction: 'all' as 'forward' | 'backward' | 'all', matchCase: false, wholeWords: false, currentRecord: false, currentField: false };
  private findReplaceDialog?: HTMLDialogElement;
  /** Find Next going through the found set; closing the dialog stops it. */
  private findScan = 0;

  /** The find term as a pattern, with the options: case, and whole words (bounded by spaces or punctuation). */
  private findPattern(): RegExp | undefined {
    const o = this.findReplace;
    if (!o.find) return undefined;
    const escaped = o.find.replace(/\r\n?/g, '\n').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(o.wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped, `gu${o.matchCase ? '' : 'i'}`);
  }

  /**
   * The current record's fields Find/Replace looks in, in tab order: edit boxes and drop-down
   * lists showing now (so only the front tab or slide panel), not in portals. As in FileMaker,
   * pop-up menus, checkboxes and radio buttons aren't searched, and read-only ones can't be replaced.
   */
  private findBoxes(): { box: HTMLInputElement | HTMLTextAreaElement; key: string; text: string }[] {
    const rec = this.record;
    if (!rec || !this.renderer || this.mode !== 'browse' || this.preview) return [];
    const root = this.content.querySelector<HTMLElement>(`[data-index="${this.index}"]`) ?? this.content;
    const current = this.focusedField?.replace(/\(\d+\)$/, '');
    const out: { box: HTMLInputElement | HTMLTextAreaElement; key: string; text: string }[] = [];
    for (const box of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input.fm-input[type=text], textarea.fm-input')) {
      if (box.closest('.fm-portal, .fm-portal-row') || box.inert || box.closest('[inert]') || !box.getClientRects().length) continue;
      const obj = box.closest<HTMLElement>('[data-id]');
      const o = obj && this.renderer.objectById(Number(obj.dataset.id));
      if (!o?.field) continue;
      const rep = [...obj!.querySelectorAll('input.fm-input, textarea.fm-input')].indexOf(box) + 1;
      const key = this.renderer.fieldKey(o, rep);
      if (!key || (this.findReplace.currentField && key.replace(/\(\d+\)$/, '') !== current)) continue;
      // The value as stored: a box not being edited may show it formatted (dates, numbers).
      const raw = rec.fieldData[key];
      const text = document.activeElement === box || raw === undefined || raw === null ? box.value : String(raw).replace(/\r\n?/g, '\n');
      out.push({ box, key, text });
    }
    // In the layout's tab order when it has one; fields not in it after, in the order they're drawn.
    const order = this.meta?.design.tabOrder;
    if (!order?.length) return out;
    const pos = (b: { box: HTMLElement }) => {
      const i = order.indexOf(Number(b.box.closest<HTMLElement>('[data-id]')!.dataset.id));
      return i < 0 ? order.length : i;
    };
    return out.sort((a, b) => pos(a) - pos(b));
  }

  /** Where the cursor is among the boxes: the one being edited (or last left) and its selection. */
  private findCursor(boxes: { box: HTMLElement }[]): { at: number; start: number; end: number } | undefined {
    const active = document.activeElement as HTMLInputElement | null;
    const el = active && boxes.some((b) => b.box === active) ? { el: active, start: active.selectionStart ?? 0, end: active.selectionEnd ?? 0 } : this.lastInput;
    const at = el ? boxes.findIndex((b) => b.box === el.el) : -1;
    return at < 0 ? undefined : { at, start: el!.start, end: el!.end };
  }

  /** Selects a match in a field box, as FileMaker does, and scrolls it into view. */
  private selectMatch(box: HTMLInputElement | HTMLTextAreaElement, start: number, end: number): void {
    box.focus();
    box.setSelectionRange(start, end);
    box.scrollIntoView({ block: 'nearest' });
    this.lastInput = { el: box, ...this.placeOf(box), start, end };
  }

  /** The next match in this record from the cursor (or from the top, or the bottom going backward). */
  private matchInRecord(pattern: RegExp, backward: boolean, fromCursor: boolean): boolean {
    const boxes = this.findBoxes();
    const cur = fromCursor ? this.findCursor(boxes) : undefined;
    const order = boxes.map((_, i) => i);
    if (backward) order.reverse();
    for (const i of order) {
      const { box, text } = boxes[i];
      if (cur && (backward ? i > cur.at : i < cur.at)) continue;
      pattern.lastIndex = 0; // matchAll starts where the last test left off
      const all = [...text.matchAll(pattern)].filter((m) => m[0].length);
      const hits = cur && i === cur.at
        ? all.filter((m) => (backward ? m.index! + m[0].length <= cur.start && m.index! < cur.start : m.index! >= cur.end && !(m.index === cur.start && m.index + m[0].length === cur.end)))
        : all;
      const m = backward ? hits[hits.length - 1] : hits[0];
      if (m) {
        this.selectMatch(box, m.index!, m.index! + m[0].length);
        return true;
      }
    }
    return false;
  }

  /**
   * Find Next: the next match after the cursor in this record, then in the records after it
   * (before it, going backward). Direction All goes round the found set back to this record.
   * Records are read in pages; only the one with a match is shown.
   */
  private async findNext(): Promise<boolean> {
    const pattern = this.findPattern();
    if (!pattern) return false;
    const o = this.findReplace;
    const backward = o.direction === 'backward';
    if (this.matchInRecord(pattern, backward, true)) return true;
    if (o.currentRecord || !this.meta) return this.notFound();
    const keys = this.findBoxes().map((b) => b.key);
    if (!keys.length) return this.notFound();
    const scan = ++this.findScan;
    const n = this.foundCount;
    const start = this.index;
    const pages = new Map<number, DataRecord[]>();
    const recordAt = async (i: number): Promise<DataRecord | undefined> => {
      const cached = this.cache.get(i);
      if (cached) return cached;
      const from = i - (i % 500);
      if (!pages.has(from)) {
        const layout = this.meta!.layout.name;
        const page = this.ids
          ? await this.api.recordsById(layout, this.ids, from + 1, 500, this.sort)
          : await this.api.records(layout, { offset: from + 1, limit: 500, query: this.query, sort: this.sort });
        pages.set(from, page.data);
      }
      return pages.get(from)![i - from];
    };
    const status = this.findReplaceDialog?.querySelector('.find-status');
    for (let k = 1; k <= n; k++) {
      if (scan !== this.findScan) return false;
      let i = start + (backward ? -k : k);
      if (o.direction === 'all') i = (i + n) % n;
      else if (i < 0 || i >= n) break;
      if (k % 500 === 0 && status) status.textContent = `Searching record ${i + 1} of ${n}…`;
      const rec = await recordAt(i);
      const hit = rec && keys.some((key) => {
        const v = rec.fieldData[key];
        pattern.lastIndex = 0;
        return v !== undefined && v !== null && pattern.test(String(v).replace(/\r\n?/g, '\n'));
      });
      if (!hit) continue;
      await this.goTo(i);
      if (scan !== this.findScan) return false;
      if (this.matchInRecord(pattern, backward, false)) {
        if (status) status.textContent = '';
        return true;
      }
    }
    if (status) status.textContent = '';
    return this.notFound();
  }

  private notFound(): false {
    const status = this.findReplaceDialog?.querySelector('.find-status');
    const what = `No ${this.findReplace.direction === 'all' ? '' : 'more '}matches for “${this.findReplace.find}”.`;
    if (status) status.textContent = what;
    else toast(what, 'info');
    return false;
  }

  /** Replace: the selected text, when it is a match, becomes the replacement (typed, so it saves as typing does). */
  private replaceSelection(): boolean {
    const pattern = this.findPattern();
    const boxes = this.findBoxes();
    const cur = this.findCursor(boxes);
    if (!pattern || !cur) return false;
    const { box, text } = boxes[cur.at];
    const selected = text.slice(cur.start, cur.end);
    pattern.lastIndex = 0;
    const m = pattern.exec(selected);
    if (!m || m.index !== 0 || m[0].length !== selected.length || !selected) return false;
    if (box.readOnly) {
      toast('This field can’t be changed here.');
      return false;
    }
    this.selectMatch(box, cur.start, cur.end);
    const replacement = this.findReplace.replace;
    if (!document.execCommand('insertText', false, replacement)) {
      box.setRangeText(replacement, cur.start, cur.end, 'end');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.lastInput = { el: box, ...this.placeOf(box), start: cur.start + replacement.length, end: cur.start + replacement.length };
    return true;
  }

  /** Replace All: on the server, in the fields Find/Replace looks in, over the found set or this record; Undo can take it back. */
  private async replaceAll(): Promise<void> {
    const o = this.findReplace;
    const fields = [...new Set(this.findBoxes().filter((b) => !b.box.readOnly).map((b) => b.key.replace(/\(\d+\)$/, '')))];
    if (!o.find || !fields.length) {
      this.notFound();
      return;
    }
    const across = o.currentRecord ? 'this record' : `all ${this.foundCount} record${this.foundCount === 1 ? '' : 's'} of the found set`;
    if (!(await askConfirm('Replace All', `Replace every “${o.find}” with “${o.replace}” in ${across}?`, 'Replace All'))) return;
    const r = await this.runButton(undefined, undefined, undefined, {
      command: 'Replace All', find: o.find.replace(/\n/g, '\r'), replace: o.replace.replace(/\n/g, '\r'), fields,
      ...(o.matchCase ? { matchCase: true } : {}), ...(o.wholeWords ? { wholeWords: true } : {}), ...(o.currentRecord ? { currentRecord: true } : {}),
    });
    if (r && r.error === 0 && r.replaced === 0) this.notFound();
    else if (r && r.error === 0 && !r.undo) toast('Replaced.', 'info');
  }

  /**
   * Edit > Find/Replace, as FileMaker's dialog: find what, replace with, direction, match case,
   * whole words, across this record or the found set, within the current field or all. It stays
   * open beside the layout while matches are selected in the fields. Beyond FileMaker (and
   * WebDirect, which has no Find/Replace at all), Replace All can be undone.
   */
  private openFindReplace(): void {
    if (this.findReplaceDialog?.isConnected) {
      this.findReplaceDialog.querySelector<HTMLInputElement>('input')?.select();
      return;
    }
    const o = this.findReplace;
    const opener = document.activeElement;
    const dialog = h('dialog', { class: 'replace-dialog find-replace', 'aria-label': 'Find/Replace' }) as HTMLDialogElement;
    this.findReplaceDialog = dialog;
    const text = (label: string, key: 'find' | 'replace') => {
      const input = h('input', { type: 'text', 'aria-label': label }) as HTMLInputElement;
      input.value = o[key];
      input.addEventListener('input', () => { o[key] = input.value; });
      return input;
    };
    const find = text('Find what', 'find');
    const replace = text('Replace with', 'replace');
    const check = (label: string, key: 'matchCase' | 'wholeWords') => {
      const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
      input.checked = o[key];
      input.addEventListener('change', () => { o[key] = input.checked; });
      return h('label', { class: 'choice' }, input, label);
    };
    const select = <T extends string>(label: string, options: [T, string][], value: T, set: (v: T) => void) => {
      const sel = h('select', { 'aria-label': label }) as HTMLSelectElement;
      for (const [v, l] of options) sel.append(h('option', { value: v }, l));
      sel.value = value;
      sel.addEventListener('change', () => set(sel.value as T));
      return h('label', { class: 'find-option' }, h('span', { class: 'label' }, label), sel);
    };
    const status = h('div', { class: 'find-status', 'aria-live': 'polite' });
    const act = (fn: () => unknown) => () => {
      status.textContent = '';
      if (!o.find) { find.focus(); return; }
      void Promise.resolve(fn()).catch((e) => toast(errorText(e)));
    };
    find.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); act(() => this.findNext())(); }
    });
    dialog.append(
      h('h2', {}, 'Find/Replace'),
      h('div', { class: 'find-fields' }, h('span', { class: 'label' }, 'Find what'), find, h('span', { class: 'label' }, 'Replace with'), replace),
      h('div', { class: 'find-options' },
        select('Direction', [['forward', 'Forward'], ['backward', 'Backward'], ['all', 'All']], o.direction, (v) => { o.direction = v; }),
        select('Search across', [['all', 'All records'], ['current', 'Current record']], o.currentRecord ? 'current' : 'all', (v) => { o.currentRecord = v === 'current'; }),
        select('Search within', [['all', 'All fields'], ['current', 'Current field']], o.currentField ? 'current' : 'all', (v) => { o.currentField = v === 'current'; })),
      h('div', { class: 'find-checks' }, check('Match case', 'matchCase'), check('Match whole words only', 'wholeWords')),
      status,
      h('div', { class: 'actions' },
        button('Replace All', act(() => this.replaceAll())),
        h('span', { class: 'spacer' }),
        button('Replace', act(() => this.replaceSelection() || this.notFound())),
        button('Replace & Find', act(() => this.replaceAndFind())),
        button('Find Next', act(() => this.findNext()), { class: 'primary' }),
      ),
      button('×', () => dialog.close(), { class: 'quiet find-close', 'aria-label': 'Close' }),
    );
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); dialog.close(); }
    });
    dialog.addEventListener('close', () => {
      this.findScan++;
      this.findReplaceDialog = undefined;
      returnFocus(opener, dialog);
      dialog.remove();
    });
    document.body.append(dialog);
    // Not modal: the matches it finds are selected in the layout behind it.
    dialog.show();
    find.select();
  }

  /** Replace & Find: replaces the selection if it's a match, then finds the next one (or, if it wasn't, the first). */
  private async replaceAndFind(): Promise<boolean> {
    this.replaceSelection();
    return this.findNext();
  }

  /** The zoom chosen with Zoom In / Zoom Out; undefined fits the layout to a narrow screen (and is 100% elsewhere). */
  private zoom?: number;

  /** The zoom the layout draws at: the chosen one, or on a screen narrower than the layout, enough to fit its width. */
  private effectiveZoom(): number {
    if (this.zoom !== undefined) return this.zoom;
    const room = this.content.clientWidth || innerWidth;
    const width = this.renderer?.width ?? 0;
    if (!width || this.preview || this.view === 'table' || innerWidth > 820 || room >= width) return 1;
    return Math.max(0.25, Math.floor((room / width) * 100) / 100);
  }

  /** Zoom In (+1) or Zoom Out (-1) through FileMaker's zoom levels; 0 goes back to 100%. */
  private setZoom(step: number): void {
    if (this.zoomLocked) return;
    const levels = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
    const now = this.effectiveZoom();
    if (step === 0) this.zoom = 1;
    else if (step > 0) this.zoom = levels.find((l) => l > now + 0.001) ?? levels[levels.length - 1];
    else this.zoom = [...levels].reverse().find((l) => l < now - 0.001) ?? levels[0];
    this.render();
  }

  private setView(v: View): void {
    const was = this.view;
    this.view = v;
    this.render();
    if (was !== v) this.writeScreenUrl();
    // OnViewChange: after the layout is shown in another view.
    if (was !== v) void this.fire('OnViewChange');
  }

  /** Runs a custom menu item's script. */
  private async menuScript(item: CustomMenuItem): Promise<void> {
    if ((!item.run && item.scriptId === undefined) || !this.meta) return;
    try {
      await this.runButton(undefined, undefined, undefined, item.scriptId !== undefined ? { scriptId: item.scriptId } : { menuItem: item.run, ...(this.menuSetId !== undefined ? { menuSet: this.menuSetId } : {}) });
    } catch (e) {
      toast(errorText(e));
    }
  }

  /**
   * The layout menu as FileMaker lists it: layouts and folders with "Include in
   * layout menus" unchecked are left out (a folder with all it holds), except the
   * layout showing, which the Layout pop-up still names.
   */
  private listedLayouts(): MenuItem[] {
    const out: MenuItem[] = [];
    let skipBelow = -1;
    for (const m of this.menuItems) {
      if (skipBelow >= 0 && m.depth > skipBelow) continue;
      skipBelow = -1;
      if (m.hidden && m.kind === 'folder') skipBelow = m.depth;
      else if (!m.hidden || m.name === this.meta?.layout.name) out.push(m);
    }
    return out;
  }

  /** Items of FileMaker's built-in submenus that the web client has. */
  /**
   * The text field and selection a Format menu command applies to: the field with the cursor, else the last one left
   * (opening the menu took the cursor), its key, and its formatting brought up to what is typed in it now.
   */
  private formatTarget(focus: boolean): { box: HTMLInputElement | HTMLTextAreaElement; key: string; start: number; end: number; runs: NonNullable<DataRecord['styles']>[string]; row?: { portal: string; data: PortalRow } } | undefined {
    const rec = this.record;
    const active = document.activeElement as HTMLElement | null;
    const last = this.lastInput;
    const box = focus ? this.insertTarget()
      : active?.matches('input.fm-input, textarea.fm-input') && this.content.contains(active) ? active as HTMLInputElement : last?.el.isConnected ? last.el : undefined;
    if (!box || !rec || this.mode !== 'browse' || box.readOnly) return undefined;
    // In a portal row it's the related record's text: its own fields only (not one from further along).
    const rowEl = box.closest<HTMLElement>('.fm-portal-row');
    const portal = rowEl?.dataset.portalName;
    const data = portal ? rec.portalData[portal]?.find((r) => r.recordId === rowEl!.dataset.row) : undefined;
    if (rowEl && !data) return undefined;
    const occurrence = portal ? this.meta?.portals.find((p) => p.name === portal)?.occurrence : undefined;
    const start = focus || box === active ? box.selectionStart ?? 0 : last!.start;
    const end = focus || box === active ? box.selectionEnd ?? 0 : last!.end;
    const { id, rep } = this.placeOf(box);
    const o = id !== undefined ? this.renderer?.objectById(Number(id)) : undefined;
    const key = o && this.renderer!.fieldKey(o, rep + 1);
    const meta = key ? this.renderer!.fieldType(key) : undefined;
    // A repetition keeps its own formatting ("Notes(2)"); a related field's other repetitions don't yet.
    if (!key || (key.includes('::') && /\(\d+\)$/.test(key)) || meta?.type !== 'text' || meta.calculated || meta.global) return undefined;
    if (data) {
      if (!key.startsWith(`${occurrence}::`)) return undefined;
      const kept = rec.portalStyles?.[portal!]?.[data.recordId]?.[key] ?? [];
      return { box, key, start, end, runs: editRuns(kept, String(data[key] ?? ''), box.value), row: { portal: portal!, data } };
    }
    // A related field outside a portal ("TO::Field"): the first related record keeps it, as FileMaker writes there.
    const runs = editRuns(rec.styles?.[key] ?? [], String(rec.fieldData[key] ?? ''), box.value);
    return { box, key, start, end, runs };
  }

  /** The formatting of the selected text, for the Format menu's checks; undefined when no text is selected. */
  private selectionFormat(): TextFormat | undefined {
    const t = this.formatTarget(false);
    return t && t.end > t.start ? formatAt(t.runs, t.start, t.end) : undefined;
  }

  /**
   * A Format menu command: changes the formatting of the selected text in a text field, kept with the data so
   * it shows in every layout, as FileMaker does. A style already on all of the selection comes off (`bits`).
   */
  private async formatText(change: (f: TextFormat) => TextFormat, bits?: number): Promise<void> {
    const t = this.formatTarget(true);
    if (!t) {
      toast('Select some text in a text field first.');
      return;
    }
    if (t.end <= t.start) {
      toast('Select the text to format first.');
      return;
    }
    const all = bits ? ((formatAt(t.runs, t.start, t.end).style ?? 0) & bits) === bits : false;
    // Plain takes every style off; a style on all of the selection comes off, else it goes on all of it.
    const apply = bits === undefined ? change : bits === 0 ? change : (f: TextFormat) => ({ ...f, style: all ? (f.style ?? 0) & ~bits : (f.style ?? 0) | bits });
    const runs = restyleRange(t.runs, t.box.value.length, t.start, t.end, apply);
    const rec = this.record!;
    const value = t.box.value;
    this.saving = this.saving.then(async () => {
      // The text as it was before this round of changes, for Revert Record (typing not yet saved is saved with the formatting).
      if (!this.scripting) {
        if (this.original?.recordId !== rec.recordId) this.original = { recordId: rec.recordId, fields: {}, rows: [] };
        if (!(t.key in this.original.fields)) this.original.fields[t.key] = rec.fieldData[t.key] ?? '';
      }
      try {
        if (t.row) {
          // A portal row: the related record keeps the formatting, as it would on its own layout.
          const { portal, data } = t.row;
          rec.modId = await this.api.update(this.meta!.layout.name, rec.recordId, {}, {
            portalData: { [portal]: [{ recordId: data.recordId, [t.key]: value }] },
            portalStyles: { [portal]: { [data.recordId]: { [t.key]: runs } } },
          });
          data[t.key] = value;
          const rows = ((rec.portalStyles ??= {})[portal] ??= {});
          rows[data.recordId] = { ...rows[data.recordId], [t.key]: runs };
          if (!runs.length) delete rows[data.recordId][t.key];
        } else {
          rec.modId = await this.api.update(this.meta!.layout.name, rec.recordId, { [t.key]: value }, { modId: rec.modId, styles: { [t.key]: runs } });
          rec.fieldData[t.key] = value;
          rec.styles = { ...rec.styles, [t.key]: runs };
          if (!runs.length) delete rec.styles[t.key];
        }
        if (!this.scripting) this.uncommitted = rec.recordId;
        if (t.box.isConnected) {
          t.box.setSelectionRange(t.start, t.end);
          previewStyled(t.box, runs);
        }
      } catch (e) {
        toast(`Couldn't format ${t.key}: ${errorText(e)}`);
        if (e instanceof ApiError && (e.code === 306 || e.code === 301)) await this.reload(rec.recordId);
      }
    });
  }

  private builtinMenu(name: string): { title: string; checked?: boolean; run: () => void }[] | undefined {
    if (name === '[Font]' || name === '[Size]' || name === '[Text Color]') {
      // Formatting is editing: a "Minimum" menu-command privilege leaves it out, as it does the Style commands.
      if (!this.commandAllowed('Plain')) return [];
      const now = this.selectionFormat();
      if (name === '[Font]') {
        return [{ title: 'Default', checked: !!now && now.font === undefined, run: () => void this.formatText((f) => ({ ...f, font: undefined })) },
          ...FORMAT_FONTS.map((font) => ({ title: font, checked: now?.font === font, run: () => void this.formatText((f) => ({ ...f, font })) }))];
      }
      if (name === '[Size]') {
        return [{ title: 'Default', checked: !!now && now.size === undefined, run: () => void this.formatText((f) => ({ ...f, size: undefined })) },
          ...FORMAT_SIZES.map((size) => ({ title: `${size} pt`, checked: now?.size === size, run: () => void this.formatText((f) => ({ ...f, size })) }))];
      }
      return [{ title: 'Default', checked: !!now && now.color === undefined, run: () => void this.formatText((f) => ({ ...f, color: undefined })) },
        ...FORMAT_COLORS.map(([title, color]) => ({ title, checked: now?.color === color, run: () => void this.formatText((f) => ({ ...f, color })) }))];
    }
    if (name === '[Offline Copy]') {
      const items: { title: string; checked?: boolean; run: () => void }[] = [{ title: 'Keep Offline Copy', checked: !!this.api.offline, run: () => void this.toggleOffline() }];
      if (this.api.waiting && !this.api.copyOnly) items.push({ title: `Send Waiting Changes (${this.api.waiting})`, run: () => void this.sendWaiting() });
      return items;
    }
    if (name === '[Windows]') {
      // Window > Show Window: this file's windows in this browser, by title; the one showing is checked.
      // Windows a script opened here come first; one behind a card or dialog can't come forward until it closes.
      if (this.behind.length) {
        const modal = this.frontWindow().style === 'card' || this.frontWindow().style === 'dialog';
        return [...this.behind.map((b) => b.win), this.frontWindow()].map((w) => ({
          title: w.name, checked: w.id === this.frontWindow().id, run: () => { if (!modal) this.selectWindow(w.id); },
        }));
      }
      return [...this.windows].sort((a, b) => a[1].title.localeCompare(b[1].title, undefined, { numeric: true })).map(([id, w]) => ({
        title: w.title, checked: id === this.windowId, run: () => this.showWindow(id),
      }));
    }
    if (name === '[Go to Layout]') {
      return this.listedLayouts().filter((m) => m.kind === 'item' && m.open).map((m) => ({
        title: m.name,
        checked: m.name === this.meta?.layout.name,
        run: () => void this.goToLayout(m.name).catch((e) => toast(errorText(e))),
      }));
    }
    if (name === '[Insert Operator]') {
      return FIND_OPERATORS.map(([op, meaning]) => ({ title: `${op}  ${meaning}`, run: () => this.insertOperator(op) }));
    }
    if (name === '[Saved Sorts]') {
      const sorts = this.sortStore();
      return [
        ...sorts.map((x) => ({ title: x.name, run: () => void this.runSavedSort(x).catch((e) => toast(errorText(e))) })),
        ...(this.sort?.length && this.mode === 'browse' ? [{ title: 'Save Current Sort…', run: () => this.saveCurrentSort() }] : []),
        ...(sorts.length ? [{ title: 'Edit Saved Sorts…', run: () => this.editSavedSorts() }] : []),
      ];
    }
    if (name === '[Saved Finds]') {
      const finds = this.findStore();
      const run = (f: SavedFind) => () => void this.runSavedFind(f).catch((e) => toast(errorText(e)));
      return [
        ...finds.saved.map((f) => ({ title: f.name, run: run(f) })),
        ...finds.recent.map((f) => ({ title: `Recent: ${f.name}`, run: run(f) })),
        ...(this.lastFind && this.mode === 'browse' ? [{ title: 'Save Current Find…', run: () => this.saveCurrentFind() }] : []),
        ...(finds.saved.length ? [{ title: 'Edit Saved Finds…', run: () => this.editSavedFinds() }] : []),
      ];
    }
    return undefined;
  }

  /**
   * Saved and recent finds, saved sorts and recent records: kept with the account on the server, so they follow it to
   * any browser (FileMaker keeps saved finds per user), with a copy in this browser for when the server can't be reached.
   */
  private prefs: { finds?: { saved: SavedFind[]; recent: SavedFind[] }; sorts?: SavedSort[]; recent?: RecentRecord[] } = {};

  private async loadPrefs(): Promise<void> {
    const local = <T>(key: string): T | undefined => {
      try {
        const v = localStorageGet(key);
        return v ? JSON.parse(v) as T : undefined;
      } catch {
        return undefined;
      }
    };
    this.prefs = {
      finds: local(this.findsKey()),
      sorts: local(this.prefKey('sorts')),
      recent: local(this.prefKey('recent')),
    };
    if (this.api.copyOnly) return;
    this.loadingPrefs = true;
    try {
      const kept = await this.api.prefs() as typeof this.prefs;
      this.serverPrefs = structuredClone(kept);
      for (const k of PREF_NAMES) {
        // Changed here while loading, or what this browser kept before they lived on the server: goes up.
        if (this.unsentPrefs.has(k) || (kept[k] === undefined && this.prefs[k] !== undefined)) this.unsentPrefs.add(k);
        else if (kept[k] !== undefined) (this.prefs as Record<string, unknown>)[k] = kept[k];
      }
    } catch {
      // An older server, or offline: this browser's copy.
    }
    this.loadingPrefs = false;
    this.sendPrefs();
  }

  private loadingPrefs = false;
  /** What the server held when this window last read or wrote it: the base for merging with other windows' changes. */
  private serverPrefs: Record<string, unknown> = {};
  private prefRetry?: ReturnType<typeof setTimeout>;
  /** Kept in this browser but not yet on the server (changed while loading or offline): sent when it can be. */
  private unsentPrefs = new Set<PrefName>();

  private savePref<K extends PrefName>(key: K, value: NonNullable<Session['prefs'][K]>): void {
    this.prefs[key] = value;
    localStorageSet(key === 'finds' ? this.findsKey() : this.prefKey(key), JSON.stringify(value));
    this.unsentPrefs.add(key);
    this.sendPrefs();
  }

  private sendPrefs(): void {
    if (this.loadingPrefs || this.api.copyOnly || this.api.isOffline) return;
    for (const key of [...this.unsentPrefs]) {
      this.unsentPrefs.delete(key);
      void this.sendPref(key);
    }
  }

  /**
   * Sends one pref after merging in what other windows (or browsers) put on the server since this one last looked, so
   * that saving a find here doesn't wipe a sort saved there. Nothing sent is retried until the connection or the next change.
   */
  private async sendPref(key: PrefName): Promise<void> {
    try {
      const server = (await this.api.prefs())[key];
      const merged = mergePrefs(key, server, this.serverPrefs[key], this.prefs[key]);
      (this.prefs as Record<string, unknown>)[key] = merged;
      localStorageSet(key === 'finds' ? this.findsKey() : this.prefKey(key), JSON.stringify(merged));
      await this.api.setPref(key, merged);
      this.serverPrefs[key] = structuredClone(merged);
    } catch {
      // Offline or the server is down: kept in this browser, and sent when the connection is back or on the next change (or in a moment).
      this.unsentPrefs.add(key);
      clearTimeout(this.prefRetry);
      this.prefRetry = setTimeout(() => this.sendPrefs(), 30_000);
    }
  }

  private prefKey(key: string): string {
    return `tabularius.${key}.${this.api.db}.${this.accountName}`;
  }

  private findStore(): { saved: SavedFind[]; recent: SavedFind[] } {
    const v = this.prefs.finds;
    return { saved: Array.isArray(v?.saved) ? [...v.saved] : [], recent: Array.isArray(v?.recent) ? [...v.recent] : [] };
  }

  private setFindStore(finds: { saved: SavedFind[]; recent: SavedFind[] }): void {
    this.savePref('finds', finds);
  }

  private sortStore(): SavedSort[] {
    return Array.isArray(this.prefs.sorts) ? [...this.prefs.sorts] : [];
  }

  /** Records > Saved Sorts > Save Current Sort: names the sort order and keeps it (beyond FileMaker). */
  private async saveCurrentSort(): Promise<void> {
    if (!this.sort?.length || !this.meta) return;
    const name = (await askText('Save Current Sort', 'Name', this.sort.map((x) => `${x.fieldName}${x.sortOrder === 'descend' ? ' ↓' : ''}`).join(', '), 'Save'))?.trim();
    if (!name || !this.meta) return;
    this.savePref('sorts', [...this.sortStore().filter((x) => x.name !== name), { name, layout: this.meta.layout.name, sort: this.sort.map((x) => ({ ...x })) }]);
    toast(`Saved the sort "${name}".`, 'info');
  }

  /** Sorts by a saved sort, on its own layout when this one isn't it and it's still open to the account. */
  private async runSavedSort(x: SavedSort): Promise<void> {
    if (this.meta?.layout.name !== x.layout) {
      if (!this.menuItems.some((m) => m.kind === 'item' && m.name === x.layout && m.open)) throw new Error(`The layout "${x.layout}" this sort was saved on isn't available.`);
      await this.goToLayout(x.layout);
      // Its fields are that layout's: not sorted when going there was refused.
      if (this.meta?.layout.name !== x.layout) return;
    }
    await this.sortRecords(x.sort);
  }

  /** The records last looked at, newest first, for Open Quickly. */
  private noteRecentRecord(): void {
    const rec = this.record;
    if (!rec || !this.meta || this.mode !== 'browse' || this.view !== 'form') return;
    const keys = this.renderer?.fieldKeys().filter((k) => !k.includes('::')) ?? [];
    const title = keys.map((k) => String(rec.fieldData[k] ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3)
      .map((v) => (v.length > 40 ? `${v.slice(0, 39)}…` : v)).join(' · ') || `Record ${rec.recordId}`;
    const entry: RecentRecord = { layout: this.meta.layout.name, recordId: rec.recordId, title };
    const kept = Array.isArray(this.prefs.recent) ? this.prefs.recent : [];
    const first = kept[0];
    if (first && first.layout === entry.layout && first.recordId === entry.recordId && first.title === entry.title) return;
    const recent = kept.filter((r) => !(r.layout === entry.layout && r.recordId === entry.recordId));
    clearTimeout(this.recentTimer);
    this.prefs.recent = [entry, ...recent].slice(0, 15);
    // Moving through records quickly writes once, when the person settles.
    this.recentTimer = setTimeout(() => this.savePref('recent', this.prefs.recent!), 2000);
  }

  private recentTimer?: ReturnType<typeof setTimeout>;

  /** Goes back to a recent record: in the found set when it's there, else on its own. */
  private async openRecentRecord(r: RecentRecord): Promise<void> {
    if (this.meta?.layout.name !== r.layout) await this.goToLayout(r.layout);
    // The record id is that layout's table's: nothing to show when going there was refused.
    if (this.meta?.layout.name !== r.layout) return;
    const at = [...this.cache].find(([, x]) => x.recordId === r.recordId)?.[0];
    if (at !== undefined) return this.goTo(at);
    if (!(await this.leaveMode())) return;
    this.ids = [Number(r.recordId)];
    this.query = undefined;
    this.index = 0;
    await this.reload();
  }

  private findsKey(): string {
    return `tabularius.finds.${this.api.db}.${this.accountName}`;
  }

  /** The words a find came from, when it is the one Find with AI filled in, unchanged. */
  private aiWords(requests: FindModeRequest[]): string | undefined {
    return this.aiFind && this.aiFind.requests === JSON.stringify(requests) ? this.aiFind.words : undefined;
  }

  /** A find just performed goes first in the recent finds (ten at most). */
  private noteRecentFind(requests: FindModeRequest[]): void {
    if (!this.meta) return;
    const find: SavedFind = { name: this.aiWords(requests) ?? findName(requests), layout: this.meta.layout.name, requests: requests.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit })) };
    const same = (f: SavedFind) => f.layout === find.layout && JSON.stringify(f.requests) === JSON.stringify(find.requests);
    const finds = this.findStore();
    finds.recent = [find, ...finds.recent.filter((f) => !same(f))].slice(0, 10);
    this.setFindStore(finds);
  }

  /** Find mode's Insert Operator: types the operator at the cursor ("" goes around the cursor). */
  private insertOperator(op: string): void {
    this.insertText(op);
    if (op === '""') {
      const box = document.activeElement as HTMLInputElement | null;
      if (box?.setSelectionRange && box.selectionStart) box.setSelectionRange(box.selectionStart - 1, box.selectionStart - 1);
    }
  }

  /**
   * The field context menu's Find Matching Records, Constrain Found Set and Extend
   * Found Set: records whose field holds exactly this record's value.
   */
  private async findMatching(key: string, value: string, how: 'find' | 'constrain' | 'extend'): Promise<void> {
    if (!(await this.commit())) return;
    // Portal fields are found as their related field.
    const field = key.replace(/\(\d+\)$/, '');
    const criteria = { [field]: matchingCriterion(value) };
    if (how !== 'find') {
      const previous = [this.query, this.ids, this.sort] as const;
      await this.runButton(undefined, undefined, undefined, { command: how === 'extend' ? 'Extend Found Set' : 'Constrain Found Set', requests: [{ criteria, omit: false }] });
      if (!this.foundCount) {
        [this.query, this.ids, this.sort] = previous;
        await this.reload();
        await this.noMatch([{ criteria, omit: false }]);
      }
      return;
    }
    this.lastFind = [{ criteria, omit: false }];
    const previous = [this.query, this.ids] as const;
    this.query = [criteria as FindRequest];
    this.ids = undefined;
    this.index = 0;
    await this.reload();
    if (!this.foundCount) {
      [this.query, this.ids] = previous;
      await this.reload();
      await this.noMatch(this.lastFind);
      return;
    }
    this.noteRecentFind(this.lastFind);
  }

  /**
   * FileMaker's alert when a find matched nothing, after the found set from before is back: Modify Find goes to Find
   * mode with these requests, Cancel stays in Browse mode.
   */
  private async noMatch(requests: FindModeRequest[]): Promise<void> {
    if ((await noMatchDialog()) !== 'modify') return;
    this.lastFind = requests.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit }));
    await this.enterFind(true);
  }

  /** A field's context menu in Browse mode, as FileMaker's: find, constrain or extend by its value, or sort by it. */
  private fieldMenu(e: MouseEvent): void {
    if (this.mode !== 'browse' || this.preview || !this.renderer) return;
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('.fm-field[data-id], [data-id]');
    const o = el && this.renderer.objectById(Number(el.dataset.id));
    const key = o?.kind === 'field' ? this.renderer.fieldKey(o) : undefined;
    if (!key) return;
    // The value shown in this row: the box's raw value, else the record's.
    const box = target.closest<HTMLElement>('[data-id]')?.querySelector<HTMLInputElement>('input.fm-input, textarea.fm-input, select');
    const rec = this.recordAt(target);
    const inPortal = !!target.closest('.fm-portal-row');
    const raw = (inPortal ? undefined : rec?.fieldData[key.replace(/\(\d+\)$/, '')]) ?? box?.value ?? '';
    const value = String(raw).replace(/\n/g, '\r');
    // A selection inside the field keeps the browser's own menu (copy, spelling).
    if (box && 'selectionStart' in box && box.selectionStart !== box.selectionEnd && document.activeElement === box) return;
    e.preventDefault();
    if (rec && rec !== this.record) {
      const row = target.closest<HTMLElement>('[data-index]');
      if (row) this.selectIndex(Number(row.dataset.index));
    }
    document.querySelector('.field-menu')?.remove();
    const menu = h('ul', { class: 'menu field-menu', role: 'menu', 'aria-label': key.replace(/\(\d+\)$/, '') });
    // Where the keyboard was, so closing the menu gives it back.
    const before = document.activeElement as HTMLElement | null;
    const item = (label: string, run: () => unknown, enabled = true) => {
      const li = h('li', { role: 'menuitem', ...(enabled ? { tabindex: '-1' } : { class: 'disabled', 'aria-disabled': 'true' }) }, h('span', { class: 'label' }, label));
      if (enabled) {
        const go = () => {
          close();
          void Promise.resolve(run()).catch((err) => toast(errorText(err)));
        };
        li.addEventListener('click', go);
        li.addEventListener('keydown', (k) => {
          if (k.key === 'Enter' || k.key === ' ') {
            k.preventDefault();
            go();
          }
        });
      }
      menu.append(li);
    };
    const sep = () => menu.append(h('li', { class: 'separator', role: 'separator' }));
    const close = (restoreFocus = true) => {
      const focusWasIn = menu.contains(document.activeElement);
      menu.remove();
      document.removeEventListener('mousedown', outside, true);
      if (restoreFocus && focusWasIn) (before?.isConnected ? before : this.content).focus?.();
    };
    const outside = (m: Event) => {
      if (!menu.contains(m.target as Node)) close(false);
    };
    const finds = this.hasCommand('Find Mode');
    item('Find Matching Records', () => this.findMatching(key, value, 'find'), finds);
    item('Constrain Found Set', () => this.findMatching(key, value, 'constrain'), finds && this.hasCommand('Constrain Found Set'));
    item('Extend Found Set', () => this.findMatching(key, value, 'extend'), finds && this.hasCommand('Extend Found Set'));
    sep();
    const sorts = this.hasCommand('Sort Records');
    item('Sort Ascending', () => this.sortRecords([{ fieldName: key.replace(/\(\d+\)$/, ''), sortOrder: 'ascend' }]), sorts);
    item('Sort Descending', () => this.sortRecords([{ fieldName: key.replace(/\(\d+\)$/, ''), sortOrder: 'descend' }]), sorts);
    // Beyond FileMaker: the assistant works out why the field shows what it does (its formula and every value it
    // read, or the relationship a related field follows). Only offered where the assistant is (not with AI off for the file).
    if (this.assistant) {
      sep();
      const shown = value.length > 120 ? `${value.slice(0, 120)}…` : value;
      item('Explain This Value', () => {
        this.focusedField = key;
        return this.assistant!.askAbout(inPortal
        ? `Why does ${key} show ${shown ? `"${shown}"` : 'nothing'} in this portal row?`
          : `Why does ${key} show ${shown ? `"${shown}"` : 'nothing'} on this record?`);
      });
      // The whole record: every calculation and validated field checked, traced back to where the trouble starts.
      item('Why Does This Record Look Wrong?', () => this.assistant!.askAbout('Why does this record look wrong? Check every calculation and validated field on it, and trace each problem back to where it starts.'));
    } else if (this.meta?.canSeeDesign && rec && !this.api.isOffline && !this.api.copyOnly) {
      // With AI off, the same question answered by the server's own trace: the formula and what it read, or the relationship.
      const rowEl = target.closest<HTMLElement>('.fm-portal-row');
      if (!inPortal || rowEl?.dataset.row) {
        sep();
        const layout = this.meta.layout.name;
        item('Explain This Value', async () => {
          const trace = await this.api.explain(layout, { recordId: rec.recordId, field: key, ...(rowEl?.dataset.row ? { portal: rowEl.dataset.portalName, row: rowEl.dataset.row } : {}) });
          showExplanation(`Why ${key.replace(/\(\d+\)$/, '')} shows ${value ? `“${value.length > 40 ? `${value.slice(0, 39)}…` : value}”` : 'nothing'}`, trace);
        });
      }
    }
    document.body.append(menu);
    menu.style.left = `${Math.min(e.clientX, innerWidth - menu.offsetWidth - 4)}px`;
    menu.style.top = `${Math.min(e.clientY, innerHeight - menu.offsetHeight - 4)}px`;
    document.addEventListener('mousedown', outside, true);
    // The keyboard works the menu as it does the container menu: arrows move, Enter runs, Escape (or Tab) closes
    // and gives the keyboard back to where it was.
    menu.addEventListener('keydown', (k) => {
      const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled])')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (k.key === 'Escape' || k.key === 'Tab') {
        k.preventDefault();
        close();
      } else if (k.key === 'ArrowDown' || k.key === 'ArrowUp') {
        k.preventDefault();
        items[(at + (k.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      } else if (k.key === 'Home' || k.key === 'End') {
        k.preventDefault();
        items[k.key === 'Home' ? 0 : items.length - 1]?.focus();
      }
    });
    menu.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled])')?.focus();
  }

  /** Performs a saved or recent find, on the layout it was made on. */
  private async runSavedFind(f: SavedFind): Promise<void> {
    if (this.meta?.layout.name !== f.layout && this.menuItems.some((m) => m.kind === 'item' && m.name === f.layout && m.open)) await this.goToLayout(f.layout);
    if (!(await this.leaveMode())) return;
    this.mode = 'find';
    this.requests = f.requests.map((r) => ({ criteria: { ...r.criteria }, omit: !!r.omit }));
    this.request = 0;
    await this.performFind();
  }

  /** Records > Saved Finds > Save Current Find: names the last find and keeps it. */
  private async saveCurrentFind(): Promise<void> {
    if (!this.lastFind || !this.meta) return;
    const name = (await askText('Save Current Find', 'Name', this.aiWords(this.lastFind) ?? findName(this.lastFind), 'Save'))?.trim();
    if (!name || !this.lastFind || !this.meta) return;
    const finds = this.findStore();
    finds.saved = [...finds.saved.filter((f) => f.name !== name), { name, layout: this.meta.layout.name, requests: this.lastFind.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit })) }];
    this.setFindStore(finds);
    toast(`Saved the find "${name}".`, 'info');
  }

  /** Records > Saved Finds > Edit Saved Finds: rename or delete them. */
  private editSavedFinds(): void {
    this.editSavedList('Edit Saved Finds', 'No saved finds.', () => this.findStore().saved, (saved) => this.setFindStore({ ...this.findStore(), saved }));
  }

  /** Records > Saved Sorts > Edit Saved Sorts: rename or delete them. */
  private editSavedSorts(): void {
    this.editSavedList('Edit Saved Sorts', 'No saved sorts.', () => this.sortStore(), (sorts) => this.savePref('sorts', sorts));
  }

  private editSavedList<T extends { name: string; layout: string }>(title: string, none: string, get: () => T[], set: (items: T[]) => void): void {
    const dialog = h('dialog', { class: 'replace-dialog saved-finds-dialog', 'aria-label': title }) as HTMLDialogElement;
    const list = h('ul', { class: 'saved-finds' });
    const draw = () => {
      const items = get();
      list.replaceChildren(...items.map((f, i) => h('li', {},
        h('span', { class: 'name' }, f.name),
        h('span', { class: 'where' }, f.layout),
        button('Rename', () => {
          void askText('Rename', 'New name', f.name, 'Rename').then((answer) => {
            const name = answer?.trim();
            if (!name) return;
            items[i] = { ...f, name };
            set(items);
            draw();
          });
        }),
        button('Delete', () => {
          items.splice(i, 1);
          set(items);
          draw();
        }),
      )));
      if (!items.length) list.append(h('li', {}, none));
    };
    draw();
    dialog.append(h('h2', {}, title), list, h('div', { class: 'actions' }, h('span', { class: 'spacer' }), button('Done', () => dialog.close(), { class: 'primary' })));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  /** Whether the file has an OnLastWindowClose script to run on logging out. */
  private onLastWindowClose = false;

  /** Whether the file has an OnWindowClose script to run when a window is closed from the menu or File > Close. */
  private onWindowClose = false;

  /**
   * Runs one of the file's own triggers (File Options). The result is false when the script exited with False, which
   * only OnWindowClose honours: the window then stays open (Claris: a trigger that runs before its event can cancel it).
   */
  private async fileTrigger(event: 'OnFirstWindowOpen' | 'OnLastWindowClose' | 'OnWindowOpen' | 'OnWindowClose'): Promise<boolean> {
    try {
      const r = await this.runButton(undefined, undefined, event);
      return !(event === 'OnWindowClose' && r && r.result.trim() !== '' && Number(r.result) === 0);
    } catch (e) {
      toast(errorText(e));
      return true;
    }
  }

  /** OnWindowClose, before the window closes; false when its script keeps the window open. Only a window closed by File > Close, Close Window or logging out runs it: a browser tab closed by its own button cannot wait for a script. */
  private async windowCloseAllowed(): Promise<boolean> {
    return !(this.onWindowClose && this.meta && !this.api.copyOnly) || (await this.fileTrigger('OnWindowClose'));
  }

  // ---------------------------------------------------------- data

  // ---------------------------------------------------------- macro recorder

  /** What has been done since Record Script was clicked; undefined when not recording. */
  private recording?: MacroAction[];

  /** The record (its place in the found set) the recorded script is on at this point; undefined when not known. */
  private recordedAt?: number;

  /** Notes something done by hand (not by a script) while recording. */
  private note(a: MacroAction): void {
    if (!this.recording || this.scripting) return;
    this.recording.push(a);
    // Where the script will be: finds start on the first record, a new record is current, the rest can't be told here.
    this.recordedAt = a.kind === 'find' || a.kind === 'showAll' || a.kind === 'quickFind' ? 0 : a.kind === 'new' ? this.index
      : a.kind === 'set' || a.kind === 'skipped' ? this.recordedAt : undefined;
    // The button's count, without redrawing the toolbar (which would clear Quick Find while someone types in it).
    const b = document.querySelector<HTMLButtonElement>('.toolbar button.recording');
    if (b) b.textContent = `Stop recording (${this.recording.filter((x) => x.kind !== 'layout').length})`;
  }

  /** Before an edit, a delete or a button's script while recording: a Go to Record when the script would be on another record. */
  private noteRecord(index: number): void {
    if (!this.recording || this.scripting || this.recordedAt === index) return;
    const was = this.recordedAt;
    this.note({ kind: 'go', to: index === 0 ? 'first' : was !== undefined && index === was + 1 ? 'next' : was !== undefined && index === was - 1 ? 'previous' : index + 1 });
    this.recordedAt = index;
  }

  /** Record Script: starts recording, or stops and offers the recorded steps as a script, with a Dry run first. */
  private async toggleRecording(): Promise<void> {
    if (!this.recording) {
      if (!(await this.commit())) return;
      this.recording = [];
      this.recordedAt = undefined;
      // It starts from where the window is: the layout, the find and the sort.
      if (this.meta) {
        const occurrence = this.meta.layout.occurrence;
        this.recording.push({ kind: 'layout', layout: this.meta.layout.name });
        if (this.ids) this.recording.push({ kind: 'skipped', what: 'the found set you started on (a script made it), so the script starts from the layout\'s records' });
        else if (this.query?.length) this.recording.push({ kind: 'find', occurrence, requests: this.query });
        if (this.sort) this.recording.push({ kind: 'sort', occurrence, sort: this.sort });
      }
      toast('Recording. Go to layouts, find, sort, make records and type into fields; click Stop recording when done.', 'info');
      this.renderToolbar();
      return;
    }
    // Taken first, so a second click on Stop finds nothing to stop.
    const actions = this.recording;
    this.recording = undefined;
    await this.commit();
    this.renderToolbar();
    if (!actions.some((a) => a.kind !== 'layout')) {
      toast('Nothing was recorded.', 'info');
      return;
    }
    const design = async (path: string, body: unknown) => {
      const r = await fetch(`/tabularius/design/v1/databases/${encodeURIComponent(this.api.db)}${path}`, {
        method: 'POST', headers: { authorization: `Bearer ${this.api.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const got = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(got.error?.code ?? -1, got.error?.message ?? httpProblem(r.status));
      return got;
    };
    await macroDialog(macroScript(actions), {
      dryRun: (text) => design('/scripts/dry-run', { text }) as Promise<ScriptDryRun>,
      save: async (name, text) => !!(await this.applyDesign([{ op: 'createScript', name, text }], `Saved the script ${name}`)),
    });
  }

  async goToLayout(name: string): Promise<void> {
    if (!(await this.commit())) return;
    // OnLayoutExit can keep the person on this layout.
    if (!(await this.fire('OnLayoutExit'))) return;
    const meta = await this.api.layout(name);
    this.closePopover();
    this.clearDisplay();
    this.meta = meta;
    showScriptNetwork(meta);
    this.layoutMenuSet();
    this.renderer = new LayoutRenderer(meta, SCOPE);
    this.focusedField = undefined;
    sessionStorageSet(`tabularius.layout.${this.api.db}`, name);
    // Layouts on the same table keep the found set; others start with all records.
    const sameTable = this.meta && this.cache.size && this.lastTable === meta.layout.table;
    this.lastTable = meta.layout.table;
    if (!sameTable) {
      this.query = undefined;
      this.sort = undefined;
      this.ids = undefined;
      this.index = 0;
    }
    const recordId = sameTable ? this.record?.recordId : undefined;
    this.mode = 'browse';
    this.popover = undefined;
    this.view = this.defaultView();
    await this.reload(recordId);
    this.note({ kind: 'layout', layout: name });
    await this.loadMenus();
    await this.fire('OnLayoutEnter');
    await this.fire('OnRecordLoad');
    this.writeScreenUrl();
  }

  private lastTable?: string;

  /** What the renderer was last fitted from: the layout's design, the window it suits, and the design it draws. */
  private fitted?: { design: LayoutDesign; key: string; shown: LayoutDesign };

  /**
   * Responsive layouts: a narrow window gets the layout stacked in one column
   * (below the layout's breakpoint) and without objects hidden at that width.
   * Preview mode prints the layout as designed.
   */
  private fitLayout(): void {
    if (!this.meta || !this.renderer) return;
    const d = this.meta.design;
    const width = Math.floor(this.content.clientWidth || innerWidth);
    // A card, floating window or dialog is sized to its layout, so the server's default stacking leaves it alone;
    // a layout's own breakpoint still applies.
    const overlay = this.behind.length > 0 && this.frontWindow().style !== 'document';
    const fallback = overlay ? 0 : this.meta.stackBelowDefault ?? 0;
    const shown = this.preview ? d : responsiveDesign(d, width, fallback);
    if (shown === d && this.renderer.meta.design === d) return;
    const below = stackBreakpoint(d, fallback);
    const stacked = below > 0 && width < below;
    const key = shown === d ? '' : `${stacked ? width : 0}:${shown.objects.map((o) => o.id).join(',')}`;
    if (this.fitted?.design === d && this.fitted.key === key && this.renderer.meta.design === this.fitted.shown) return;
    this.renderer = new LayoutRenderer(shown === d ? this.meta : { ...this.meta, design: shown }, SCOPE);
    this.fitted = { design: d, key, shown: this.renderer.meta.design };
  }

  /** Layout Setup's views allowed: all three unless the layout limits them. */
  private allows(v: View): boolean {
    const allowed = this.meta?.design.viewsAllowed;
    return !allowed || allowed.includes(v);
  }

  private defaultView(): View {
    const v = this.savedView();
    return this.allows(v) ? v : this.meta!.design.viewsAllowed![0];
  }

  private savedView(): View {
    // The view FileMaker saved with the layout, when the file says.
    if (this.meta?.design.view) return this.meta.design.view;
    const body = this.renderer?.part('body');
    // A layout with no objects but table view columns is used as a table.
    if (!this.meta?.design.objects.length && this.meta?.design.tableView?.length) return 'table';
    if (!body) return 'form';
    // Layouts made in Tabularius have no saved view. Summary parts only make
    // sense in a list, and a short body under a header is a list row.
    // The script engine's ownView makes the same choice: keep the two alike.
    const kinds = new Set(this.renderer!.parts.map((p) => p.kind));
    if (['leading-grand-summary', 'trailing-grand-summary', 'sub-summary-leading', 'sub-summary-trailing'].some((k) => kinds.has(k as never))) return 'list';
    return body.height < 150 && (kinds.has('header') || kinds.has('top-navigation')) ? 'list' : 'form';
  }

  /** Re-runs the found set's query, keeping the current record when it is still found. */
  async reload(keepRecordId?: string): Promise<void> {
    const previousFoundCount = this.foundCount;
    this.displayGeneration++;
    this.groupsGeneration++;
    this.cache.clear();
    this.foundRowsAsked++;
    this.conflicts.clear();
    this.states.clear();
    this.groups = undefined;
    this.findState = undefined;
    this.emptyState = undefined;
    await this.fetch(Math.max(0, this.index - (this.index % PAGE)));
    if (keepRecordId) {
      let at = [...this.cache].find(([, r]) => r.recordId === keepRecordId)?.[0];
      // A sort can move the record to a page not loaded yet: ask where it is now, so the window stays on it.
      if (at === undefined && this.foundCount > PAGE) {
        const index = await this.api.position(this.meta!.layout.name, { recordId: keepRecordId, ids: this.ids, query: this.query, sort: this.sort }).catch(() => -1);
        if (index >= 0) {
          if (!this.cache.has(index)) await this.fetch(index);
          at = index;
        }
      }
      if (at !== undefined) this.index = at;
    }
    this.index = Math.min(this.index, Math.max(0, this.foundCount - 1));
    if (!this.cache.has(this.index) && this.foundCount) await this.fetch(this.index);
    await this.loadStates();
    this.render();
    if (this.foundCount !== previousFoundCount) announce(`Found ${this.foundCount} record${this.foundCount === 1 ? '' : 's'}.`);
  }

  /**
   * Fetches records again shortly when some of their values are from just
   * before the latest change (shown faded) while the server works them out:
   * every few seconds, ten times at most, a page at a time, and only while the
   * same layout is showing.
   */
  private recheckUpdating(records: DataRecord[]): void {
    const due: string[] = [];
    for (const r of records) {
      if (!r.updating?.length) this.updatingTries.delete(r.recordId);
      else if ((this.updatingTries.get(r.recordId) ?? 0) < 10) due.push(r.recordId);
    }
    if (!due.length) return;
    for (const id of due) this.updatingTries.set(id, (this.updatingTries.get(id) ?? 0) + 1);
    const meta = this.meta;
    setTimeout(() => {
      if (this.meta !== meta) return;
      for (const at of pagesHolding(this.cache, due, PAGE)) this.pendingPages.add(at);
      if (this.pendingPages.size) void this.flush();
    }, 3000);
  }

  /** Fetches the page holding `at`. */
  private async fetch(at: number): Promise<void> {
    const start = at - (at % PAGE);
    this.loading++;
    const generation = this.displayGeneration;
    try {
      const layout = this.meta!.layout.name;
      const page = this.ids
        ? await this.api.recordsById(layout, this.ids, start + 1, PAGE, this.sort)
        : await this.api.records(layout, { offset: start + 1, limit: PAGE, query: this.query, sort: this.sort });
      if (generation !== this.displayGeneration) return;
      page.data.forEach((r, i) => this.cache.set(start + i, r));
      this.recheckUpdating(page.data);
      this.foundCount = page.foundCount;
      if (page.totalCount >= 0) this.totalCount = page.totalCount;
    } finally {
      this.loading--;
    }
  }

  async goTo(index: number): Promise<void> {
    if (!this.foundCount) return;
    if (!(await this.commit())) return;
    const before = this.index;
    this.displayGeneration++;
    this.index = Math.max(0, Math.min(this.foundCount - 1, index));
    if (!this.cache.has(this.index)) await this.fetch(this.index);
    this.popover = undefined;
    await this.loadStates();
    if (this.view === 'form') this.render();
    else this.select();
    if (this.index !== before) announce(`Record ${this.recordNumber} of ${this.foundCount}.`);
    if (this.index !== before) await this.fire('OnRecordLoad');
    this.writeScreenUrl();
  }

  /** Records drawn with layout objects right now: the current one, or a list's page. */
  private shown(): { id: string; number: number }[] {
    if (this.mode === 'find' || (this.view === 'table' && !this.preview)) return [];
    const win = this.view === 'list' && !this.preview ? this.rowWindow() : undefined;
    const from = this.preview ? 0 : win ? win.from : this.view === 'list' ? this.index - (this.index % PAGE) : this.index;
    const to = this.preview ? Math.min(this.foundCount, PREVIEW_MAX) : win ? win.to : this.view === 'list' ? Math.min(this.foundCount, from + PAGE) : Math.min(this.foundCount, from + 1);
    const out: { id: string; number: number }[] = [];
    for (let i = from; i < to; i++) {
      const r = this.cache.get(i);
      if (r && !this.states.has(r.recordId)) out.push({ id: r.recordId, number: i + 1 });
    }
    return out;
  }

  /** Works out hide conditions, tooltips and placeholders for what is about to be drawn. */
  async loadStates(): Promise<void> {
    if (!this.meta || !this.hasFormulas()) return;
    const generation = this.displayGeneration;
    const meta = this.meta;
    const current = () => generation === this.displayGeneration && meta === this.meta;
    const body = { mode: this.windowMode, view: this.view, foundCount: this.foundCount, totalCount: this.totalCount };
    try {
      if (this.mode === 'find') {
        if (!this.findState) {
          const state = await this.api.view(meta.layout.name, body);
          if (current()) this.findState = state.find;
        }
        return;
      }
      if (!this.foundCount) {
        if (!this.emptyState) {
          const state = await this.api.view(meta.layout.name, body);
          if (current()) this.emptyState = state.find;
        }
        return;
      }
      const records = this.shown();
      if (!records.length) return;
      try {
        const r = await this.api.view(meta.layout.name, { ...body, records });
        if (!current()) return;
        for (const [id, v] of Object.entries(r.records ?? {})) this.states.set(id, v);
      } finally {
        // Not asked again for these records, even when the server couldn't work them out.
        for (const { id } of records) if (current() && !this.states.has(id)) this.states.set(id, { hidden: [], tooltips: {}, placeholders: {} });
      }
      if (this.hasCharts()) {
        const charts = await this.api.charts(this.meta.layout.name, { ...body, records: records.map((r) => r.id), query: this.query, sort: this.sort, ids: this.ids });
        if (!current()) return;
        for (const [id, c] of Object.entries(charts)) {
          const state = this.states.get(id);
          if (state) state.charts = c;
        }
      }
    } catch (e) {
      // Drawn without them, every object shows: better than no layout.
      console.warn('Layout formulas failed', e);
    }
  }

  private hasFormulas(): boolean {
    const any = (objs: LayoutObject[]): boolean => objs.some((o) => o.hide || o.tooltip || o.placeholder || o.conditions || o.label !== undefined || o.activeSegmentFormula || o.webUrl || o.chart || /<<[^<>]+>>/.test(o.text ?? '') || (o.children && any(o.children)));
    return !!this.meta!.recordValueLists?.length || any(this.meta!.design.objects);
  }

  private hasCharts(): boolean {
    const any = (objs: LayoutObject[]): boolean => objs.some((o) => o.chart || (o.children && !o.portal && any(o.children)));
    return any(this.meta!.design.objects);
  }

  /**
   * Blurs the focused field so its change event saves it, then fires the
   * layout's OnRecordCommit when the record was changed. False when that
   * trigger's script returns False: the person stays on the record (its
   * fields are already saved, since the web client saves each field as it is left).
   *
   * When the layout has "Save record changes automatically" unchecked, leaving a
   * changed record asks first, as FileMaker does: Don't Save reverts it and Cancel
   * stays. `ask` is false for an explicit save (Enter, a Commit Records button, a
   * button's script), which FileMaker doesn't ask about.
   */
  async commit(ask = true): Promise<boolean> {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && this.content.contains(el)) el.blur();
    await this.saving;
    if (this.scripting) return true;
    if (ask && this.uncommitted !== undefined && this.meta?.design.saveRecordChanges === false && this.uncommitted === this.record?.recordId) {
      const r = await customDialog({ run: '', step: 'Save changes', message: 'Save changes to this record?', buttons: ['Save', 'Don\'t Save', 'Cancel'] });
      if (!r || r.button === 3) return false;
      if (r.button === 2) {
        await this.revertRecord(false);
        return true;
      }
    }
    if (this.uncommitted !== undefined && !(await this.fire('OnRecordCommit'))) return false;
    const made = this.created && (await this.commitNew(this.created));
    if (made === 'stay') return false;
    const committed = this.uncommitted;
    this.uncommitted = this.original = undefined;
    // Offline: checked once the connection is back.
    if (made !== 'later') this.created = undefined;
    // As in FileMaker, a portal's filter and sort apply again once the record is committed: a row edited out of the filter goes.
    const rec = this.record;
    if (committed !== undefined && rec?.recordId === committed && this.meta?.portals.some((p) => p.filter || p.sort?.length)) {
      try {
        freshen(rec, await this.api.record(this.meta.layout.name, rec.recordId));
        this.render();
      } catch {
        // Offline, or the record went: the rows stay as they were drawn.
      }
    }
    return true;
  }

  /**
   * A record made with New Record is committed: its fields that must have a value are checked now, as FileMaker
   * checks them, not when it was made empty. When a check fails the person is told why and stays on the record
   * to fix it (false), or reverts it, which takes the record away.
   */
  private async commitNew(made: { id: string; layout: string }): Promise<'done' | 'stay' | 'later'> {
    if (this.api.isOffline || this.api.copyOnly) return 'later';
    try {
      const modId = await this.api.commitNew(made.layout, made.id);
      for (const rec of this.cache.values()) if (rec.recordId === made.id && this.meta?.layout.name === made.layout) rec.modId = modId;
      return 'done';
    } catch (e) {
      // Deleted meanwhile: nothing to commit.
      if (e instanceof ApiError && e.code === 101) return 'done';
      if (!(e instanceof ApiError) || e.code < 500 || e.code > 509) {
        // Not a check that failed (no access to edit it, say): said, and the record stays as it is.
        toast(`Couldn't commit the new record: ${errorText(e)}`);
        return 'done';
      }
      const r = await customDialog({ run: '', step: 'Commit', message: errorText(e), buttons: ['OK', 'Revert Record'] });
      if (r?.button !== 2) return 'stay';
      const here = this.meta?.layout.name === made.layout && this.record?.recordId === made.id;
      if (here) await this.revertRecord(false);
      else {
        // Left behind on another record or layout: it goes away all the same.
        try { await this.api.remove(made.layout, made.id); } catch { /* already gone */ }
        this.created = undefined;
        await this.reload();
      }
      return 'done';
    }
  }

  /** The record whose fields were saved since it was last committed (for OnRecordCommit). */
  private uncommitted?: string;
  /**
   * What the uncommitted record's changed fields held before they were changed, for
   * Revert Record: the web client saves each field as it's left, so reverting writes these back.
   */
  /** made: related records typed into portals' empty rows, which Revert Record deletes. */
  private original?: { recordId: string; fields: Record<string, Value>; rows: { portal: string; recordId: string; key: string; value: Value }[]; made?: { portal: string; recordId: string }[] };
  /** A record made with New Record and not committed yet: reverting it deletes it, as in FileMaker. */
  private created?: { id: string; layout: string };
  /** True while an input method is composing text in a field, so a redraw doesn't cut it off. */
  private composing = false;
  /** Set while reverting, so the field being left isn't saved. */
  private reverting = false;

  /** Records > Revert Record: puts the record back as it was before this round of changes. */
  /** Records > Record History: who changed this record, when and from where, with a button to put each change back. */
  private openRecordHistory(): void {
    const rec = this.record;
    if (!rec || !this.meta) return;
    const layout = this.meta.layout.name;
    const id = rec.recordId;
    showRecordHistory(`History of record ${id}`, () => this.api.recordHistory(layout, id), {
      revert: (seq, fields) => this.api.revertChange(layout, id, seq, fields),
      changed: () => void this.refreshWindow(),
    });
  }

  async revertRecord(ask = true): Promise<void> {
    const rec = this.record;
    if (!rec || !this.meta) return;
    if (ask && !(await askConfirm('Revert Record', 'Revert record to the last saved version?', 'Revert'))) return;
    if (!(await this.fire('OnRecordRevert'))) return;
    this.reverting = true;
    for (const k of [...this.conflicts.keys()]) if (k.startsWith(`${rec.recordId}\0`)) this.conflicts.delete(k);
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && this.content.contains(el)) el.blur();
    this.reverting = false;
    await this.saving;
    const layout = this.meta.layout.name;
    const orig = this.original?.recordId === rec.recordId ? this.original : undefined;
    try {
      // Related records added from portals' empty rows go away.
      if (orig?.made?.length) await this.api.update(layout, rec.recordId, {}, { deleteRelated: orig.made.map((m) => `${m.portal}.${m.recordId}`) });
      if (this.created?.id === rec.recordId && this.created.layout === layout) {
        // A new record that was never committed goes away.
        await this.api.remove(layout, rec.recordId);
        this.created = this.uncommitted = this.original = undefined;
        this.totalCount--;
        if (this.ids) this.ids = this.ids.filter((x) => String(x) !== rec.recordId);
        await this.reload();
        return;
      }
      if (orig) {
        const portalData: Record<string, Record<string, Value>[]> = {};
        for (const r of orig.rows) {
          if (orig.made?.some((m) => m.portal === r.portal && m.recordId === r.recordId)) continue;
          const rows = (portalData[r.portal] ??= []);
          let row = rows.find((x) => x.recordId === r.recordId);
          if (!row) rows.push(row = { recordId: r.recordId });
          row[r.key] = r.value;
        }
        await this.api.update(layout, rec.recordId, orig.fields, Object.keys(portalData).length ? { portalData: portalData as Record<string, Partial<PortalRow>[]> } : { modId: rec.modId });
      }
      this.uncommitted = this.original = undefined;
      await this.reload(rec.recordId);
    } catch (e) {
      toast(`Couldn't revert the record: ${errorText(e)}`);
    }
  }

  private saving: Promise<void> = Promise.resolve();

  save(key: string, value: string, row?: RowContext): void {
    if (this.reverting) return;
    const rec = this.recordFor(row);
    if (!rec || !this.meta) return;
    if (this.refused.delete(rec.recordId)) return;
    const layout = this.meta.layout.name;
    const occurrence = this.meta.layout.occurrence;
    const pending = `${rec.recordId}\0${key}`;
    const handed = value;
    if (!row) this.unsaved.set(pending, handed);
    const run = async () => {
      // Set when the person combined their typing with another user's change: the field shows what was saved.
      let combined = false;
      // The first value each field had in this round of changes, for Revert Record.
      if (!this.scripting) {
        if (this.original?.recordId !== rec.recordId) this.original = { recordId: rec.recordId, fields: {}, rows: [] };
        const orig = this.original;
        if (row) {
          if (row.row.recordId && !orig.rows.some((r) => r.portal === row.portal && r.recordId === row.row.recordId && r.key === key)) orig.rows.push({ portal: row.portal, recordId: row.row.recordId, key, value: row.row[key] ?? '' });
        } else if (!(key in orig.fields)) {
          orig.fields[key] = rec.fieldData[key] ?? '';
        }
      }
      try {
        if (row && !row.row.recordId) {
          // The portal's empty last row: a new related record, its match fields filled in from this one.
          if (value === '') return;
          const made = await this.api.addRelated(layout, rec.recordId, row.portal, { [key]: value });
          rec.modId = made.modId;
          if (!made.recordId) throw new Error('the related record was not created');
          // The row is that record now: the rest of what's typed in it goes there too.
          row.row.recordId = made.recordId;
          row.row.modId = made.relatedModId ?? '';
          row.row[key] = value;
          if (!this.scripting) (this.original!.made ??= []).push({ portal: row.portal, recordId: made.recordId });
          const rowEl = document.activeElement?.closest<HTMLElement>('.fm-portal-new');
          if (rowEl) {
            rowEl.classList.remove('fm-portal-new');
            rowEl.dataset.row = made.recordId;
          }
          if (!this.scripting) announce('Portal row added.');
          if (!this.scripting) this.uncommitted = rec.recordId;
          freshen(rec, await this.api.record(layout, rec.recordId));
          this.states.delete(rec.recordId);
          await this.loadStates();
          // The portal gains a row, with a new empty one under it: drawn once the cursor leaves this row,
          // so typing on into its other fields isn't lost.
          if (rowEl && rowEl.contains(document.activeElement)) {
            const done = (e: FocusEvent) => {
              if (rowEl.contains(e.relatedTarget as Node | null)) return;
              rowEl.removeEventListener('focusout', done);
              void this.saving.then(() => this.renderKeepingFocus());
            };
            rowEl.addEventListener('focusout', done);
          } else {
            this.renderKeepingFocus();
          }
          return;
        } else if (row) {
          rec.modId = await retrying(() => this.api.update(layout, rec.recordId, {}, { portalData: { [row.portal]: [{ recordId: row.row.recordId, [key]: value }] } }));
          row.row[key] = value;
          if (!this.scripting) announce('Changes saved.');
        } else {
          const merged = await this.merge(rec, key, value);
          if (merged === undefined) return;
          combined = merged !== value;
          value = merged;
          rec.fieldData[key] = value;
          if (!this.scripting) announce('Changes saved.');
        }
        if (!this.scripting) this.uncommitted = rec.recordId;
        // A Set Field acts on the current record: typing on another row of a list goes to that record first.
        if (row) this.note({ kind: 'skipped', what: `typing into ${key} in a portal row` });
        else {
          // The record typed into (in list and table views, maybe not the one the script is on).
          const at = [...this.cache].find(([, r]) => r.recordId === rec.recordId)?.[0];
          if (at !== undefined) this.noteRecord(at);
          this.note({ kind: 'set', occurrence, field: key, value });
        }
        // Kept in the offline copy, to send later: the server can't work out what else the change affects yet.
        if (this.api.isOffline || this.api.copyOnly) {
          this.refreshValues();
          return;
        }
        // Other fields may show the same value (or a related one): refresh them.
        const fresh = await this.api.record(layout, rec.recordId);
        // The record's other fields, before: an auto-enter or calculation the change set off shows at once too.
        const others = (r: DataRecord) => JSON.stringify(Object.entries(r.fieldData).filter(([k]) => k !== key));
        const before = others(rec);
        freshen(rec, fresh);
        this.refetchFoundRow(rec.recordId);
        const was = JSON.stringify(this.states.get(rec.recordId));
        this.states.delete(rec.recordId);
        await this.loadStates();
        // Hide conditions, conditional formatting, merge text, other fields' values and the like that follow the value
        // change as the cursor leaves the field, as in FileMaker, even when it went on to another field, which keeps the
        // cursor (an open popover stays as is).
        const inField = !!document.activeElement?.matches('input.fm-input, textarea.fm-input') && !this.composing;
        const restyled = inField && !this.popover && this.view === 'form' && rec === this.record
          && (JSON.stringify(this.states.get(rec.recordId)) !== was || others(rec) !== before);
        if (combined || restyled) this.renderKeepingTyping();
        else this.refreshValues();
        if (!row) await this.refreshBreaks(key);
      } catch (e) {
        announce('Save failed.');
        toast(unreachableRequest(e) ? `Can't reach the server, so ${key.replace(/\(\d+\)$/, '')} wasn't saved.` : `Couldn't save ${key}: ${errorText(e)}`);
        if (e instanceof ApiError && (e.code === 306 || e.code === 301)) await this.reload(rec.recordId);
        // Nothing reached the server: the field goes back to the value it is stored with, not left looking saved.
        else if (unreachableRequest(e)) {
          if (!row) this.unsaved.delete(pending);
          this.renderKeepingFocus();
        }
        // The empty row shows what was typed, though nothing was made: draw it empty again.
        else if (row && !row.row.recordId) this.renderKeepingFocus();
      }
    };
    this.saving = this.saving.then(run).finally(() => {
      if (!row && this.unsaved.get(pending) === handed) this.unsaved.delete(pending);
    });
  }

  /**
   * Saves a field of the record, asking which to keep when another user changed the same field while it was typed
   * in: answers what was saved, or undefined when the person kept theirs.
   */
  private async merge(rec: DataRecord, key: string, value: string): Promise<string | undefined> {
    const layout = this.meta!.layout.name;
    const ask = async (theirs: string, by: string | undefined): Promise<string | undefined> => {
      const choice = theirs === value ? theirs : await mergeDialog(key, theirs, value, by);
      if (choice === undefined || choice === theirs) {
        // Theirs stays: the field shows it again.
        rec.fieldData[key] = theirs;
        this.renderKeepingTyping();
        return undefined;
      }
      return choice;
    };
    const conflict = this.conflicts.get(`${rec.recordId}\0${key}`);
    this.conflicts.delete(`${rec.recordId}\0${key}`);
    // Only while the record still holds their change: a later version has been shown since, and the save's
    // modification id decides.
    if (conflict && conflict.theirs === String(rec.fieldData[key] ?? '')) {
      const choice = await ask(conflict.theirs, conflict.by);
      if (choice === undefined) return undefined;
      value = choice;
    }
    try {
      rec.modId = await retrying(() => this.api.update(layout, rec.recordId, { [key]: value }, { modId: rec.modId }));
      return value;
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 306) || this.offline) throw e;
    }
    // Changed by someone else since it was shown (before their change reached this window): when it was another
    // field, this one saves on the new version; when it was this field too, the person chooses.
    const before = String(rec.fieldData[key] ?? '');
    const fresh = await this.api.record(layout, rec.recordId);
    const theirs = String(fresh.fieldData[key] ?? '');
    freshen(rec, fresh);
    this.states.delete(rec.recordId);
    if (theirs !== before) {
      const choice = await ask(theirs, this.changedBy.get(rec.recordId));
      if (choice === undefined) return undefined;
      value = choice;
    }
    rec.modId = await retrying(() => this.api.update(layout, rec.recordId, { [key]: value }, { modId: rec.modId }));
    return value;
  }

  /** The record a field edit belongs to: in list and table views, the row it was made in. */
  private recordFor(row?: RowContext): DataRecord | undefined {
    void row;
    return this.editing ?? this.record;
  }

  /** Set while rendering or editing a list row, so edits go to that row's record. */
  private editing?: DataRecord;

  /**
   * A container's menu, as FileMaker's Insert menu and FileMaker Go's container options: open it, download it with
   * its own name, insert a picture or file, take a photo, sign, or empty it.
   */
  private containerMenu(rec: DataRecord, key: string, url: string, anchor: HTMLElement, editable: boolean, row?: RowContext): void {
    document.querySelector('.field-menu')?.remove();
    const menu = h('ul', { class: 'menu field-menu container-menu', role: 'menu', 'aria-label': key.replace(/\(\d+\)$/, '') });
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', outside, true);
      anchor.focus();
    };
    const outside = (m: Event) => {
      if (!menu.contains(m.target as Node) && m.target !== anchor) close();
    };
    const item = (label: string, run: () => unknown) => {
      const li = h('li', { role: 'menuitem', tabindex: '-1' }, h('span', { class: 'label' }, label));
      const go = () => {
        close();
        void Promise.resolve(run()).catch((err) => toast(errorText(err)));
      };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (k) => {
        if (k.key === 'Enter' || k.key === ' ') {
          k.preventDefault();
          go();
        }
      });
      menu.append(li);
    };
    const sep = () => menu.lastElementChild && !menu.lastElementChild.classList.contains('separator') && menu.append(h('li', { class: 'separator', role: 'separator' }));
    const path = url.split('?')[0];
    const filename = url ? decodeURIComponent(path.split('/').pop() ?? 'file') : '';
    const kind = url ? containerKind(path) : undefined;
    const put = (file: File | undefined) => {
      if (!file) return;
      this.editing = rec;
      this.upload(key, file, row);
      this.editing = undefined;
    };
    // The browser's picker from this tap (it only opens for a person's own gesture).
    const pick = (accept: string) => {
      const input = h('input', { type: 'file', accept }) as HTMLInputElement;
      input.addEventListener('change', () => put(input.files?.[0]));
      input.click();
    };
    if (url && kind !== 'file' && kind !== 'audio') item(kind === 'pdf' ? 'Open PDF' : kind === 'video' ? 'Play Video' : 'Open Picture', () => previewContainer(url, filename, kind!));
    if (url) item('Download', () => downloadContainer(url, filename));
    if (editable) {
      sep();
      item(url ? 'Replace with Picture…' : 'Insert Picture…', () => pick('image/*'));
      item(url ? 'Replace with File…' : 'Insert File…', () => pick('*/*'));
      item('Take Photo…', async () => put(await takePhoto()));
      item('Signature…', async () => put(await signature()));
      if (url) {
        sep();
        item('Clear', () => this.clearContainer(rec, key, row));
      }
    }
    if (!menu.children.length) return;
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(r.left, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${r.bottom + 4 + menu.offsetHeight > innerHeight ? Math.max(4, r.top - menu.offsetHeight - 4) : r.bottom + 4}px`;
    document.addEventListener('pointerdown', outside, true);
    menu.addEventListener('keydown', (k) => {
      const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (k.key === 'Escape') close();
      else if (k.key === 'ArrowDown' || k.key === 'ArrowUp') {
        k.preventDefault();
        items[(at + (k.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    });
    (menu.querySelector<HTMLElement>('[role=menuitem]'))?.focus();
  }

  /** Host: a container in form view was clicked or tapped. */
  containerAction(key: string, url: string, anchor: HTMLElement, editable: boolean, row?: RowContext): void {
    const rec = this.recordFor(row);
    if (rec) this.containerMenu(rec, key, url, anchor, editable, row);
  }

  private async clearContainer(rec: DataRecord, key: string, row?: RowContext): Promise<void> {
    if (!this.meta || (row && !row.row.recordId)) return;
    const m = /^(.*?)(?:\((\d+)\))?$/.exec(key)!;
    await this.saving;
    await this.api.clearContainer(this.meta.layout.name, rec.recordId, m[1], Number(m[2] ?? 1), row && { name: row.portal, recordId: String(row.row.recordId) });
    freshen(rec, await this.api.record(this.meta.layout.name, rec.recordId));
    this.render();
  }

  upload(key: string, file: File, row?: RowContext): void {
    const rec = this.recordFor(row);
    if (!rec || !this.meta) return;
    // A portal's empty last row has no related record yet to put a file in.
    if (row && !row.row.recordId) {
      toast('Enter something in a field of this row first, then add the file.');
      return;
    }
    const m = /^(.*?)(?:\((\d+)\))?$/.exec(key)!;
    const layout = this.meta.layout.name;
    const portal = row && { name: row.portal, recordId: String(row.row.recordId) };
    if (file.size >= PIECED_FROM) {
      // A big file goes up in pieces beside whatever else is being saved, so editing goes on while it travels; it can be cancelled.
      void (async () => {
        const stop = new AbortController();
        const bar = progressToast(`Uploading ${file.name}`, { label: 'Cancel', title: 'Stop the upload', run: () => stop.abort() });
        try {
          await this.api.upload(layout, rec.recordId, m[1], Number(m[2] ?? 1), file, portal, { onProgress: (done, total) => bar.progress(done, total), signal: stop.signal });
          await this.saving;
          freshen(rec, await this.api.record(layout, rec.recordId));
          this.render();
          toast(`Uploaded ${file.name}`, 'info');
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') toast(`Cancelled the upload of ${file.name}`, 'info');
          else toast(`Couldn't upload ${file.name}: ${errorText(e)}`, 'error', { label: 'Upload help', run: () => { location.href = '/docs/troubleshooting-web-client#a-container-file-will-not-upload'; } });
        } finally {
          bar.remove();
        }
      })();
      return;
    }
    this.saving = this.saving.then(async () => {
      try {
        await this.api.upload(layout, rec.recordId, m[1], Number(m[2] ?? 1), file, portal);
        freshen(rec, await this.api.record(layout, rec.recordId));
        this.render();
      } catch (e) {
        toast(`Couldn't upload ${file.name}: ${errorText(e)}`, 'error', { label: 'Upload help', run: () => { location.href = '/docs/troubleshooting-web-client#a-container-file-will-not-upload'; } });
      }
    });
  }

  async newRecord(): Promise<void> {
    if (this.mode === 'find') return;
    if (!(await this.commit())) return;
    try {
      const id = await this.api.create(this.meta!.layout.name, {}, this.record?.recordId, true);
      const rec = await this.api.record(this.meta!.layout.name, id);
      // FileMaker adds the new record to the end of the found set.
      this.foundCount++;
      this.totalCount++;
      this.index = this.foundCount - 1;
      this.cache.set(this.index, rec);
      this.created = { id, layout: this.meta!.layout.name };
      this.ids?.push(Number(id));
      this.note({ kind: 'new' });
      await this.loadStates();
      this.render();
      this.focusFirstField();
      this.writeScreenUrl();
    } catch (e) {
      toast(`Couldn't create a record: ${errorText(e)}`);
    }
  }

  async deleteRecord(): Promise<void> {
    const rec = this.record;
    if (!rec) return;
    // In a row of a portal set to allow deleting rows, it's that related record that goes, as in FileMaker.
    const rowEl = this.portalRow;
    if (rowEl?.isConnected && this.content.contains(rowEl)) {
      const owner = this.recordAt(rowEl);
      const related = owner?.portalData[rowEl.dataset.portal!]?.find((r) => r.recordId === rowEl.dataset.row);
      if (owner && related) return this.deletePortalRow({ portal: rowEl.dataset.portal!, row: related }, 'Permanently delete this ONE related record?', owner);
    }
    if (!(await askConfirm('Delete Record', 'Permanently delete this ENTIRE record?', 'Delete'))) return;
    // Through the script engine's Delete Record step, so the server can journal it and the toast can offer Undo.
    try {
      if (this.uncommitted === rec.recordId) this.uncommitted = undefined;
      const at = this.index;
      await this.recordCommand('Delete Record');
      this.noteRecord(at);
      this.note({ kind: 'delete' });
      this.writeScreenUrl();
    } catch (e) {
      toast(`Couldn't delete the record: ${errorText(e)}`);
    }
  }

  async showAll(): Promise<void> {
    if (!(await this.commit())) return;
    this.query = undefined;
    this.ids = undefined;
    this.mode = 'browse';
    const id = this.record?.recordId;
    this.index = 0;
    await this.reload(id);
    this.note({ kind: 'showAll' });
    this.writeScreenUrl();
  }

  /** Leaves the current mode, if its OnModeExit lets it. */
  private async leaveMode(): Promise<boolean> {
    return (await this.commit()) && (await this.fire('OnModeExit'));
  }

  /** Find mode, with one empty request or, for Modify Last Find, the last find's requests. */
  async enterFind(modifyLast = false): Promise<void> {
    if (!(await this.leaveMode())) return;
    this.preview = false;
    this.mode = 'find';
    announce('Find mode.');
    this.requests = modifyLast && this.lastFind ? this.lastFind.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit })) : [{ criteria: {}, omit: false }];
    this.request = 0;
    this.popover = undefined;
    if (this.view === 'table') this.view = 'form';
    await this.loadStates();
    this.render();
    this.focusFirstField();
    await this.fire('OnModeEnter');
    this.writeScreenUrl();
  }

  async enterBrowse(): Promise<void> {
    const was = this.windowMode;
    if (was !== 'browse' && !(await this.leaveMode())) return;
    this.preview = false;
    this.mode = 'browse';
    await this.loadStates();
    this.render();
    if (was !== 'browse') announce('Browse mode.');
    if (was !== 'browse') await this.fire('OnModeEnter');
    this.writeScreenUrl();
  }

  // ---------------------------------------------------------- preview

  /** Preview mode: the found set on printed pages. The window stays in Browse mode for scripts and the server. */
  private preview = false;
  /** The mode as FileMaker names it: Preview mode is Browse mode drawn as pages. For triggers and Get ( WindowMode ). */
  private get windowMode(): 'browse' | 'find' | 'preview' {
    return this.preview ? 'preview' : this.mode;
  }
  private previewLoading?: Promise<void>;

  async enterPreview(): Promise<void> {
    const was = this.windowMode;
    if (was !== 'preview' && !(await this.leaveMode())) return;
    this.mode = 'browse';
    this.preview = true;
    if (was !== 'preview') announce('Preview mode.');
    this.popover = undefined;
    await this.loadAll();
    await this.loadStates();
    this.render();
    if (was !== 'preview') await this.fire('OnModeEnter');
    this.writeScreenUrl();
  }

  /** Every record preview mode lays out, fetched a page at a time. */
  private async loadAll(): Promise<void> {
    const n = Math.min(this.foundCount, PREVIEW_MAX);
    for (let i = 0; i < n; i += PAGE) if (!this.cache.has(i)) await this.fetch(i);
  }

  /** Print: the browser's print dialog, from Preview mode so the pages are what prints. */
  async print(fromScript = false): Promise<void> {
    // A script set to run with full access may print for an account that can't (the server decides that).
    if (!this.printing && !fromScript) return toast('This account isn\'t allowed to print.', 'error');
    // A script prints the first PREVIEW_MAX records without asking; a person chooses the complete PDF or nothing.
    const warning = fromScript ? undefined : printLimitNotice(this.foundCount);
    if (warning) {
      if (confirm(warning)) await this.doCommand('Save Records as PDF');
      return;
    }
    if (!this.preview) await this.enterPreview();
    // Let the pages and their pictures draw before the dialog takes a snapshot.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100)));
    window.print();
  }

  /** The found set split into pages: header and footer on each, then the parts in between. */
  private renderPreview(page: HTMLElement): void {
    const r = this.renderer!;
    const n = Math.min(this.foundCount, PREVIEW_MAX);
    if ([...Array(n).keys()].some((i) => !this.cache.has(i))) {
      // A layout change or a script left records unfetched: get them, then draw again.
      this.previewLoading ??= this.loadAll().then(() => this.loadStates()).finally(() => {
        this.previewLoading = undefined;
        this.render();
      });
    }
    const one = (kind: string) => r.partsOfKind([kind])[0];
    const header = one('header'), titleHeader = one('title-header'), footer = one('footer'), titleFooter = one('title-footer');
    const top = (p: number) => (p === 1 ? titleHeader ?? header : header);
    const bottom = (p: number) => (p === 1 ? titleFooter ?? footer : footer);
    // The parts between header and footer, in print order.
    type Item = { part: LayoutPart; i?: number; draw: (host: Host) => HTMLElement | undefined };
    const items: Item[] = [];
    for (const p of r.partsOfKind(['leading-grand-summary'])) items.push({ part: p, draw: (host) => r.renderPart(p, host) });
    const body = r.part('body');
    const breaks = this.groups ? this.breakParts().sort((a, b) => a.level - b.level) : [];
    for (let i = 0; i < n; i++) {
      const rec = this.cache.get(i);
      if (!rec) continue;
      for (const b of breaks.filter((x) => x.part.kind === 'sub-summary-leading')) {
        const run = this.runAt(b.level, i);
        if (run?.start === i) items.push({ part: b.part, i, draw: () => this.renderBreak(b.part, b.level, rec, i, 'first') });
      }
      if (body) items.push({ part: body, i, draw: (host) => r.renderPart(body, host) });
      for (const b of breaks.filter((x) => x.part.kind === 'sub-summary-trailing').reverse()) {
        const run = this.runAt(b.level, i);
        if (run && run.start + run.count - 1 === i) items.push({ part: b.part, i, draw: () => this.renderBreak(b.part, b.level, rec, i, 'last') });
      }
    }
    for (const p of r.partsOfKind(['trailing-grand-summary'])) items.push({ part: p, draw: (host) => r.renderPart(p, host) });
    const size = pageSize(r.width, this.meta!.pageSetup, this.meta!.design.fixedMargins);
    const noop = () => undefined;
    const hostAt = (i: number | undefined, pageNumber: number): Host => {
      const rec = i === undefined ? undefined : this.cache.get(i);
      const base: Host = rec ? this.hostFor(rec, i!) : { mode: 'browse', panels: this.panels, foundCount: this.foundCount, totalCount: this.totalCount, save: noop, upload: noop, action: noop };
      return { ...base, pageNumber, save: noop, upload: noop, action: noop, fieldEvent: noop };
    };
    // Parts with sliding objects are drawn first, to measure how far they shrink; the pages are made from what's left.
    const heights = items.map((x) => x.part.height);
    const drawn: (HTMLElement | undefined)[] = [];
    if (items.some((x) => r.slides(x.part))) {
      // Measured in the document, offscreen, with the layout's styles and the page's classes.
      const measure = h('div', { class: page.className });
      const wrap = h('div', { class: `${SCOPE} preview-measure` }, measure);
      this.content.append(wrap);
      items.forEach((x, k) => {
        if (!r.slides(x.part)) return;
        const el = x.draw(hostAt(x.i ?? 0, 1));
        if (!el) return;
        measure.append(el);
        heights[k] = this.slideObjects(el, x.part.height);
        drawn[k] = el;
      });
      wrap.remove();
    }
    // Part Definition's page breaks: before each occurrence of a part, or after every N of them.
    const seen = new Map<LayoutPart, number>();
    const nth = items.map((x) => {
      const n = (seen.get(x.part) ?? 0) + 1;
      seen.set(x.part, n);
      return n;
    });
    const frame = { header: (p: number) => top(p)?.height ?? 0, footer: (p: number) => bottom(p)?.height ?? 0 };
    const pageBreaks = {
      before: (k: number) => !!items[k].part.options?.pageBreakBefore,
      after: (k: number) => {
        const every = items[k].part.options?.pageBreakEvery;
        return !!every && nth[k] % every === 0;
      },
    };
    // Layout Setup's "Print in N columns": records side by side, grand summaries across the page.
    const columns = (this.meta!.design.printColumns?.count ?? 1) > 1 ? this.meta!.design.printColumns! : undefined;
    const spans = (k: number) => items[k].part.kind.endsWith('grand-summary');
    const placed = columns ? paginateColumns(heights, spans, frame, size.height, columns, pageBreaks) : undefined;
    const pages = placed ? placed.pages.map((p) => p.map((x) => x.index)) : paginate(heights, frame, size.height, pageBreaks);
    const columnWidth = columns ? size.width / columns.count : 0;
    const numbers = pageNumbers(pages, (k) => !!items[k].part.options?.restartPageNumbers);
    // A sliding part was measured as page 1: one showing the page number is drawn again, and slid again, for the page it landed on.
    const redraw = items.map((x, k) => !!drawn[k] && r.showsPageNumber(x.part));
    if (redraw.some(Boolean)) {
      const measure = h('div', { class: page.className });
      const wrap = h('div', { class: `${SCOPE} preview-measure` }, measure);
      this.content.append(wrap);
      pages.forEach((onPage, p) => {
        if (numbers[p] === 1) return;
        for (const k of onPage) {
          if (!redraw[k]) continue;
          const el = items[k].draw(hostAt(items[k].i ?? 0, numbers[p]));
          if (!el) continue;
          measure.append(el);
          // The pages were made from the first measurement; a longer number doesn't move the part onto another page.
          this.slideObjects(el, items[k].part.height);
          drawn[k] = el;
        }
      });
      wrap.remove();
    }
    // The printer's page follows: CSS can only set it for the whole document.
    this.pageStyle ??= document.head.appendChild(h('style', { id: 'preview-page' }));
    const { margins: m, paper } = size;
    this.pageStyle.textContent = `@media print { @page { size: ${paper.width}pt ${paper.height}pt; margin: ${m.top}pt ${m.right}pt ${m.bottom}pt ${m.left}pt; } }`;
    const height = size.height;
    const scale = size.scale ?? 1;
    page.style.setProperty('--preview-width', `${size.width}px`);
    page.style.setProperty('--preview-scale', String(scale));
    page.style.setProperty('--preview-margin-top', `${m.top / scale}px`);
    page.style.setProperty('--preview-margin-left', `${m.left / scale}px`);
    page.style.setProperty('--preview-margin-right', `${m.right / scale}px`);
    page.style.setProperty('--preview-margin-bottom', `${m.bottom / scale}px`);
    pages.forEach((onPage, p) => {
      // The sheet's place decides title header and footer; the page number shown can start again.
      const sheetNo = p + 1;
      const number = numbers[p];
      const rows = onPage.map((k) => items[k].i).filter((i): i is number => i !== undefined);
      // The header shows the page's first record, the footer its last, as FileMaker prints them.
      const first = rows[0] ?? (this.foundCount ? 0 : undefined);
      const last = rows[rows.length - 1] ?? first;
      const sheet = h('div', { class: 'preview-sheet', 'aria-label': `Page ${sheetNo}` });
      // A part taller than the page makes its page longer; printing carries it on to the next sheet of paper.
      const flowHeight = placed ? placed.used[p] : onPage.reduce((n, k) => n + heights[k], 0);
      const used = (top(sheetNo)?.height ?? 0) + flowHeight + (bottom(sheetNo)?.height ?? 0);
      sheet.style.setProperty('--preview-height', `${Math.max(height, used)}px`);
      const flow = h('div', { class: 'preview-flow' });
      const head = top(sheetNo);
      if (head) flow.append(r.renderPart(head, hostAt(first, number)));
      if (placed) {
        // Each part in its column, cut at the column's width as FileMaker prints it.
        const grid = h('div', { class: 'preview-columns' });
        grid.style.height = `${flowHeight}px`;
        for (const x of placed.pages[p]) {
          const el = drawn[x.index] ?? items[x.index].draw(hostAt(items[x.index].i ?? first, number));
          if (!el) continue;
          const cell = h('div', { class: 'preview-cell' }, el);
          cell.style.top = `${x.top}px`;
          cell.style.left = `${x.column < 0 ? 0 : x.column * columnWidth}px`;
          if (x.column >= 0) cell.style.width = `${columnWidth}px`;
          grid.append(cell);
        }
        flow.append(grid);
      } else {
        for (const k of onPage) {
          const el = drawn[k] ?? items[k].draw(hostAt(items[k].i ?? first, number));
          if (el) flow.append(el);
        }
      }
      sheet.append(flow);
      const foot = bottom(sheetNo);
      if (foot) sheet.append(h('div', { class: 'preview-footer' }, r.renderPart(foot, hostAt(last, number))));
      page.append(sheet);
    });
    page.inert = true;
    this.previewPages = pages.length;
    this.previewPage = 0;
    this.content.removeEventListener('scroll', this.trackPage);
    this.content.addEventListener('scroll', this.trackPage, { passive: true });
    this.renderToolbar();
  }

  /**
   * Slides a drawn part's objects as Sliding & Visibility says (see slide()),
   * measuring each sliding field's or text's content; returns the part's new height.
   */
  private slideObjects(part: HTMLElement, height: number): number {
    const r = this.renderer!;
    const boxes: SlideBox[] = [];
    const els = new Map<string, HTMLElement>();
    for (const el of part.querySelectorAll<HTMLElement>(':scope > [data-id]')) {
      const o = r.objectById(Number(el.dataset.id));
      if (!o) continue;
      const top = parseFloat(el.style.top), b = o.bounds;
      const box: SlideBox = { id: el.dataset.id!, top, left: b.left, bottom: top + b.bottom - b.top, right: b.right, up: o.sliding?.up, left_: o.sliding?.left, resizePart: o.sliding?.resizePart };
      if (o.sliding) Object.assign(box, contentSize(el, o.kind));
      // A portal that slides up and shrinks its part leaves out its empty rows, as in FileMaker.
      if (o.kind === 'portal' && o.sliding?.up && o.sliding.resizePart) box.contentHeight = portalContentHeight(el);
      boxes.push(box);
      els.set(box.id, el);
    }
    const out = slide(boxes, height);
    for (const [id, b] of out.bounds) {
      const el = els.get(id)!;
      Object.assign(el.style, { top: `${b.top}px`, left: `${b.left}px`, height: `${b.bottom - b.top}px`, width: `${b.right - b.left}px`, right: '' });
      // Shrunk to nothing: not even its border prints.
      if (b.bottom <= b.top || b.right <= b.left) el.style.display = 'none';
    }
    part.style.height = `${out.height}px`;
    return out.height;
  }

  private previewPages = 0;
  /** The page in view in Preview mode, from 0, for the toolbar's Pages navigator. */
  private previewPage = 0;

  /** Preview mode's Pages navigator: scrolls that page into view. */
  private showPage(i: number): void {
    const sheets = this.content.querySelectorAll<HTMLElement>('.preview-sheet');
    const sheet = sheets[Math.max(0, Math.min(sheets.length - 1, i))];
    if (!sheet) return;
    this.content.scrollTo({ top: sheet.offsetTop - 24 });
    this.previewPage = [...sheets].indexOf(sheet);
    this.renderToolbar();
  }

  /** Scrolling in Preview mode moves the Pages navigator to the page mostly in view. */
  private trackPage = (): void => {
    if (!this.preview || this.mode === 'find') return;
    const sheets = this.content.querySelectorAll<HTMLElement>('.preview-sheet');
    const middle = this.content.scrollTop + this.content.clientHeight / 2;
    let at = 0;
    sheets.forEach((s, i) => { if (s.offsetTop <= middle) at = i; });
    if (at !== this.previewPage) {
      this.previewPage = at;
      this.renderToolbar();
    }
  };
  private pageStyle?: HTMLStyleElement;

  async performFind(): Promise<void> {
    if (!(await this.commit())) return;
    // Find requests add records; omit requests take them away in order.
    const query = buildFindRequests(this.requests);
    if (!query.length) {
      toast('Type what to find in one or more fields, then click Perform Find.', 'info');
      return;
    }
    if (!(await this.fire('OnModeExit'))) return;
    this.lastFind = this.requests.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit }));
    const previous = [this.query, this.ids] as const;
    this.query = query;
    this.ids = undefined;
    this.mode = 'browse';
    this.index = 0;
    await this.reload();
    if (!this.foundCount) {
      announce('Found 0 records.');
      [this.query, this.ids] = previous;
      const again = (await noMatchDialog()) === 'modify';
      this.mode = again ? 'find' : 'browse';
      await this.reload();
      this.writeScreenUrl();
      return;
    }
    this.noteRecentFind(this.lastFind);
    this.note({ kind: 'find', occurrence: this.meta!.layout.occurrence, requests: query.filter((q) => Object.keys(q).some((k) => k !== 'omit')) });
    await this.fire('OnModeEnter');
    this.writeScreenUrl();
  }

  /**
   * Find mode's Constrain Found Set (only records of the found set that match)
   * and Extend Found Set (the found set plus the records that match). The
   * server's script engine does them as the steps do.
   */
  async constrainFind(extend: boolean): Promise<void> {
    if (!(await this.commit())) return;
    const requests = this.requests
      .map((r) => ({ criteria: Object.fromEntries(Object.entries(r.criteria).filter(([, v]) => v.trim()).map(([k, v]) => [k.includes('|') ? k.slice(k.indexOf('|') + 1) : k, v])), omit: r.omit }))
      .filter((r) => Object.keys(r.criteria).length);
    if (!requests.length || requests.every((r) => r.omit)) {
      toast('Type what to find in one or more fields first.', 'info');
      return;
    }
    if (!(await this.fire('OnModeExit'))) return;
    this.lastFind = this.requests.map((r) => ({ criteria: { ...r.criteria }, omit: r.omit }));
    const previous = [this.query, this.ids, this.sort] as const;
    await this.runButton(undefined, undefined, undefined, { command: extend ? 'Extend Found Set' : 'Constrain Found Set', requests });
    if (this.mode === 'browse' && !this.foundCount) {
      [this.query, this.ids, this.sort] = previous;
      const again = (await noMatchDialog()) === 'modify';
      this.mode = again ? 'find' : 'browse';
      await this.reload();
      return;
    }
    this.note({ kind: 'find', occurrence: this.meta!.layout.occurrence, how: extend ? 'extend' : 'constrain',
      requests: requests.map((r) => ({ ...r.criteria, ...(r.omit ? { omit: 'true' } : {}) }) as FindRequest) });
    await this.fire('OnModeEnter');
  }

  /** Find mode: adds an empty request (or a copy of the one showing) after the others and shows it. */
  newRequest(duplicate = false): void {
    this.keepTyping();
    const r = this.requests[this.request];
    this.requests.push(duplicate ? { criteria: { ...r.criteria }, omit: r.omit } : { criteria: {}, omit: false });
    this.request = this.requests.length - 1;
    this.render();
    this.focusFirstField();
  }

  /** Find mode: deletes the request showing; the last one left is just emptied. */
  deleteRequest(): void {
    this.keepTyping();
    if (this.requests.length === 1) this.requests = [{ criteria: {}, omit: false }];
    else this.requests.splice(this.request, 1);
    this.request = Math.min(this.request, this.requests.length - 1);
    this.render();
  }

  /** Go to Record/Request/Page > Specify…: asks for a record number and shows that record. */
  private async goToRecordNumber(): Promise<void> {
    if (!this.foundCount) return;
    const answer = await askText('Go to Record', `Record number (1-${this.foundCount})`, String(this.index + 1), 'Go');
    if (answer !== null && Number(answer) >= 1) await this.goTo(Math.min(this.foundCount, Math.trunc(Number(answer))) - 1);
  }

  /** The same in Find mode, where it shows a find request (Claris, Requests menu: Go to Record/Request/Page). */
  private async goToRequestNumber(): Promise<void> {
    const n = this.requests.length;
    if (n < 2) return;
    const answer = await askText('Go to Request', `Request number (1-${n})`, String(this.request + 1), 'Go');
    if (answer !== null && Number(answer) >= 1) this.showRequest(Math.min(n, Math.trunc(Number(answer))) - 1);
  }

  /** Find mode: switches the request showing between Include and Omit. */
  private toggleOmit(): void {
    this.omit = !this.omit;
    this.renderToolbar();
  }

  /** Find mode: shows request `i` (0-based). */
  showRequest(i: number): void {
    if (i < 0 || i >= this.requests.length || i === this.request) return;
    this.keepTyping();
    this.request = i;
    this.render();
  }

  /**
   * Find mode: what is being typed in a field goes into the request showing before another is shown. A request's
   * criteria are taken as each field is left, and a field taken away by a redraw is never left.
   */
  private keepTyping(): void {
    const el = document.activeElement as HTMLElement | null;
    if (el && this.content.contains(el)) el.blur();
  }

  /** The fields Quick Find searches: every field on the layout but containers, summaries and globals (one value for every record can't tell records apart). */
  private quickFindKeys(): string[] {
    const r = this.renderer;
    if (!r) return [];
    return r.fieldKeys().filter((k) => {
      const t = r.fieldType(k);
      return t && t.type !== 'container' && !t.summary && !t.global;
    });
  }

  /** keepRecordId: the record to show in what it finds (a record chosen in Open Quickly). */
  async quickFind(text: string, keepRecordId?: string): Promise<void> {
    if (!text.trim()) return this.showAll();
    // Quick find searches every field on the layout; the Data API ORs separate requests.
    let keys = this.quickFindKeys();
    if (!keys.length) return;
    const previous = [this.query, this.ids] as const;
    this.ids = undefined;
    this.mode = 'browse';
    for (;;) {
      this.query = keys.map((k) => ({ [k]: text }) as FindRequest);
      this.index = 0;
      try {
        await this.reload(keepRecordId);
        break;
      } catch (e) {
        // A field the server can't search (a related field in another file's
        // table, for now) is skipped, as FileMaker skips fields Quick Find can't use.
        const missing = e instanceof ApiError && e.code === 102 ? /"(.+)"/.exec(e.message)?.[1] : undefined;
        if (missing && keys.includes(missing) && keys.length > 1) {
          keys = keys.filter((k) => k !== missing);
          continue;
        }
        [this.query, this.ids] = previous;
        toast(`Couldn't search: ${errorText(e)}`);
        await this.reload();
        return;
      }
    }
    if (!this.foundCount) toast('No records match.', 'info');
    this.note({ kind: 'quickFind', text });
  }

  async sortBy(field: string, order: 'ascend' | 'descend'): Promise<void> {
    await this.sortRecords(field ? [{ fieldName: field, sortOrder: order }] : undefined);
  }

  async sortRecords(sort: SortSpec[] | undefined): Promise<void> {
    this.sort = sort?.length ? sort : undefined;
    const id = this.record?.recordId;
    await this.reload(id);
    announce('Sort applied.');
    if (this.meta) this.note({ kind: 'sort', occurrence: this.meta.layout.occurrence, ...(this.sort ? { sort: this.sort } : {}) });
  }

  /**
   * FileMaker's Sort Records dialog: fields on the left, the sort order (each
   * field ascending or descending) on the right. For a script's Sort Records
   * step, `answer` gets the order chosen, or undefined for Cancel.
   */
  private openSortDialog(fields: string[], initial = this.sort, answer?: (order: SortSpec[] | undefined) => void): void {
    const order: SortSpec[] = (initial ?? []).map((s) => ({ ...s }));
    let chosenOrder: SortSpec[] | undefined;
    for (const s of order) if (!fields.includes(s.fieldName)) fields = [...fields, s.fieldName];
    const dialog = h('dialog', { class: 'sort-dialog', 'aria-label': 'Sort records' });
    const available = h('select', { size: '12', 'aria-label': 'Fields' });
    const chosen = h('ol', { class: 'sort-order', 'aria-label': 'Sort order' });
    const draw = () => {
      available.replaceChildren(...fields.filter((f) => !order.some((s) => s.fieldName === f)).map((f) => h('option', { value: f }, f)));
      chosen.replaceChildren(...order.map((s, i) => {
        // Ascending, descending, or a custom order based on one of the file's value lists, as in FileMaker.
        const lists = this.meta?.sortLists ?? [];
        const dir = h('select', { class: 'sort-dir', 'aria-label': `Order for ${s.fieldName}` },
          h('option', { value: 'ascend' }, 'Ascending'), h('option', { value: 'descend' }, 'Descending'),
          ...(lists.length ? [h('optgroup', { label: 'Custom order based on value list' }, ...lists.map((l) => h('option', { value: l }, l)))] : []),
          ...(s.sortOrder !== 'ascend' && s.sortOrder !== 'descend' && !lists.includes(s.sortOrder) ? [h('option', { value: s.sortOrder }, s.sortOrder)] : [])) as HTMLSelectElement;
        dir.value = s.sortOrder;
        dir.addEventListener('change', () => (s.sortOrder = dir.value));
        const up = button('↑', () => {
          [order[i - 1], order[i]] = [order[i], order[i - 1]];
          draw();
        }, { class: 'quiet', title: 'Move up', 'aria-label': `Move ${s.fieldName} up` });
        up.disabled = i === 0;
        const remove = button('×', () => {
          order.splice(i, 1);
          draw();
        }, { class: 'quiet', title: 'Remove', 'aria-label': `Remove ${s.fieldName}` });
        return h('li', {}, h('span', { class: 'name' }, s.fieldName), dir, up, remove);
      }));
      if (!order.length) chosen.append(h('li', { class: 'empty' }, 'Unsorted'));
    };
    const add = () => {
      for (const o of [...available.selectedOptions]) order.push({ fieldName: o.value, sortOrder: 'ascend' });
      draw();
    };
    available.addEventListener('dblclick', add);
    const close = () => {
      dialog.remove();
      answer?.(chosenOrder);
    };
    dialog.addEventListener('close', close);
    dialog.append(
      h('h2', {}, 'Sort Records'),
      h('div', { class: 'sort-columns' },
        h('div', {}, h('div', { class: 'label' }, 'Fields'), available, button('Add →', add)),
        h('div', {}, h('div', { class: 'label' }, 'Sort order'), chosen),
      ),
      h('div', { class: 'actions' },
        button('Clear All', () => {
          order.length = 0;
          draw();
        }),
        h('span', { class: 'spacer' }),
        button('Cancel', () => dialog.close()),
        button('Sort', () => {
          chosenOrder = order;
          dialog.close();
          if (!answer) void this.sortRecords(order).catch((e) => toast(errorText(e)));
        }, { class: 'primary' }),
      ),
    );
    draw();
    document.body.append(dialog);
    dialog.showModal();
  }

  // ---------------------------------------------------------- button actions

  async action(o: LayoutObject, row?: RowContext): Promise<void> {
    if (o.kind === 'popover-button' && o.target !== undefined) return this.togglePopover(o.target, o.id);
    const a = o.action;
    if (!a) return;
    if (this.mode === 'find' && !['Perform Find', 'Enter Browse Mode', 'Go to Layout', 'Show All Records'].includes(a.step)) return;
    try {
      switch (a.step) {
        case 'Perform Script':
          if (!a.script) throw new Error('This button runs a script in another file.');
          this.noteRecord(this.index);
          this.note({ kind: 'script', script: a.script, ...(a.parameter ? { parameter: a.parameter } : {}) });
          await this.runButton(o, row);
          break;
        case 'Go to Layout':
          if (a.layout) await this.goToLayout(a.layout);
          else await this.runButton(o, row);
          break;
        case 'New Record/Request': if (this.mode === 'find') this.newRequest(); else await this.newRecord(); break;
        case 'Delete Record/Request': if (this.mode === 'find') this.deleteRequest(); else await this.deleteRecord(); break;
        case 'Commit Records/Requests': await this.commit(false); break;
        case 'Show All Records': await this.showAll(); break;
        case 'Enter Find Mode': await this.enterFind(); break;
        case 'Perform Find': await this.performFind(); break;
        case 'Enter Browse Mode': await this.enterBrowse(); break;
        case 'Close Popover': this.closePopover(); break;
        case 'Delete Portal Row': await this.deletePortalRow(row); break;
        case 'Beep': break;
        // Anything else runs on the server as a one-step script.
        default: await this.runButton(o, row);
      }
    } catch (e) {
      toast(errorText(e));
    }
  }

  /** Set while a script runs: what it changes doesn't fire script triggers. */
  private scripting = false;

  /**
   * Runs a script trigger of the layout (or of object `o`) for `event`, if it
   * has one. Triggers don't fire for changes a script makes, so a trigger's
   * script can't set itself off again.
   */
  async fire(event: string, o?: LayoutObject, row?: RowContext, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (this.scripting || !this.meta || !this.hasTrigger(event, o)) return true;
    try {
      const r = await this.runButton(o, row, event, extra);
      // A trigger that fires before its event cancels it when its script exits with False.
      return !(PRE_EVENTS.has(event) && r && r.result.trim() !== '' && Number(r.result) === 0);
    } catch (e) {
      toast(errorText(e));
      return true;
    }
  }

  /** The layout (or object `o`) has a trigger for `event` in this mode (Browse mode unless it says otherwise). */
  private hasTrigger(event: string, o?: LayoutObject): boolean {
    const triggers = o ? o.triggers : this.meta?.design.triggers;
    return !!triggers?.some((t) => t.event === event && (t.modes ?? ['browse']).includes(this.windowMode));
  }

  /** Auto-complete: the field's indexed values starting with what's typed. */
  /**
   * Found-set portals' rows (portals on the layout's own occurrence) for the found set they were fetched for: one place
   * per record found, filled as rows are fetched, with how many each fetch asks for (the rows it shows, and a few more).
   */
  private foundRows = new Map<string, FoundPortalRows>();
  private foundRowsKey = '';
  /** Bumped when the found set is read again, so found-set portals fetch their rows again too. */
  private foundRowsAsked = 0;

  /**
   * A found-set portal's rows: the window's found set, as far as fetched, with the current record's row as it is now.
   * The first call for a found set fetches the rows the portal shows; scrolling fetches the rest as they come into view.
   */
  foundSetRows(portal: string, shown: number): (PortalRow | undefined)[] | undefined {
    const meta = this.meta;
    if (!meta) return undefined;
    // Before the found set is read (or with none), there is nothing to fetch.
    if (!this.foundCount) return [];
    const key = JSON.stringify([meta.layout.name, this.query, this.sort, this.ids, this.foundCount, this.foundRowsAsked]);
    if (key !== this.foundRowsKey) {
      this.foundRowsKey = key;
      this.foundRows.clear();
    }
    let got = this.foundRows.get(portal);
    if (!got) {
      got = { rows: [], page: Math.max(1, shown) + FOUND_ROWS_SPARE, asked: new Set(), top: 0 };
      this.foundRows.set(portal, got);
      this.fetchFoundRows(portal, 0, got.page - 1);
    }
    const rec = this.record;
    const own = rec?.portalData[portal]?.find((r) => r.recordId === rec.recordId);
    return own ? got.rows.map((r) => (r?.recordId === own.recordId ? own : r)) : got.rows;
  }

  /**
   * A saved record's row in the found-set portals, read again: the record's own portal data covers only the first rows,
   * so for a record further down the fetched row would otherwise keep showing what the field held before.
   */
  private refetchFoundRow(recordId: string): void {
    for (const [portal, got] of this.foundRows) {
      const versions = got.versions ??= new Map<string, FoundPortalVersion>(got.rows.flatMap((row) => row ? [[row.recordId, { generation: 0, modId: row.modId }] as const] : []));
      const generation = got.generation = (got.generation ?? 0) + 1;
      versions.set(recordId, { generation, modId: versions.get(recordId)?.modId });
      const i = got.rows.findIndex((r) => r?.recordId === recordId);
      for (const key of [recordId, i]) {
        got.failures?.delete(key);
        got.failed?.delete(key);
      }
      if (i < 0 && !got.displaced?.has(recordId)) continue;
      (got.stale ??= new Set()).add(recordId);
      got.rejections?.delete(recordId);
      // A later save supersedes any response or delayed retry for the same record.
      for (const request of got.requests ?? []) {
        request.records.delete(recordId);
        request.positions.delete(i);
      }
      this.retryFoundRows(portal);
    }
  }

  /** A found-set portal scrolled: the rows in view (and a page past them) are fetched if they aren't yet. */
  foundSetScrolled(portal: string, top: number, first: number, last: number): void {
    const got = this.foundRows.get(portal);
    if (!got) return;
    got.top = top;
    this.fetchFoundRows(portal, first, last + got.page);
  }

  /** The most related records of one portal the page fetches beyond the 50 that come with a record. */
  private static readonly PORTAL_CAP = 2000;
  /** Portal rows already fetched or being fetched, by record. */
  private morePortals = new WeakMap<DataRecord, Map<string, Promise<PortalRow[]>>>();
  /** The rest of a long portal for the record shown: fetched in pieces once, added to the record, and given to the portal to draw. */
  morePortalRows(portal: string, record: DataRecord, have: number, total: number): Promise<PortalRow[]> {
    const asked = this.morePortals.get(record) ?? new Map<string, Promise<PortalRow[]>>();
    this.morePortals.set(record, asked);
    const known = asked.get(portal);
    if (known) return known;
    const layout = this.meta!.layout.name;
    const generation = this.displayGeneration;
    const fetched = (async (): Promise<PortalRow[]> => {
      const rows: PortalRow[] = [];
      try {
        while (have + rows.length < Math.min(total, Session.PORTAL_CAP)) {
          const piece = await this.api.portalRows(layout, record.recordId, portal, have + rows.length + 1, Math.min(500, Session.PORTAL_CAP - have - rows.length));
          if (!piece.length || generation !== this.displayGeneration) break;
          rows.push(...piece);
        }
      } catch { /* the 50 it came with stay; a later draw asks again */ asked.delete(portal); }
      if (generation === this.displayGeneration) (record.portalData[portal] ??= []).push(...rows);
      return rows;
    })();
    asked.set(portal, fetched);
    return fetched;
  }
  foundSetScrollTop(portal: string): number {
    return this.foundRows.get(portal)?.top ?? 0;
  }

  /** Requests stale records that no outstanding request covers, batching adjacent rows with the same delay. */
  private retryFoundRows(portal: string, ready = new Set<string>()): void {
    const got = this.foundRows.get(portal);
    const stale = got?.stale;
    if (!got || !stale?.size) return;
    const requests = [...got.requests ?? []];
    const delayFor = (id: string) => {
      const failures = got.failures?.get(id) ?? 0;
      if (failures > 1) return Math.min(8000, 250 * 2 ** (failures - 2));
      const rejected = ready.has(id) ? 0 : got.rejections?.get(id) ?? 0;
      return rejected > 1 ? Math.min(250, 25 * 2 ** Math.min(rejected - 2, 4)) : 0;
    };
    for (const id of got.displaced?.keys() ?? []) {
      if (stale.has(id) && !got.failed?.has(id) && !requests.some((request) => request.records.has(id))) {
        const i = Math.max(0, got.rows.findIndex((row) => row?.recordId === id));
        this.fetchFoundRows(portal, i, i, delayFor(id), id);
      }
    }
    const due = got.rows.flatMap((row, i) => row && stale.has(row.recordId)
      && !got.failed?.has(row.recordId)
      && !got.displaced?.has(row.recordId)
      && !requests.some((request) => request.records.has(row.recordId)) ? [i] : []);
    const backoff = (i: number) => delayFor(got.rows[i]!.recordId);
    for (let at = 0; at < due.length;) {
      const first = due[at++];
      let last = first;
      const delay = backoff(first);
      while (at < due.length && due[at] === last + 1 && backoff(due[at]) === delay) last = due[at++];
      for (let i = first; i <= last; i++) got.asked.delete(i);
      this.fetchFoundRows(portal, first, last, delay);
    }
  }

  /** Fetches rows `from` to `to` (0-based) of a found-set portal that aren't fetched or asked for yet, in one request. */
  private fetchFoundRows(portal: string, from: number, to: number, delay = 0, recordId?: string): void {
    const got = this.foundRows.get(portal);
    const meta = this.meta;
    if (!got || !meta) return;
    const total = recordId ? to + 1 : got.rows.length || to + 1;
    let first = from;
    while (!recordId && first <= to && first < total && got.asked.has(first)) first++;
    let last = Math.min(to, total - 1);
    while (!recordId && last >= first && got.asked.has(last)) last--;
    if (first > last) return;
    const stale = got.stale ??= new Set();
    const requests = got.requests ??= new Set();
    const rejections = got.rejections ??= new Map();
    const versions = got.versions ??= new Map<string, FoundPortalVersion>(got.rows.flatMap((row) => row ? [[row.recordId, { generation: 0, modId: row.modId }] as const] : []));
    const rowGeneration = got.generation = (got.generation ?? 0) + 1;
    const records = recordId ? [recordId] : got.rows.slice(first, last + 1).map((row) => row?.recordId);
    const request: FoundPortalRequest = { positions: new Set(), records: new Set(records.filter((id): id is string => id !== undefined && !got.failed?.has(id))) };
    for (const id of request.records) {
      stale.add(id);
      for (const earlier of requests) earlier.records.delete(id);
    }
    for (let i = first; i <= last; i++) {
      if (got.failed?.has(i) || (got.rows[i] && got.failed?.has(got.rows[i]!.recordId))) continue;
      if (recordId && got.rows[i]?.recordId !== recordId) continue;
      got.asked.add(i);
      request.positions.add(i);
      // Positions decide which cells may be painted; they never discharge a stale record.
      for (const earlier of requests) earlier.positions.delete(i);
    }
    requests.add(request);
    const key = this.foundRowsKey;
    const generation = this.displayGeneration;
    const window = this.frontWindow().id;
    const obsolete = () => this.foundRowsKey !== key || generation !== this.displayGeneration || window !== this.frontWindow().id;
    const current = () => this.meta === meta && this.foundRows.get(portal) === got;
    const finish = (error?: unknown) => {
      requests.delete(request);
      const retry = error !== undefined && retryableRequest(error);
      let stopped = false;
      if (error !== undefined) {
        const failures = got.failures ??= new Map();
        // Failed cached rows follow their identities; only unfetched cells need a positional failure.
        const keys = [...request.records, ...[...request.positions].filter((i) => !got.rows[i])];
        for (const key of keys) {
          const attempts = (failures.get(key) ?? 0) + 1;
          failures.set(key, attempts);
          if (!retry || attempts >= 5) {
            (got.failed ??= new Map()).set(key, error);
            stopped = true;
          }
        }
      }
      const empty: number[] = [];
      for (const i of request.positions) {
        const id = got.rows[i]?.recordId;
        if (!got.failed?.has(id ?? i)) got.asked.delete(i);
        if (id) stale.add(id);
        else if (retry && !got.failed?.has(i)) empty.push(i);
      }
      for (const id of request.records) if (stale.has(id)) rejections.set(id, (rejections.get(id) ?? 0) + 1);
      this.retryFoundRows(portal);
      for (let at = 0; at < empty.length;) {
        const first = empty[at++];
        let last = first;
        const failures = got.failures!.get(first)!;
        while (at < empty.length && empty[at] === last + 1 && got.failures!.get(empty[at]) === failures) last = empty[at++];
        this.fetchFoundRows(portal, first, last, failures === 1 ? 0 : Math.min(8000, 250 * 2 ** (failures - 2)));
      }
      if (stopped) toast(errorText(error));
    };
    const load = () => {
      if (!current()) return;
      // Requeue a delayed retry at its current position without counting the timer as a rejected response.
      if (obsolete()) {
        requests.delete(request);
        this.retryFoundRows(portal, request.records);
        return;
      }
      if (!request.positions.size && !request.records.size) {
        requests.delete(request);
        this.retryFoundRows(portal);
        return;
      }
      void this.api.foundSetPortal(meta.layout.name, { portal, ...(this.ids ? { ids: this.ids } : { query: this.query }), sort: this.sort, offset: first + 1, limit: last - first + 1, ...(recordId ? { recordId } : {}) })
        .then((res) => {
          if (!current()) return;
          if (obsolete() || (recordId ? !request.records.has(recordId) : !request.positions.size)) return finish();
          let painted = false;
          const displace = (row: PortalRow) => {
            (got.displaced ??= new Map()).set(row.recordId, row);
            stale.add(row.recordId);
          };
          // Preserve identities before shrinking: an empty old position says nothing about a moved record.
          got.rows.slice(res.count).forEach((row) => { if (row && stale.has(row.recordId)) displace(row); });
          if (got.rows.length !== res.count) got.rows.length = res.count;
          for (const i of got.asked) if (i >= res.count) got.asked.delete(i);
          if (recordId && res.offset === 0) {
            versions.set(recordId, { generation: rowGeneration });
            got.rows.forEach((row, i) => { if (row?.recordId === recordId) { delete got.rows[i]; got.asked.delete(i); } });
            stale.delete(recordId);
            rejections.delete(recordId);
            got.displaced?.delete(recordId);
            request.positions.clear();
            painted = true;
          }
          res.rows.forEach((row, at) => {
            const i = (recordId ? (res.offset ?? first + 1) - 1 : first) + at;
            if (i < 0 || i >= res.count || (recordId ? row.recordId !== recordId : !request.positions.has(i))) return;
            const id = records[at];
            if (id && (id !== row.recordId || !request.records.has(id))) {
              if (request.records.has(id) && got.rows[i]?.recordId === id) displace(got.rows[i]!);
              return;
            }
            // Even an empty requested position can return an identity refreshed by a newer request.
            const known = versions.get(row.recordId);
            if (known && (known.generation > rowGeneration || (known.modId !== undefined
              && /^\d+$/.test(known.modId) && /^\d+$/.test(row.modId) && BigInt(known.modId) > BigInt(row.modId)))) return;
            versions.set(row.recordId, { generation: rowGeneration, modId: row.modId });
            if (recordId) {
              got.rows.forEach((old, at) => { if (old?.recordId === recordId) { delete got.rows[at]; got.asked.delete(at); } });
              const old = got.rows[i];
              if (old && old.recordId !== recordId) displace(old);
              for (const other of requests) other.positions.delete(i);
              request.positions.clear();
              got.asked.add(i);
              got.displaced?.delete(recordId);
            }
            got.rows[i] = row;
            got.failures?.delete(row.recordId);
            got.failures?.delete(i);
            got.failed?.delete(row.recordId);
            got.failed?.delete(i);
            request.positions.delete(i);
            if (request.records.has(row.recordId)) {
              stale.delete(row.recordId);
              rejections.delete(row.recordId);
            }
            painted = true;
          });
          finish();
          if (!painted) return;
          if (this.mode !== 'browse' || this.preview) return this.renderKeepingTyping();
          // An asynchronous portal page must not replace sibling viewers or fields someone has already used.
          const repaint = (objects: LayoutObject[], path: LayoutObject[] = []) => {
            for (const o of objects) {
              if (o.kind === 'portal') {
                const name = o.name ?? o.portal?.tableOccurrence ?? '';
                const setup = meta.portals.find((p) => p.name === name) ?? meta.portals.find((p) => p.occurrence === o.portal?.tableOccurrence);
                if (setup?.name === portal) this.repaintObject({ o, path });
              } else if (o.children) repaint(o.children, [...path, o]);
            }
          };
          repaint(meta.design.objects);
        }, (error) => { if (current()) finish(error); });
    };
    // Only repeated rejection of the same record delays its next request.
    if (delay) setTimeout(load, delay);
    else load();
  }

  /** A click on a found-set portal's row: that record of the found set. */
  goToRecordId(recordId: string): void {
    for (const [i, rec] of this.cache) if (rec.recordId === recordId) return void this.goTo(i);
    for (const { rows } of this.foundRows.values()) {
      const i = rows.findIndex((r) => r?.recordId === recordId);
      if (i >= 0) return void this.goTo(i);
    }
  }

  async fieldIndex(key: string, prefix: string): Promise<string[]> {
    return this.meta ? this.api.fieldIndex(this.meta.layout.name, key, prefix) : [];
  }

  /** A tab or slide control's OnPanelSwitch, before panel `p` comes to the front; true to switch it in place. */
  async switchPanel(o: LayoutObject, p: LayoutObject): Promise<boolean> {
    if (this.scripting || !this.hasTrigger('OnPanelSwitch', o)) return true;
    const panels = (o.children ?? []).filter((c) => c.kind === 'tab-panel' || c.kind === 'slide-panel');
    const current = panels.find((c) => c.id === this.panels.get(o.id)) ?? panels[0];
    const at = (c?: LayoutObject) => (c ? `${panels.indexOf(c) + 1};${c.name ?? ''}` : '');
    if (!(await this.fire('OnPanelSwitch', o, undefined, { panel: { current: at(current), target: at(p) } }))) return false;
    // The script redrew the layout: bring the panel to the front in the new drawing.
    this.panels.set(o.id, p.id);
    this.render();
    return false;
  }

  fieldEvent(o: LayoutObject, event: 'OnObjectEnter' | 'OnObjectExit' | 'OnObjectModify' | 'OnObjectSave', row?: RowContext): void {
    if (event === 'OnObjectSave') {
      if (this.quietFocus || !o.triggers?.some((t) => t.event === 'OnObjectSave' || t.event === 'OnObjectValidate')) return;
      // OnObjectValidate first: a script that exits False keeps the cursor in the field, and OnObjectSave doesn't run.
      this.fieldTriggers = this.fieldTriggers.then(() => this.saving).then(async () => {
        if (!(await this.fire('OnObjectValidate', o, row))) {
          this.refocus(String(o.id));
          return;
        }
        await this.fire('OnObjectSave', o, row);
      });
      return;
    }
    if (this.quietFocus || !o.triggers?.some((t) => t.event === event)) return;
    // After the value is saved, so the script sees it, and in order: a field's OnObjectSave runs before its OnObjectExit.
    this.fieldTriggers = this.fieldTriggers.then(() => this.saving).then(() => this.fire(event, o, row));
  }

  /** The field triggers waiting to run, one after another. */
  private fieldTriggers: Promise<unknown> = Promise.resolve();

  /** Runs a button's script (or a script trigger's) on the server, then shows what it left: layout, found set, record, mode. */
  private async runButton(o: LayoutObject | undefined, row?: RowContext, trigger?: string, extra: Record<string, unknown> = {}): Promise<ScriptRun | undefined> {
    // A timer's script finishes first; then the click (or trigger) runs, rather than being lost.
    if (this.scripting && this.timerRun && extra.timer === undefined) await this.timerRun.catch(() => undefined);
    if (this.scripting) return undefined;
    this.scripting = true;
    this.content.setAttribute('aria-busy', 'true');
    const before = this.urlReady ? location.pathname + location.search + location.hash : '';
    let scriptDone!: () => void;
    this.scriptEnded = new Promise<void>((resolve) => { scriptDone = resolve; });
    try {
      return await this.runScriptCall(o, row, trigger, extra);
    } finally {
      this.scripting = false;
      // The script applied its layout, record and found set without writing the address: write where it left the screen, then
      // keep one entry for it, so Back returns to where it started. A Back pressed meanwhile already moved the address; that stays.
      try {
        if (this.urlReady && !this.popDuringScript) {
          this.writeScreenUrl(false);
          const after = location.pathname + location.search + location.hash;
          if (after !== before && !this.restoringUrlState) { writeAddress(history, before, false); writeAddress(history, after, true); }
        }
      } finally {
        this.popDuringScript = false;
        scriptDone();
        this.content.removeAttribute('aria-busy');
        // Failed requests and display actions must thaw too, before another script can start.
        const frozen = this.frozenWindows.size > 0;
        this.frozenWindows.clear();
        if (frozen) this.renderKeepingTyping();
      }
    }
  }

  private async runScriptCall(o: LayoutObject | undefined, row?: RowContext, trigger?: string, extra: Record<string, unknown> = {}): Promise<ScriptRun> {
    // Leaving a field fires its OnObjectExit after the save; committing here would blur it again.
    if (!['OnObjectExit', 'OnObjectEnter', 'OnObjectValidate', 'OnObjectSave', 'OnObjectKeystroke', 'OnLayoutKeystroke'].includes(trigger ?? '')) {
      await this.commit(false);
      // The record is committed: let go of this window's edit locks, so the script (in a session of its own) can change it.
      await this.locks.releaseAll();
    } else await this.saving;
    const rec = this.record;
    // Where it started, for "Why?" when it stops with an error.
    const started: { layout?: string; recordId?: number; parameter?: string } = { layout: this.meta!.layout.name, ...(rec ? { recordId: Number(rec.recordId) } : {}),
      ...(typeof extra.parameter === 'string' ? { parameter: extra.parameter } : {}) };
    const before = { ids: this.ids && [...this.ids], query: this.query, sort: this.sort };
    // A field's own trigger runs with the cursor in that field (and row): leaving it runs its OnObjectExit.
    const activeObject = trigger?.startsWith('OnObject') && o?.kind === 'field' ? o.id : undefined;
    let r: ScriptRun = await this.whileRunning(this.api.button(this.meta!.layout.name, {
      objectId: o?.id,
      activeObjectId: Number(document.activeElement?.closest<HTMLElement>('.fm[data-id]')?.dataset.id) || this.activeObjectId,
      ...this.displayPortals(), layoutId: this.meta!.layout.id, displayRecords: [...this.cache.values()].map((r) => Number(r.recordId)),
      ...(trigger ? { trigger } : {}),
      ...(activeObject !== undefined && Number.isInteger(activeObject) ? { activeObject } : {}),
      ...(activeObject !== undefined && activeObject === o?.id && row?.row.recordId ? { activeRow: Number(row.row.recordId) } : {}),
      ...extra,
      recordId: rec ? Number(rec.recordId) : undefined,
      row: row?.row.recordId ? { portal: row.portal, recordId: row.row.recordId } : undefined,
      ...(this.ids ? { ids: this.ids } : { query: this.query, sort: this.sort }),
      mode: this.windowMode, view: this.view, totalCount: this.totalCount,
      ...(this.preview ? { preview: true } : {}),
      ...(this.lastVisited && this.lastVisitedLayout ? { lastVisited: { layout: this.lastVisitedLayout, recordId: Number(this.lastVisited) } } : {}),
      // The window the script starts in, and every window open in this browser window (front last).
      window: this.frontWindow(), windows: [...this.behind.map((b) => ({ ...b.win, layout: b.state.meta?.layout.name,
        recordId: Number(b.state.cache.get(b.state.index)?.recordId),
        ...(b.state.ids ? { ids: b.state.ids } : { query: b.state.query ?? [] }), sort: b.state.sort })), this.frontWindow()],
    }));
    let openAfter: string | undefined;
    // Freeze Window: the screen stays as it was while the script asks for a dialog, until Refresh Window (a pause repaints too).
    const isFrozen = () => this.frozenWindows.has(r.window?.id ?? this.frontWindow().id);
    let goTo: string | undefined;
    let print = false;
    // An open popover stays open through a script that doesn't close it, as in FileMaker.
    let keepPopover = true;
    // View As: applied once the window shows the layout the script left.
    let view: string | undefined;
    let checkpointVersion: number | undefined;
    // Scroll Window: applied in order once the window shows what the script left.
    const scrolls: string[] = [];
    const perform = async (actions: ScriptRun['actions']) => {
      for (const act of actions) {
        if (act.step === 'Freeze Window') {
          this.frozenWindows.add(String(act.windowId ?? this.frontWindow().id));
        } else if (act.step.startsWith('Refresh ')) {
          if (act.step !== 'Refresh Window') await this.ensureActionDisplay(act);
          await this.applyRefresh(act);
        } else if (act.step === 'Set Web Viewer') {
          await this.setWebViewer(act);
        } else if (act.step === 'Show Custom Dialog') {
          const lines = [act.title, act.message].filter((x) => typeof x === 'string' && x) as string[];
          alert(lines.join('\n\n'));
        } else if ((act.step === 'Open URL' || act.step === 'Dial Phone') && typeof act.url === 'string' && /^(https?|mailto|tel):/i.test(act.url)) {
          window.open(act.url, '_blank', 'noopener');
        } else if (typeof act.clipboard === 'string') {
          // Copy, Cut, Copy Record/Request: onto the person's own clipboard, with real line breaks.
          const copy = act.clipboard.replace(/\r\n?/g, '\n');
          navigator.clipboard?.writeText(copy).catch(() => toast("The browser didn't allow writing to the clipboard."));
        } else if (typeof act.download === 'string' && typeof act.base64 === 'string') {
          // Export Records, Save Records as Excel or PDF, Close PDF: the file goes to the person's downloads, as in WebDirect.
          saveDownload(act.download, base64Blob(act.base64));
        } else if (act.step === 'Export Field Contents' && typeof act.filename === 'string' && (typeof act.base64 === 'string' || typeof act.url === 'string')) {
          saveDownload(act.filename, typeof act.base64 === 'string' ? base64Blob(act.base64) : String(act.url));
        } else if (act.step === 'Install Menu Set' && typeof act.menuSetId === 'number') {
          this.installMenuSet(act.menuSetId);
        } else if (act.step === 'Go to Object' && typeof act.objectName === 'string') {
          goTo = act.objectName;
          const target = this.findObject(act.objectName);
          this.activeObjectId = target?.o.id;
          if (!isFrozen() && target && this.popover && ![...target.path, target.o].some((o) => o.id === this.popover!.id)) this.closePopover();
        } else if (act.step === 'Print') {
          print = true;
        } else if (act.step === 'Install OnTimer Script') {
          this.installTimer(Number(act.interval) || 0, typeof act.timer === 'string' ? act.timer : undefined);
        } else if (act.step === 'Perform JavaScript in Web Viewer' && typeof act.functionName === 'string') {
          await this.ensureActionDisplay(act);
          // A Go to Object before it (a viewer in a closed popover) shows the object and opens its popover first; the run's end focuses it.
          if (goTo) {
            this.showObject(goTo);
            const target = this.findObject(goTo);
            if (target && !isFrozen()) this.openPopoverOf(target);
          }
          await this.performJavaScript(String(act.objectName ?? ''), act.functionName, Array.isArray(act.parameters) ? act.parameters.map(String) : []);
        } else if (act.step === 'Close Popover') {
          this.closePopover();
          const target = goTo ? this.findObject(goTo) : undefined;
          if (target && [...target.path, target.o].some((o) => o.kind === 'popover')) goTo = undefined;
          keepPopover = false;
        } else if (act.step === 'View As' && typeof act.view === 'string') {
          view = act.view;
        } else if (act.step === 'Scroll Window' && typeof act.scroll === 'string') {
          scrolls.push(act.scroll);
        } else if (act.step === 'Set Zoom Level' && (typeof act.zoom === 'number' || act.zoom === 'in' || act.zoom === 'out')) {
          this.scriptZoom(act.zoom);
          this.zoomLocked = act.lock === true;
        } else if (act.step === 'Show/Hide Toolbars' && typeof act.showHide === 'string') {
          // For this session only: the person's own choice (View > Status Toolbar) is what's remembered.
          this.statusToolbarHidden = act.showHide === 'toggle' ? !this.statusToolbarHidden : act.showHide === 'hide';
          this.toolbarLocked = act.lock === true;
          this.renderToolbar();
        } else if (act.step === 'Show/Hide Menubar' && typeof act.showHide === 'string' && this.menuBar) {
          const bar = this.menuBar.element;
          bar.hidden = act.showHide === 'toggle' ? !bar.hidden : act.showHide === 'hide';
        } else if (act.step === 'Beep') {
          beep();
        } else if (typeof act.open === 'string' && /^design\.html(#\w+)?$/.test(act.open)) {
          // Open Manage Database, Open Script Workspace, ...: the Design screen, once the script is done
          openAfter = act.open;
        } else if (act.open === 'saved-finds') {
          this.editSavedFinds();
        }
      }
    };
    // Insert File: the script waits while the person picks a file (or cancels).
    // Pause/Resume Script: it waits while the person looks at the window it left, until Continue or Cancel.
    // Show Custom Dialog: it waits for a button, over the window as the script left it.
    // Each answer brings the actions since the last one.
    while (r.waiting) {
      if (r.waiting.step === 'Checkpoint') {
        await this.showRun(r, goTo, { keepPopover, view, reload: false });
        if (!isFrozen()) goTo = undefined;
        await perform(r.actions ?? []);
        // Scrolls so far belong to the window as it stands now, before the script moves on (perhaps to another layout).
        for (const to of scrolls.splice(0)) this.scrollWindow(to);
        checkpointVersion = r.syncVersion;
        r = await this.api.continueRun(r.waiting.run, true, this.displayPortals());
        continue;
      }
      await perform(r.actions ?? []);
      if (r.waiting.step === 'Pause') {
        this.frozenWindows.delete(r.window?.id ?? this.frontWindow().id);
        await this.showRun(r, goTo, { keepPopover, view, scrolls: scrolls.splice(0) });
        goTo = undefined;
        const go = await new Promise<boolean>((resolve) => {
          this.pausedRun = resolve;
          this.renderToolbar();
        });
        this.pausedRun = undefined;
        r = await this.whileRunning(this.api.continueRun(r.waiting.run, go));
      } else if (r.waiting.step === 'Sort') {
        // The dialog lists the fields of the layout the script is on, so it repaints even when frozen.
        this.frozenWindows.delete(r.window?.id ?? this.frontWindow().id);
        await this.showRun(r, goTo, { keepPopover, view, scrolls: scrolls.splice(0) });
        goTo = undefined;
        const initial = r.waiting.sort;
        const order = await new Promise<SortSpec[] | undefined>((resolve) => this.openSortDialog(this.sortFields(), initial, resolve));
        r = await this.whileRunning(this.api.answerSort(r.waiting.run, order));
      } else if (r.waiting.step === 'Index') {
        // Insert from Index: View Index over the window as the script left it.
        if (!isFrozen()) {
          await this.showRun(r, goTo, { keepPopover, view, scrolls: scrolls.splice(0) });
          goTo = undefined;
        }
        r = await this.whileRunning(this.api.answerIndex(r.waiting.run, await viewIndex(r.waiting.values ?? [])));
      } else if (r.waiting.step === 'Dialog') {
        if (!isFrozen()) {
          await this.showRun(r, goTo, { keepPopover, view, scrolls: scrolls.splice(0) });
          goTo = undefined;
        }
        r = await this.whileRunning(this.api.answerDialog(r.waiting.run, await customDialog(r.waiting)));
      } else if (r.waiting.step === 'Device') {
        // Insert from Device: the camera, signature pad, bar code reader or microphone, over the window as it stands.
        if (!isFrozen()) {
          await this.showRun(r, goTo, { keepPopover, view, scrolls: scrolls.splice(0) });
          goTo = undefined;
        }
        const got = await fromDevice((r.waiting.type ?? 'Camera') as DeviceType, r.waiting.camera);
        r = await this.whileRunning(typeof got === 'string' ? this.api.answerText(r.waiting.run, got) : this.api.answerRun(r.waiting.run, got));
      } else if (r.waiting.step === 'Location') {
        r = await this.whileRunning(this.api.answerLocation(r.waiting.run, await locate()));
      } else if (r.waiting.step === 'Clipboard') {
        // Paste with nothing copied in the script: what is on the person's own clipboard.
        r = await this.whileRunning(this.api.answerText(r.waiting.run, await personClipboard()));
      } else {
        r = await this.whileRunning(this.api.answerRun(r.waiting.run, await chooseFile(r.waiting.title)));
      }
    }
    await perform(r.actions ?? []);
    for (const warning of r.warnings ?? []) toast(warning, 'error');
    if (openAfter) {
      location.href = openAfter;
      return r;
    }
    // A menu command's "no records match" is told by the command itself.
    const failureMessage = scriptFailureMessage(r, typeof extra.command === 'string' ? extra.command : undefined);
    if (failureMessage) {
      // "Why?": the assistant runs it again on a copy, offline, and explains the failing step in plain English.
      const failure = { script: r.script, error: r.error, ...(r.message ? { message: r.message } : {}), ...(started.layout ? { layout: started.layout } : {}), ...(started.recordId !== undefined ? { recordId: started.recordId } : {}), ...(started.parameter !== undefined ? { parameter: started.parameter } : {}) };
      toast(failureMessage, 'error',
        this.assistant && this.canExplainScripts ? { label: 'Why?', run: () => void this.assistant!.explainFailure(failure) } : undefined);
    }
    const frozen = this.frozenWindows.size > 0;
    this.frozenWindows.clear();
    if (frozen) this.renderKeepingTyping();
    await this.showRun(r, goTo, { keepPopover, view, reload: checkpointVersion === undefined || checkpointVersion !== r.syncVersion, scrolls: scrolls.splice(0) });
    if (print) await this.print(true);
    // Replace Field Contents and Delete All Records can be taken back, unlike in FileMaker.
    const undo = r.undo;
    if (undo) toast(`${undo.summary}.`, 'info', { label: 'Undo', run: () => void this.undoChange(undo.id, undo.kind === 'delete' ? before : undefined) });
    return r;
  }

  /** Undo on a bulk change's toast: puts the values back, then shows the records again. */
  private async undoChange(id: string, before?: { ids?: number[]; query?: FindRequest[]; sort?: SortSpec[] }): Promise<void> {
    try {
      const { undone, skipped } = await this.api.undoChange(id);
      // Deleted records come back into the found set they were deleted from.
      if (before) Object.assign(this, { ids: before.ids && [...before.ids], query: before.query, sort: before.sort });
      await this.reload(this.record?.recordId);
      toast(skipped.length ? `Undone, except ${skipped.length} value${skipped.length === 1 ? '' : 's'} changed since.` : `Undone (${undone} record${undone === 1 ? '' : 's'}).`, 'info');
    } catch (e) {
      toast(errorText(e));
    }
  }

  /** The window's OnTimer script (Install OnTimer Script), as the id the server gave it. */
  private timer?: ReturnType<typeof setInterval>;
  private readonly viewerStates = new Map<string, ViewerState>();
  private readonly frozenWindows = new Set<string>();
  private displayGeneration = 0;
  private activeObjectId?: number;
  private drawnLayoutId?: number;
  private drawnWindowId?: string;

  viewer(o: LayoutObject, row: RowContext | undefined, address: string | undefined): { key: string; state: ViewerState } {
    const key = viewerKey(this.frontWindow().id, this.meta!.layout.id, this.record?.recordId ?? '', o.id, row?.row.recordId);
    let state = this.viewerStates.get(key);
    if (!state) this.viewerStates.set(key, state = new ViewerState(address));
    else state.address(address);
    return { key, state };
  }

  /** Runs timer `id` every `seconds`, replacing the window's timer; no id or 0 seconds stops it. */
  private installTimer(seconds: number, id?: string): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    if (!id || !(seconds > 0)) return;
    this.timer = setInterval(() => void this.fireTimer(id), Math.max(seconds * 1000, 50));
  }

  /**
   * One tick of the timer. A script that is running goes first, as in
   * FileMaker; and while the cursor is in a field the tick is skipped, so a
   * timer never pulls someone out of what they are typing. The next tick
   * tries again.
   */
  private async fireTimer(id: string): Promise<void> {
    const active = document.activeElement as HTMLElement | null;
    if (this.scripting || !this.meta || (active && this.content.contains(active) && active.matches('input, textarea, select, [contenteditable]'))) return;
    try {
      this.timerRun = this.runButton(undefined, undefined, undefined, { timer: id });
      await this.timerRun;
    } catch (e) {
      // The server no longer has it (it restarted, or the session ended): stop asking.
      this.installTimer(0);
      toast(errorText(e));
    } finally {
      this.timerRun = undefined;
    }
  }

  /** The timer's script while it runs. */
  private timerRun?: Promise<ScriptRun | undefined>;
  /** The wait after a window resize before OnLayoutSizeChange runs. */
  private resized?: ReturnType<typeof setTimeout>;

  /** Perform JavaScript in Web Viewer: the named web viewer's global function, with the parameters as text. */
  private async performJavaScript(object: string, fn: string, args: string[]): Promise<void> {
    const found = object ? this.findObject(object) : undefined;
    if (!found || found.o.kind !== 'web-viewer') return;
    const scope = this.content.querySelector('.fm-current') ?? this.content;
    const frame = scope.querySelector<HTMLIFrameElement>(`.fm[data-id="${found.o.id}"] iframe.fm-webviewer`) ?? this.content.querySelector<HTMLIFrameElement>(`.fm[data-id="${found.o.id}"] iframe.fm-webviewer`);
    if (frame) await callWebViewer(frame, fn, args);
  }

  /** Visible child identities and found-set positions, refreshed again at each acknowledgement. */
  private displayPortals(): Record<string, unknown> {
    const displayPortals: Record<string, Record<string, number[]>> = {};
    const foundPortalRanges: Record<string, { offset: number; limit: number }> = {};
    for (const part of this.content.querySelectorAll<HTMLElement>('.fm-part[data-record]')) {
      const parent = part.dataset.record!;
      for (const box of part.querySelectorAll<HTMLElement>('.fm[data-id]')) {
        const object = this.findObject((o) => String(o.id) === box.dataset.id)?.o;
        if (object?.kind !== 'portal') continue;
        const name = object.name ?? object.portal?.tableOccurrence ?? '';
        const scroller = box.querySelector<HTMLElement>('.fm-portal-rows');
        const ids = [...box.querySelectorAll<HTMLElement>('.fm-portal-row[data-row]')].filter((row) => !scroller ||
          (row.offsetTop < scroller.scrollTop + scroller.clientHeight && row.offsetTop + row.offsetHeight > scroller.scrollTop)).map((r) => Number(r.dataset.row));
        (displayPortals[parent] ??= {})[name] = ids;
        const cached = this.foundRows.get(name);
        const range = cached && foundPortalRange(ids, this.ids, cached.rows);
        if (range) foundPortalRanges[name] = range;
      }
    }
    return { layoutId: this.meta?.layout.id, displayPortals, foundPortalRanges };
  }

  /** A checkpoint after navigation supplies its own display data; no second request behind the run's transaction. */
  private async ensureActionDisplay(act: Record<string, unknown>): Promise<void> {
    const refresh = act.refresh as RefreshData | undefined;
    if (!refresh) return;
    const record = this.record?.recordId ?? String(this.ids?.[this.index] ?? '');
    const drawn = this.content.querySelector<HTMLElement>('.fm-part[data-record]');
    if (this.drawnWindowId !== this.frontWindow().id || this.drawnLayoutId !== this.meta?.layout.id || !this.record || !drawn || drawn.dataset.record !== record) {
      await this.applyRefresh({ ...act, step: 'Refresh Window', resumeUpdates: false });
    }
  }

  private async applyRefresh(act: Record<string, unknown>): Promise<void> {
    if (!this.meta || !refreshMatches(act, this.frontWindow().id, this.meta.layout.id, this.record?.recordId ?? String(this.ids?.[this.index] ?? ''))) return;
    const refresh = act.refresh as RefreshData | undefined;
    if (!refresh) return;
    this.displayGeneration++;
    const whole = act.step === 'Refresh Window';
    const target = !whole ? this.findObject((o) => o.id === act.objectId) : undefined;
    if (!whole && !target) return;
    const portal = target?.o.kind === 'portal' ? target.o : target?.path.findLast((o) => o.kind === 'portal');
    const portalName = portal && (portal.name ?? portal.portal?.tableOccurrence ?? '');
    const repetition = typeof act.repetition === 'number' ? act.repetition : undefined;
    const indices = new Map([...this.cache].map(([i, r]) => [r.recordId, i]));
    const previousFoundRows = new Map(this.foundRows);
    if (whole) {
      if (act.resumeUpdates !== false) this.frozenWindows.delete(this.frontWindow().id);
      this.closePopover();
      this.displayGeneration++;
      this.cache.clear();
      this.states.clear();
      this.foundRowsAsked++;
      this.foundRows.clear();
      this.foundRowsKey = JSON.stringify([this.meta.layout.name, this.query, this.sort, this.ids, this.foundCount, this.foundRowsAsked]);
      this.groups = undefined;
      this.groupsGeneration++;
      this.findState = refresh.find;
      this.emptyState = refresh.find;
    }
    for (const rec of refresh.records) {
      const i = this.ids ? this.ids.indexOf(Number(rec.recordId)) : indices.get(rec.recordId) ?? this.index;
      if (i < 0) continue;
      const old = this.cache.get(i);
      const requestedPortals = refresh.requestedPortals?.[rec.recordId];
      if (whole || !old) this.cache.set(i, rec);
      else if (act.step === 'Refresh Portal' && portalName) {
        old.portalData[portalName] = rec.portalData[portalName] ?? [];
        if (rec.portalStyles?.[portalName]) (old.portalStyles ??= {})[portalName] = rec.portalStyles[portalName];
        else if (old.portalStyles) delete old.portalStyles[portalName];
      } else if (target) {
        const key = portalName && target.o.field ? `${target.o.field.tableOccurrence}::${target.o.field.field}` : this.renderer!.fieldKey(target.o);
        mergeObjectRecord(old, rec, key, repetition, portalName, portalName ? requestedPortals?.[portalName] : undefined);
        const children = (objects: LayoutObject[], within = portalName) => {
          for (const child of objects) {
            const inPortal = child.kind === 'portal' ? child.name ?? child.portal?.tableOccurrence : within;
            const childKey = inPortal && child.field ? `${child.field.tableOccurrence}::${child.field.field}` : this.renderer!.fieldKey(child);
            mergeObjectRecord(old, rec, childKey, undefined, inPortal, inPortal ? requestedPortals?.[inPortal] : undefined);
            if (child.children) children(child.children, inPortal);
          }
        };
        if (target.o.children) children(target.o.children);
      }
      const next = refresh.states[rec.recordId];
      if (!next) continue;
      const before = this.states.get(rec.recordId);
      if (whole || !before) this.states.set(rec.recordId, next);
      else if (target) {
        const state = mergeObjectState(before, next, target.o);
        if (portalName) {
          state.rows = { ...before.rows };
          if (act.step === 'Refresh Portal') state.rows[portalName] = next.rows?.[portalName] ?? {};
          else {
            state.rows[portalName] = { ...before.rows?.[portalName] };
            const requested = new Set(requestedPortals?.[portalName]?.map(String) ?? rec.portalData[portalName]?.map((row) => row.recordId));
            for (const [id, row] of Object.entries(before.rows?.[portalName] ?? {})) {
              if (!requested.has(id)) continue;
              state.rows[portalName][id] = mergeObjectState(row, next.rows?.[portalName]?.[id] ?? { hidden: [] }, target.o);
            }
            // Previously no formula output in a visible portal row (for example a newly shown viewer).
            for (const row of old?.portalData[portalName] ?? []) if (requested.has(row.recordId) && !state.rows[portalName][row.recordId]) {
              state.rows[portalName][row.recordId] = mergeObjectState({ hidden: [] }, next.rows?.[portalName]?.[row.recordId] ?? { hidden: [] }, target.o);
            }
          }
        }
        this.states.set(rec.recordId, state);
      }
    }
    for (const [name, got] of Object.entries(refresh.foundRows ?? {})) {
      const old = previousFoundRows.get(name);
      if (!whole && act.step === 'Refresh Object' && target && name === portalName && old) {
        mergeFoundObjectRows(old.rows, got.rows, target.o, repetition);
        continue;
      }
      if (!whole && (act.step !== 'Refresh Portal' || name !== portalName)) continue;
      const rows = foundPortalPage(got.rows, got.count, got.offset);
      this.foundRows.set(name, { rows, page: old?.page ?? 50, asked: new Set(got.rows.map((_, i) => (got.offset ?? 1) - 1 + i)), top: old?.top ?? 0 });
    }
    if (whole) this.renderKeepingTyping();
    else if (target && act.repaint !== false) this.repaintObject(target, repetition);
  }

  /** Replace the target in its design parent, including objects that had no DOM node while hidden. */
  private repaintObject(target: { o: LayoutObject; path: LayoutObject[] }, repetition?: number): void {
    if (!this.renderer || this.frozenWindows.has(this.frontWindow().id)) return;
    const { o, path } = target;
    const root = path[0] ?? o;
    const part = [...this.renderer.parts].reverse().find((p) => root.bounds.top >= p.top) ?? this.renderer.parts[0];
    const portal = path.findLast((p) => p.kind === 'portal');
    const name = portal && (portal.name ?? portal.portal?.tableOccurrence ?? '');
    const parent = path.at(-1);
    for (const scope of this.content.querySelectorAll<HTMLElement>(`.fm-part[data-part="${part.top}"]`)) {
      const rec = [...this.cache.values()].find((r) => r.recordId === scope.dataset.record);
      if (!rec) continue;
      const i = [...this.cache].find(([, r]) => r === rec)![0];
      const host = this.hostFor(rec, i);
      const instances = portal ? [...scope.querySelectorAll<HTMLElement>(`.fm[data-id="${portal.id}"] .fm-portal-row[data-row]`)] : [scope];
      for (const instance of instances) {
        const row = portal && name ? rec.portalData[name]?.find((r) => r.recordId === instance.dataset.row) ?? this.foundRows.get(name)?.rows.find((r) => r?.recordId === instance.dataset.row) : undefined;
        if (portal && !row) continue;
        const container = parent && parent !== portal ? instance.querySelector<HTMLElement>(`.fm[data-id="${parent.id}"]`) : instance;
        if (!container) continue; // The design parent is itself hidden.
        const origin = parent ? { top: parent.bounds.top + (parent === portal ? 1 : 0), left: parent.bounds.left + (parent === portal ? 1 : 0), right: parent.bounds.right - (parent === portal ? 1 : 0) } : { top: part.top, left: 0 };
        const old = container.querySelector<HTMLElement>(`:scope > .fm[data-id="${o.id}"]`);
        const fresh = this.renderer.renderObject(o, host, origin, row && name ? { portal: name, row } : undefined);
        if (!fresh) { old?.remove(); continue; }
        const scroll = old?.querySelector('.fm-portal-rows')?.scrollTop ?? 0;
        // A selected field repetition keeps the other cells, their drafts, selection and event handlers.
        if (old && repetition && o.kind === 'field') {
          const before = old.querySelectorAll(':scope > .fm-rep');
          const after = fresh.querySelectorAll(':scope > .fm-rep');
          before.forEach((cell, at) => { if (at !== repetition - 1 && after[at]) after[at].replaceWith(cell); });
        }
        const focus = (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) && old?.contains(document.activeElement)
          ? { ...this.placeOf(document.activeElement), start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : undefined;
        container.insertBefore(fresh, old ?? null);
        this.keepWebViewers(fresh);
        this.quietly(() => old?.remove());
        const rows = fresh.querySelector('.fm-portal-rows');
        if (rows) rows.scrollTop = scroll;
        if (focus?.id) {
          const input = this.inputAt(focus, fresh);
          this.quietly(() => input?.focus());
          if (input && focus.start !== null && focus.end !== null) input.setSelectionRange(focus.start, focus.end);
        }
      }
    }
    this.styles();
  }

  private async setWebViewer(act: Record<string, unknown>): Promise<void> {
    await this.ensureActionDisplay(act);
    if (!this.meta || !refreshMatches(act, this.frontWindow().id, this.meta.layout.id, this.record?.recordId)) return;
    const target = this.findObject((o) => o.id === act.objectId);
    if (!target || target.o.kind !== 'web-viewer') return;
    await this.applyRefresh({ ...act, step: 'Refresh Object', repaint: false });
    const data = act.refresh as RefreshData | undefined;
    const portal = target.path.findLast((o) => o.kind === 'portal');
    const name = portal && (portal.name ?? portal.portal?.tableOccurrence ?? '');
    for (const [i, rec] of this.cache) {
      if (act.recordId !== undefined && String(act.recordId) !== rec.recordId) continue;
      const host = this.hostFor(rec, i);
      const state = data?.states[rec.recordId] ?? this.states.get(rec.recordId);
      const rows = name ? rec.portalData[name] ?? [] : [undefined];
      for (const row of rows) {
        const address = row && name ? state?.rows?.[name]?.[row.recordId]?.web?.[target.o.id] : state?.web?.[target.o.id];
        host.viewer!(target.o, row && name ? { portal: name, row } : undefined, address).state.apply(act.action as ViewerAction, typeof act.url === 'string' ? act.url : undefined);
      }
    }
    const frames = [...this.content.querySelectorAll<HTMLIFrameElement>(`.fm[data-id="${target.o.id}"] iframe.fm-webviewer`)];
    // Same-document traversal restores the existing frame directly, including on browsers without moveBefore.
    if (!frames.length || frames.some((frame) => String(this.viewerStates.get(frame.dataset.viewerKey ?? '')?.generation) !== frame.dataset.viewerGeneration)) this.repaintObject(target);
    for (const frame of this.content.querySelectorAll<HTMLIFrameElement>(`.fm[data-id="${target.o.id}"] iframe.fm-webviewer`)) {
      if (frame.dataset.loaded !== '1') await new Promise<void>((resolve) => { frame.addEventListener('load', () => resolve(), { once: true }); setTimeout(resolve, 5000); });
      const state = frame.dataset.viewerKey && this.viewerStates.get(frame.dataset.viewerKey);
      if (state) restoreViewer(frame, state);
    }
  }

  /**
   * A call from a web viewer page with "Allow JavaScript to perform FileMaker scripts" on (FileMaker.PerformScript, or
   * window.tabularius's data calls). Everything goes through this account's session, so the server's privilege checks apply.
   */
  private async pageCall(objectId: number, method: string, args: unknown[]): Promise<unknown> {
    const text = (v: unknown, what: string): string => {
      if (typeof v !== 'string' || !v) throw new Error(`${what} is missing`);
      return v;
    };
    const fields = (v: unknown): Record<string, Value> => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Field data must be an object of field names and values');
      return v as Record<string, Value>;
    };
    const page = (o: unknown) => {
      const x = (o && typeof o === 'object' ? o : {}) as { offset?: unknown; limit?: unknown; sort?: unknown };
      return {
        offset: Math.max(1, Math.trunc(Number(x.offset) || 1)),
        limit: Math.min(1000, Math.max(1, Math.trunc(Number(x.limit) || 100))),
        ...(Array.isArray(x.sort) ? { sort: x.sort as SortSpec[] } : {}),
      };
    };
    const layout = this.meta?.layout.name;
    switch (method) {
      case 'context': {
        const rec = this.record;
        return {
          file: this.api.db, account: this.accountName, layout, mode: this.windowMode, recordId: rec?.recordId, recordNumber: rec ? this.recordNumber : undefined,
          foundCount: this.foundCount, totalCount: this.totalCount, fieldData: rec?.fieldData,
        };
      }
      // The layouts this account may open (its Layouts menu, without folders), and going to one.
      case 'layouts': return this.listedLayouts().filter((m) => m.kind === 'item' && m.open).map((m) => m.name);
      case 'goToLayout': {
        const name = text(args[0], 'The layout');
        if (!this.listedLayouts().some((m) => m.kind === 'item' && m.open && m.name === name)) throw new Error(`There is no layout "${name}" to go to`);
        await this.goToLayout(name);
        return null;
      }
      case 'records': return this.api.records(text(args[0], 'The layout'), page(args[1]));
      case 'find': {
        const query = Array.isArray(args[1]) ? args[1] : args[1] && typeof args[1] === 'object' ? [args[1]] : undefined;
        if (!query?.length) throw new Error('A find needs at least one request, such as {"Status": "Open"}');
        return this.api.records(text(args[0], 'The layout'), { ...page(args[2]), query: query as FindRequest[] });
      }
      case 'record': return this.api.record(text(args[0], 'The layout'), text(args[1], 'The record id'));
      case 'create': return { recordId: await this.api.create(text(args[0], 'The layout'), fields(args[1])) };
      case 'update': return { modId: await this.api.update(text(args[0], 'The layout'), text(args[1], 'The record id'), fields(args[2])) };
      case 'remove': await this.api.remove(text(args[0], 'The layout'), text(args[1], 'The record id')); return { deleted: true };
      case 'valueList': return this.api.valueList(layout ?? '', text(args[0], 'The value list'));
      case 'summarize': {
        if (!args[0] || typeof args[0] !== 'object') throw new Error('summarize takes a widget, such as {"kind": "number", "layout": "Invoices"}');
        return this.api.summarize(args[0] as Record<string, unknown>);
      }
      // The browser's print dialog for the window as it is (the page, not a preview of records): where a dashboard is saved as PDF.
      case 'print': {
        if (!this.printing) throw new Error('This account isn\'t allowed to print.');
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100)));
        window.print();
        return null;
      }
      case 'performScript': {
        const script = text(args[0], 'The script name');
        // FileMaker queues a script asked for while another runs (option 0, Continue); so does this.
        while (this.scripting) await new Promise((r) => setTimeout(r, 100));
        await this.runButton(undefined, undefined, undefined, { webViewer: objectId, script, parameter: String(args[1] ?? ''), option: Number(args[2]) || 0 });
        return null;
      }
    }
    throw new Error(`No such call: ${method}`);
  }

  /** A paused script waits on this: Continue (true) or Cancel (false). */
  private pausedRun?: (go: boolean) => void;

  // ---------------------------------------------------------- windows a script opens

  /** The front window: one a script opened (New Window), or this browser window itself. */
  private frontWindow(): ScriptWindow {
    return this.front ?? { id: this.windowId, name: this.windowName || document.title, style: 'document' };
  }

  /** What a window shows, kept while another window is in front of it. */
  private windowState(): WindowState {
    return {
      meta: this.meta, renderer: this.renderer, view: this.view, mode: this.mode, preview: this.preview, query: this.query, sort: this.sort,
      ids: this.ids, foundCount: this.foundCount, totalCount: this.totalCount, cache: this.cache, index: this.index, lastTable: this.lastTable,
      requests: this.requests, request: this.request, panels: this.panels, scroll: this.content.scrollTop,
    };
  }

  private restoreWindow(s: WindowState): void {
    const { scroll, ...rest } = s;
    this.clearDisplay();
    Object.assign(this, rest, { groups: undefined, popover: undefined, fitted: undefined });
    this.pendingScroll = scroll;
  }

  /** Pictures of windows behind made so far, to name each one's styles apart. */
  private backdrops = 0;
  /** Scroll position to put back once a window that was behind is drawn again. */
  private pendingScroll?: number;

  /**
   * The windows a script left: windows it closed go (the one behind comes forward, as it was), and a window it opened
   * (or selected) comes to the front, the one it opened over staying behind it. The result's layout, found set and
   * record are then the front window's.
   */
  private followWindows(r: ScriptRun): void {
    for (const id of r.closed ?? []) {
      this.frozenWindows.delete(id);
      for (const key of this.viewerStates.keys()) if (JSON.parse(key)[0] === id) this.viewerStates.delete(key);
      if (id === this.frontWindow().id) this.popWindow();
      else {
        const i = this.behind.findIndex((b) => b.win.id === id);
        if (i >= 0) this.behind.splice(i, 1)[0].backdrop.remove();
      }
    }
    const w = r.window;
    if (!w) return;
    if (w.id === this.frontWindow().id) {
      if (this.front || w.style !== 'document') this.front = { ...w };
      return;
    }
    const i = this.behind.findIndex((b) => b.win.id === w.id);
    if (i >= 0) {
      // Select Window: that window comes forward as it was; this one goes behind it.
      const [target] = this.behind.splice(i, 1);
      target.backdrop.remove();
      this.pushWindow(w, target.state);
    } else this.pushWindow(w);
  }

  /** `w` comes to the front, over this window: a new one starts as a copy of this one, as New Window's does. */
  private pushWindow(w: ScriptWindow, state?: WindowState): void {
    this.closePopover();
    const backdrop = this.backdrop(w);
    this.behind.push({ win: this.frontWindow(), state: this.windowState(), backdrop });
    this.stage.insertBefore(backdrop, this.frame);
    this.front = w;
    if (state) this.restoreWindow(state);
    else {
      this.clearDisplay();
      Object.assign(this, { cache: new Map(this.cache), panels: new Map<number, number>(), groups: undefined, popover: undefined });
    }
    this.syncWindowChrome();
  }

  /** The front window goes; the one behind it comes forward as it was. */
  private popWindow(): void {
    const top = this.behind.pop();
    if (!top) return;
    const id = this.frontWindow().id;
    this.frozenWindows.delete(id);
    for (const key of this.viewerStates.keys()) if (JSON.parse(key)[0] === id) this.viewerStates.delete(key);
    this.closePopover();
    top.backdrop.remove();
    this.front = top.win.id === this.windowId ? undefined : top.win;
    this.restoreWindow(top.state);
    this.syncWindowChrome();
    // Show the restored window even if reloading its layout fails (for example, after another session deletes it).
    this.render();
  }

  /** Select Window from the Window menu, for windows a script opened here. */
  private selectWindow(id: string): void {
    if (id === this.frontWindow().id) return;
    const i = this.behind.findIndex((b) => b.win.id === id);
    if (i < 0) return;
    const [target] = this.behind.splice(i, 1);
    target.backdrop.remove();
    this.pushWindow(target.win, target.state);
    this.render();
    void this.reload();
  }

  /** A picture of the window as it looks now, to stay behind the window coming in front of it (dimmed under a card). */
  private backdrop(over: ScriptWindow): HTMLElement {
    const shot = this.frame.cloneNode(true) as HTMLElement;
    // A copy leaves out what boxes show (their values are properties): the picture shows them as they are.
    const boxes = this.frame.querySelectorAll<HTMLInputElement>('input, textarea, select');
    shot.querySelectorAll<HTMLInputElement>('input, textarea, select').forEach((b, i) => {
      const from = boxes[i];
      if (!from) return;
      if (b.type === 'checkbox' || b.type === 'radio') b.checked = from.checked;
      else b.value = from.value;
    });
    shot.querySelector('.window-close')?.remove();
    // Web viewers would load again in the picture: they show as their frame only.
    for (const f of shot.querySelectorAll('iframe')) f.replaceWith(h('div', { class: f.className }));
    for (const el of shot.querySelectorAll('[id]')) el.removeAttribute('id');
    const content = shot.querySelector<HTMLElement>('.content');
    const top = this.content.scrollTop;
    const dim = over.style === 'card' && over.dimParent !== false;
    // The layout's styles are numbered per layout (s3, e60), and the window in front brings its own: the picture keeps
    // this layout's, renamed so the two don't meet.
    const tag = `w${++this.backdrops}-`;
    const generated = /^[a-z]{1,3}\d+$/;
    for (const el of [shot, ...shot.querySelectorAll<HTMLElement>('[class]')]) {
      const names = [...el.classList];
      if (names.some((c) => generated.test(c))) el.className = names.map((c) => (generated.test(c) ? tag + c : c)).join(' ');
    }
    const sheet = h('style', {}, (this.styleEl?.textContent ?? '').replace(/\.([a-z]{1,3}\d+)(?![\w-])/g, `.${tag}$1`));
    const el = h('div', { class: `window-backdrop${dim ? ' window-dim' : ''}`, 'aria-hidden': 'true' }, sheet, shot);
    el.inert = true;
    if (content) requestAnimationFrame(() => (content.scrollTop = top));
    return el;
  }

  /** A card or dialog in front: the window under it (toolbar and bars too) waits, as in FileMaker. */
  private syncWindowChrome(): void {
    const w = this.frontWindow();
    const modal = this.behind.length > 0 && (w.style === 'card' || w.style === 'dialog');
    for (const el of [this.toolbar, this.windowBar, this.bottomBar]) {
      el.inert = modal;
      el.classList.toggle('window-waiting', modal && w.style === 'card' && w.dimParent !== false);
    }
    this.frame.querySelector(':scope > .window-close')?.remove();
    if (this.closable()) {
      const close = h('button', { type: 'button', class: 'window-close', 'aria-label': `Close ${w.name}`, title: 'Close Window' }, '×');
      close.addEventListener('click', () => void this.closeFrontWindow());
      this.frame.prepend(close);
    }
    this.frame.setAttribute('role', w.style === 'document' ? 'none' : 'dialog');
    if (w.style === 'document') this.frame.removeAttribute('aria-label');
    else this.frame.setAttribute('aria-label', w.name);
    if (modal) this.frame.setAttribute('aria-modal', 'true');
    else this.frame.removeAttribute('aria-modal');
  }

  /** A window a script opened that has a close control: cards unless the script turned it off, and floating windows and dialogs. */
  private closable(): boolean {
    const w = this.frontWindow();
    return this.behind.length > 0 && w.style !== 'document' && w.closeButton !== false;
  }

  /** The close control or Escape: the front window closes and the one behind comes forward, as Close Window does. */
  private async closeFrontWindow(): Promise<void> {
    if (!this.behind.length || this.scripting) return;
    if (!(await this.commit())) return;
    await this.locks.releaseAll();
    this.popWindow();
    await this.reload();
    await this.loadMenus();
  }

  /**
   * The front window's frame: filling the area for a document window; for a card, floating window or dialog, the size
   * New Window gave (else the layout's), centered over the window behind or at the top and left given, never past the
   * area's edges.
   */
  private sizeWindow(): void {
    const w = this.frontWindow();
    const overlay = this.behind.length > 0 && w.style !== 'document';
    this.frame.className = `window-frame${overlay ? ` window-${w.style}` : ''}`;
    if (!overlay) {
      this.frame.style.cssText = '';
      return;
    }
    const zoom = this.meta ? this.effectiveZoom() : 1;
    const parts = this.meta?.design.parts ?? [];
    const width = (w.width ?? this.renderer?.width ?? 600) * zoom;
    const height = (w.height ?? (parts.reduce((n, p) => n + p.height, 0) || 400)) * zoom;
    const area = { width: this.stage.clientWidth || innerWidth, height: this.stage.clientHeight || innerHeight };
    const gutter = 16;
    const fitW = Math.min(width, area.width - 2 * gutter);
    const fitH = Math.min(height, area.height - 2 * gutter);
    const left = w.left !== undefined ? Math.min(Math.max(gutter, w.left), area.width - gutter - fitW) : (area.width - fitW) / 2;
    const top = w.top !== undefined ? Math.min(Math.max(gutter, w.top), area.height - gutter - fitH) : Math.max(gutter, (area.height - fitH) / 2);
    Object.assign(this.frame.style, { width: `${fitW}px`, height: `${fitH}px`, left: `${Math.max(gutter, left)}px`, top: `${top}px` });
  }

  /** Shows what a script left (or a paused one has so far): layout, found set, record, mode. */
  private async showRun(r: ScriptRun, goTo?: string, after: { keepPopover?: boolean; view?: string; reload?: boolean; scrolls?: string[] } = {}): Promise<void> {
    this.followWindows(r);
    const sameLayout = !r.layout || r.layout === this.meta!.layout.name;
    const target = goTo && sameLayout ? this.findObject(goTo) : undefined;
    const popover = after.keepPopover && sameLayout && this.popover
      && (!target || [...target.path, target.o].some((o) => o.id === this.popover!.id)) ? { id: this.popover.id } : undefined;
    const frozen = this.frozenWindows.has(this.frontWindow().id);
    if (!popover && !frozen) this.closePopover();
    // A different layout: load its design but keep the found set the script left.
    if (r.layout && r.layout !== this.meta!.layout.name) {
      const meta = await this.api.layout(r.layout);
      this.clearDisplay();
      this.cache.clear();
      this.states.clear();
      this.meta = meta;
      showScriptNetwork(meta);
      // A set the script installed stays; otherwise the new layout's own set applies.
      if (!r.actions?.some((a) => a.step === 'Install Menu Set')) this.layoutMenuSet();
      this.renderer = new LayoutRenderer(meta, SCOPE);
      this.lastTable = meta.layout.table;
      this.view = this.defaultView();
      sessionStorageSet(`tabularius.layout.${this.api.db}`, r.layout);
    }
    if (r.recordId !== undefined && String(r.recordId) !== this.record?.recordId) this.displayGeneration++;
    if (r.foundSet) {
      const positions = new Map(r.foundSet.map((id, i) => [String(id), i]));
      if (this.foundCount !== r.foundSet.length || [...this.cache].some(([i, rec]) => positions.get(rec.recordId) !== i)
        || [...this.foundRows.values()].some((got) => got.rows.some((row, i) => row && positions.get(row.recordId) !== i))) this.drawnLayoutId = undefined;
      this.cache = checkpointCache(this.cache, r.foundSet);
      this.foundCount = r.foundSet.length;
      this.ids = r.foundSet;
      this.query = undefined;
      this.sort = r.sort;
      const at = r.recordId === undefined ? -1 : r.foundSet.indexOf(r.recordId);
      this.index = at >= 0 ? at : 0;
      const key = JSON.stringify([this.meta!.layout.name, this.query, this.sort, this.ids, this.foundCount, this.foundRowsAsked]);
      if (key !== this.foundRowsKey) {
        this.foundRowsKey = key;
        for (const got of this.foundRows.values()) {
          const cached = new Map<number, PortalRow>();
          got.rows.forEach((row, i) => { if (row) cached.set(i, row); });
          const positions = checkpointCache(cached, r.foundSet);
          got.rows = new Array<PortalRow | undefined>(this.foundCount);
          for (const [i, row] of positions) got.rows[i] = row;
          got.asked = new Set(positions.keys());
        }
      }
    }
    this.mode = r.mode ?? this.mode;
    // Scripts run Preview mode as Browse mode, and say when they leave the window in it.
    this.preview = !!r.preview && this.mode === 'browse';
    // The field someone is typing in stays focused when the script leaves the layout as it was.
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.fm[data-id]')?.dataset.id;
    const layout = this.meta!.layout.name;
    // Go to Object: a tab or slide panel comes to the front; a field gets the cursor.
    if (after.view) this.scriptView(after.view);
    if (goTo) this.showObject(goTo);
    if (after.reload !== false) await this.reload();
    if (frozen) return;
    if (popover && !this.popover) {
      const target = this.findObject((o) => o.id === popover.id);
      if (target) this.openPopoverOf(target);
    }
    if (goTo) this.focusObject(goTo);
    if (r.active) this.focusActive(r.active);
    else if (r.active === null) {
      const box = document.activeElement;
      if (box instanceof HTMLElement && this.content.contains(box)) box.blur();
    } else if (!goTo && focused && this.meta!.layout.name === layout && this.mode === 'browse') this.refocus(focused);
    for (const to of after.scrolls ?? []) this.scrollWindow(to);
    await this.loadMenus();
  }

  /**
   * Scroll Window: Home and End go to the top and bottom of what the window shows, Page Up and Page Down by a
   * window's height less a line, and To Selection brings the field with the cursor into view.
   */
  private scrollWindow(to: string): void {
    const c = this.content;
    const page = Math.max(c.clientHeight - 40, c.clientHeight / 2);
    if (to === 'home') c.scrollTop = 0;
    else if (to === 'end') c.scrollTop = c.scrollHeight;
    else if (to === 'page up') c.scrollTop -= page;
    else if (to === 'page down') c.scrollTop += page;
    else if (to === 'to selection') {
      const box = document.activeElement;
      if (box instanceof HTMLElement && c.contains(box)) box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** The named object on the layout (or the first one `name` accepts), with the objects that hold it. */
  private findObject(name: string | ((o: LayoutObject) => boolean)): { o: LayoutObject; path: LayoutObject[] } | undefined {
    const walk = (objs: LayoutObject[], path: LayoutObject[]): { o: LayoutObject; path: LayoutObject[] } | undefined => {
      for (const o of objs) {
        if (typeof name === 'string' ? o.name === name : name(o)) return { o, path };
        const r = o.children && walk(o.children, [...path, o]);
        if (r) return r;
      }
      return undefined;
    };
    return this.meta ? walk(this.meta.design.objects, []) : undefined;
  }

  /** Brings the panels holding an object (or the panel itself) to the front. */
  private showObject(name: string): void {
    const found = this.findObject(name);
    if (!found) return;
    const chain = [...found.path, found.o];
    const frozen = this.frozenWindows.has(this.frontWindow().id);
    if (!frozen && this.popover && !chain.some((o) => o.id === this.popover!.id)) this.closePopover();
    chain.forEach((x, i) => {
      if ((x.kind === 'tab-panel' || x.kind === 'slide-panel') && i > 0) {
        const control = chain[i - 1];
        this.panels.set(control.id, x.id);
        if (frozen) return;
        // An already-open popover keeps its DOM and viewer: switch its panels in place before JavaScript runs.
        for (const el of this.content.querySelectorAll<HTMLElement>(`.fm[data-id="${control.id}"]`)) {
          el.querySelectorAll<HTMLElement>(':scope > .fm-panel').forEach((p) => (p.hidden = p.dataset.panel !== String(x.id)));
          const panels = (control.children ?? []).filter((p) => p.kind === 'tab-panel' || p.kind === 'slide-panel');
          el.querySelectorAll<HTMLElement>(':scope > :is(.fm-tabs, .fm-dots) > button').forEach((tab, n) => {
            const chosen = panels[n]?.id === x.id;
            tab.classList.toggle('fm-checked', chosen);
            // As the layout draws them: a tab says it is selected and is the one in the tab order; a slide dot is a pressed button.
            if (tab.classList.contains('fm-tab')) {
              tab.setAttribute('aria-selected', String(chosen));
              tab.setAttribute('tabindex', chosen ? '0' : '-1');
            } else tab.setAttribute('aria-pressed', String(chosen));
          });
        }
      }
    });
  }

  /** View As in a script: a view the layout allows, or Cycle to the next one (form, list, table). */
  private scriptView(v: string): void {
    const order: View[] = ['form', 'list', 'table'];
    if (v === 'cycle') {
      const at = order.indexOf(this.view);
      const next = [1, 2, 3].map((i) => order[(at + i) % 3]).find((x) => this.allows(x));
      if (next) this.view = next;
    } else if ((order as string[]).includes(v) && this.allows(v as View)) this.view = v as View;
  }

  /** Set Zoom Level in a script: a percentage (FileMaker's 25 to 400), or a step in or out; drawn with the window. */
  private scriptZoom(zoom: number | 'in' | 'out'): void {
    const levels = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
    const now = this.effectiveZoom();
    if (zoom === 'in') this.zoom = levels.find((l) => l > now + 0.001) ?? levels[levels.length - 1];
    else if (zoom === 'out') this.zoom = [...levels].reverse().find((l) => l < now - 0.001) ?? levels[0];
    else this.zoom = Math.min(4, Math.max(0.25, zoom / 100));
  }

  /** Puts the cursor where the script left it (Go to Field, Set Selection, Select All), opening its popover first. */
  private focusActive(a: NonNullable<ScriptRun['active']>): void {
    const found = this.findObject((o) => o.id === a.objectId);
    if (found) this.openPopoverOf(found);
    const scope = this.content.querySelector('.fm-current') ?? this.content;
    const boxes = [...scope.querySelectorAll<HTMLElement>(`.fm[data-id="${a.objectId}"]`)];
    // A portal field shows once per row: the script's row.
    const box = boxes[a.portal && a.row ? a.row - 1 : 0]?.querySelector<HTMLElement>('input, select, textarea');
    if (!box) return;
    // The script's own step ran the field's OnObjectEnter on the server already.
    this.quietly(() => box.focus());
    if (!(box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) || !a.selection) return;
    try {
      if (a.selection === 'all') box.select();
      else box.setSelectionRange(Math.min(a.selection[0], box.value.length), Math.min(a.selection[1], box.value.length));
    } catch {
      // a kind of input that has no text selection
    }
  }

  private openPopoverOf(found: { o: LayoutObject; path: LayoutObject[] }): void {
    const all = (objs: LayoutObject[]): LayoutObject[] => objs.flatMap((x) => [x, ...all(x.children ?? [])]);
    const objects = all(this.meta!.design.objects);
    for (const popover of [...found.path, found.o].filter((x) => x.kind === 'popover')) {
      let open = this.popover;
      while (open && open.id !== popover.id) open = open.parent;
      if (open) continue;
      const opener = objects.find((x) => x.kind === 'popover-button' && x.target === popover.id);
      if (opener) this.togglePopover(popover.id, opener.id);
    }
  }

  /** Opens the popover holding a named object (or the popover itself) and puts the cursor in a named field, as Go to Object does. */
  private focusObject(name: string): void {
    const found = this.findObject(name);
    if (!found) return;
    this.openPopoverOf(found);
    if (found.o.kind !== 'field') return;
    const scope = this.content.querySelector('.fm-current') ?? this.content;
    // Go to Object ran the field's OnObjectEnter on the server already.
    this.quietly(() => scope.querySelector<HTMLElement>(`.fm[data-id="${found.o.id}"] :is(input, select, textarea)`)?.focus());
  }

  /**
   * Tab and Shift-Tab follow the layout's Set Tab Order: the next object in
   * it that is showing, in the current record (and the current portal row
   * for portal fields), wrapping round as FileMaker does. Returns false to
   * leave the key to the browser (no tab order, or the cursor isn't on the
   * layout).
   */
  private tabNext(back: boolean): boolean {
    const order = this.meta?.design.tabOrder;
    const active = document.activeElement as HTMLElement | null;
    if (!order?.length || this.preview || this.view === 'table' || !active || !this.content.contains(active)) return false;
    // List View: body objects of the record the cursor is in (or the current one); header and footer objects are outside any record.
    const record = active.closest<HTMLElement>('[data-index]') ?? this.content.querySelector<HTMLElement>('.fm-current');
    const row = active.closest<HTMLElement>('.fm-portal-row');
    const focusable = ':is(input:not([type=hidden]), select, textarea, button):not(:disabled)';
    const stops: HTMLElement[] = [];
    for (const id of order) {
      const els = [...this.content.querySelectorAll<HTMLElement>(`.fm[data-id="${id}"]`)];
      // A portal field: the one in the cursor's row, else the first row's.
      const el = (row && els.find((x) => row.contains(x))) ?? (record && els.find((x) => record.contains(x))) ?? els.find((x) => !x.closest('[data-index]'));
      const target = el?.matches(focusable) ? el : el?.querySelector<HTMLElement>(focusable);
      if (target && target.getClientRects().length && !target.closest('[hidden], [inert]') && target.tabIndex >= 0) stops.push(target);
    }
    if (!stops.length) return false;
    const at = stops.findIndex((x) => x === active || x.contains(active) || active.contains(x));
    const next = at < 0 ? (back ? stops.length - 1 : 0) : (at + (back ? -1 : 1) + stops.length) % stops.length;
    stops[next].focus();
    if (stops[next] instanceof HTMLInputElement || stops[next] instanceof HTMLTextAreaElement) (stops[next] as HTMLInputElement).select();
    return true;
  }

  /** Whether this Return (or keypad Enter) is one of the keys the focused field's object goes to the next object with. */
  private exitKey(e: KeyboardEvent): boolean {
    const id = Number((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.fm[data-id]')?.dataset.id);
    if (!id || !this.meta) return false;
    const all = (objs: LayoutObject[]): LayoutObject[] => objs.flatMap((x) => [x, ...all(x.children ?? [])]);
    const b = all(this.meta.design.objects).find((x) => x.id === id)?.field?.behavior;
    return !!(e.code === 'NumpadEnter' ? b?.enterKey : b?.returnKey);
  }

  /** Focuses an object's field again without firing its OnObjectEnter. */
  private refocus(id: string): void {
    const scope = this.content.querySelector('.fm-current') ?? this.content;
    const input = scope.querySelector<HTMLElement>(`.fm[data-id="${id}"] :is(input, select, textarea)`);
    if (!input) return;
    this.quietly(() => input.focus());
  }

  /** Moves the cursor without firing the fields' OnObjectEnter, OnObjectExit or OnObjectSave. */
  private quietly(move: () => void): void {
    this.quietFocus = true;
    try {
      move();
    } finally {
      this.quietFocus = false;
    }
  }

  private quietFocus = false;

  /**
   * OnObjectKeystroke and OnLayoutKeystroke: a character, Backspace or Delete
   * typed into a field runs the field's trigger, then the layout's, before it
   * goes in; a script that exits False stops it. What was typed before is
   * saved first, so the script sees it and the redraw keeps it. Returns
   * whether the key was taken.
   */
  private keystrokeTrigger(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.isComposing || !this.meta || this.replayingKey) return false;
    // A field's own handling (a value list, Tab typing a tab) comes first: a key it took doesn't fire the trigger.
    const navigation = e.key.length !== 1 && e.key !== 'Backspace' && e.key !== 'Delete';
    const char = navigation && e.defaultPrevented ? undefined : triggerKeystroke(e.key, e.code);
    const box = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (char === undefined || !box?.matches?.('input.fm-input, textarea.fm-input') || box.readOnly || !this.content.contains(box)) return false;
    const objEl = box.closest<HTMLElement>('.fm[data-id]');
    if (!objEl) return false;
    const o = this.renderer?.objectById(Number(objEl.dataset.id));
    const onObject = !!o && this.hasTrigger('OnObjectKeystroke', o);
    const onLayout = this.hasTrigger('OnLayoutKeystroke');
    if (!onObject && !onLayout) return false;
    e.preventDefault();
    // Shift 1, Caps Lock 2, Option/Alt 8, as Get ( TriggerModifierKeys ) counts them.
    const modifierKeys = (e.shiftKey ? 1 : 0) | (e.getModifierState?.('CapsLock') ? 2 : 0) | (e.altKey ? 8 : 0);
    const portal = !!box.closest('.fm-portal-row');
    const id = objEl.dataset.id!;
    const rep = Math.max(0, [...objEl.querySelectorAll('input.fm-input, textarea.fm-input')].indexOf(box));
    // The field box as drawn now: a script's redraw replaces it.
    const live = (): HTMLInputElement | HTMLTextAreaElement | undefined => {
      if (box.isConnected) return box;
      if (portal) return undefined;
      const scope = this.content.querySelector('.fm-current') ?? this.content;
      return scope.querySelectorAll<HTMLInputElement>(`.fm[data-id="${id}"] :is(input.fm-input, textarea.fm-input)`)[rep];
    };
    this.keystrokes = this.keystrokes.then(async () => {
      const el = live();
      if (!el) return;
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
      const key = this.keyOf(el);
      if (!portal && key && el.value !== String(this.record?.fieldData[key] ?? '').replace(/\r\n?/g, '\n')) {
        this.save(key, el.value);
        // Saved: setting the value again keeps the browser from saving it a second time (a change event) when the box goes away.
        el.value = el.value;
        el.setSelectionRange(start, end);
      }
      const extra = { keystroke: char, modifierKeys };
      if (onObject && !(await this.fire('OnObjectKeystroke', o, undefined, extra))) return;
      if (onLayout && !(await this.fire('OnLayoutKeystroke', undefined, undefined, extra))) return;
      // The script may have drawn the layout again: the field, with the cursor where it was.
      const now = live();
      if (!now) return;
      if (now !== el) {
        this.quietFocus = true;
        try {
          now.focus();
        } finally {
          this.quietFocus = false;
        }
        now.setSelectionRange(Math.min(start, now.value.length), Math.min(end, now.value.length));
      }
      if (document.activeElement !== now) return;
      if (navigation) {
        this.replayKey(now, e);
        return;
      }
      const command = char === '\b' ? 'delete' : char === '\x7f' ? 'forwardDelete' : 'insertText';
      if (!document.execCommand(command, false, command === 'insertText' ? char : undefined) && command === 'insertText') {
        now.setRangeText(char, now.selectionStart ?? now.value.length, now.selectionEnd ?? now.value.length, 'end');
        now.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }).catch((err) => toast(errorText(err)));
    return true;
  }

  /** Keystrokes waiting for their triggers, in the order typed. */
  private keystrokes: Promise<unknown> = Promise.resolve();
  /** Set while a navigational key a keystroke trigger let through is handled again. */
  private replayingKey = false;

  /**
   * A navigational key a keystroke trigger let through: handled as if just typed (Tab to the next
   * object, Return to the next line or object, ...), and where nothing here handles it, as the browser
   * would have: moving the cursor for arrows, focus for Tab, a new line for Return in a text area.
   */
  private replayKey(el: HTMLInputElement | HTMLTextAreaElement, e: KeyboardEvent): void {
    const again = new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true });
    this.replayingKey = true;
    try {
      el.dispatchEvent(again);
    } finally {
      this.replayingKey = false;
    }
    if (again.defaultPrevented) return;
    if (e.key === 'Tab') {
      const all = [...this.content.querySelectorAll<HTMLElement>('input.fm-input, textarea.fm-input, select, button')]
        .filter((x) => !(x as HTMLInputElement).disabled && x.tabIndex >= 0 && x.getClientRects().length && !x.closest('[hidden], [inert]'));
      const next = all[(all.indexOf(el) + (e.shiftKey ? -1 : 1) + all.length) % all.length];
      next?.focus();
      if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) next.select();
    } else if (e.key === 'Enter' && el instanceof HTMLTextAreaElement) {
      if (!document.execCommand('insertText', false, '\n')) el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
    } else if (e.key.startsWith('Arrow')) {
      moveCaret(el, e.key, e.shiftKey);
    }
  }

  private async deletePortalRow(row?: RowContext, question = 'Delete this related record?', rec = this.recordFor(row)): Promise<void> {
    if (!row?.row.recordId || !rec) return;
    if (!(await askConfirm('Delete Related Record', question, 'Delete'))) return;
    await this.api.update(this.meta!.layout.name, rec.recordId, {}, { deleteRelated: `${row.portal}.${row.row.recordId}` });
    announce('Portal row deleted.');
    freshen(rec, await this.api.record(this.meta!.layout.name, rec.recordId));
    this.render();
  }

  private togglePopover(id: number, buttonId: number): void {
    if (this.popover?.id === id) return this.closePopover(this.popover.parent?.id);
    const opener = this.content.querySelector(`[data-id="${buttonId}"]`);
    // Opening a nested popover retains the ancestor containing its opener.
    const parent = this.popover && opener && this.popover.el.contains(opener) ? this.popover : undefined;
    if (!parent) this.closePopover();
    const part = this.renderer!.partOf(buttonId);
    const partEl = part && this.content.querySelector<HTMLElement>(`.fm-part-${part.kind}${this.view === 'list' && part.kind === 'body' ? '.fm-current' : ''}`);
    const el = this.renderer!.renderPopover(id, this, part?.top ?? 0);
    if (!el || !partEl) return;
    partEl.append(el);
    this.popover = { id, el, button: buttonId, parent };
    this.content.querySelector(`[data-id="${buttonId}"] button[aria-haspopup]`)?.setAttribute('aria-expanded', 'true');
    this.styles();
    // Like FileMaker, keep the popover (and its title bar) inside the window.
    const title = el.querySelector<HTMLElement>('.fm-popover-title')?.getBoundingClientRect().height ?? 0;
    const box = el.getBoundingClientRect();
    const view = this.content.getBoundingClientRect();
    const zoom = box.height / (el.offsetHeight || box.height || 1) || 1;
    let dy = 0;
    if (box.bottom > view.bottom) dy = view.bottom - box.bottom;
    if (box.top - title + dy < view.top) dy = view.top - (box.top - title);
    if (dy) el.style.top = `${parseFloat(el.style.top) + dy / zoom}px`;
    // A dialog named by its title bar; the keyboard goes into it (Escape closes it).
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', el.querySelector('.fm-popover-title')?.textContent?.trim() || 'Popover');
    el.querySelector<HTMLElement>('input:not([type=hidden]):not([tabindex="-1"]), textarea, select, button:not([tabindex="-1"]), [tabindex="0"]')?.focus();
  }

  private closePopover(keep?: number): void {
    // Leave the field being edited first, so its value is saved; then focus goes back to the button that opened it.
    const active = document.activeElement;
    let open = this.popover;
    let inside = false;
    while (open && open.id !== keep) {
      inside ||= active instanceof HTMLElement && open.el.contains(active);
      open = open.parent;
    }
    if (inside) (active as HTMLElement).blur();
    const opener = this.popover?.button;
    open = this.popover;
    while (open && open.id !== keep) {
      this.content.querySelector(`[data-id="${open.button}"] button[aria-haspopup]`)?.setAttribute('aria-expanded', 'false');
      open.el.remove();
      open = open.parent;
    }
    this.popover = open;
    if (inside && opener !== undefined) this.content.querySelector<HTMLElement>(`[data-id="${opener}"] button, [data-id="${opener}"][tabindex]`)?.focus();
  }

  // ---------------------------------------------------------- drawing

  /** Draws the layout again, the cursor staying in the field it was in. */
  private renderKeepingFocus(): void {
    const box = document.activeElement as HTMLInputElement | null;
    const inField = !!box?.matches('input.fm-input, textarea.fm-input') && this.content.contains(box);
    const place = inField ? { ...this.placeOf(box!), start: box!.selectionStart, end: box!.selectionEnd } : undefined;
    this.render();
    if (!place?.id) return;
    const el = this.inputAt(place);
    if (!el) return;
    this.quietly(() => el.focus());
    if (place.start !== null && place.end !== null) el.setSelectionRange(place.start, place.end);
  }

  render(): void {
    if (this.frozenWindows.has(this.frontWindow().id)) return;
    this.drawnLayoutId = this.meta?.layout.id;
    this.drawnWindowId = this.frontWindow().id;
    this.sizeWindow();
    // Back in Browse mode (or after a script), a view the layout doesn't allow gives way to one it does.
    if (this.mode === 'browse' && !this.allows(this.view)) this.view = this.defaultView();
    this.fitLayout();
    if (this.menuBar && !this.customMenus && this.standardMode !== this.mode) {
      this.standardMode = this.mode;
      this.menuBar.set(this.standardMenuSet());
    }
    this.noteVisit();
    this.renderToolbar();
    this.publishWindow();
    if (!this.renderer) return;
    // Changing views (form to list) shows records whose formulas aren't worked out yet.
    if (this.mode === 'browse' && this.shown().length && this.hasFormulas() && !this.statesPending) {
      const generation = this.displayGeneration;
      const window = this.frontWindow().id;
      const pending = this.loadStates().finally(() => {
        if (this.statesPending !== pending) return;
        this.statesPending = undefined;
        if (generation === this.displayGeneration && window === this.frontWindow().id) this.render();
      });
      this.statesPending = pending;
    }
    this.scheduleGroups();
    this.closePopover();
    const scroll = this.pendingScroll ?? this.content.scrollTop;
    this.pendingScroll = undefined;
    // The layout's own background (theme element 20) fills the window behind the parts.
    const setup = this.meta?.design;
    const page = h('div', { class: `page fm e20 ${this.preview ? 'mode-preview' : `mode-${this.mode} view-${this.view}`}${setup?.recordIndicator === false ? ' no-record-indicator' : ''}${setup?.fieldFrames === false ? '' : ' fm-frames'}` });
    page.style.setProperty('--fm-layout-width', `${this.renderer.width}px`);
    const zoom = this.effectiveZoom();
    if (zoom !== 1) page.style.zoom = String(zoom);
    // Each drawing starts without a long list; list and table views set one up.
    this.lastVirtual = this.virtual;
    this.virtual = undefined;
    if (this.preview) this.renderPreview(page);
    else if (this.view === 'table' && this.mode === 'browse') this.renderTable(page);
    else if (this.view === 'list' && this.mode === 'browse') this.renderList(page);
    else this.renderForm(page);
    const fresh = h('div', { class: SCOPE }, page);
    this.content.append(fresh);
    const virtual = this.virtual;
    this.keepWebViewers(fresh);
    // Pages kept through the redraw hear of it (tabularius.on('refresh', …)), to show the record or data as it now is.
    tellPages(fresh, 'refresh', { recordId: this.record?.recordId, foundCount: this.foundCount });
    // Taking away the old drawing takes the cursor out of its field (Chrome says so with a blur), but that is the
    // window being redrawn, not the person leaving the field: no OnObjectExit, and whoever redraws puts the cursor back.
    this.quietly(() => {
      for (const old of [...this.content.children]) if (old !== fresh) old.remove();
    });
    this.styles();
    this.content.scrollTop = scroll;
    if (virtual) this.layOutRows(virtual, false, scroll);
    this.markRows();
    if (zoom < 1 && !this.preview) this.addHitAreas(page, zoom);
  }

  /**
   * A layout scaled down to fit a phone shrinks its fields below a fingertip (WCAG 2.5.8 asks for 24px). Each field
   * shorter than that on screen gets an invisible strip above and below it that puts the cursor in it, into the
   * empty space around it only: half the gap to the object above or below, or up to the edge of its part (or list
   * row). Called again as a list draws more rows.
   */
  private addHitAreas(page: HTMLElement, zoom: number): void {
    const need = 24 / zoom;
    for (const cell of page.querySelectorAll<HTMLElement>('.fm[data-id]')) {
      if (cell.querySelector(':scope > .fm-hit')) continue; // a list row kept from the last drawing
      const box = cell.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea, select');
      if (box.length !== 1 || cell.querySelector('.fm[data-id]')) continue;
      const input = box[0] as HTMLElement;
      const top = cell.offsetTop, height = cell.offsetHeight, left = cell.offsetLeft, right = left + cell.offsetWidth;
      const parent = cell.parentElement;
      if (!parent || !height || height >= need) continue;
      const pad = (need - height) / 2;
      let up = top, down = parent.offsetHeight - top - height;
      for (const other of parent.children) {
        if (other === cell || !(other instanceof HTMLElement) || !other.matches('.fm[data-id]')) continue;
        if (other.offsetLeft >= right || other.offsetLeft + other.offsetWidth <= left) continue;
        const oTop = other.offsetTop, oBottom = oTop + other.offsetHeight;
        if (oBottom <= top) up = Math.min(up, (top - oBottom) / 2);
        else if (oTop >= top + height) down = Math.min(down, (oTop - top - height) / 2);
      }
      const strips = [['top', Math.min(pad, up)], ['bottom', Math.min(pad, down)]] as const;
      for (const [side, size] of strips) {
        if (size < 1) continue;
        const strip = h('span', { class: 'fm-hit', 'aria-hidden': 'true' });
        strip.style.cssText = `${side}: ${-size}px; height: ${size}px`;
        strip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          input.focus();
        });
        cell.append(strip);
      }
    }
  }

  // ---------------------------------------------------------- long lists

  /**
   * List and table views draw only the rows in view (and a few either side), between two spacers that stand in for
   * the rest, and fetch records a page at a time as they scroll into view: 100,000 records scroll like 50.
   */
  private virtual?: { kind: 'list' | 'table'; container: HTMLElement; rowHeight: number; build: (i: number) => HTMLElement; from: number; to: number; rows: Map<number, HTMLElement>; shownIndex?: number; measured?: boolean };
  private lastVirtual?: Session['virtual'];
  private fetching = new Set<number>();
  private scrollFrame = 0;

  private startVirtual(kind: 'list' | 'table', container: HTMLElement, rowHeight: number, build: (i: number) => HTMLElement): void {
    const was = this.lastVirtual;
    this.virtual = { kind, container, rowHeight, build, from: 0, to: 0, rows: new Map(), shownIndex: was?.kind === kind ? was.shownIndex : undefined };
  }

  /** The rows drawn now, for formulas and live updates. */
  private rowWindow(): { from: number; to: number } | undefined {
    const v = this.virtual;
    return v && v.container.isConnected ? { from: v.from, to: v.to } : undefined;
  }

  /**
   * Where the rows are: the list's top in the scrolled content, how far into it the window is scrolled (`top`), the
   * window's height, and the list's full height. Browsers can't make an element much taller than 15 million pixels,
   * so a longer list is drawn that tall (`drawn`) and scrolling moves through it proportionally (`at`, in rows' pixels).
   */
  private rowGeometry(v: NonNullable<Session['virtual']>): { containerTop: number; top: number; height: number; full: number; drawn: number; at: number } {
    const zoom = this.effectiveZoom();
    const contentTop = this.content.getBoundingClientRect().top;
    const containerTop = (v.container.getBoundingClientRect().top - contentTop) / zoom + this.content.scrollTop / zoom;
    const top = Math.max(0, this.content.scrollTop / zoom - containerTop);
    const height = this.content.clientHeight / zoom;
    const full = this.foundCount * v.rowHeight;
    const drawn = Math.min(full, MAX_DRAWN);
    const at = drawn === full || drawn <= height ? top : Math.min(full - height, top * (full - height) / (drawn - height));
    return { containerTop, top, height, full, drawn, at };
  }

  /** The rows that should be drawn for where the window is scrolled. */
  private wantedRows(v: NonNullable<Session['virtual']>): { from: number; to: number } {
    const OVERSCAN = 8;
    const g = this.rowGeometry(v);
    const from = Math.max(0, Math.floor(g.at / v.rowHeight) - OVERSCAN);
    const to = Math.min(this.foundCount, Math.max(from, Math.ceil((g.at + g.height) / v.rowHeight) + OVERSCAN));
    return { from, to };
  }

  /** Draws the rows in view, keeping rows already drawn (so a field being typed in stays as it is). */
  private layOutRows(v: NonNullable<Session['virtual']>, force = false, scroll?: number): void {
    if (this.virtual !== v || !v.container.isConnected) return;
    // The list's full height first, so the window can scroll anywhere in it.
    if (!v.container.firstChild) {
      const full = this.spacerFor(v, Math.min(this.foundCount * v.rowHeight, MAX_DRAWN));
      v.container.append(full, this.spacerFor(v, 0));
      // Redrawn in place (a save, a timer): back where it was, which the empty list couldn't hold.
      if (scroll !== undefined) this.content.scrollTop = scroll;
    }
    // Arriving from another record (form view, a script, the arrows): the current record scrolls into view.
    if (v.shownIndex !== this.index) {
      v.shownIndex = this.index;
      if (!this.rowInView(v, this.index)) this.reveal(this.index, false);
    }
    let { from, to } = this.wantedRows(v);
    // The row with the cursor in it stays drawn while it's within reach.
    const active = document.activeElement?.closest<HTMLElement>('[data-index]');
    const at = active && v.container.contains(active) ? Number(active.dataset.index) : undefined;
    if (at !== undefined && at >= from - 200 && at < to + 200) {
      from = Math.min(from, at);
      to = Math.max(to, at + 1);
    }
    const g = this.rowGeometry(v);
    const scaled = g.drawn < g.full;
    // A list taller than can be drawn: the drawn rows sit where the scroll position says, so they move with it.
    const above = scaled ? Math.max(0, Math.min(g.drawn - (to - from) * v.rowHeight, g.top - (g.at - from * v.rowHeight))) : from * v.rowHeight;
    const below = Math.max(0, (scaled ? g.drawn : g.full) - above - (to - from) * v.rowHeight);
    if (!force && from === v.from && to === v.to) {
      if (scaled) {
        (v.container.firstElementChild as HTMLElement).style.height = `${above}px`;
        (v.container.lastElementChild as HTMLElement).style.height = `${below}px`;
      }
      return;
    }
    const rows = new Map<number, HTMLElement>();
    for (let i = from; i < to; i++) {
      const old = v.rows.get(i);
      rows.set(i, old && !(old.classList.contains('fm-row-loading') && this.cache.has(i)) ? old : v.build(i));
    }
    v.container.replaceChildren(this.spacerFor(v, above), ...rows.values(), this.spacerFor(v, below));
    v.rows = rows;
    v.from = from;
    v.to = to;
    // Rows come out a little taller or shorter than planned (borders, a theme's padding): measured once, then used.
    if (!v.measured) {
      const real = [...rows.values()].find((el) => !el.classList.contains('fm-row-loading'));
      const height = real ? real.getBoundingClientRect().height / this.effectiveZoom() : 0;
      if (height > 0) {
        v.measured = true;
        if (Math.abs(height - v.rowHeight) > 0.5) {
          v.rowHeight = height;
          // The current record was scrolled to with the planned height: again, with the real one.
          v.shownIndex = undefined;
          return this.layOutRows(v, true);
        }
      }
    }
    this.markRows();
    const zoom = this.effectiveZoom();
    if (zoom < 1) this.addHitAreas(v.container, zoom);
    void this.fillRows(v, from, to);
  }

  /** An empty row standing in for rows out of view. */
  private spacerFor(v: NonNullable<Session['virtual']>, px: number): HTMLElement {
    const el = v.kind === 'table'
      ? h('tr', { class: 'fm-row-spacer', 'aria-hidden': 'true' }, h('td', { colspan: '999' }))
      : h('div', { class: 'fm-row-spacer', 'aria-hidden': 'true' });
    el.style.height = `${px}px`;
    return el;
  }

  /** Fetches the pages the drawn rows need, then draws them and works out their formulas. */
  private async fillRows(v: NonNullable<Session['virtual']>, from: number, to: number): Promise<void> {
    const pages: number[] = [];
    for (let i = from - (from % PAGE); i < to; i += PAGE) {
      let missing = false;
      for (let j = Math.max(i, from); j < Math.min(to, i + PAGE); j++) if (!this.cache.has(j)) missing = true;
      if (missing && !this.fetching.has(i)) pages.push(i);
    }
    if (!pages.length) return;
    for (const p of pages) this.fetching.add(p);
    try {
      await Promise.all(pages.map((p) => this.fetch(p)));
    } catch (e) {
      toast(`Couldn't load records: ${errorText(e)}`);
      return;
    } finally {
      for (const p of pages) this.fetching.delete(p);
    }
    if (this.virtual !== v) return;
    if (v.kind === 'list' && this.hasFormulas()) await this.loadStates();
    this.layOutRows(v, true);
  }

  private rowInView(v: NonNullable<Session['virtual']>, i: number): boolean {
    const { from, to } = this.wantedRows(v);
    return i >= from + 8 && i < to - 8;
  }

  /** Scrolls row `i` of a list or table into view, and draws what's there. */
  private reveal(i: number, draw = true): void {
    const v = this.virtual;
    if (!v) return;
    const zoom = this.effectiveZoom();
    const g = this.rowGeometry(v);
    // Where the window should be, in rows' pixels: the row just inside its top or bottom edge.
    const rowTop = i * v.rowHeight;
    let at = g.at;
    if (rowTop < g.at) at = rowTop - v.rowHeight;
    else if (rowTop + v.rowHeight > g.at + g.height) at = rowTop + 2 * v.rowHeight - g.height;
    if (at !== g.at) {
      at = Math.max(0, Math.min(g.full - g.height, at));
      const top = g.drawn === g.full || g.drawn <= g.height ? at : at * (g.drawn - g.height) / (g.full - g.height);
      this.content.scrollTop = (g.containerTop + top) * zoom;
    }
    if (draw) this.layOutRows(v);
    v.rows.get(i)?.classList.add('fm-current');
  }

  private onScroll(): void {
    if (!this.virtual || this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (this.virtual) this.layOutRows(this.virtual);
    });
  }

  /**
   * Web viewers showing the same page as before keep it, as in FileMaker: a
   * redraw (after a script, a timer or a save) doesn't reload them, so what
   * Perform JavaScript in Web Viewer or the page itself did stays. Browsers
   * without Element.moveBefore (it moves a frame without reloading it)
   * reload them as before.
   */
  private keepWebViewers(fresh: HTMLElement): void {
    const move = (Element.prototype as { moveBefore?: unknown }).moveBefore;
    if (typeof move !== 'function') return;
    const where = (f: HTMLIFrameElement) => [f.dataset.viewerKey, f.dataset.viewerGeneration, f.dataset.viewerAddress].join('\u0000');
    const old = new Map<string, HTMLIFrameElement>();
    for (const f of this.content.querySelectorAll<HTMLIFrameElement>('iframe.fm-webviewer')) if (!fresh.contains(f)) old.set(where(f), f);
    if (!old.size) return;
    for (const f of fresh.querySelectorAll<HTMLIFrameElement>('iframe.fm-webviewer')) {
      const kept = old.get(where(f));
      if (!kept || !f.parentElement) continue;
      old.delete(where(f));
      (f.parentElement as unknown as { moveBefore(node: Node, child: Node | null): void }).moveBefore(kept, f);
      f.remove();
      // The kept page has loaded already: the fresh copy's loading bar would never be taken down.
      if (kept.dataset.loaded === '1') kept.parentElement?.querySelector(':scope > .fm-webviewer-bar')?.remove();
    }
  }

  private statesPending?: Promise<void>;

  /** Navigation drops asynchronous display work and focus belonging to the previous window or layout. */
  private clearDisplay(): void {
    this.displayGeneration++;
    this.groupsGeneration++;
    this.states.clear();
    this.foundRows.clear();
    this.foundRowsKey = '';
    this.statesPending = undefined;
    this.groupsPending = undefined;
    this.activeObjectId = undefined;
    this.lastInput = undefined;
    this.portalRow = undefined;
    this.focusedField = undefined;
  }

  private styleEl?: HTMLStyleElement;

  private styles(): void {
    const style = this.renderer!.style();
    // Named styles are numbered per layout, so the last layout's sheet must go.
    if (this.styleEl !== style) this.styleEl?.remove();
    this.styleEl = style;
    if (!style.isConnected) document.head.append(style);
  }

  private renderForm(page: HTMLElement): void {
    const r = this.renderer!;
    const top = r.partsOfKind(['top-navigation', 'title-header', 'header']);
    const bottom = r.partsOfKind(['trailing-grand-summary', 'footer', 'title-footer', 'bottom-navigation']);
    const body = r.partsOfKind(['body']);
    // The body grows to fill the window; bottom-anchored objects move with it.
    const used = [...top, ...body, ...bottom].reduce((n, p) => n + p.height, 0);
    const stretch = Math.max(0, this.content.clientHeight / this.effectiveZoom() - used);
    for (const p of top) page.append(r.renderPart(p, this));
    // With no records FileMaker still draws the layout, with empty fields.
    for (const p of body) page.append(r.renderPart(p, this, { stretch }));
    for (const p of bottom) page.append(r.renderPart(p, this));
  }

  /** Sub-summary parts that show for the current sort, with the sort level of their break field. */
  private breakParts(): { part: LayoutPart; level: number }[] {
    const r = this.renderer!;
    const sort = this.sort?.map((s) => s.fieldName) ?? [];
    return r.partsOfKind(['sub-summary-leading', 'sub-summary-trailing'])
      .map((part) => ({ part, level: sort.indexOf(r.refKey(part.breakField) ?? '') }))
      .filter((p) => p.level >= 0);
  }

  /** Starts missing grouping work without redrawing the layout or changing its focus. */
  private scheduleGroups(): void {
    if (this.mode !== 'browse' || (this.view !== 'list' && !this.preview) || this.groups !== undefined || this.groupsPending) return;
    const pending = this.loadGroups().then((result) => {
      if (this.groupsPending !== pending) return;
      this.groupsPending = undefined;
      if (result === 'stale') this.scheduleGroups();
      else if (result === 'loaded' && this.mode === 'browse' && (this.view === 'list' || this.preview)) this.renderKeepingTyping();
    });
    this.groupsPending = pending;
  }

  /** Works out the sub-summary groups when the found set is sorted by a break field, as FileMaker does in Browse mode. */
  private async loadGroups(): Promise<'loaded' | 'empty' | 'stale'> {
    const parts = this.renderer ? this.breakParts() : [];
    if (!parts.length || !this.sort || !this.foundCount) {
      this.groups = null;
      return 'empty';
    }
    const meta = this.meta;
    const scope = () => JSON.stringify([this.groupsGeneration, this.frontWindow().id, this.query, this.ids, this.sort, this.foundCount]);
    const key = scope();
    const current = () => meta === this.meta && key === scope();
    const fields = this.sort.slice(0, Math.max(...parts.map((p) => p.level)) + 1).map((s) => s.fieldName);
    try {
      const runs = await this.api.groups(this.meta!.layout.name, { fields, sort: this.sort, ...(this.ids ? { ids: this.ids } : { query: this.query }) });
      if (!current()) return 'stale';
      this.groups = { fields, runs };
      return 'loaded';
    } catch (e) {
      if (!current()) return 'stale';
      console.warn('Sub-summaries failed', e);
      this.groups = null;
      return 'empty';
    }
  }

  /** The run at a sort level that holds the record at position i. */
  private runAt(level: number, i: number): GroupRun | undefined {
    const runs = this.groups?.runs[level] ?? [];
    let [lo, hi] = [0, runs.length - 1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (runs[mid].start > i) hi = mid - 1;
      else if (runs[mid].start + runs[mid].count <= i) lo = mid + 1;
      else return runs[mid];
    }
    return undefined;
  }

  /** A sub-summary part for the group the record at i starts or ends: its fields read that record, summaries the group. */
  private renderBreak(part: LayoutPart, level: number, rec: DataRecord, i: number, edge: 'first' | 'last'): HTMLElement | undefined {
    const run = this.runAt(level, i);
    if (!run || (edge === 'first' ? run.start !== i : run.start + run.count - 1 !== i)) return undefined;
    const shown: DataRecord = { ...rec, fieldData: { ...rec.fieldData, ...run.values } };
    const el = this.renderer!.renderPart(part, { ...this.hostFor(shown, i), save: () => undefined, upload: () => undefined });
    el.classList.add('fm-break');
    Object.assign(el.dataset, { breakLevel: String(level), breakPart: String(part.top), breakIndex: String(i), breakEdge: edge });
    return el;
  }

  private renderList(page: HTMLElement): void {
    const r = this.renderer!;
    for (const p of r.partsOfKind(['top-navigation', 'title-header', 'header', 'leading-grand-summary'])) page.append(r.renderPart(p, this));
    const body = r.part('body');
    const list = h('div', { class: 'list' });
    const breaks = this.groups ? this.breakParts().sort((a, b) => a.level - b.level) : [];
    // Without sub-summaries every row is the body's height: only the rows in view are drawn, however many records.
    if (body && !breaks.length && !(this.preview)) {
      this.startVirtual('list', list, body.height, (i) => {
        const rec = this.cache.get(i);
        if (!rec) return h('div', { class: 'fm-row-loading', 'data-index': String(i), style: `height: ${body.height}px` });
        this.editing = rec;
        const el = r.renderPart(body, { ...this.hostFor(rec, i) });
        this.editing = undefined;
        el.dataset.index = String(i);
        if (i === this.index) el.classList.add('fm-current');
        el.addEventListener('focusin', () => this.selectIndex(i));
        el.addEventListener('mousedown', () => this.selectIndex(i));
        return el;
      });
    } else if (body) {
      const start = this.index - (this.index % PAGE);
      const end = Math.min(this.foundCount, start + PAGE);
      if (start > 0) list.append(button(`Show records ${start - PAGE + 1}–${start}`, () => this.goTo(start - 1), { class: 'more' }));
      for (let i = start; i < end; i++) {
        const rec = this.cache.get(i);
        if (!rec) continue;
        this.editing = rec;
        const index = i;
        // Leading sub-summaries outermost first, trailing ones innermost first.
        for (const b of breaks.filter((x) => x.part.kind === 'sub-summary-leading')) {
          const el = this.renderBreak(b.part, b.level, rec, i, 'first');
          if (el) list.append(el);
        }
        const el = r.renderPart(body, { ...this.hostFor(rec, i) });
        el.dataset.index = String(i);
        if (i === this.index) el.classList.add('fm-current');
        el.addEventListener('focusin', () => this.selectIndex(index));
        el.addEventListener('mousedown', () => this.selectIndex(index));
        list.append(el);
        for (const b of breaks.filter((x) => x.part.kind === 'sub-summary-trailing').reverse()) {
          const el = this.renderBreak(b.part, b.level, rec, i, 'last');
          if (el) list.append(el);
        }
      }
      this.editing = undefined;
      if (end < this.foundCount) list.append(button(`Show records ${end + 1}–${Math.min(this.foundCount, end + PAGE)}`, () => this.goTo(end), { class: 'more' }));
    }
    page.append(list);
    for (const p of r.partsOfKind(['trailing-grand-summary', 'footer', 'title-footer', 'bottom-navigation'])) page.append(r.renderPart(p, this));
  }

  /** A Host for one row of a list: same session, but this row's record. */
  private hostFor(rec: DataRecord, i: number): Host {
    const self = this;
    return {
      mode: 'browse', record: rec, panels: this.panels, recordNumber: i + 1, foundCount: this.foundCount, totalCount: this.totalCount,
      state: this.states.get(rec.recordId),
      viewer: (o, row, address) => {
        const key = viewerKey(self.frontWindow().id, self.meta!.layout.id, rec.recordId, o.id, row?.row.recordId);
        let state = self.viewerStates.get(key);
        if (!state) self.viewerStates.set(key, state = new ViewerState(address));
        else state.address(address);
        return { key, state };
      },
      morePortalRows: (portal, record, have, total) => self.morePortalRows(portal, record, have, total),
      foundSetRows: (portal, shown) => self.foundSetRows(portal, shown),
      foundSetScrolled: (portal, top, first, last) => self.foundSetScrolled(portal, top, first, last),
      foundSetScrollTop: (portal) => self.foundSetScrollTop(portal),
      goToRecordId: (id) => self.goToRecordId(id),
      save: (key, value, row) => {
        self.editing = rec;
        self.save(key, value, row);
        self.editing = undefined;
      },
      upload: (key, file, row) => {
        self.editing = rec;
        self.upload(key, file, row);
        self.editing = undefined;
      },
      containerAction: (key, url, anchor, editable, row) => {
        self.index = i;
        self.containerMenu(rec, key, url, anchor, editable, row);
      },
      action: (o, row) => {
        self.index = i;
        void self.action(o, row);
      },
      fieldEvent: (o, event, row) => {
        self.index = i;
        self.fieldEvent(o, event, row);
      },
      switchPanel: (o, p) => {
        self.index = i;
        return self.switchPanel(o, p);
      },
      fieldIndex: (key, prefix) => self.fieldIndex(key, prefix),
    };
  }

  private selectIndex(i: number): void {
    if (this.index === i) return;
    this.index = i;
    this.select();
  }

  /** Marks the current row in list and table views without redrawing. */
  private select(): void {
    this.noteVisit();
    const rows = this.content.querySelectorAll<HTMLElement>('[data-index]');
    let found = false;
    rows.forEach((el) => {
      const on = el.dataset.index === String(this.index);
      el.classList.toggle('fm-current', on);
      if (on) {
        found = true;
        el.scrollIntoView({ block: 'nearest' });
      }
    });
    if (found) this.renderToolbar();
    else if (this.virtual) {
      this.reveal(this.index);
      this.renderToolbar();
    } else this.render();
  }

  private renderTable(page: HTMLElement): void {
    const r = this.renderer!;
    const meta = this.meta!;
    const designed = meta.design.tableView?.length
      ? meta.design.tableView.flatMap((c) => {
          const f = c.field;
          if (!f.field) return [];
          const key = !f.tableOccurrence || f.tableOccurrence === meta.layout.occurrence ? f.field : `${f.tableOccurrence}::${f.field}`;
          return [{ key, width: c.width }];
        })
      : r.fieldKeys().map((key) => ({ key, width: 140 }));
    const columns = this.tableColumns(designed);
    const table = h('table', { class: 'table-view' });
    const head = h('tr');
    columns.forEach((c, at) => {
      // From the keyboard too: Enter or Space sorts, ⌥← and ⌥→ move the column, ⇧← and ⇧→ make it narrower or wider.
      const th = h('th', { title: 'Click to sort; drag to move; drag the edge to resize', draggable: 'true', tabindex: '0',
        'aria-description': 'Enter to sort; Option or Alt with the arrow keys to move; Shift with the arrow keys to resize' }, c.key);
      th.style.width = `${c.width}px`;
      const sorted = this.sort?.[0]?.fieldName === c.key ? this.sort[0].sortOrder : undefined;
      if (sorted) th.classList.add(sorted);
      if (sorted) th.setAttribute('aria-sort', sorted === 'ascend' ? 'ascending' : 'descending');
      th.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).classList.contains('resize')) void this.sortBy(c.key, sorted === 'ascend' ? 'descend' : 'ascend');
      });
      th.addEventListener('keydown', (e) => {
        if (e.target !== th || e.metaKey || e.ctrlKey) return;
        if ((e.key === 'Enter' || e.key === ' ') && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          void this.sortBy(c.key, sorted === 'ascend' ? 'descend' : 'ascend');
          return;
        }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const step = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.altKey && !e.shiftKey) {
          e.preventDefault();
          const to = at + step;
          if (to < 0 || to >= columns.length) return;
          const moved = [...columns];
          moved.splice(to, 0, ...moved.splice(at, 1));
          this.saveTableColumns(moved);
          this.render();
          // The header keeps the focus in its new place.
          this.content.querySelectorAll<HTMLElement>('table.table-view thead th')[to]?.focus();
        } else if (e.shiftKey && !e.altKey) {
          e.preventDefault();
          c.width = Math.max(30, c.width + step * 10);
          th.style.width = `${c.width}px`;
          this.saveTableColumns(columns);
        }
      });
      // Drag a header onto another to move the column there, as in FileMaker's Table View.
      th.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/x-tabularius-column', String(at)));
      th.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('text/x-tabularius-column')) e.preventDefault();
      });
      th.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData('text/x-tabularius-column'));
        if (!Number.isInteger(from) || from === at) return;
        const moved = [...columns];
        moved.splice(at, 0, ...moved.splice(from, 1));
        this.saveTableColumns(moved);
        this.render();
      });
      // The right edge resizes the column.
      const grip = h('span', { class: 'resize', 'aria-hidden': 'true' });
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX, w0 = c.width;
        const move = (m: MouseEvent) => {
          c.width = Math.max(30, Math.round(w0 + m.clientX - x0));
          th.style.width = `${c.width}px`;
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          this.saveTableColumns(columns);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      th.append(grip);
      head.append(th);
    });
    table.append(h('thead', {}, head));
    const tbody = h('tbody');
    const ROW = 25;
    this.startVirtual('table', tbody, ROW, (i) => {
      const rec = this.cache.get(i);
      const tr = h('tr', { 'data-index': String(i) });
      if (!rec) {
        tr.classList.add('fm-row-loading');
        for (const _ of columns) tr.append(h('td'));
        return tr;
      }
      if (i === this.index) tr.classList.add('fm-current');
      const index = i;
      tr.addEventListener('focusin', () => this.selectIndex(index));
      tr.addEventListener('mousedown', () => this.selectIndex(index));
      for (const c of columns) {
        const t = r.fieldType(c.key);
        const value = String(rec.fieldData[c.key] ?? '');
        const td = h('td');
        if (t?.type === 'container') {
          if (value) td.append(h('a', { href: value, target: '_blank', rel: 'noopener' }, decodeURIComponent(value.split('?')[0].split('/').pop() ?? 'file')));
        } else {
          // Named by its column heading and record number, as a spreadsheet cell is read out.
          const input = h('input', { value: value.replace(/[\r\n]+/g, ' '), 'aria-label': `${c.key}, record ${i + 1}` });
          input.readOnly = !!(t?.calculated || t?.summary || t?.readOnly || !t);
          input.dir = 'auto';
          let last = input.value;
          input.addEventListener('change', () => {
            if (input.value === last) return;
            last = input.value;
            this.editing = rec;
            this.save(c.key, input.value);
            this.editing = undefined;
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            // Up and down move to the same column in the next record, like a spreadsheet.
            else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              e.stopPropagation();
              void this.moveTableCell(index + (e.key === 'ArrowDown' ? 1 : -1), c.key);
            }
          });
          input.dataset.column = c.key;
          td.append(input);
        }
        tr.append(td);
      }
      return tr;
    });
    table.append(tbody);
    page.append(table);
  }

  /** Table View columns: the layout's, in the order and widths this person last left them. */
  private tableColumns(designed: { key: string; width: number }[]): { key: string; width: number }[] {
    let saved: { key: string; width: number }[] = [];
    try {
      saved = JSON.parse(localStorageGet(this.tableKey()) ?? '[]');
    } catch {
      saved = [];
    }
    const known = new Map(designed.map((c) => [c.key, c]));
    const out = saved.filter((c) => known.has(c.key) && typeof c.width === 'number').map((c) => ({ key: c.key, width: c.width }));
    for (const c of designed) if (!out.some((x) => x.key === c.key)) out.push({ ...c });
    return out;
  }

  private saveTableColumns(columns: { key: string; width: number }[]): void {
    localStorageSet(this.tableKey(), JSON.stringify(columns.map(({ key, width }) => ({ key, width }))));
  }

  private tableKey(): string {
    return `tabularius.table.${this.api.db}.${this.meta!.layout.name}`;
  }

  /** Moves the cursor to a column of another record in Table View, fetching its page when needed. */
  private async moveTableCell(i: number, key: string): Promise<void> {
    if (i < 0 || i >= this.foundCount) return;
    if (!(await this.commit())) return;
    this.index = i;
    if (!this.cache.has(i)) await this.fetch(i);
    this.select();
    this.content.querySelector<HTMLInputElement>(`tr[data-index="${i}"] input[data-column="${CSS.escape(key)}"]`)?.focus();
  }

  /**
   * After a save in list view: works out the groups again and redraws the
   * sub-summary parts in place, so subtotals follow the edit (FileMaker keeps
   * the record where it is when a sort field changes, so those edits don't regroup).
   */
  private async refreshBreaks(key: string): Promise<void> {
    if (!this.groups || this.view !== 'list' || this.sort?.some((s) => s.fieldName === key)) return;
    await this.loadGroups();
    for (const el of this.content.querySelectorAll<HTMLElement>('.fm-break')) {
      const { breakLevel, breakPart, breakIndex, breakEdge } = el.dataset;
      const part = this.renderer?.parts.find((p) => String(p.top) === breakPart);
      const rec = this.cache.get(Number(breakIndex));
      const fresh = part && rec && this.renderBreak(part, Number(breakLevel), rec, Number(breakIndex), breakEdge as 'first' | 'last');
      if (fresh) el.replaceWith(fresh);
    }
  }

  /** After a save: updates field values in place, so the field being typed in keeps focus. */
  private refreshValues(): void {
    if (this.view === 'form' && this.mode === 'browse') {
      const active = document.activeElement;
      if (active && active !== document.body && active !== this.content && this.content.contains(active)) return;
      this.render();
    }
  }

  private focusFirstField(): void {
    const first = this.content.querySelector<HTMLElement>('.fm-part-body .fm-input:not([readonly]), .fm-part-body input:not([readonly])');
    first?.focus();
  }

  private keys(e: KeyboardEvent): void {
    // In a browser tab ⌘N, ⌘T and ⌘W never reach the page, so the menus show them with Alt added; answer those as the plain keys.
    const plain = withoutTabAlt(e);
    if (plain) {
      this.keys(plain);
      if (plain.defaultPrevented) e.preventDefault();
      return;
    }
    if (this.keystrokeTrigger(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) {
      if (e.key === 'Escape' && this.popover) this.closePopover();
      // Escape closes a card window that has a close control, unless the cursor is in a field.
      else if (e.key === 'Escape' && this.closable() && !(e.target as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) {
        e.preventDefault();
        void this.closeFrontWindow();
        return;
      }
      if (e.key === 'Tab' && !e.altKey && this.tabNext(e.shiftKey)) e.preventDefault();
      // In Find mode, Return in a field (a tall, multi-line box too: no text is typed there) or Enter performs the find, as in FileMaker.
      if (e.key === 'Enter' && this.mode === 'find' && !e.shiftKey && !e.altKey && this.content.contains(e.target as Node) && !(e.target as HTMLElement).matches('select, button')) {
        e.preventDefault();
        void this.performFind();
        return;
      }
      if (e.key === 'Enter' && !e.altKey && this.exitKey(e) && this.tabNext(e.shiftKey)) e.preventDefault();
      // The keypad's Enter commits the record (Return types a new line), as in FileMaker.
      if (e.code === 'NumpadEnter' && this.mode === 'browse') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        void this.commit(false);
      }
      return;
    }
    const k = e.key.toLowerCase();
    // A custom menu item's own shortcut comes first.
    const custom = this.customMenus && shortcutItem(this.customMenus, e);
    if (custom) {
      e.preventDefault();
      if (custom.run) void this.menuScript(custom);
      else if (custom.command) this.menuCommand(custom.command, true);
      return;
    }
    // ⌘Z outside a field: the toast's Undo, if one is showing (in a field it undoes the typing, as the browser does).
    if (k === 'z' && !e.shiftKey && !e.altKey && !editable(e.target as Element) && this.hasCommand('Undo') && toastUndo()) {
      e.preventDefault();
      return;
    }
    const allowed = (command: string, fn: () => void) => (this.hasCommand(command) ? fn : undefined);
    // FileMaker Pro's other shortcuts: ⌘L Layout mode, ⇧⌘R Refresh Window, ⇧⌘T Omit Multiple, ⌘= Replace Field
    // Contents, ⌥⌘S the status toolbar, ⇧⌘S Script Workspace, ⇧⌘D Manage Database (by key position, since ⌥ changes the letter).
    const letter = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : k;
    const fmKey = e.altKey ? (letter === 's' && !e.shiftKey ? 'Status Toolbar' : undefined)
      : e.shiftKey ? ({ r: 'Refresh Window', t: 'Omit Multiple', s: 'Script Workspace', d: 'Manage Database' } as Record<string, string>)[letter]
        : ({ '=': 'Replace Field Contents' } as Record<string, string>)[k];
    if (fmKey) {
      e.preventDefault();
      if (this.hasCommand(fmKey)) this.doCommand(fmKey);
      return;
    }
    // Insert menu: ⌘- date, ⌘; time, ⇧⌘N user name, ⌘I from index, ⌘' from the last visited record.
    const insert: Record<string, string> = { '-': 'Current Date', ';': 'Current Time', i: 'From Index', "'": 'From Last Visited Record' };
    const insertCommand = e.shiftKey ? (k === 'n' ? 'Current User Name' : undefined) : insert[k];
    if (insertCommand && !e.altKey) {
      if (this.hasCommand(insertCommand)) {
        e.preventDefault();
        this.doCommand(insertCommand);
      }
      return;
    }
    // Edit > Find/Replace: ⇧⌘F opens it, ⌘G finds again, ⇧⌘G replaces and finds again.
    if (!e.altKey && (k === 'g' || (k === 'f' && e.shiftKey))) {
      const command = k === 'f' ? 'Find/Replace' : e.shiftKey ? 'Replace & Find Again' : 'Find Again';
      if (this.hasCommand(command) && this.menuCommand(command, false)) {
        e.preventDefault();
        this.doCommand(command);
      }
      return;
    }
    // Format > Style: ⇧⌘P plain, ⇧⌘B bold, ⇧⌘I italic, ⇧⌘U underline, on the selected text.
    const style = e.shiftKey && !e.altKey && this.mode === 'browse' ? ({ p: 'Plain', b: 'Bold', i: 'Italic', u: 'Underline' } as Record<string, string>)[k] : undefined;
    if (style) {
      e.preventDefault();
      if (this.hasCommand(style)) this.doCommand(style);
      return;
    }
    const map: Record<string, (() => void) | undefined> = {
      n: allowed('New Record', () => (this.mode === 'find' ? this.newRequest() : void this.newRecord())),
      r: this.mode === 'find' ? undefined : allowed('Modify Last Find', () => this.doCommand('Modify Last Find')),
      f: allowed('Find Mode', () => this.doCommand('Find Mode')),
      b: () => void this.enterBrowse(),
      u: allowed('Preview Mode', () => this.doCommand('Preview Mode')),
      l: this.canDesign ? allowed('Layout Mode', () => this.doCommand('Layout Mode')) : undefined,
      // Without the printing privilege, ⌘P doesn't fall through to the browser's own print dialog either.
      p: allowed('Print', () => this.doCommand('Print')) ?? (this.printing ? undefined : () => toast('This account isn\'t allowed to print.', 'error')),
      j: allowed('Show All Records', () => void this.showAll()),
      k: allowed('Open Quickly', () => this.openQuickly()),
      '/': () => this.shortcutsSheet(),
      e: allowed('Delete Record', () => (this.mode === 'find' ? this.deleteRequest() : void this.deleteRecord())),
      // As in FileMaker: ⌘S sorts, ⌘T omits, ⌘D duplicates.
      s: allowed('Sort Records', () => this.doCommand('Sort Records')),
      t: this.mode === 'find' ? allowed('Omit Request', () => this.doCommand('Omit Request')) : allowed('Omit Record', () => this.doCommand('Omit Record')),
      d: allowed('Duplicate Record', () => this.doCommand('Duplicate Record')),
      arrowdown: () => (this.mode === 'find' ? this.showRequest(this.request + 1) : void this.goTo(this.index + 1)),
      arrowup: () => (this.mode === 'find' ? this.showRequest(this.request - 1) : void this.goTo(this.index - 1)),
    };
    if (e.key === 'Enter' && this.mode === 'find') {
      e.preventDefault();
      void this.performFind();
      return;
    }
    const fn = map[k];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }

  // ---------------------------------------------------------- toolbar

  /** Fields to sort by: those on the layout, plus sub-summary break fields and the current sort (a script's may use others). */
  private sortFields(): string[] {
    const keys = new Set(this.renderer?.fieldKeys() ?? []);
    for (const p of this.renderer?.parts ?? []) {
      const k = this.renderer!.refKey(p.breakField);
      if (k) keys.add(k);
    }
    for (const s of this.sort ?? []) keys.add(s.fieldName);
    return [...keys];
  }

  /** The window changed shape: formulas that read Get ( WindowWidth ) or the orientation give new answers. */
  private async windowChanged(): Promise<void> {
    if (!this.meta || this.preview) return;
    this.states.clear();
    this.findState = undefined;
    this.emptyState = undefined;
    await this.loadStates();
    this.render();
  }

  /**
   * Touch gestures, as on FileMaker Go: a sideways swipe in form view goes to the next or previous record, and pulling
   * down at the top of the window refreshes it. These follow touch events, not pointer events: once the browser takes a
   * finger for scrolling (or overscrolling at the top) it cancels the pointer, but its touches keep coming. They keep
   * coming to the element first touched even when a redraw (another user's change, say) takes it out of the window, so
   * the rest of the gesture is followed there rather than on the window.
   */
  private touchGestures(): void {
    const c = this.content;
    let start: { x: number; y: number; at: number; top: boolean; left: number } | undefined;
    let last: { x: number; y: number } | undefined;
    let pulled = 0;
    const pull = h('div', { class: 'pull-refresh', 'aria-hidden': 'true' }, h('span', { class: 'pull-spinner' }));
    const reset = () => {
      start = undefined;
      last = undefined;
      pulled = 0;
      pull.style.removeProperty('--pull');
      pull.classList.remove('ready');
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) return reset();
      const t = e.touches[0];
      last = { x: t.clientX, y: t.clientY };
      if (!start.top) return;
      const dy = t.clientY - start.y;
      if (dy <= 0 || Math.abs(t.clientX - start.x) > dy) return;
      pulled = Math.min(dy, 120);
      if (!pull.isConnected) c.prepend(pull);
      pull.style.setProperty('--pull', String(pulled));
      pull.classList.toggle('ready', pulled >= PULL_TO_REFRESH);
    };
    const end = () => {
      if (!start || !last) return reset();
      const dx = last.x - start.x;
      const dy = last.y - start.y;
      const quick = Date.now() - start.at < 700;
      // A layout wider than the window scrolls sideways under the finger: that's a pan, not a swipe.
      const panned = c.scrollLeft !== start.left;
      const refresh = pulled >= PULL_TO_REFRESH;
      reset();
      if (refresh) {
        pull.classList.add('busy');
        c.prepend(pull);
        void this.refreshWindow().finally(() => pull.remove()).catch((err) => toast(errorText(err)));
        return;
      }
      pull.remove();
      if (this.view !== 'form' || !quick || panned || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
      const to = this.index + (dx < 0 ? 1 : -1);
      if (to < 0 || to >= this.foundCount) return;
      c.dataset.swipe = dx < 0 ? 'next' : 'prev';
      void this.goTo(to).finally(() => setTimeout(() => delete c.dataset.swipe, 250));
    };
    const cancel = () => {
      reset();
      pull.remove();
    };
    c.addEventListener('touchstart', (e) => {
      reset();
      if (e.touches.length !== 1 || this.mode !== 'browse' || this.preview) return;
      // A slide control takes its own swipes; fields, lists and portals scroll or select instead.
      const target = e.target as Element;
      if (target.closest('input, textarea, select, [contenteditable], .fm-portal-rows, .fm-web-viewer, .fm-container, [data-swipes]')) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, at: Date.now(), top: c.scrollTop <= 0, left: c.scrollLeft };
      last = { x: t.clientX, y: t.clientY };
      const done = new AbortController();
      const finish = (then: () => void) => () => { done.abort(); then(); };
      target.addEventListener('touchmove', move as EventListener, { passive: true, signal: done.signal });
      target.addEventListener('touchend', finish(end), { signal: done.signal });
      target.addEventListener('touchcancel', finish(cancel), { signal: done.signal });
    }, { passive: true });
  }

  /** Records > Refresh Window, and pulling down on a phone: the found set and record as the server has them now. */
  private async refreshWindow(): Promise<void> {
    if (!this.meta) return;
    const generation = this.displayGeneration;
    const scope = { windowId: this.frontWindow().id, layoutId: this.meta.layout.id, recordId: this.record ? Number(this.record.recordId) : undefined };
    const refresh = await this.api.refresh(this.meta.layout.name, { ...scope, ids: this.ids, query: this.query, sort: this.sort, mode: this.windowMode, view: this.view,
      ...this.displayPortals(), totalCount: this.totalCount, displayRecords: [...this.cache.values()].map((r) => Number(r.recordId)), step: 'Refresh Window' });
    if (generation === this.displayGeneration) await this.applyRefresh({ step: 'Refresh Window', ...scope, refresh });
  }

  /** The bottom toolbar on phones: previous, record number, next, New Record and Find, or the find requests. */
  private renderBottomBar(): void {
    const b = this.bottomBar;
    b.replaceChildren();
    b.hidden = !this.meta || !!this.preview || !!this.pausedRun;
    if (b.hidden) return;
    const icon = (label: string, glyph: string, run: () => void, opts: Record<string, string> = {}) =>
      button(glyph, run, { 'aria-label': label, title: label, ...opts });
    if (this.mode === 'find') {
      const n = this.requests.length;
      b.append(
        icon('Previous request', '‹', () => this.showRequest(this.request - 1), this.request === 0 ? { disabled: '' } : {}),
        h('span', { class: 'bottom-count' }, `Request ${this.request + 1} of ${n}`),
        icon('Next request', '›', () => this.showRequest(this.request + 1), this.request === n - 1 ? { disabled: '' } : {}),
        icon('New request', '+', () => this.newRequest()),
        button('Find', () => void this.performFind(), { class: 'primary' }),
        button('Cancel', () => void this.enterBrowse(), { class: 'quiet' }),
      );
      return;
    }
    const count = button(this.foundCount ? `${this.index + 1} of ${this.foundCount}` : 'No records', () => void this.goToRecordNumber(), { class: 'bottom-count quiet', 'aria-label': `${this.foundCount ? `${this.index + 1} of ${this.foundCount}` : 'No records'}, go to record number` });
    if (!this.foundCount) count.disabled = true;
    b.append(
      icon('Previous record', '‹', () => void this.goTo(this.index - 1), this.index <= 0 ? { disabled: '' } : {}),
      count,
      icon('Next record', '›', () => void this.goTo(this.index + 1), this.index >= this.foundCount - 1 ? { disabled: '' } : {}),
      ...(this.hasCommand('New Record') ? [icon('New record', '+', () => void this.newRecord())] : []),
      ...(this.hasCommand('Find Mode') ? [icon('Find', '⌕', () => this.doCommand('Find Mode'))] : []),
    );
  }

  /**
   * Rebuilds the toolbar, keeping keyboard focus on the same control (or the one in its place):
   * pressing List, ›, a zoom button and the like rebuilds it, which would otherwise drop focus to
   * the page (WCAG 2.4.3).
   */
  renderToolbar(): void {
    const bars = [this.toolbar, this.windowBar, this.bottomBar];
    const focused = document.activeElement as HTMLElement | null;
    const bar = focused && bars.find((b) => focused !== b && b.contains(focused));
    const stops = () => bars.flatMap((b) => [...b.querySelectorAll<HTMLElement>('button, input, select, a[href]')]);
    const key = (el: HTMLElement) => `${bars.findIndex((b) => b.contains(el))}|${el.tagName}|${el.getAttribute('aria-label') ?? ''}|${el.title}|${el.textContent}`;
    const was = bar ? { key: key(focused), at: stops().indexOf(focused) } : undefined;
    this.buildToolbar();
    if (was) (stops().find((el) => key(el) === was.key) ?? stops()[was.at])?.focus();
  }

  private buildToolbar(): void {
    // Under a card or dialog, the window's toolbar and bars stay as they were, waiting, as FileMaker's parent window does.
    if (this.toolbar.inert) return;
    this.renderBottomBar();
    this.renderWindowBar();
    const t = this.toolbar;
    t.replaceChildren();
    t.hidden = this.statusToolbarHidden;
    t.classList.toggle('finding', this.mode === 'find');
    t.classList.toggle('previewing', !!this.preview && this.mode !== 'find');
    // Presence: the current record, in every view (list and table views show where others are too).
    const shown = this.mode === 'browse' && this.meta ? this.record : undefined;
    if (this.presence.look(shown && this.meta!.layout.name, shown?.recordId)) {
      this.viewers = [];
      if (shown) void this.refreshViewers();
    }
    // FileMaker's status toolbar: a row of buttons, each an icon over its name, then the layout bar.
    const row = h('div', { class: 'tb-row' });
    const bar = h('div', { class: 'layout-bar' });
    t.append(row, bar);
    // A paused script: Continue or Cancel, whatever the mode, as in FileMaker's status toolbar.
    const resume = this.pausedRun;
    if (resume) {
      row.append(h('div', { class: 'group paused' },
        h('span', { class: 'mode-badge paused' }, 'Paused'),
        button('Continue', () => resume(true), { class: 'primary' }),
        button('Cancel', () => resume(false)),
      ));
    }
    const layoutSelect = h('select', { class: 'layout-menu', 'aria-label': 'Layout' });
    // Layout folders, as FileMaker's layout pop-up shows them: a folder inside another is labelled with its path.
    let group: HTMLElement = layoutSelect;
    const folders: string[] = [];
    const openGroup = () => {
      group = folders.length ? h('optgroup', { label: folders.join(' › ') }) : layoutSelect;
      if (group !== layoutSelect) layoutSelect.append(group);
    };
    for (const m of this.listedLayouts()) {
      if (m.kind === 'folder') {
        folders.length = Math.min(folders.length, m.depth);
        folders.push(m.name);
        openGroup();
      } else if (m.kind === 'folder-end') {
        folders.pop();
        openGroup();
      } else if (m.kind === 'item') {
        if (m.depth < folders.length) { // a layout after its folder ended without a marker
          folders.length = m.depth;
          openGroup();
        }
        const opt = h('option', { value: m.name }, m.name);
        if (!m.open) opt.disabled = true;
        group.append(opt);
      } else if (m.kind === 'separator') {
        group.append(h('option', { disabled: '', 'aria-hidden': 'true' }, '──────────'));
      }
    }
    if (this.meta) layoutSelect.value = this.meta.layout.name;
    layoutSelect.addEventListener('change', () => void this.goToLayout(layoutSelect.value).catch((e) => toast(errorText(e))));

    const views = h('div', { class: 'segmented', role: 'group', 'aria-label': 'View As' });
    for (const v of (['form', 'list', 'table'] as View[]).filter((x) => this.allows(x))) {
      const name = `View as ${v[0].toUpperCase() + v.slice(1)}`;
      const b = button('', () => this.setView(v), { 'aria-pressed': String(this.view === v), title: name, 'aria-label': name });
      b.innerHTML = TOOL_ICONS[v];
      if (this.mode === 'find' && v !== 'form') b.disabled = true;
      views.append(b);
    }
    // The layout bar, as FileMaker's: Layout and View As at the left, Edit Layout at the right.
    bar.append(
      h('div', { class: 'group' }, h('span', { class: 'label' }, 'Layout:'), layoutSelect),
      h('div', { class: 'group' }, h('span', { class: 'label' }, 'View As:'), views),
    );
    const editLayout = this.hasCommand('Layout Mode') ? [button('Edit Layout', () => this.doCommand('Layout Mode'), { class: 'quiet edit-layout', title: 'Change this layout in Layout mode (⌘L)' })] : [];
    const aiPanel = this.assistant ? [button('Ask AI', () => this.assistant!.toggle(), { class: 'ai-button', title: 'The assistant, in a panel at the side: ask about this file, layout or record' })] : [];

    if (this.mode === 'find') {
      // A find in words: the assistant turns it into find requests and shows the found set.
      const words = h('input', { type: 'search', class: 'ai-find', placeholder: 'Describe what to find', 'aria-label': 'Describe what to find' });
      const findWithAI = () => {
        const text = words.value.trim();
        if (text && this.assistant) void this.assistant.findInWords(text);
      };
      words.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // Enter here asks the assistant, not Perform Find on the (empty) requests.
          e.preventDefault();
          e.stopPropagation();
          findWithAI();
        }
      });
      // Insert Operators, as in FileMaker's Find mode toolbar: typed where the cursor was.
      const operators = h('select', { class: 'operators', 'aria-label': 'Insert Operators' }, h('option', { value: '' }, 'Operators'),
        ...FIND_OPERATORS.map(([op, meaning]) => h('option', { value: op }, `${op}  ${meaning}`))) as HTMLSelectElement;
      operators.addEventListener('change', () => {
        const op = operators.value;
        operators.value = '';
        if (op) this.insertOperator(op);
      });
      // Matching Records: Include or Omit, as FileMaker's pair of buttons.
      const matching = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Matching Records' },
        ...([['Include', false], ['Omit', true]] as const).map(([label, omit]) => button(label, () => {
          this.omit = omit;
          this.renderToolbar();
        }, { 'aria-pressed': String(this.omit === omit), ...(omit ? { title: 'Leave out the records this request matches (⌘T)' } : {}) })));
      const saved = this.builtinMenu('[Saved Finds]') ?? [];
      const savedFinds = h('select', { class: 'saved-finds', 'aria-label': 'Saved Finds' }, h('option', { value: '' }, 'Saved Finds'),
        ...saved.map((s, i) => h('option', { value: String(i) }, s.title))) as HTMLSelectElement;
      savedFinds.addEventListener('change', () => saved[Number(savedFinds.value)]?.run());
      const n = this.requests.length;
      row.append(
        this.navigator('Requests', this.request, n, (i) => this.showRequest(i), 'request', h('span', { class: 'found' }, h('b', {}, String(n)), h('small', {}, 'Total'))),
        tool('New Request', 'newRequest', () => this.newRequest(), { title: 'Add a request (⌘N); records matching any request are found' }),
        tool('Delete Request', 'delete', () => this.deleteRequest(), { title: 'Delete this request (⌘E)', ...(n < 2 ? { disabled: '' } : {}) }),
        tool('Perform Find', 'find', () => void this.performFind(), { class: 'tb primary' }),
        tool('Cancel Find', 'cancel', () => void this.enterBrowse()),
        h('div', { class: 'tb-field' }, matching, h('span', { class: 'tb-label' }, 'Matching Records')),
        h('div', { class: 'tb-field' }, operators, h('span', { class: 'tb-label' }, 'Insert')),
        ...(saved.length ? [h('div', { class: 'tb-field' }, savedFinds, h('span', { class: 'tb-label' }, 'Saved Finds'))] : []),
        ...(this.hasCommand('Constrain Found Set') && (this.query || this.ids) ? [tool('Constrain', 'constrain', () => void this.constrainFind(false), { title: 'Find only among the records found now' })] : []),
        ...(this.hasCommand('Extend Found Set') && (this.query || this.ids) ? [tool('Extend', 'extend', () => void this.constrainFind(true), { title: 'Add the matching records to the records found now' })] : []),
        h('div', { class: 'spacer' }),
      );
      bar.append(h('div', { class: 'spacer' }),
        ...(this.assistant ? [h('div', { class: 'group' }, words, button('Find with AI', findWithAI, { class: 'ai-button', title: 'The assistant fills in find requests from your words, to check and change before Perform Find' }))] : []));
      return;
    }

    if (this.preview) {
      const shownRecords = Math.min(this.foundCount, PREVIEW_MAX);
      row.append(
        this.navigator('Pages', this.previewPage, this.previewPages, (i) => this.showPage(i), 'page',
          h('span', { class: 'found' }, h('b', {}, String(this.previewPages)), h('small', {}, shownRecords < this.foundCount ? `Total (first ${shownRecords} of ${this.foundCount} records)` : 'Total'))),
        tool('Exit Preview', 'exit', () => void this.enterBrowse()),
        ...(this.hasCommand('Print') ? [tool('Print', 'print', () => void this.print(), { class: 'tb primary' })] : []),
        ...(this.hasCommand('Save Records as PDF') ? [tool('Save as PDF', 'pdf', () => this.doCommand('Save Records as PDF'))] : []),
        h('a', { href: '/docs/troubleshooting-web-client#preview-or-printing-is-blank-incomplete-or-laid-out-incorrectly' }, 'Preview and print help'),
        h('div', { class: 'spacer' }),
      );
      bar.append(h('div', { class: 'spacer' }), ...editLayout);
      return;
    }

    const found = this.query || (this.ids && this.foundCount !== this.totalCount);
    const sorted = this.sort?.length ? 'Sorted' : 'Unsorted';
    const count = h('span', { class: 'found' },
      h('b', {}, String(this.foundCount)),
      h('small', {}, found ? `Found (${sorted})` : `Total (${sorted})`),
      ...(found ? [h('small', { class: 'of-total' }, `${this.totalCount} Total`)] : []));
    const quick = h('input', { type: 'search', class: 'quick-find', placeholder: 'Search', 'aria-label': 'Quick find' });
    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.quickFind(quick.value);
    });
    const editor = this.lockedByOther(this.record);
    row.append(
      this.navigator('Records', this.index, this.foundCount, (i) => void this.goTo(i), 'record', count),
      ...(editor ? [h('div', { class: 'group in-use', title: `${editor} is editing this record: your changes wait until they're done` }, ...avatars([editor], editor), `Being edited by ${editor}`)] : []),
      ...(this.viewers.length && !editor ? [h('div', { class: 'group also-here', title: `Also here: ${this.viewers.join(', ')}. They have this record open too.`, 'aria-label': `Also here: ${this.viewers.join(', ')}` }, ...avatars(this.viewers), h('span', { class: 'also-names' }, this.viewers.join(', ')))] : []),
      // A custom menu set without a command takes its toolbar button away too, as in FileMaker.
      ...(this.hasCommand('Show All Records') ? [tool('Show All', 'showAll', () => void this.showAll())] : []),
      ...(this.hasCommand('New Record') ? [tool('New Record', 'newRecord', () => void this.newRecord())] : []),
      ...(this.hasCommand('Delete Record') ? [tool('Delete Record', 'delete', () => void this.deleteRecord(), this.record ? {} : { disabled: '' })] : []),
      ...(this.hasCommand('Find Mode') ? [tool('Find', 'find', () => this.doCommand('Find Mode'))] : []),
      ...(this.hasCommand('Sort Records') ? [tool('Sort', 'sort', () => this.openSortDialog([...this.sortFields()]), { title: 'Sort Records (⌘S)' })] : []),
      h('div', { class: 'spacer' }),
      h('div', { class: 'tb-field quick' }, quick, h('span', { class: 'tb-label' }, 'Quick Find')),
    );
    // Tabularius's one-click sort, after FileMaker's own layout bar items.
    const sortKeys = this.sortFields();
    const sortSelect = h('select', { 'aria-label': 'Sort by' }, h('option', { value: '' }, 'Unsorted'), ...sortKeys.map((k) => h('option', { value: k }, k)));
    sortSelect.value = this.sort?.[0]?.fieldName ?? '';
    const order = this.sort?.[0]?.sortOrder === 'descend' ? 'descend' : 'ascend';
    sortSelect.addEventListener('change', () => void this.sortBy(sortSelect.value, order));
    const orderBtn = button(order === 'ascend' ? '↑' : '↓', () => void this.sortBy(sortSelect.value, order === 'ascend' ? 'descend' : 'ascend'), { title: 'Sort order', class: 'quiet' });
    orderBtn.disabled = !this.sort;
    bar.append(
      ...(this.hasCommand('Preview Mode') ? [button('Preview', () => this.doCommand('Preview Mode'), { class: 'quiet', title: 'The found set as printed pages (⌘U)' })] : []),
      ...(this.hasCommand('Sort Records') && sortKeys.length ? [h('div', { class: 'group quick-sort' }, h('span', { class: 'label' }, 'Sort by:'), sortSelect, orderBtn)] : []),
      h('div', { class: 'spacer' }),
      ...(this.recording ? [button(`Stop recording (${this.recording.filter((a) => a.kind !== 'layout').length})`, () => void this.toggleRecording(), { class: 'quiet recording', title: 'Stop, then see the recorded steps as a script, dry run it and save it' })] : []),
      ...(this.assistant && this.record ? [button('Ask about this record', () => void this.assistant!.askAbout(ABOUT_RECORD), { class: 'quiet', title: 'A summary of this record with its related records (orders, notes, line items), citing the fields it used; then ask anything about it' })] : []),
      ...aiPanel,
      ...editLayout,
    );
    if (this.loading) t.classList.add('busy');
    else t.classList.remove('busy');
  }

  /** FileMaker's records (or requests) navigator: the book's previous and next pages, the number box, and the count. */
  private navigator(label: string, at: number, total: number, go: (i: number) => void, noun: string, count: HTMLElement): HTMLElement {
    const prev = button('', () => go(at - 1), { title: `Previous ${noun}`, 'aria-label': `Previous ${noun}`, class: 'page prev' });
    const next = button('', () => go(at + 1), { title: `Next ${noun}`, 'aria-label': `Next ${noun}`, class: 'page next' });
    prev.innerHTML = TOOL_ICONS.prev;
    next.innerHTML = TOOL_ICONS.next;
    prev.disabled = at <= 0;
    next.disabled = at >= total - 1;
    const box = h('input', { class: 'record-number', 'aria-label': `${noun[0].toUpperCase()}${noun.slice(1)} number`, value: total ? String(at + 1) : '0', inputmode: 'numeric' });
    box.addEventListener('change', () => {
      const n = Math.trunc(Number(box.value));
      if (n >= 1 && total) go(Math.min(total, n) - 1);
      else box.value = String(at + 1);
    });
    return h('div', { class: 'tb-field nav', role: 'group', 'aria-label': label },
      h('div', { class: 'book' }, prev, next, box, count),
      h('span', { class: 'tb-label' }, label));
  }

  /** The bar at the foot of the window, as FileMaker's: zoom, the status toolbar's show/hide, and the mode popup. */
  private renderWindowBar(): void {
    const w = this.windowBar;
    w.replaceChildren();
    w.hidden = !this.meta;
    if (w.hidden) return;
    w.classList.toggle('finding', this.mode === 'find');
    w.classList.toggle('previewing', !!this.preview && this.mode !== 'find');
    const zoomLock: Record<string, string> = this.zoomLocked ? { disabled: '' } : {};
    const zoom = h('div', { class: 'group zoom', role: 'group', 'aria-label': 'Zoom' },
      button(`${Math.round(this.effectiveZoom() * 100)}`, () => this.setZoom(0), { class: 'quiet zoom-level', title: 'Zoom level: click for 100%', ...zoomLock }),
      button('−', () => this.setZoom(-1), { title: 'Zoom Out', 'aria-label': 'Zoom Out', class: 'quiet', ...zoomLock }),
      button('+', () => this.setZoom(1), { title: 'Zoom In', 'aria-label': 'Zoom In', class: 'quiet', ...zoomLock }));
    const toggle = button('', () => this.toggleStatusToolbar(), { class: 'quiet toolbar-toggle', title: this.statusToolbarHidden ? 'Show Status Toolbar (⌥⌘S)' : 'Hide Status Toolbar (⌥⌘S)', 'aria-label': 'Status Toolbar', 'aria-pressed': String(!this.statusToolbarHidden), ...(this.toolbarLocked ? { disabled: '' } : {}) });
    toggle.innerHTML = TOOL_ICONS.toolbar;
    w.append(zoom, toggle, this.modeSwitch(), h('div', { class: 'spacer' }),
      h('span', { class: 'account', title: 'Signed in as' }, this.accountName),
      keepFocusOnPress(button('Log Out', () => void this.logout(), { class: 'quiet' })));
  }

  /** View > Status Toolbar (⌥⌘S): hides or shows the toolbar, remembered for this file. */
  private toggleStatusToolbar(): void {
    if (this.toolbarLocked) return;
    this.statusToolbarHidden = !this.statusToolbarHidden;
    localStorageSet(`openhbam.statusToolbar.${this.api.db}`, this.statusToolbarHidden ? 'hidden' : 'shown');
    this.renderToolbar();
  }

  /** Shows a found set (from the assistant): a find on a layout, as Perform Find would. */
  async showFoundSet(layout: string, query: FindRequest[], sort?: SortSpec[]): Promise<void> {
    try {
      if (this.meta?.layout.name !== layout) await this.goToLayout(layout);
      else await this.commit();
      this.query = query.length ? query : undefined;
      this.sort = sort;
      this.ids = undefined;
      this.mode = 'browse';
      this.index = 0;
      await this.reload();
    } catch (e) {
      toast(errorText(e));
    }
  }

  /**
   * Find mode on a layout with requests filled in (the assistant's "Edit in Find mode", and Find with AI), find and omit
   * requests alike, to check, change and perform. `words` is what the person asked for: it names the find when saved.
   */
  async editFind(layout: string, requests: FindRequest[], words?: string): Promise<void> {
    try {
      if (this.meta?.layout.name !== layout) await this.goToLayout(layout);
      await this.enterFind();
      if (this.mode !== 'find') return;
      const keys = this.renderer?.fieldKeys() ?? [];
      const bare = (k: string) => k.slice(k.indexOf('|') + 1).toLowerCase();
      const missing = new Set<string>();
      const filled: FindModeRequest[] = [];
      for (const request of requests) {
        const criteria: Record<string, string> = {};
        for (const [k, v] of Object.entries(request)) {
          if (k === 'omit') continue;
          const key = keys.find((x) => x.toLowerCase() === k.toLowerCase()) ?? keys.find((x) => bare(x) === k.toLowerCase());
          if (key) criteria[key] = String(v);
          else missing.add(k);
        }
        if (Object.keys(criteria).length) filled.push({ criteria, omit: String(request.omit) === 'true' });
      }
      if (filled.length) this.requests = filled;
      this.request = 0;
      this.aiFind = words ? { words, requests: JSON.stringify(this.requests) } : undefined;
      this.render();
      const omits = filled.filter((r) => r.omit).length;
      if (missing.size) toast(`Not on this layout, so left out: ${[...missing].join(', ')}. Change the find in the assistant panel to keep them.`, 'info');
      else if (words) toast(`Filled in ${filled.length === 1 ? 'a request' : `${filled.length} requests`}${omits ? ` (${omits === filled.length ? 'omitting' : `${omits} omitting`})` : ''} from "${words}". Change anything, then Perform Find.`, 'info');
    } catch (e) {
      toast(errorText(e));
    }
  }

  /** Applies design changes the assistant proposed, then reloads the layout to show them. */
  async applyDesign(changes: Record<string, unknown>[], done = 'Design changed'): Promise<false | { undo?: Record<string, unknown>[] }> {
    try {
      const r = await fetch(`/tabularius/design/v1/databases/${encodeURIComponent(this.api.db)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.api.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(body.error?.code ?? -1, body.error?.message ?? httpProblem(r.status));
      toast(done, 'info');
      // The Layout and Scripts menus list what the file has now: a script just saved is there to run.
      await this.api.menu().then((menu) => {
        this.menuItems = menu.layouts;
        this.scriptsMenu = menu.scripts ?? [];
      }, () => {});
      // A file that had no layouts opens again, on the first new one.
      if (this.meta) await this.goToLayout(this.meta.layout.name).catch(() => {});
      else location.reload();
      return { undo: body.undo };
    } catch (e) {
      toast(errorText(e));
      return false;
    }
  }

  /** Where this window is, for coming back to it from Layout mode or Design. */
  private rememberReturn(): void {
    if (!this.meta) return;
    const snapshot: WindowSnapshot = {
      layout: this.meta.layout.name, view: this.view, query: this.query, sort: this.sort, ids: this.ids,
      index: this.index, recordId: this.record?.recordId, ...(this.secondary !== undefined ? { number: this.secondary } : {}),
    };
    sessionStorageSet(RETURN_KEY, JSON.stringify(snapshot));
  }

  /**
   * Layout mode, as FileMaker's: this layout in the layout editor, in this window. Browse, Find or Preview there
   * (or Exit Layout, ⌘B) comes back to this layout, found set and record.
   */
  async enterLayout(): Promise<void> {
    if (!this.meta) return;
    if (this.mode === 'find' || this.preview) await this.enterBrowse();
    if (!(await this.commit())) return;
    announce('Layout mode.');
    this.rememberReturn();
    try {
      sessionStorage.setItem('tabularius.windowRecord', JSON.stringify({ layout: this.meta.layout.name, recordId: this.record ? Number(this.record.recordId) : undefined }));
    } catch { /* private window: previews start on the first records */ }
    location.href = `design.html#layoutmode=${this.meta.layout.id}`;
  }

  /** Browse, Find, Layout and Preview, as FileMaker's mode pop-up: the one this window is in is pressed. */
  private modeSwitch(): HTMLElement {
    const now = this.windowMode;
    const modes: ['browse' | 'find' | 'layout' | 'preview', string, string, () => void][] = [
      ['browse', 'Browse', 'Browse Mode (⌘B): see and change records', () => void this.enterBrowse()],
      ...(this.hasCommand('Find Mode') ? [['find', 'Find', 'Find Mode (⌘F): type what to look for', () => this.doCommand('Find Mode')] as ['find', string, string, () => void]] : []),
      ...(this.canDesign && this.hasCommand('Layout Mode') ? [['layout', 'Layout', 'Layout Mode (⌘L): change this layout', () => this.doCommand('Layout Mode')] as ['layout', string, string, () => void]] : []),
      ...(this.hasCommand('Preview Mode') ? [['preview', 'Preview', 'Preview Mode (⌘U): the found set as printed pages', () => this.doCommand('Preview Mode')] as ['preview', string, string, () => void]] : []),
    ];
    const group = h('div', { class: 'segmented modes', role: 'group', 'aria-label': 'Mode' });
    for (const [id, label, title, run] of modes) group.append(button(label, () => { if (id !== now) run(); }, { 'aria-pressed': String(id === now), title }));
    return group;
  }

  /** Design (Manage Database, Script Workspace, Layout mode): `where` is a query and tab (#scripts) to open at. */
  async openDesign(where = ''): Promise<void> {
    if (!(await this.commit())) return;
    this.rememberReturn();
    // Design mode's formula previews start on this record.
    try {
      sessionStorage.setItem('tabularius.windowRecord', JSON.stringify({ layout: this.meta?.layout.name, recordId: this.record ? Number(this.record.recordId) : undefined }));
    } catch { /* private window: previews start on the first records */ }
    location.href = `design.html${where}`;
  }

  async openSecurity(): Promise<void> {
    if (!(await this.commit())) return;
    location.href = 'security.html';
  }

  /** Tells an open Data Viewer what this window shows, so its formulas follow the current record. */
  private publishWindow(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    if (!this.windowChannel) {
      this.windowChannel = new BroadcastChannel(`tabularius.window.${this.api.db}`);
      this.windowChannel.onmessage = (e) => {
        if (e.data?.type === 'hello') this.publishWindow();
      };
    }
    this.windowChannel.postMessage({
      type: 'window', layout: this.meta?.layout.name, recordId: this.record ? Number(this.record.recordId) : undefined,
      mode: this.windowMode, view: this.view, foundCount: this.foundCount, totalCount: this.totalCount, number: this.record ? this.recordNumber : undefined,
    });
  }

  openAutomations(): void {
    window.open('automations.html', 'tabularius-automations');
  }

  openCleanup(): void {
    window.open('cleanup.html', 'tabularius-cleanup');
  }

  /** Digest runs that came in since this browser last looked: a notice with a button to read them. */
  private syncing = false;

  /** Sends the field changes made offline; asks about any that clash with changes made on the server meanwhile. */
  private async sendWaiting(): Promise<void> {
    if (!this.api.offline || this.api.copyOnly || this.syncing) return;
    this.syncing = true;
    announce('Syncing offline changes.');
    try {
      const before = this.api.waiting;
      const clashes = await this.api.sync();
      for (const edit of clashes) {
        const choice = await clashDialog(edit, (key) => key);
        if (choice) await this.api.resolve(edit, choice === 'mine').catch((e) => toast(`Couldn't save your changes: ${errorText(e)}`));
      }
      if (before && !this.api.waiting) {
        announce('Offline changes saved.');
        toast(before === 1 ? 'The change made offline was saved.' : `The ${before} changes made offline were saved.`, 'info');
      } else announce('Offline sync complete.');
      if (before || clashes.length) await this.reload(this.record?.recordId);
    } catch (e) {
      announce('Offline sync failed.');
      toast(`Couldn't send the changes made offline: ${errorText(e)}`);
    } finally {
      this.syncing = false;
    }
  }

  /** Changes made offline wait in a copy made with an earlier password: asks for it, then moves them to this one's. */
  private async recoverStaleCopy(): Promise<void> {
    const saved = this.api.offlineKey;
    if (!shelf || !saved || !this.api.staleCopy) return;
    const k = await importKey(saved);
    const answer = await oldPasswordDialog(this.api.db, k.account, await OfflineCopy.waitingIn(shelf, this.api.db, k.account));
    if (!answer) return;
    try {
      this.api.offline = answer === 'discard'
        ? await OfflineCopy.create(shelf, this.api.db, k.account, k.salt, k.key)
        : await answer.moveTo(k.salt, k.key);
    } catch (e) {
      // The copy is still there under the old password, with its waiting changes: the person can try again.
      toast(`The offline changes couldn't be moved to this password yet: ${errorText(e)}`);
      return;
    }
    this.api.staleCopy = false;
    await this.api.countWaiting();
    await this.sendWaiting();
  }

  /** File > Offline Copy > Keep Offline Copy: starts or removes this browser's copy of the file. */
  private async toggleOffline(): Promise<void> {
    if (!shelf) {
      toast('Offline copies need the server on HTTPS (or this computer), in a browser that allows them.');
      return;
    }
    const current = this.api.offline;
    if (current) {
      const waiting = this.api.waiting;
      if (waiting && !(await askConfirm('Remove offline copy?', `${waiting === 1 ? 'A change made offline hasn\'t' : `${waiting} changes made offline haven't`} been sent yet and will be lost. Remove the offline copy?`, 'Remove'))) return;
      this.api.offline = undefined;
      await current.forget();
      await this.api.countWaiting();
      if (this.api.copyOnly) {
        offlineHooks = undefined;
        void showLogin();
        return;
      }
      toast('This browser no longer keeps an offline copy of this file.', 'info');
      return;
    }
    if (!this.api.offlineKey) {
      toast('Sign in with your password to keep an offline copy: the copy opens with it.');
      return;
    }
    if (this.api.staleCopy) {
      await this.recoverStaleCopy();
      return;
    }
    const k = await importKey(this.api.offlineKey);
    this.api.offline = await OfflineCopy.create(shelf, this.api.db, k.account, k.salt, k.key);
    // What opening the file asks for, so it opens offline; the rest is kept as it is opened.
    await this.api.menu().catch(() => undefined);
    if (this.meta) await this.api.layout(this.meta.layout.name).catch(() => undefined);
    toast('This browser now keeps what you open in this file, so you can read it and change fields without a connection.', 'info');
    await this.reload(this.record?.recordId);
  }

  private async digestNotice(): Promise<void> {
    const key = `tabularius.digestsSeen.${this.api.db.toLowerCase()}`;
    let digests: Digest[];
    try {
      digests = (await digestApi(this.api.db, this.api.token)<DigestList>('GET')).digests;
    } catch {
      return; // an older server, or no access: no notice
    }
    // The first time, only runs from the last day count as new.
    const seen = localStorageGet(key) ?? new Date(Date.now() - 86_400_000).toISOString();
    const fresh = digests.filter((d) => d.last && d.last.at > seen).sort((a, b) => b.last!.at.localeCompare(a.last!.at));
    const newest = digests.map((d) => d.last?.at ?? '').sort().at(-1);
    if (newest && newest > seen) localStorageSet(key, newest);
    if (!fresh.length) return;
    toast(fresh.length === 1 ? `New digest: ${fresh[0].name}` : `${fresh.length} new digests, latest ${fresh[0].name}`, 'info',
      { label: 'Read', run: () => window.open(`dashboard.html?id=${encodeURIComponent(fresh[0].dashboard)}`, 'tabularius-dashboards') });
  }

  openDashboards(): void {
    window.open('dashboard.html', 'tabularius-dashboards');
  }

  openDataViewer(): void {
    window.open('dataviewer.html', 'tabularius-dataviewer', 'popup,width=560,height=680');
  }

  async openDebugger(): Promise<void> {
    if (!(await this.commit())) return;
    location.href = 'debugger.html';
  }

  async logout(): Promise<void> {
    if (!(await this.commit())) return;
    // Claris's order: OnWindowClose (which can keep the window), then OnLastWindowClose.
    if (!(await this.windowCloseAllowed())) return;
    if (this.onLastWindowClose && this.meta) await this.fileTrigger('OnLastWindowClose');
    this.teardown();
    await this.locks.releaseAll();
    await this.api.logout();
    sessionStorageSet('tabularius.session', undefined);
    location.reload();
  }
}

function showBusyScreen(): void {
  document.title = `Busy · ${PRODUCT_NAME}`;
  app.replaceChildren(h('main', { class: 'login-screen' }, h('div', { class: 'login', role: 'alert' },
    lockup('div'), h('h1', {}, 'Busy, try again'),
    h('p', {}, 'The server is handling a lot of requests. Your file has not changed.'),
    button('Try again', () => location.reload(), { class: 'primary' }),
  )));
}

start().catch((e) => {
  if (e instanceof ApiError && e.status === 503) showBusyScreen();
  else app.replaceChildren(h('p', { class: 'fatal' }, `Couldn't start: ${errorText(e)}`));
});

// Installable: the service worker keeps the client's own files so the app opens without a connection (it keeps no
// data). Browsers allow it only over HTTPS or on this computer.
if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({
    keep: [location.pathname, ...performance.getEntriesByType('resource').map((e) => e.name)],
  }));
}

// Scripts that can't reach the network yet (an administrator turns it on per file in the admin console): said until it is dismissed.
const networkBanner = h('aside', { class: 'network-banner', role: 'status' },
  h('span', {}, "Scripts can't reach the network yet. An administrator can turn it on when this copy is the live one."),
  button('Dismiss', () => { networkBannerDismissed = true; networkBanner.remove(); }, { class: 'offline-action' }));
let networkBannerDismissed = false;
function showScriptNetwork(meta: LayoutMeta): void {
  if (meta.scriptNetwork === false && !networkBannerDismissed) {
    // In the flow at the top of the window, so it never covers the controls (or the bottom bar on a phone).
    const shell = document.querySelector('.shell');
    // After the skip link, which stays the first Tab stop.
    if (shell && networkBanner.parentElement !== shell) (shell.querySelector(':scope > .skip') ?? { after: (n: Node) => shell.prepend(n) }).after(networkBanner);
  } else networkBanner.remove();
}

// Without a connection: say so while it lasts, and what happens to changes, rather than failing request by request.
  const offlineBanner = h('div', { class: 'offline-banner', role: 'status' });
/** The live stream has been failing to reconnect; set by the window that listens. */
let liveDown = false;
function showOnline(): void {
  const api = offlineHooks?.api;
  const waiting = api?.waiting ?? 0;
  const changes = waiting === 1 ? '1 change' : `${waiting} changes`;
  let message: string | undefined;
  let action: [string, () => void] | undefined;
  if (api?.copyOnly) {
    // Opened from the copy alone: offer to sign in whenever the browser has a network (the sign-in page says if the server is down).
    if (!navigator.onLine) message = waiting ? `You're offline. ${changes} will be saved when you're back online and sign in.` : "You're offline, working from this browser's copy. Changes to fields are saved when you're back online and sign in.";
    else {
      message = waiting ? `Working from this browser's copy. Sign in to save ${changes} made offline.` : "Working from this browser's copy. Sign in to work with the server again.";
      action = ['Sign In', () => offlineHooks?.signIn()];
    }
  } else if (!navigator.onLine || api?.isOffline) {
    message = !api?.offline ? "You're offline. Changes can't be saved until the connection is back."
      : waiting ? `You're offline. ${changes} will be saved when the connection is back.`
      : "You're offline, working from this browser's copy. Changes to fields are saved when the connection is back.";
  } else if (waiting) {
    message = `${changes} made offline ${waiting === 1 ? "hasn't" : "haven't"} been saved yet.`;
    action = ['Save Now', () => offlineHooks?.send()];
  } else if (liveDown) {
    message = "Reconnecting to the server. Changes other people make won't show until it's back.";
  }
  if (!message) {
    offlineBanner.remove();
    return;
  }
  // Unchanged: left alone, so a click on its button isn't lost to a redraw.
  const shown = `${message}\u0000${action?.[0] ?? ''}`;
  if (offlineBanner.isConnected && offlineBanner.dataset.shown === shown) return;
  offlineBanner.dataset.shown = shown;
  offlineBanner.replaceChildren(h('span', {}, message), ...(action ? [button(action[0], action[1], { class: 'offline-action' })] : []),
    h('a', { href: '/docs/troubleshooting-web-client#the-offline-banner-appears' }, 'Offline help'));
  if (!offlineBanner.isConnected) document.body.append(offlineBanner);
}
addEventListener('online', () => {
  offlineHooks?.online();
  showOnline();
});
addEventListener('offline', showOnline);
showOnline();




/** How big a sliding object's content is: an empty field or text is nothing; a field's text its lines' height and its width. Others keep their size. */
/** A portal's height with only its filled rows: nothing when it has none. */
function portalContentHeight(el: HTMLElement): number {
  const rows = el.querySelectorAll<HTMLElement>(':scope > .fm-portal-rows > .fm-portal-row');
  if (!rows.length) return 0;
  const last = rows[rows.length - 1];
  // The rows sit inside a 1-point border on each side.
  return parseFloat(last.style.top) + parseFloat(last.style.height) + 2;
}

function contentSize(el: HTMLElement, kind: string): { contentHeight?: number; contentWidth?: number } {
  if (kind === 'text') {
    const text = el.querySelector<HTMLElement>('.fm-text');
    if (!text?.textContent?.trim()) return { contentHeight: 0, contentWidth: 0 };
    const { height, width } = el.style;
    Object.assign(el.style, { height: 'auto', width: 'max-content' });
    const wide = el.offsetWidth;
    el.style.width = width;
    const out = { contentHeight: el.offsetHeight, contentWidth: wide };
    el.style.height = height;
    return out;
  }
  if (kind !== 'field') return {};
  const box = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('textarea.fm-input, input.fm-input');
  if (!box) return {};
  if (!box.value.trim()) return { contentHeight: 0, contentWidth: 0 };
  // Padding and borders around the text, kept when the field shrinks.
  const chrome = el.offsetHeight - box.clientHeight;
  const ctx = document.createElement('canvas').getContext('2d');
  let contentWidth: number | undefined;
  if (ctx) {
    const cs = getComputedStyle(box);
    ctx.font = cs.font;
    contentWidth = Math.ceil(Math.max(...box.value.split('\n').map((l) => ctx.measureText(l).width)) + (el.offsetWidth - box.clientWidth) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
  }
  if (box instanceof HTMLTextAreaElement) {
    const h0 = box.style.height;
    box.style.height = '0';
    const contentHeight = box.scrollHeight + chrome;
    box.style.height = h0;
    return { contentHeight, contentWidth };
  }
  return { contentWidth };
}

/** Format > Style's commands, as FileMaker names them, and their style bits (Plain takes every style off). */
const STYLE_COMMANDS: Record<string, number> = {
  Plain: 0, Bold: 256, Italic: 512, Underline: 1024, 'Word Underline': 4096, 'Double Underline': 64, Strikethrough: 2048,
  Highlight: 1, 'Small Caps': 128, Uppercase: 16, Lowercase: 32, 'Title Case': 48, Superscript: 4, Subscript: 8,
};
/** Format menu choices: fonts every browser has, FileMaker's sizes, and a few colors. */
const FORMAT_FONTS = ['Arial', 'Courier New', 'Georgia', 'Helvetica', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const FORMAT_SIZES = [9, 10, 12, 14, 18, 24, 36, 48, 72];
const FORMAT_COLORS: [string, string][] = [['Black', '#000000'], ['Gray', '#808080'], ['Red', '#CC0000'], ['Orange', '#E07000'], ['Green', '#008000'], ['Blue', '#0050C8'], ['Purple', '#7030A0']];

/** The signed-in session's page lifecycle handlers: leaving says so to others, coming back from the cache says so again. */
let pageHandlers: { show: () => void } | undefined;
/** Every session's presence in this page (a session replaced by signing in again may still be telling the server). */
const livePresences = new Set<Presence>();
addEventListener('pagehide', () => {
  for (const p of livePresences) p.stop();
});
addEventListener('pageshow', (e) => {
  if (e.persisted) pageHandlers?.show();
});

/** A record brought up to date in place: keys the server leaves out when empty (updating, styles) go too. */
function freshen(rec: DataRecord, fresh: DataRecord): void {
  delete rec.updating;
  delete rec.styles;
  delete rec.portalStyles;
  Object.assign(rec, fresh);
}

/** Round initials for people, coloured by name so each person keeps a colour; at most three, then "+N". */
function avatars(names: string[], editor?: string): HTMLElement[] {
  const shown = names.slice(0, 3).map((n) => {
    const words = n.replace(/[@.].*$/, '').split(/[\s_-]+/).filter(Boolean);
    const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
    let hash = 0;
    for (const ch of n.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const el = h('span', { class: `avatar${n === editor ? ' editing' : ''}`, 'aria-hidden': 'true' }, initials);
    el.style.setProperty('--hue', String(hash % 360));
    return el;
  });
  if (names.length > 3) shown.push(h('span', { class: 'avatar more', 'aria-hidden': 'true' }, `+${names.length - 3}`));
  return shown;
}
