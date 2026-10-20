import type { LayoutObject } from '../types.ts';

/** View > Show: drawing aids belong to this browser user, not to the saved layout. */
export interface LayoutViewOptions {
  pageMargins: boolean;
  textBoundaries: boolean;
  fieldBoundaries: boolean;
  buttonOutlines: boolean;
  slidingObjects: boolean;
  hideCondition: boolean;
}

export const DEFAULT_LAYOUT_VIEW_OPTIONS: LayoutViewOptions = {
  pageMargins: false, textBoundaries: true, fieldBoundaries: true, buttonOutlines: true, slidingObjects: false, hideCondition: true,
};

export function loadLayoutViewOptions(key: string, storage?: Pick<Storage, 'getItem'>): LayoutViewOptions {
  try {
    const saved = (storage ?? globalThis.localStorage).getItem(key);
    const parsed = saved ? JSON.parse(saved) as Partial<LayoutViewOptions> : {};
    return Object.fromEntries(Object.entries(DEFAULT_LAYOUT_VIEW_OPTIONS).map(([k, fallback]) => [k, typeof parsed[k as keyof LayoutViewOptions] === 'boolean' ? parsed[k as keyof LayoutViewOptions] : fallback])) as unknown as LayoutViewOptions;
  } catch {
    return { ...DEFAULT_LAYOUT_VIEW_OPTIONS };
  }
}

export function saveLayoutViewOptions(key: string, options: LayoutViewOptions, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? globalThis.localStorage).setItem(key, JSON.stringify(options));
  } catch {
    // Layout display preferences are optional when browser storage is unavailable.
  }
}

/** Extra classes used by the editor's canvas and object boxes for each View > Show choice. */
export function layoutViewClasses(options: LayoutViewOptions, object?: LayoutObject): string[] {
  const classes: string[] = [];
  if (options.pageMargins) classes.push('le-show-margins');
  if (object?.kind === 'text' && options.textBoundaries) classes.push('le-text-boundary');
  if (object?.kind === 'field' && options.fieldBoundaries) classes.push('le-field-boundary');
  if (object && ['button', 'popover-button', 'button-bar', 'segment'].includes(object.kind) && options.buttonOutlines) classes.push('le-button-outline');
  if (object?.sliding && options.slidingObjects) classes.push('le-sliding');
  if (object?.hide && options.hideCondition) classes.push('le-hide-condition');
  return classes;
}
