import type { ScriptRun } from './types.ts';

/** The terminal failure toast; commands tell their own "no records match" result. */
export function scriptFailureMessage(run: Pick<ScriptRun, 'script' | 'error' | 'message' | 'denial'>, command?: string): string | undefined {
  if (!run.error || (command && run.error === 401)) return undefined;
  const prefix = command ? `${command} stopped with error ${run.error}` : `Script "${run.script}" stopped with error ${run.error}`;
  return prefix + (run.message ? `: ${run.message}` : '') + (run.denial ? ` ${run.denial.explanation}` : '');
}
