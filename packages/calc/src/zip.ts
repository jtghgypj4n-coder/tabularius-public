// Zip archives for the BaseElements zip functions: written deflated, read stored
// or deflated, with UTF-8 names. node:zlib only; no Zip64 or encryption.

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** The path inside the archive, with "/" between folders; a folder ends in "/". */
  name: string;
  data: Uint8Array;
}

/** The most entries an uploaded archive (a workbook, a plug-in package) may hold, and the most an entry may unpack to, as a multiple of its compressed size. */
export const ARCHIVE_MAX_ENTRIES = 4096;
export const ARCHIVE_MAX_RATIO = 1000;

/** The message for an archive with too many entries; the Excel reader says the same. */
export const tooManyEntries = (count: number, limit: number) => `the archive holds ${count} entries; more than ${limit} are not read`;

/** The message for an entry that is nearly all repetition, which is how a decompression bomb is built. */
export const overRatio = (name: string, size: number, packed: number, limit: number) =>
  `${name} unpacks to ${size} bytes from ${packed}, more than ${limit} times its size; real files do not compress that far`;

/** Hard caps for one entry and for the sum of entries. */
const MAX_ENTRY = 256 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;

/** DOS time and date fields for a moment, in local time as zip tools expect. */
function dosTime(d: Date): [number, number] {
  if (d.getFullYear() < 1980) return [0, 0x21];
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ];
}

export function zip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const [time, date] = dosTime(when);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const folder = entry.name.endsWith('/');
    const data = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const packed = folder ? Buffer.alloc(0) : deflateRawSync(data, { level: 9 });
    const method = folder ? 0 : 8;
    const file = Buffer.from(entry.name, 'utf8');
    const crc = folder ? 0 : crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(file.length, 26);
    locals.push(head, file, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x0314, 4); // made by Unix, so the attributes below mean something
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(file.length, 28);
    dir.writeUInt32LE(((folder ? 0o40755 : 0o100644) << 16 | (folder ? 0x10 : 0)) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, file);
    offset += head.length + file.length + packed.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dirBytes, end]));
}

export interface UnzipOptions {
  /** Maximum sum of uncompressed entry sizes, checked before inflation; may further lower the 256 MiB hard cap. */
  maxTotalBytes?: number;
  /** Most entries in the directory; more is refused before any entry is read. No limit when left out (only the format's 65,534). */
  maxEntries?: number;
  /** Most an entry may unpack to, as a multiple of its compressed size; checked on the directory, before inflation. No limit when left out. */
  maxRatio?: number;
}

/** The entries of an archive, in directory order. Throws for damaged or oversized archives. */
export function unzip(bytes: Uint8Array, options: UnzipOptions = {}): ZipEntry[] {
  const maxTotal = Math.min(options.maxTotalBytes ?? MAX_TOTAL, MAX_TOTAL);
  if (!Number.isSafeInteger(maxTotal) || maxTotal < 0) throw new Error('invalid zip total byte limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive');
  const count = view.getUint16(end + 10, true);
  if (options.maxEntries !== undefined && count > options.maxEntries) throw new Error(tooManyEntries(count, options.maxEntries));
  const directorySize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  const directoryStart = at;
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error('multi-disk zip is unsupported');
  if (count === 0xffff || directorySize === 0xffffffff || at === 0xffffffff) throw new Error('Zip64 is unsupported');
  const directoryEnd = at + directorySize;
  if (directoryEnd !== end) throw new Error('damaged zip directory');
  const entries: { name: string; method: number; size: number; crc: number; raw: Uint8Array }[] = [];
  let total = 0;
  // Read the entire directory first: a later entry can put the archive over budget.
  for (let n = 0; n < count; n++) {
    if (at + 46 > directoryEnd || view.getUint32(at, true) !== 0x02014b50) throw new Error('damaged zip directory');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const next = at + 46 + nameLen + extra + comment;
    if (next > directoryEnd) throw new Error('damaged zip directory');
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('Zip64 is unsupported');
    if (flags & 1) throw new Error(`${name} is encrypted`);
    if (size > MAX_ENTRY) throw new Error(`${name} is over the zip entry byte limit`);
    total += size;
    if (total > maxTotal) throw new Error(`zip is over ${maxTotal} bytes unpacked`);
    if (local + 30 > view.getUint32(end + 16, true) || view.getUint32(local, true) !== 0x04034b50) throw new Error('damaged zip entry');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > view.getUint32(end + 16, true)) throw new Error('damaged zip entry');
    if (method !== 0 && method !== 8) throw new Error(`${name} uses an unsupported compression method`);
    if (method === 0 && packed !== size) throw new Error(`${name} has an incorrect uncompressed size`);
    if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
        view.getUint16(local + 26, true) !== nameLen ||
        !bytes.subarray(local + 30, local + 30 + nameLen).every((b, i) => b === bytes[at + 46 + i])) {
      throw new Error('damaged zip entry metadata');
    }
    const localCrc = view.getUint32(local + 14, true);
    const localPacked = view.getUint32(local + 18, true);
    const localSize = view.getUint32(local + 22, true);
    if (flags & 8) {
      // Streaming writers may leave local values zero and put them after the payload.
      if ((localCrc !== 0 && localCrc !== crc) || (localPacked !== 0 && localPacked !== packed) || (localSize !== 0 && localSize !== size)) {
        throw new Error('damaged zip entry metadata');
      }
      const descriptor = start + packed;
      const matches = (offset: number) => offset + 12 <= directoryStart &&
        view.getUint32(offset, true) === crc && view.getUint32(offset + 4, true) === packed && view.getUint32(offset + 8, true) === size;
      if (!matches(descriptor) && !(descriptor + 16 <= directoryStart && view.getUint32(descriptor, true) === 0x08074b50 && matches(descriptor + 4))) {
        throw new Error('damaged zip entry descriptor');
      }
    } else {
      if (localSize !== size) throw new Error(`${name} has an incorrect uncompressed size (damaged zip entry)`);
      if (localPacked !== packed || localCrc !== crc) throw new Error('damaged zip entry metadata');
    }
    entries.push({ name, method, size, crc, raw: bytes.subarray(start, start + packed) });
    at = next;
  }
  if (at !== directoryEnd) throw new Error('damaged zip directory');
  // After the size total, so an archive over budget is refused for that first; before any entry is inflated.
  if (options.maxRatio !== undefined) {
    for (const { name, method, size, raw } of entries) {
      if (method === 8 && size > options.maxRatio * raw.length) throw new Error(overRatio(name, size, raw.length, options.maxRatio));
    }
  }
  return entries.map(({ name, method, size, crc, raw }) => {
    // Do not trust the declared size: cap actual inflation too, including empty entries.
    let data: Uint8Array;
    try {
      data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new Error(`${name} has an incorrect uncompressed size`);
      throw new Error(`${name} has a damaged zip entry`, { cause: e });
    }
    if (data.length !== size) throw new Error(`${name} has an incorrect uncompressed size`);
    if (crc32(data) !== crc) throw new Error(`${name} has a damaged zip entry checksum`);
    return { name, data: method === 0 ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  });
}
