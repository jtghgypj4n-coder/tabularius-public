// Keeping a file's data away from AI. A file with AI turned off (in the admin console, `tabularius ai off`, or the
// server's --ai-exclude) is never read for the assistant, digests' summaries, AI matching or any MCP client, whatever
// the account's privileges, the local administrator included. A file that uses another file's tables or scripts is
// kept from AI too while that file is, so its related fields can't carry the other file's data out.

import { assertAiPolicy } from './ai-policy.ts';
import type { Store, Privileges } from '../../store/src/index.ts';
import type { Script } from '../../fmp12/src/index.ts';
import { dataSourceFile } from '../../store/src/import.ts';
import type { Host } from './host.ts';

/** The file that keeps this one from AI: itself, or a hosted file it uses (directly or through others). */
export function aiBlocker(store: Store): Store | undefined {
  const seen = new Set<Store>();
  const visit = (s: Store): Store | undefined => {
    if (seen.has(s)) return undefined;
    seen.add(s);
    if (!s.aiAllowed) return s;
    for (const d of s.schema.dataSources) {
      let other: Store | undefined;
      try {
        other = s.resolveFile(dataSourceFile(d.paths) ?? d.name) as Store | undefined;
      } catch {
        other = undefined;
      }
      const hit = other && other !== s ? visit(other) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  return visit(store);
}

/** Why AI can't use this file, recorded in its security log; undefined when it can. */
export function aiRefusal(store: Store, who: { account?: string | null; via: string; from?: string; policy?: boolean; privileges?: Privileges; programs?: readonly Script[] }): string | undefined {
  const blocker = aiBlocker(store);
  if (!blocker) {
    if (who.policy !== false) {
      try { assertAiPolicy(store, who.privileges ?? who.account ?? (who.via === 'script' ? '(unknown script)' : undefined), who.via, { scripts: who.via === 'script', programs: who.programs }); }
      catch (e) { return (e as Error).message; }
    }
    return undefined;
  }
  const message = blocker.refuseAi(who);
  if (blocker === store) return message;
  store.refuseAi(who);
  return `AI is turned off for ${store.name} because it uses data from ${blocker.name}, which has AI turned off. Turn AI on for ${blocker.name} first, or keep it off for both`;
}

/** What /admin shows per file: whether AI can read it, and why not. */
export function aiStatus(store: Store): { allowed: boolean; turnedOff: boolean; byServer: boolean; through?: string } {
  const blocker = aiBlocker(store);
  return {
    allowed: !blocker,
    turnedOff: store.aiTurnedOff,
    byServer: store.aiExcludedByServer,
    ...(blocker && blocker !== store ? { through: blocker.name } : {}),
  };
}

/** Keeps these files from AI whatever they say (serve's and mcp's --ai-exclude), from when each opens. */
export function excludeFromAi(host: Host, names: string[]): void {
  const excluded = new Set(names.map((n) => n.trim().replace(/\.fmp12$/i, '').toLowerCase()).filter(Boolean));
  if (!excluded.size) return;
  const exclude = (store: Store) => {
    if (excluded.has(store.name.toLowerCase())) store.aiExcludedByServer = true;
  };
  for (const s of host.openStores()) exclude(s);
  host.onAdd.push(exclude);
}

/**
 * The hosted files AI may read, for telling an AI app what is hosted: a file with AI off isn't even named, and
 * `visible` (when given) leaves out files the caller couldn't open anyway, so a mistyped name doesn't list them.
 */
export function aiHostedNames(host: Host, visible: (s: Store) => boolean = () => true): string {
  return host.names().filter((n) => {
    const s = host.get(n);
    return s && !aiBlocker(s) && visible(s);
  }).join(', ') || '(none)';
}
