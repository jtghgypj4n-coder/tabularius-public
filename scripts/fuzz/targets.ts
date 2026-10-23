// Reader-only adapters: never execute a script, SQL statement, plug-in or request.
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { Schema } from '../../packages/fmp12/src/schema.ts';
import { FmpDatabase, FmpError, encryptionInfo, decodePayload, decodeScsu, pbParse, readLayoutDesigns } from '../../packages/fmp12/src/index.ts';
import { parseXml, snippetChanges } from '../../packages/store/src/snippet.ts';
import { layoutObjectsFromSnippet } from '../../packages/store/src/layout-snippet.ts';
import { uuidsFromSaveAsXml } from '../../packages/store/src/save-as-xml.ts';
import { parseScriptText } from '../../packages/store/src/script-text.ts';
import { DesignError } from '../../packages/store/src/design.ts';
import { readCalendar } from '../../packages/store/src/calendar.ts';
import { parseDelimited, parseDelimitedRows } from '../../packages/store/src/delimited.ts';
import { fileMakerSqlSyntax, oneStatement } from '../../packages/store/src/sql-dates.ts';
import { anyAllToIn, fetchToLimit, blanked } from '../../packages/store/src/sql-grammar.ts';
import { importFileRows, importFileRowIterator, ScriptError } from '../../packages/scripts/src/engine.ts';
import { readXlsx, xlsxSheetNames, unzip as sheetUnzip, MissingSheetError, SheetLimitError } from '../../packages/scripts/src/xlsx.ts';
import { parseDigestChallenge } from '../../packages/scripts/src/digest-auth.ts';
import { parse } from '../../packages/calc/src/parser.ts';
import { CalcError } from '../../packages/calc/src/values.ts';
import { jsonParse } from '../../packages/calc/src/json.ts';
import { parseXmlDocument, XPathError } from '../../packages/calc/src/xpath.ts';
import { unzip } from '../../packages/calc/src/zip.ts';
import { readPackage } from '../../packages/plugins/src/package.ts';
import { filterSql, filterTokens } from '../../packages/server/src/odata.ts';
import { parseRequestJson } from '../../packages/server/src/request-json.ts';
import { ApiError, readJson, readBoundedJson, multipartParts, multipartUpload, multipartText } from '../../packages/server/src/dataapi.ts';
import { MultipartLimits, MultipartLimitError } from '../../packages/server/src/multipart-limits.ts';
import { batchRequests, BatchError } from '../../packages/server/src/odata-batch.ts';
import { parseRange } from '../../packages/server/src/containers.ts';
import { etagMatches } from '../../packages/server/src/conditional.ts';
import { ARRAY_ELEMENT, BINARY_OID, BinaryFormatError, binaryParam, decodeNumeric } from '../../packages/server/src/pgbinary.ts';
import type { Target } from './generate.ts';
const schema = { tables: [], tableOccurrences: [], relationships: [], layouts: [], layoutOrder: [], scripts: [], scriptOrder: [], valueLists: [], customFunctions: [], accounts: [], privilegeSets: [], extendedPrivileges: [], dataSources: [], themes: [], fonts: [], customMenus: [], customMenuSets: [] } as unknown as Schema;
const props = [{ name: 'Name', field: 'Name', type: 'text', edm: 'Edm.String', queryable: true, writable: true }, { name: 'Count', field: 'Count', type: 'number', edm: 'Edm.Decimal', queryable: true, writable: true }];
function request(data: Buffer): IncomingMessage {
  return Object.assign(Readable.from([data.subarray(0, 7), data.subarray(7)]), { headers: { 'content-type': 'application/json' }, method: 'POST' }) as unknown as IncomingMessage;
}
// Explicit domain rejections only. TypeError/RangeError/assertions are findings.
export function expected(target: Target, e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e instanceof TypeError || e instanceof RangeError) return false;
  if (e instanceof DesignError || e instanceof CalcError || e instanceof FmpError || e instanceof XPathError || e instanceof ScriptError || e instanceof ApiError || e instanceof MultipartLimitError || e instanceof BatchError || e instanceof MissingSheetError || e instanceof SheetLimitError) return true;
  if (target === 'pgwire-binary') return e instanceof BinaryFormatError;
  if (['json', 'data-api'].includes(target) && e instanceof SyntaxError) return true;
  if (target === 'odata-filter' && e.constructor.name === 'ODataError') return true;
  if (e.constructor !== Error) return false;
  if (['csv', 'tsv', 'merge'].includes(target)) return /^(Malformed CSV quoting|Unclosed CSV quote)$/.test(e.message);
  if (target === 'xlsx') return /^(not a zip file|bad zip (directory|entry)|the zip file expands to more than|the workbook has no sheet|the archive holds \d+ entries)|^\S+ (unpacks to \d+ bytes from \d+, more than \d+ times its size|is nested more than \d+ levels deep|has a closing tag with nothing open)/.test(e.message);
  if (target === 'zip') return /^(not a zip archive|multi-disk zip is unsupported|Zip64 is unsupported|damaged zip (directory|entry)|zip is over )| (is encrypted|is over the zip entry byte limit|uses an unsupported compression method|has an incorrect uncompressed size( \(damaged zip entry\))?|has a damaged zip entry( checksum)?)$/.test(e.message);
  if (target === 'ohplugin') return /^(not a plug-in package:|the package (holds|is over|has no)|plugin.json(:| in the package is not JSON)|signature.json (is not JSON|needs publisherKey and sig)|the package's signature does not match)/.test(e.message);
  return false;
}
export async function exercise(target: Target, data: Buffer): Promise<{ accepted: number; rejected: number }> {
  const s = data.toString('utf8');
  const checks: (() => unknown | Promise<unknown>)[] = [];
  switch (target) {
    case 'filemaker-xml': checks.push(() => parseXml(s), () => parseXmlDocument(s), () => uuidsFromSaveAsXml(data)); break;
    case 'clipboard': checks.push(() => parseXml(s), () => snippetChanges(s, schema), () => layoutObjectsFromSnippet(s, schema)); break;
    case 'fmpxmlresult': checks.push(() => importFileRows('synthetic.xml', data), () => [...importFileRowIterator('synthetic.xml', data)]); break;
    case 'csv': case 'tsv': case 'merge': {
      const separator = target === 'tsv' ? '\t' : ',';
      checks.push(() => parseDelimited(s, separator, true), () => [...parseDelimitedRows(s, separator)], () => importFileRows(`synthetic.${target === 'merge' ? 'mer' : target}`, data), () => [...importFileRowIterator(`synthetic.${target === 'merge' ? 'mer' : target}`, data)]); break;
    }
    case 'xlsx': checks.push(() => readXlsx(data), () => xlsxSheetNames(data), () => sheetUnzip(data)); break;
    case 'zip': checks.push(() => unzip(data, { maxTotalBytes: 16 * 1024 * 1024 })); break;
    case 'ohplugin': checks.push(() => readPackage(data)); break;
    case 'ics': checks.push(() => readCalendar(s)); break;
    case 'json': checks.push(() => parseRequestJson(s), () => jsonParse(s)); break;
    case 'data-api': checks.push(() => readJson(request(data)), () => readJson(request(data), true), () => readBoundedJson(request(data))); break;
    case 'script': checks.push(() => parseScriptText(s, schema)); break;
    case 'calc': checks.push(() => parse(s)); break;
    case 'sql': checks.push(() => fileMakerSqlSyntax(s), () => anyAllToIn(s), () => fetchToLimit(s), () => blanked(s), () => oneStatement(s)); break;
    case 'odata-filter': checks.push(() => filterTokens(s), () => filterSql(s, props)); break;
    case 'multipart': {
      const type = 'multipart/form-data; boundary=fuzz';
      checks.push(() => [...multipartParts(type, data)], () => multipartUpload(type, data), () => multipartText(type, data, 'upload'), () => {
        const limits = new MultipartLimits(type);
        for (let at = 0; at < data.length; at += 7) limits.push(data.subarray(at, at + 7));
      }); break;
    }
    case 'mime-headers': checks.push(() => batchRequests('multipart/mixed; boundary=fuzz', data), () => batchRequests('application/json', data), () => parseDigestChallenge(s), () => parseRange(s, 1024), () => etagMatches(s, '"synthetic"')); break;
    case 'fmp12': checks.push(() => encryptionInfo(data), () => {
      const db = new FmpDatabase(data);
      try {
        for (const _ of db.file.chunks()) { /* fully consume lazy reader */ }
        readLayoutDesigns(db.file, db.schema);
        for (const t of db.schema.tables) { for (const _ of db.rawRecords(t.id)) { /* consume */ } db.containers(t.id); }
      } finally { db.close(); }
    }, () => decodePayload(data.subarray(20)), () => decodeScsu(data), () => pbParse(data)); break;
    // Every type a Bind parameter can name; an array's header is also pointed at its own element type so the element readers run.
    case 'pgwire-binary': for (const oid of [...Object.values(BINARY_OID), ...Object.keys(ARRAY_ELEMENT).map(Number)]) {
      checks.push(() => binaryParam(data, oid));
      if (ARRAY_ELEMENT[oid] !== undefined && data.length >= 12) checks.push(() => { const b = Buffer.from(data); b.writeUInt32BE(ARRAY_ELEMENT[oid], 8); return binaryParam(b, oid); });
    }
    // A small expansion allowance, so the cap on what a Bind's arrays expand to is reached and must refuse cleanly.
    checks.push(() => decodeNumeric(data), () => binaryParam(data, 1231, { left: 2048, total: 2048 }), () => binaryParam(data, 1009, { left: 64, total: 64 })); break;
  }
  let accepted = 0, rejected = 0;
  for (const check of checks) {
    try { await check(); accepted++; }
    catch (e) { if (expected(target, e)) rejected++; else throw e; }
  }
  return { accepted, rejected };
}
