// Cursor movement in a field box, for keys a script trigger handled before the browser could.

/** Moves the cursor in a field box as an arrow key does (Shift extends the selection); up and down go by lines. */
export function moveCaret(el: { value: string; selectionStart: number | null; selectionEnd: number | null; selectionDirection: string | null; setSelectionRange(start: number, end: number, direction?: 'forward' | 'backward'): void }, key: string, shift: boolean): void {
  const v = el.value;
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0;
  const backward = el.selectionDirection === 'backward';
  let anchor = backward ? end : start;
  let at = backward ? start : end;
  if (!shift && start !== end && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    const p = key === 'ArrowLeft' ? start : end;
    el.setSelectionRange(p, p);
    return;
  }
  const lineStart = at === 0 ? 0 : v.lastIndexOf('\n', at - 1) + 1;
  const column = at - lineStart;
  if (key === 'ArrowLeft') at = Math.max(0, at - 1);
  else if (key === 'ArrowRight') at = Math.min(v.length, at + 1);
  else if (key === 'ArrowUp') at = lineStart === 0 ? 0 : Math.min(v.lastIndexOf('\n', lineStart - 2) + 1 + column, lineStart - 1);
  else if (key === 'ArrowDown') {
    const lineEnd = v.indexOf('\n', at);
    const nextEnd = lineEnd < 0 ? -1 : v.indexOf('\n', lineEnd + 1);
    at = lineEnd < 0 ? v.length : Math.min(lineEnd + 1 + column, nextEnd < 0 ? v.length : nextEnd);
  }
  if (!shift) anchor = at;
  el.setSelectionRange(Math.min(anchor, at), Math.max(anchor, at), at < anchor ? 'backward' : 'forward');
}
