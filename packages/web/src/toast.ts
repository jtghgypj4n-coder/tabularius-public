// The one toast every page uses (the web client, the design pages, the debugger and the security pages).
//
// Toasts go into one live region that is in the page before any of them, so screen readers say each one
// (a region added already holding its text is often skipped). Errors are alerts. They stack in the region,
// the newest at the bottom, so two showing at once never overlap. A toast goes on its own after a few
// seconds, but not while the pointer or keyboard focus is on it (WCAG 2.2.1).

export interface ToastAction {
  label: string;
  run: () => void;
  /** The button's tooltip. */
  title?: string;
}

let region: HTMLElement | undefined;

function toasts(): HTMLElement {
  if (!region?.isConnected) {
    region = document.createElement('div');
    region.className = 'toasts';
    region.setAttribute('role', 'status');
    document.body.append(region);
  }
  return region;
}

function actionButton(t: HTMLElement, action: ToastAction): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'toast-action';
  b.textContent = action.label;
  if (action.title) b.title = action.title;
  b.addEventListener('click', () => {
    t.remove();
    action.run();
  });
  return b;
}

/** A message for a few seconds; one with a button stays a little longer, to give time to click it. */
export function toast(message: string, kind: 'error' | 'info' = 'error', action?: ToastAction): void {
  if (!action && message.includes('The server has nothing at that address')) {
    action = { label: 'Updated client help', run: () => { location.href = '/docs/troubleshooting-web-client#the-client-looks-like-an-old-version-after-an-update'; } };
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  if (kind === 'error') t.setAttribute('role', 'alert');
  t.append(message);
  if (action) {
    t.append(' ', actionButton(t, action));
    t.classList.add('toast-with-action');
    if (action.label === 'Undo') t.dataset.undo = '';
  }
  toasts().append(t);
  let timer = 0;
  const arm = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => t.remove(), action ? 15000 : kind === 'error' ? 6000 : 3000);
  };
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('focusin', () => clearTimeout(timer));
  t.addEventListener('mouseleave', arm);
  t.addEventListener('focusout', arm);
  arm();
}

/** A note that stays until it is removed (a script running on the server), with a button that stops it. */
export function pinnedToast(message: string, action: ToastAction): { say(message: string): void; remove(): void } {
  const t = document.createElement('div');
  t.className = 'toast toast-info toast-with-action';
  t.append(message, ' ');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'toast-action';
  b.textContent = action.label;
  if (action.title) b.title = action.title;
  b.addEventListener('click', action.run);
  t.append(b);
  toasts().append(t);
  return { say: (text) => t.replaceChildren(text), remove: () => t.remove() };
}

/** A note with a progress bar that stays until it is removed (a big file going up), with a button that stops it. */
export function progressToast(message: string, action: ToastAction): { progress(done: number, total: number): void; remove(): void } {
  const t = document.createElement('div');
  t.className = 'toast toast-info toast-with-action toast-progress';
  const text = document.createElement('span');
  text.textContent = message;
  const bar = document.createElement('progress');
  bar.max = 100;
  bar.value = 0;
  bar.setAttribute('aria-label', message);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'toast-action';
  b.textContent = action.label;
  if (action.title) b.title = action.title;
  b.addEventListener('click', action.run);
  t.append(text, ' ', bar, ' ', b);
  toasts().append(t);
  return {
    progress(done, total) {
      bar.value = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
      bar.title = `${bar.value}%`;
    },
    remove: () => t.remove(),
  };
}

/**
 * Edit > Undo (⌘Z) outside a field: the Undo of the newest toast still showing one (a deleted record, an import,
 * an AI replace), so it can be reached without getting to the toast in time. False when none is showing.
 */
export function toastUndo(): boolean {
  const undo = [...(region?.querySelectorAll<HTMLElement>('.toast[data-undo] .toast-action') ?? [])].pop();
  undo?.click();
  return !!undo;
}
