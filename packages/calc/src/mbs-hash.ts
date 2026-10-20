// MBS's Hash component, worked out offline: digests, HMACs and CRCs of text,
// hex, base64 or container data. Behaviour and examples follow MonkeyBread's
// function reference (mbsplugins.eu, Hash.*). Hash.DigestFile and path inputs
// read files, so they stay refused like the rest of MBS's file functions.
// Hash.PBKDF2.HMAC stays refused too: standard PBKDF2 doesn't reproduce the
// reference's own example, and a stored hash that silently didn't match would
// lock people out. The random-string functions aren't here either.

import { createHash, createHmac, getHashes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Env } from './evaluate.ts';
import { asNumber, asText, num, text, type Value } from './values.ts';

type MbsFunction = (v: Value[], env: Env) => Value;
/** An MBS error result: "[MBS] ERROR: ...", with MBS ( "IsError" ) then 1. */
export type MbsError = (env: Env, message: string) => Value;

const T = (v: Value | undefined, env: Env) => (v === undefined ? '' : asText(v, env.order));
const N = (v: Value | undefined) => (v === undefined ? 0 : asNumber(v));

class Refused extends Error {}

function fromHex(s: string): Buffer {
  const hex = s.replace(/\s+/g, '');
  if (hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Refused('Invalid hex string');
  return Buffer.from(hex, 'hex');
}

/** Text as bytes in a named MBS text encoding: UTF-8 unless one of the Latin-1 names is given. */
function encoded(s: string, encoding: string): Buffer {
  return /^(ansi|windows|latin1|iso-?8859-?1|native|dos)$/i.test(encoding.trim()) ? Buffer.from(s, 'latin1') : Buffer.from(s, 'utf8');
}

/** InputType + InputData (+ InputEncoding), as Hash.Digest, Hash.CRC16 and Hash.CRC32 take them. */
function input(type: Value | undefined, data: Value | undefined, encoding: Value | undefined, env: Env): Buffer {
  const kind = T(type, env).trim().toLowerCase();
  if (kind === 'text') return encoded(T(data, env), T(encoding, env));
  if (kind === 'hex') return fromHex(T(data, env));
  if (kind === 'base64') return Buffer.from(T(data, env).replace(/\s+/g, ''), 'base64');
  if (kind === 'container' || kind === 'data' || kind === 'image' || kind === 'pdf') {
    if (data?.type === 'container' && data.data) return Buffer.from(data.data);
    throw new Refused('No container data');
  }
  if (kind === 'path') throw new Refused('Files are not read in Tabularius');
  throw new Refused(`Unknown input type: ${T(type, env)}`);
}

/** A digest as hex (MBS writes upper case), base64 or base64url (flags 1 and 8). */
function output(bytes: Buffer, flags: number): string {
  if (flags & 8) return bytes.toString('base64url');
  if (flags & 1) return bytes.toString('base64');
  return bytes.toString('hex').toUpperCase();
}

/** A digest name as MBS takes it (MD5, SHA1, SHA256, RSA-SHA3-256, Shake128, ...), as Node names it. */
function algorithm(name: string): string {
  const n = name.trim();
  const known = getHashes();
  const plain = n.toLowerCase().replace(/^sha-(?=\d)/, 'sha');
  const pick = known.find((h) => h.toLowerCase() === plain) ?? known.find((h) => h.toLowerCase() === n.toLowerCase());
  if (!pick || /^(sha|dsa|dsa-sha|md4|mdc2)$/i.test(n)) throw new Refused(`Unknown digest: ${name}`);
  return pick;
}

const reflect = (x: number, bits: number) => {
  let r = 0;
  for (let i = 0; i < bits; i++) r = (r << 1) | ((x >>> i) & 1);
  return r;
};

export function mbsHashFunctions(error: MbsError): Record<string, MbsFunction> {
  const guarded = (f: MbsFunction): MbsFunction => (v, env) => {
    try {
      return f(v, env);
    } catch (e) {
      if (e instanceof Refused) return error(env, e.message);
      throw e;
    }
  };
  const out: Record<string, MbsFunction> = {};
  // Hash.MD5 / SHA1 / SHA256 / SHA512 ( Text { ; Flags } ): flag 2 reads the text as hex.
  // Hash.<name>.HMAC ( Key ; Data { ; Flags } ): flag 2 reads the key as hex, 4 the data.
  for (const [name, node] of [['md5', 'md5'], ['sha1', 'sha1'], ['sha256', 'sha256'], ['sha512', 'sha512']] as const) {
    out[`hash.${name}`] = guarded((v, env) => {
      const flags = Math.trunc(N(v[1]));
      const data = flags & 2 ? fromHex(T(v[0], env)) : Buffer.from(T(v[0], env), 'utf8');
      return text(output(createHash(node).update(data).digest(), flags));
    });
    out[`hash.${name}.hmac`] = guarded((v, env) => {
      const flags = Math.trunc(N(v[2]));
      const key = flags & 2 ? fromHex(T(v[0], env)) : Buffer.from(T(v[0], env), 'utf8');
      const data = flags & 4 ? fromHex(T(v[1], env)) : Buffer.from(T(v[1], env), 'utf8');
      return text(output(createHmac(node, key).update(data).digest(), flags));
    });
  }
  // Hash.Digest ( Algorithm ; InputType ; InputData ; InputEncoding ; OutputType { ; OutputInfo } ).
  out['hash.digest'] = guarded((v, env) => {
    const digest = createHash(algorithm(T(v[0], env))).update(input(v[1], v[2], v[3], env)).digest();
    const kind = T(v[4], env).trim().toLowerCase();
    if (kind === 'hex') return text(output(digest, 0));
    if (kind === 'base64') return text(output(digest, 1));
    if (kind === 'base64url') return text(output(digest, 8));
    throw new Refused(`Unsupported output type: ${T(v[4], env)}`);
  });
  // Hash.CRC32 ( InputType ; InputData { ; InputEncoding ; StartValue } ): zip's CRC, as a number.
  out['hash.crc32'] = guarded((v, env) => num(crc32(input(v[0], v[1], v[2], env), Math.trunc(N(v[3])) >>> 0)));
  // Hash.CRC16 ( InputType ; InputData { ; InputEncoding ; StartValue ; Poly ; FinalXOR ; ReflectInput ; ReflectOutput } ).
  // Defaults 65535 and 4129 (CCITT). MBS's own MODBUS example (reflected input, output
  // left as is) gives 0x3D7B for "123456789", which a reflected input only reaches with the
  // register reflected at the end too, so reflecting the input reflects the result as well.
  out['hash.crc16'] = guarded((v, env) => {
    const bytes = input(v[0], v[1], v[2], env);
    let crc = (v[3] === undefined || T(v[3], env) === '' ? 0xffff : Math.trunc(N(v[3]))) & 0xffff;
    const poly = (v[4] === undefined || T(v[4], env) === '' ? 0x1021 : Math.trunc(N(v[4]))) & 0xffff;
    const reflectIn = N(v[6]) !== 0;
    for (let b of bytes) {
      if (reflectIn) b = reflect(b, 8);
      crc ^= b << 8;
      for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ poly) & 0xffff : (crc << 1) & 0xffff;
    }
    if (reflectIn || N(v[7]) !== 0) crc = reflect(crc, 16);
    return num((crc ^ Math.trunc(N(v[5]))) & 0xffff);
  });
  return out;
}
