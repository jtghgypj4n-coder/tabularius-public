import type { RunOptions } from './engine.ts';

/** AI and trial runs cannot inherit the operator's outbound capabilities or plug-in installs. Apply last. */
export function offlineScriptOptions(options: RunOptions = {}): RunOptions {
  return { ...options, network: false, outbound: undefined, mail: undefined, ai: undefined, installPlugin: undefined };
}
