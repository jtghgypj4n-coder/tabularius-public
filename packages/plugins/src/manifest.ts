// A plug-in's plugin.json: who it is, the functions it provides (by name and by the FileMaker plug-in id and
// function index the file reader decodes), and the permissions it asks for. Design: research/plugins/plugin-system.md.

import { z } from 'zod';
import { portableName } from '../../store/src/portable-path.ts';

/** The plug-in API this Tabularius offers. A plug-in's `api` range must include it. */
export const HOST_API = '1.0';

/**
 * Whether the host API version (major.minor) is in a plug-in's range: "^1.0" (the same major, at least that minor),
 * "~1.0" (the same major and minor), ">=1.0", "1.x" or "1.*", "*", or an exact "1.0". Anything else is not understood.
 */
export function apiSatisfied(range: string, host: string = HOST_API): boolean {
  const [hMajor, hMinor] = host.split('.').map(Number);
  const r = range.trim();
  if (r === '*' || r === 'x') return true;
  const m = /^(\^|~|>=)?\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(?:\d+|x|\*))?$/.exec(r);
  if (!m) return false;
  const major = Number(m[2]);
  const minor = m[3] === undefined || m[3] === 'x' || m[3] === '*' ? undefined : Number(m[3]);
  switch (m[1]) {
    case '^': return hMajor === major && hMinor >= (minor ?? 0);
    case '~': return hMajor === major && (minor === undefined || hMinor === minor);
    case '>=': return hMajor > major || (hMajor === major && hMinor >= (minor ?? 0));
    default: return hMajor === major && (minor === undefined || hMinor === minor);
  }
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** A FileMaker plug-in id: the 4 characters stored with each call (GyBE, MBSP, 3MLR). */
const OWNER = /^[\x21-\x7e]{4}$/;

export const PluginFunctionSpec = z.object({
  /** What people write and what reports show. Case doesn't matter. */
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/),
  /** With index: the FileMaker plug-in id this function belongs to, so calls decoded from .fmp12 files bind to it. */
  owner: z.string().regex(OWNER).optional(),
  index: z.number().int().min(0).max(0xffff).optional(),
  min: z.number().int().min(0),
  max: z.number().int().min(0).optional(),
  /** Same arguments, same result, and no host calls (enforced). External permissions still make it volatile. */
  pure: z.boolean().default(false),
}).refine((f) => (f.owner === undefined) === (f.index === undefined), { message: 'owner and index go together' })
  .refine((f) => f.max === undefined || f.max >= f.min, { message: 'max is below min' });

export const PluginManifest = z.object({
  /** Reverse-DNS, unique: org.example.troi-file. */
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/).max(100).refine(portableName, 'not a portable file name'),
  name: z.string().min(1),
  version: z.string().regex(SEMVER),
  /** Host API range it was written for, e.g. "^1.0". */
  api: z.string().min(1),
  publisher: z.string().min(1),
  license: z.string().optional(),
  runtime: z.enum(['js', 'wasm']).default('js'),
  main: z.string().regex(/^[^/\\]+\.(?:js|mjs|wasm)$/).refine(portableName, 'not a portable file name'),
  /** FileMaker plug-in ids it stands in for. */
  owners: z.array(z.string().regex(OWNER)).default([]),
  functions: z.array(PluginFunctionSpec).min(1),
  permissions: z.object({
    files: z.array(z.enum(['documents:read', 'documents:write', 'temporary:read', 'temporary:write'])).default([]),
    network: z.array(z.string().regex(/^(?:\*\.)?[a-z0-9.-]+$/i)).default([]),
    mail: z.boolean().default(false),
    secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
    /** Requested V8 old-space (including runtime overhead) / wasm linear memory budget; clamped to 64 MB. Not a process RSS cap. */
    memoryMb: z.number().int().min(8).max(1024).default(64),
    timeoutMs: z.number().int().min(1).max(60000).default(250),
  }).default({ files: [], network: [], mail: false, secrets: [], memoryMb: 64, timeoutMs: 250 }),
}).superRefine((m, ctx) => {
  if (!apiSatisfied(m.api)) ctx.addIssue({ code: 'custom', path: ['api'], message: `needs plug-in API ${m.api}, and this Tabularius offers ${HOST_API}` });
  const seen = new Set<string>();
  for (const f of m.functions) {
    for (const key of [f.name.toLowerCase(), ...(f.owner ? [`${f.owner}:${f.index}`] : [])]) {
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `${key} is provided twice` });
      seen.add(key);
    }
    if (f.owner && f.owner !== 'FMDR' && !m.owners.includes(f.owner)) ctx.addIssue({ code: 'custom', message: `${f.name}: owner ${f.owner} isn't in owners` });
    if (f.owner === 'FMDR') ctx.addIssue({ code: 'custom', message: `${f.name}: FMDR is FileMaker's own` });
  }
});

export type PluginManifest = z.infer<typeof PluginManifest>;
export type PluginFunctionSpec = z.infer<typeof PluginFunctionSpec>;

/** The manifest, or the reasons it isn't one. */
export function parseManifest(json: unknown): { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] } {
  const r = PluginManifest.safeParse(json);
  if (r.success) return { ok: true, manifest: r.data };
  return { ok: false, errors: r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message) };
}
