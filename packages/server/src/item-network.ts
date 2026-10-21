// A schedule, automation or inbound hook reaches the network only when its file's scripts may (the file's Script network
// switch in the admin console, or --allow-script-network) and the item itself was set to (its `network` option).

import type { Host } from './host.ts';

type ScriptOptions = ReturnType<Host['scriptOptions']>;

/** The network part of a run's options for an item of `kind` ("schedule", "automation", "inbound hook"); `own` is the item's `network` option. */
export function itemNetwork(opts: ScriptOptions, own: boolean | undefined, kind: string): Pick<ScriptOptions, 'network' | 'networkFiles' | 'networkOff'> {
  return {
    network: opts.network && own === true,
    networkFiles: opts.networkFiles,
    networkOff: own === true ? opts.networkOff
      : () => `Network access is off for this ${kind}: its network option is off${opts.network ? '' : ", and so is its file's Script network switch"}. Turn them on in the admin console.`,
  };
}
