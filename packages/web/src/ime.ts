/** True while Enter is confirming an IME composition, including Safari's legacy signal. */
export const confirmsComposition = (e: { isComposing?: boolean; keyCode?: number }) => !!e.isComposing || e.keyCode === 229;

/** Whether this Enter should activate a handler; multiline fields may allow Shift+Enter. */
export function enterActivates(e: { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number }, allowShift = false): boolean {
  return e.key === 'Enter' && (allowShift || !e.shiftKey) && !confirmsComposition(e);
}
