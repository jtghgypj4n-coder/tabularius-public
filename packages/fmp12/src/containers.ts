// Container field data (images, PDFs, files stored in the database).
//
// A record's container field holds only a short reference: the blob id as two
// hex digits ("01", "02", ...) followed by U+E000. The blobs themselves live
// per table under [table].31.5.[blobId]:
//   k2          stream directory: u16 count, then per stream a 4-char tag and u32 size
//   K"FNAM"     file name: u32 count, then u8 length + kind ("image", "file"),
//               u16 length + name, both XOR-0x5A text
//   [tag]       one child per stream, its bytes in segments 1..n; the main
//               stream is tagged by type (JPEG, PNGf, GIFf, PDF , FILE, ...)
// [table].31.1.8.[hash] maps a content hash to the blob id, so identical files
// are stored once.
//
// An externally stored file (open storage) keeps no data stream: K"REMO" is
// the folder it is in, relative to the field's base directory: 8 zero bytes,
// then plain text ending in NUL ("Docs/Invoices/", the field's storage
// calculation). A stream tagged with the file's lower-case type ("pdf ") holds
// its size (u64 little-endian), a 16-byte hash and its name on disk; FNAM is
// the name shown. Seen in a private sample file.

import type { FmpFile } from './file.ts';
import { pathInt } from './chunks.ts';
import { buildTree, Node, segmentOf } from './tree.ts';
import { decodeText } from './scsu.ts';

export interface ContainerBlob {
  id: number;
  filename?: string;
  /** "image", "file", ... as FileMaker records it. */
  kind?: string;
  /** Tag of the main stream, e.g. "JPEG", "PNGf", "PDF ". */
  type: string;
  mime: string;
  data: Uint8Array;
  /** Every stream by tag, including metadata such as FNAM and SIZE. */
  streams: Map<string, Uint8Array>;
  /** Stored outside the file: its path (folder from REMO, then the name), relative to the base directory. */
  external?: string;
  /** An externally stored file's size in bytes when it was stored, as the file records it. */
  externalSize?: number;
}

const METADATA_STREAMS = new Set(['FNAM', 'SIZE', 'DPI_']);

const MIME_BY_TAG: Record<string, string> = {
  JPEG: 'image/jpeg',
  PNGf: 'image/png',
  GIFf: 'image/gif',
  'PDF ': 'application/pdf',
  TIFF: 'image/tiff',
  BMPf: 'image/bmp',
  'SVG ': 'image/svg+xml',
  HEIC: 'image/heic',
  JP2_: 'image/jp2',
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', pdf: 'application/pdf',
  tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
  mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Blob id from a container field's stored text, or undefined when it is not a
 * reference. The text is the blob id's path-integer bytes in hex, then U+E000:
 * "01" is 1, "8102" is 386 (0x80 + 0x102), "C00102" is 16770 (0x4080 + 0x102),
 * as a private sample's invoices (blobs 16770, 16878, ...) showed.
 */
export function containerRefId(text: string): number | undefined {
  const m = /^((?:[0-9a-fA-F]{2}){1,3})[\0]?$/.exec(text.trim());
  return m ? pathInt(Buffer.from(m[1], 'hex')) : undefined;
}

function tagOf(seg: string): string | undefined {
  if (!/^0x[0-9a-f]{8}$/.test(seg)) return undefined;
  return Buffer.from(seg.slice(2), 'hex').toString('latin1');
}

function parseFnam(b: Uint8Array): { kind?: string; filename?: string } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 7 || v.getUint32(0) < 1) return {};
  let at = 4;
  const kindLen = b[at++];
  const kind = decodeText(b.subarray(at, at + kindLen));
  at += kindLen;
  if (at + 2 > b.length) return { kind };
  const nameLen = v.getUint16(at);
  at += 2;
  return { kind, filename: decodeText(b.subarray(at, at + nameLen)) };
}

export function mimeOf(type: string, filename: string | undefined, data: Uint8Array): string {
  if (MIME_BY_TAG[type]) return MIME_BY_TAG[type];
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'application/pdf';
  return 'application/octet-stream';
}

/** One blob from its node (exported for tests). */
export function readBlob(id: number, node: Node): ContainerBlob {
  const streams = new Map<string, Uint8Array>();
  for (const [seg, child] of node.children) {
    const tag = typeof seg === 'string' ? tagOf(seg) : undefined;
    if (tag) streams.set(tag, child.longBytes() ?? new Uint8Array());
  }
  for (const { key, data } of node.kvLong) {
    if (key.length === 4) streams.set(Buffer.from(key).toString('latin1'), data);
  }
  const { kind, filename } = streams.has('FNAM') ? parseFnam(streams.get('FNAM')!) : {};
  const remote = streams.get('REMO');
  if (remote) {
    // REMO: 8 bytes (zero in every file seen), then the folder as text, ending in NUL.
    const folder = Buffer.from(remote.subarray(8)).toString('utf8').replace(/\0+$/, '');
    const tag = [...streams.keys()].find((t) => !METADATA_STREAMS.has(t) && t !== 'REMO') ?? '';
    // The type stream: u64 size (little-endian), 16-byte hash, then the name on disk, ending in NUL.
    // That name can differ from the one shown (FileMaker numbers duplicates: Invoice_1.pdf).
    const described = streams.get(tag);
    const onDisk = described && described.length > 24 ? Buffer.from(described.subarray(24)).toString('utf8').replace(/\0+$/, '') : '';
    const name = onDisk || filename || '';
    const size = described && described.length >= 8 ? Number(Buffer.from(described.buffer, described.byteOffset, 8).readBigUInt64LE(0)) : undefined;
    return {
      id, filename, kind, type: tag.toUpperCase(), mime: mimeOf(tag.toUpperCase(), filename, new Uint8Array()), data: new Uint8Array(), streams, external: folder + name,
      ...(size !== undefined && Number.isSafeInteger(size) ? { externalSize: size } : {}),
    };
  }
  let type = '';
  let data: Uint8Array = new Uint8Array();
  for (const [tag, bytes] of streams) {
    if (!METADATA_STREAMS.has(tag) && bytes.length >= data.length) [type, data] = [tag, bytes];
  }
  return { id, filename, kind, type, mime: mimeOf(type, filename, data), data, streams };
}

/** Every container blob stored for a table, by blob id. */
export function readContainers(file: FmpFile, tableId: number): Map<number, ContainerBlob> {
  const out = new Map<number, ContainerBlob>();
  for (const blob of containerBlobs(file, tableId)) out.set(blob.id, blob);
  return out;
}

/**
 * A table's container blobs one at a time, in blob id order, so only one is
 * in memory however many the table holds. `after` skips blob ids up to it.
 */
export function* containerBlobs(file: FmpFile, tableId: number, after = 0): Generator<ContainerBlob> {
  let id: number | undefined;
  let node = new Node();
  for (const { path, chunk } of file.chunks(undefined, [tableId, 31, 5])) {
    const blob = path.length >= 4 ? pathInt(path[3]) : undefined;
    if (blob === undefined || blob <= after) continue;
    if (blob !== id) {
      if (id !== undefined) yield readBlob(id, node);
      id = blob;
      node = new Node();
    }
    let n = node;
    for (let i = 4; i < path.length; i++) {
      const seg = segmentOf(path[i]);
      let c = n.children.get(seg);
      if (!c) n.children.set(seg, (c = new Node()));
      n = c;
    }
    n.add(chunk);
  }
  if (id !== undefined) yield readBlob(id, node);
}

/** The file's image library (31.5.[id]): images and icons that layouts use, stored like container blobs. */
export function readImageLibrary(file: FmpFile): Map<number, ContainerBlob> {
  const root = buildTree(file, () => true, file.chunks(undefined, [31, 5]));
  const out = new Map<number, ContainerBlob>();
  for (const [id, node] of root.child(31, 5)?.numbered() ?? []) {
    let blob = readBlob(id, node);
    // Pasted pictures can keep a PDF next to a JPEG or PNG preview; browsers draw the preview.
    if (!WEB_IMAGES.includes(blob.type)) {
      const tag = WEB_IMAGES.find((t) => blob.streams.get(t)?.length);
      if (tag) {
        const data = blob.streams.get(tag)!;
        blob = { ...blob, type: tag, data, mime: mimeOf(tag, blob.filename, data) };
      }
    }
    if (blob.data.length) out.set(id, blob);
  }
  return out;
}

const WEB_IMAGES = ['PNGf', 'JPEG', 'GIFf', 'SVG ', 'WEBP'];
