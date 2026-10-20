/**
 * What Get ( TriggerKeystroke ) reports for a key, as the Code function numbers them (Claris, Code function,
 * "navigational keys"): backspace 8, tab 9 (shift-tab too: Get ( TriggerModifierKeys ) tells the shift), enter 10,
 * return 13, escape 27, left 28, up 29, right 30, down 31, forward delete 127. Space is 32, an ordinary character.
 * Home, End, Page Up and Page Down are not on that page, so they report nothing and fire no trigger.
 */
export const KEYSTROKE_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, NumpadEnter: 10, Enter: 13, Escape: 27,
  ArrowLeft: 28, ArrowUp: 29, ArrowRight: 30, ArrowDown: 31, Delete: 127,
};

/** The character a keystroke trigger sees for a key event, or undefined when it isn't one (Shift, Home, F5, ...). */
export function triggerKeystroke(key: string, code: string): string | undefined {
  if (key.length === 1) return key;
  const number = KEYSTROKE_CODES[code === 'NumpadEnter' ? 'NumpadEnter' : key];
  return number === undefined ? undefined : String.fromCharCode(number);
}
