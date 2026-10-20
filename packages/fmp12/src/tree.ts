// An in-memory view of the path "file system" that fmp12 chunks build.
// Used for metadata (schema catalogs), which is small; record data is
// streamed instead (see records.ts).

import { pathValue, type Chunk } from './chunks.ts';
import { decodeText } from './scsu.ts';
import type { FmpFile } from './file.ts';

/** A path segment as a number when integer-like, else as a hex string. */
export type Segment = number | string;

export function segmentOf(key: Uint8Array): Segment {
  const v = pathValue(key);
  if (v !== undefined) return v;
  let s = '0x';
  for (const b of key) s += b.toString(16).padStart(2, '0');
  return s;
}

export class Node {
  readonly kv = new Map<number, Uint8Array>();
  readonly kvLong: { key: Uint8Array; data: Uint8Array }[] = [];
  readonly data: Uint8Array[] = [];
  readonly segments = new Map<number, Uint8Array>();
  readonly children = new Map<Segment, Node>();

  child(...path: Segment[]): Node | undefined {
    let n: Node | undefined = this;
    for (const s of path) {
      n = n.children.get(s);
      if (!n) return undefined;
    }
    return n;
  }

  /** Children with integer ids, in id order. */
  numbered(): [number, Node][] {
    const out: [number, Node][] = [];
    for (const [k, v] of this.children) if (typeof k === 'number') out.push([k, v]);
    return out.sort((a, b) => a[0] - b[0]);
  }

  text(key: number): string | undefined {
    const v = this.kv.get(key);
    return v === undefined ? undefined : decodeText(v);
  }

  /**
   * A value too large for one chunk: the parts are keyed (kv or segment) 1, 2, ...
   * in order. Key 0 carries formatting and is skipped.
   */
  longBytes(): Uint8Array | undefined {
    const parts = new Map<number, Uint8Array>();
    for (const [k, v] of this.kv) if (k >= 1) parts.set(k, v);
    for (const [k, v] of this.segments) if (k >= 1) parts.set(k, v);
    if (parts.size === 0) return undefined;
    const keys = [...parts.keys()].sort((a, b) => a - b);
    let len = 0;
    for (const k of keys) len += parts.get(k)!.length;
    const out = new Uint8Array(len);
    let at = 0;
    for (const k of keys) {
      out.set(parts.get(k)!, at);
      at += parts.get(k)!.length;
    }
    return out;
  }

  /** Text stored inline at `key` or as a long value in child node `key`. */
  textOrLong(key: number): string | undefined {
    const inline = this.text(key);
    if (inline !== undefined) return inline;
    const long = this.children.get(key)?.longBytes();
    return long ? decodeText(long) : undefined;
  }

  /** Object name: key 16 by FileMaker convention. */
  get name(): string | undefined {
    return this.textOrLong(16);
  }

  add(chunk: Chunk): void {
    // Copies, so a kept value does not hold on to its whole 4 KiB block.
    switch (chunk.type) {
      case 'kv': this.kv.set(chunk.key, chunk.data.slice()); break;
      case 'kvlong': this.kvLong.push({ key: chunk.key.slice(), data: chunk.data.slice() }); break;
      case 'data': this.data.push(chunk.data.slice()); break;
      case 'segment': this.segments.set(chunk.index, chunk.data.slice()); break;
    }
  }
}

/**
 * Build the tree for every chunk whose path the filter accepts. The filter
 * sees the path as segments so callers can skip bulky record data.
 */
export function buildTree(
  file: FmpFile,
  accept: (path: Segment[]) => boolean = () => true,
  source: Iterable<{ path: Uint8Array[]; chunk: Chunk }> = file.chunks(),
): Node {
  const root = new Node();
  for (const { path, chunk } of source) {
    const segs = path.map(segmentOf);
    if (!accept(segs)) continue;
    let n = root;
    for (const s of segs) {
      let c = n.children.get(s);
      if (!c) {
        c = new Node();
        n.children.set(s, c);
      }
      n = c;
    }
    n.add(chunk);
  }
  return root;
}
