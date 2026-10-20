// The text of a file the person picked, whatever it was saved as: UTF-8 (with or without a byte order mark),
// UTF-16 (little or big endian, with its byte order mark) or, when the bytes are not valid UTF-8, Windows-1252,
// which is what Excel's "CSV" and most older Windows programs write.

const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function windows1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...Array.from(bytes.subarray(i, i + 8192), (b) => CP1252[b] ?? b));
  }
  return out;
}

/** The text of `data`, without any byte order mark. */
export function decodeText(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) {
    // Big endian: swap each pair of bytes and read it as little endian.
    const swapped = new Uint8Array(data.length - 2 - ((data.length - 2) % 2));
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = data[i + 3];
      swapped[i + 1] = data[i + 2];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  const body = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return windows1252(body);
  }
}
