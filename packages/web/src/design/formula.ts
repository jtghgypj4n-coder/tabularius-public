// "Check syntax" for formula boxes: asks the server to check the formula
// against the file's fields and functions, shows the first error under the
// box and selects where it is, like FileMaker's Specify Calculation dialog.

import type { FormulaContext } from './client.ts';
import { windowRecord } from './window-record.ts';
import { h, button } from './dom.ts';
import { errorText, type Studio } from './main.ts';

export interface FormulaChecker {
  /** The button, for an actions row. */
  button: HTMLButtonElement;
  /** Where the result shows; put it under the formula box. */
  message: HTMLElement;
  /** Checks the formula; true when it has no errors (or is empty). */
  check(): Promise<boolean>;
  /** Before saving: true when the formula is fine or the user chooses to save it anyway. */
  confirmSave(): Promise<boolean>;
}

/**
 * `fix`, when given, adds "Fix with AI" beside an error: the assistant gets the formula and the error and drafts a
 * corrected formula, checked, with a button that puts it in the box.
 */
export function formulaChecker(studio: Studio, box: HTMLTextAreaElement, context: () => FormulaContext, fix?: (error: string) => void): FormulaChecker {
  const message = h('p', { class: 'd-formula-msg', role: 'status', hidden: '' });
  const show = (text: string, ok: boolean) => {
    message.textContent = text;
    if (!ok && fix && studio.ask) message.append(' ', button('Fix with AI', () => fix(text), { class: 'd-ai-fix', title: 'The assistant corrects the formula and checks it; you review it before it goes in the box' }));
    message.classList.toggle('error', !ok);
    message.hidden = false;
  };
  box.addEventListener('input', () => { message.hidden = true; });
  const check = async (): Promise<boolean> => {
    if (!box.value.trim()) return true;
    try {
      const r = await studio.client.check(box.value, context());
      if (r.ok) {
        show('No errors found.', true);
        return true;
      }
      show(r.message, false);
      if (r.at !== undefined) {
        // Select the word the error is about.
        const end = /^[^\s()[\];:,"]*/.exec(box.value.slice(r.at))![0].length;
        box.focus();
        box.setSelectionRange(r.at, r.at + Math.max(1, end));
      }
      return false;
    } catch (e) {
      show(errorText(e), false);
      return false;
    }
  };
  return {
    button: button('Check syntax', () => void check()),
    message,
    check,
    async confirmSave() {
      if (await check()) return true;
      return confirm(`${message.textContent}\n\nSave the formula anyway? It will show "?" until it is fixed.`);
    },
  };
}

/**
 * The live preview under a formula box: the formula as typed, worked out on the record the person was on (when
 * they came from a layout on the formula's table) and on the first few other records, as they type. Nothing is
 * stored; a formula with an error shows the error instead. FileMaker shows a result only after you save.
 */
export function formulaPreview(studio: Studio, box: HTMLTextAreaElement, context: () => FormulaContext): HTMLElement {
  const out = h('div', { class: 'd-formula-preview', 'aria-live': 'polite', hidden: '' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = 0;
  const run = async () => {
    const text = box.value.trim();
    if (!text) {
      out.hidden = true;
      return;
    }
    const n = ++asked;
    try {
      const at = windowRecord();
      const r = await studio.client.preview(box.value, context(), at);
      if (n !== asked) return;
      if (!r.ok) {
        out.replaceChildren(h('span', { class: 'd-muted' }, `Preview: ${r.message ?? 'the formula has an error'}`));
      } else if (!r.results.length) {
        out.replaceChildren(h('span', { class: 'd-muted' }, 'Preview: no records to try it on.'));
      } else {
        out.replaceChildren(
          h('span', { class: 'd-muted' }, `Preview on ${r.layout}: `),
          ...r.results.map((x, i) => h('span', { class: `d-preview-value${x.error ? ' error' : ''}`, title: x.error ?? x.value ?? '' },
            h('span', { class: 'd-muted' }, i === 0 && at.recordId === x.recordId && at.layout === r.layout ? `your record ${x.recordId}: ` : `record ${x.recordId}: `),
            x.error ? x.error : x.value === '' ? '(empty)' : (x.value ?? '').length > 80 ? `${x.value!.slice(0, 80)}…` : x.value ?? '')),
        );
      }
      out.hidden = false;
    } catch {
      if (n === asked) out.hidden = true;
    }
  };
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 400);
  });
  void run();
  return out;
}
