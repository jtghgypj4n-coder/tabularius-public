/**
 * A toolbar button that must work while a field is being typed in. Pressing a button normally moves focus to it,
 * which saves the field and redraws the toolbar; the redraw replaces the button under the pointer and the click is
 * lost. Cancelling the press keeps focus where it was, so the click lands; the action itself commits the field.
 */
export function keepFocusOnPress<T extends { addEventListener(type: 'mousedown', fn: (e: { preventDefault(): void }) => void): void }>(el: T): T {
  el.addEventListener('mousedown', (e) => e.preventDefault());
  return el;
}
