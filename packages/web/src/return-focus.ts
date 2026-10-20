/**
 * A dialog that is not modal (Find/Replace, Check layout) leaves the page usable behind it, so closing it does not
 * bring focus back by itself. Put it back on what opened the dialog, unless focus has already gone on to something
 * else (a match Find selected in a field): that is where the person is working.
 */
export function returnFocus(opener: Element | null | undefined, dialog: HTMLElement, fallback?: HTMLElement | null): void {
  const active = document.activeElement;
  if (active && active !== document.body && !dialog.contains(active)) return;
  const target = opener instanceof HTMLElement && opener.isConnected && opener.offsetParent !== null ? opener : fallback;
  target?.focus();
}
