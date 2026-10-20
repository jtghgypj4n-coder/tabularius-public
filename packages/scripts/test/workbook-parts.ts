// A workbook built from its parts, as plain text, so a test can give it what Excel writes and this program's own
// writer does not: several sheets, the 1904 date system, phonetic runs.
import { crc32 } from 'node:zlib';

export function zipOf(parts: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(parts)) {
    const data = Buffer.from(content, 'utf8');
    const name = Buffer.from(path, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    locals.push(head, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(data), 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A workbook of the given sheets (name and the XML of its rows), with the extra parts and workbook properties given. */
export function workbook(sheets: { name: string; rows: string }[], extra: { props?: string; sharedStrings?: string; styles?: string } = {}): Uint8Array {
  return zipOf({
    'xl/workbook.xml': `<workbook ${NS}>${extra.props ?? ''}<sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${NS}><sheetData>${s.rows}</sheetData></worksheet>`])),
    ...(extra.sharedStrings ? { 'xl/sharedStrings.xml': `<sst ${NS}>${extra.sharedStrings}</sst>` } : {}),
    ...(extra.styles ? { 'xl/styles.xml': `<styleSheet ${NS}>${extra.styles}</styleSheet>` } : {}),
  });
}
