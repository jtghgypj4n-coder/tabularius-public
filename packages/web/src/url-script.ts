/** A WebDirect-style link, /fmi/webd/File?script=Name&param=text&$name=value, as the app's address carries it. */
export interface LinkedScript { script: string; parameter: string; variables: Record<string, string> }

/** What the address asks to run, or nothing; the variables are the $names, at most 20. */
export function parseLinkedScript(search: string): LinkedScript | undefined {
  const q = new URLSearchParams(search);
  const script = q.get('script');
  if (!script) return undefined;
  const variables: Record<string, string> = {};
  for (const [k, v] of q) if (/^\$[^$\s]{1,100}$/.test(k) && Object.keys(variables).length < 20) variables[k] = v;
  return { script, parameter: q.get('param') ?? '', variables };
}

/** The link's script, taken out of the address so a reload doesn't run it again. */
export function linkedScript(): LinkedScript | undefined {
  const found = parseLinkedScript(location.search);
  if (!found) return undefined;
  const q = new URLSearchParams(location.search);
  for (const k of [...q.keys()]) if (k === 'script' || k === 'param' || k.startsWith('$')) q.delete(k);
  history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
  return found;
}
