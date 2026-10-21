import type { RunOptions } from './engine.ts';

/** What a run that is always offline says when it asks for the network: no switch turns it on. */
export const OFFLINE_RUN_NOTICE = 'Network access is off: scripts an AI app runs, and debug and dry runs, never reach the network';

/** AI and trial runs cannot inherit the operator's outbound capabilities or plug-in installs. Apply last. */
export function offlineScriptOptions(options: RunOptions = {}): RunOptions {
  return { ...options, network: false, networkFiles: undefined, networkOff: () => OFFLINE_RUN_NOTICE, outbound: undefined, mail: undefined, ai: undefined, installPlugin: undefined };
}
