"""Build fixed WinAnsi TrueType subsets for the PDF writer; standard library only.

Run with a directory containing Arimo, Tinos, and Cousine static TTF files:
    python3 scripts/subset-pdf-fonts.py SOURCE_DIR packages/scripts/fonts

The source URLs and licenses are recorded beside the generated fonts.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path


WIN_ANSI = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E,
    0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
    0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
    0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
    0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
    0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
}
HEBREW = range(0x0590, 0x0600)
COMBINING = range(0x0300, 0x0370)
EMOJI = set(range(0x1F600, 0x1F650)) | set(range(0x1F900, 0x1F930)) | {
    0x1F44D, 0x1F44E, 0x1F525, 0x1F680, 0x1F389, 0x1F4A1,
}


def unpack(fmt: str, data: bytes, at: int):
    return struct.unpack_from('>' + fmt, data, at)


def checksum(data: bytes) -> int:
    data += b'\0' * (-len(data) % 4)
    return sum(struct.unpack('>' + 'I' * (len(data) // 4), data)) & 0xffffffff


def table_directory(data: bytes) -> dict[str, bytes]:
    count = unpack('H', data, 4)[0]
    tables = {}
    for i in range(count):
        tag, _sum, start, length = unpack('4sIII', data, 12 + i * 16)
        if start + length > len(data):
            raise ValueError(f'{tag!r} exceeds the source font')
        tables[tag.decode('ascii')] = data[start:start + length]
    return tables


def cmap4(tables: dict[str, bytes]):
    data = tables['cmap']
    count = unpack('H', data, 2)[0]
    offsets = [unpack('HHI', data, 4 + i * 8) for i in range(count)]
    chosen = next((offset for platform, encoding, offset in offsets
                   if platform == 3 and encoding == 1 and unpack('H', data, offset)[0] == 4), None)
    if chosen is None:
        raise ValueError('source font has no Microsoft Unicode format 4 cmap')
    start = chosen
    segments = unpack('H', data, start + 6)[0] // 2
    end_at = start + 14
    start_at = end_at + 2 * segments + 2
    delta_at = start_at + 2 * segments
    range_at = delta_at + 2 * segments

    def glyph(cp: int) -> int:
        for i in range(segments):
            end = unpack('H', data, end_at + 2 * i)[0]
            if cp > end:
                continue
            begin = unpack('H', data, start_at + 2 * i)[0]
            if cp < begin:
                return 0
            delta = unpack('H', data, delta_at + 2 * i)[0]
            distance = unpack('H', data, range_at + 2 * i)[0]
            if not distance:
                return (cp + delta) & 0xffff
            at = range_at + 2 * i + distance + 2 * (cp - begin)
            value = unpack('H', data, at)[0]
            return (value + delta) & 0xffff if value else 0
        return 0

    return glyph


def cmap12(tables: dict[str, bytes]):
    data = tables['cmap']
    count = unpack('H', data, 2)[0]
    offsets = [unpack('HHI', data, 4 + i * 8) for i in range(count)]
    chosen = next((offset for platform, encoding, offset in offsets
                   if (platform, encoding) in ((3, 10), (0, 4)) and unpack('H', data, offset)[0] == 12), None)
    if chosen is None:
        return lambda _cp: 0
    groups = unpack('I', data, chosen + 12)[0]
    ranges = [unpack('III', data, chosen + 16 + i * 12) for i in range(groups)]

    def glyph(cp: int) -> int:
        lo, hi = 0, len(ranges)
        while lo < hi:
            mid = (lo + hi) // 2
            start, end, first = ranges[mid]
            if cp < start:
                hi = mid
            elif cp > end:
                lo = mid + 1
            else:
                return first + cp - start
        return 0

    return glyph


def sfnt(tables: dict[str, bytes], scaler: bytes) -> bytes:
    names = sorted(tables)
    count = len(names)
    largest = 1 << (count.bit_length() - 1)
    header = bytearray(scaler + struct.pack('>HHHH', count, largest * 16, largest.bit_length() - 1, count * 16 - largest * 16))
    directory = bytearray(count * 16)
    body = bytearray()
    for i, name in enumerate(names):
        data = tables[name]
        start = 12 + count * 16 + len(body)
        struct.pack_into('>4sIII', directory, i * 16, name.encode('ascii'), checksum(data), start, len(data))
        body += data + b'\0' * (-len(data) % 4)
    result = header + directory + body
    # The head table's adjustment makes the checksum of the entire font equal
    # to the TrueType magic constant. Its directory checksum uses zero there.
    head_index = names.index('head')
    head_at = unpack('I', directory, head_index * 16 + 8)[0]
    struct.pack_into('>I', result, head_at + 8, (0xB1B0AFBA - checksum(result)) & 0xffffffff)
    return bytes(result)


def subset(data: bytes, extra=()):
    tables = table_directory(data)
    try:
        glyph4 = cmap4(tables)
    except ValueError:
        glyph4 = lambda _cp: 0
    glyph12 = cmap12(tables)
    def glyph_for(cp: int) -> int:
        return (glyph4(cp) if cp <= 0xffff else 0) or glyph12(cp)
    count = unpack('H', tables['maxp'], 4)[0]
    location_format = unpack('h', tables['head'], 50)[0]
    if location_format == 0:
        locations = [unpack('H', tables['loca'], i * 2)[0] * 2 for i in range(count + 1)]
    elif location_format == 1:
        locations = [unpack('I', tables['loca'], i * 4)[0] for i in range(count + 1)]
    else:
        raise ValueError('unknown glyph-location format')

    def codepoint(byte: int) -> int | None:
        return WIN_ANSI.get(byte, byte if 32 <= byte <= 126 or 160 <= byte <= 255 else None)

    glyph_ids = [glyph_for(cp) if (cp := codepoint(byte)) is not None else 0 for byte in range(32, 256)]
    unicode_ids = {cp: gid for cp in extra if (gid := glyph_for(cp))}
    included = {0, *glyph_ids, *unicode_ids.values()}
    queue = list(included)
    while queue:
        gid = queue.pop()
        if gid >= count:
            raise ValueError('glyph ID is outside maxp')
        glyph = tables['glyf'][locations[gid]:locations[gid + 1]]
        if len(glyph) < 10 or unpack('h', glyph, 0)[0] >= 0:
            continue
        at = 10
        while True:
            flags, child = unpack('HH', glyph, at)
            at += 4 + (4 if flags & 1 else 2)
            at += 2 if flags & 8 else 4 if flags & 64 else 8 if flags & 128 else 0
            if child not in included:
                included.add(child)
                queue.append(child)
            if not flags & 32:
                break

    glyf = bytearray()
    loca = [0]
    for gid in range(count):
        if gid in included:
            glyf += tables['glyf'][locations[gid]:locations[gid + 1]]
            if len(glyf) % 2:
                glyf += b'\0'
        loca.append(len(glyf))
    if location_format == 0 and len(glyf) // 2 <= 65535:
        location = struct.pack('>' + 'H' * len(loca), *(at // 2 for at in loca))
    else:
        location = struct.pack('>' + 'I' * len(loca), *loca)
        head = bytearray(tables['head'])
        struct.pack_into('>h', head, 50, 1)
        tables['head'] = bytes(head)
    tables['glyf'] = bytes(glyf)
    tables['loca'] = location
    head = bytearray(tables['head'])
    struct.pack_into('>I', head, 8, 0)
    tables['head'] = bytes(head)
    keep = {'OS/2', 'cmap', 'cvt ', 'fpgm', 'gasp', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'prep'}
    font = sfnt({name: value for name, value in tables.items() if name in keep}, data[:4])

    units = unpack('H', tables['head'], 18)[0]
    metrics_count = unpack('H', tables['hhea'], 34)[0]
    advances = [unpack('H', tables['hmtx'], i * 4)[0] for i in range(metrics_count)]
    widths = [round(advances[min(gid, metrics_count - 1)] * 1000 / units) for gid in glyph_ids]
    unicode = {str(cp): [gid, round(advances[min(gid, metrics_count - 1)] * 1000 / units)] for cp, gid in unicode_ids.items()}
    bbox = [round(v * 1000 / units) for v in unpack('hhhh', tables['head'], 36)]
    ascent, descent = [round(v * 1000 / units) for v in unpack('hh', tables['hhea'], 4)]
    italic = unpack('i', tables['post'], 4)[0] / 65536
    return font, {'widths': widths, 'unicode': unicode, 'bbox': bbox, 'ascent': ascent, 'descent': descent, 'italic': italic,
                  'glyphs': len(included), 'sourceGlyphs': count}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('usage: subset-pdf-fonts.py SOURCE_DIR OUTPUT_DIR')
    source, output = map(Path, sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    metadata = {}
    for family in ('Arimo', 'Tinos', 'Cousine'):
        for style in ('Regular', 'Bold', 'Italic', 'BoldItalic'):
            name = f'{family}-{style}'
            font, info = subset((source / f'{name}.ttf').read_bytes(), (*HEBREW, *COMBINING))
            (output / f'{name}.ttf').write_bytes(font)
            metadata[name] = info
    font, info = subset((source / 'NotoEmoji-Regular.ttf').read_bytes(), EMOJI)
    (output / 'NotoEmoji-Regular.ttf').write_bytes(font)
    metadata['NotoEmoji-Regular'] = info
    (output / 'metrics.json').write_text(json.dumps(metadata, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
