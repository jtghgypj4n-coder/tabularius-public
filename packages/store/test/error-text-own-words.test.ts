// The descriptions in ERROR_MEANINGS are in our own words. The code numbers follow Claris's list, but the sentence
// for a code must not repeat the wording we once had (identical to, or a small edit of, Claris's text).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ERROR_MEANINGS, errorMeaning } from '../src/error-codes.ts';

// code -> earlier wordings the description must no longer equal or share a run of four words with
const OLD_WORDINGS: [number, string[]][] = [
  [-1, ['Unknown error']],
  [0, ['No error']],
  [1, ['User canceled action']],
  [2, ['Memory error']],
  [4, ['Command is unknown']],
  [5, ['Command is invalid']],
  [6, ['File is read-only']],
  [7, ['Running out of memory']],
  [9, ['Insufficient privileges']],
  [10, ['Requested data is missing']],
  [11, ['Name is not valid']],
  [12, ['Name already exists']],
  [13, ['File or object is in use']],
  [14, ['Out of range']],
  [15, ['Can\'t divide by zero']],
  [16, ['Operation failed; request retry']],
  [100, ['File is missing']],
  [101, ['Record is missing']],
  [102, ['Field is missing']],
  [103, ['Relationship is missing']],
  [104, ['Script is missing']],
  [105, ['Layout is missing']],
  [106, ['Table is missing']],
  [107, ['Index is missing']],
  [108, ['Value list is missing']],
  [109, ['Privilege set is missing']],
  [110, ['Related tables are missing']],
  [111, ['Field repetition is invalid']],
  [112, ['Window is missing']],
  [113, ['Function is missing']],
  [114, ['File reference is missing']],
  [115, ['Menu set is missing']],
  [116, ['Layout object is missing']],
  [117, ['Data source is missing']],
  [118, ['Theme is missing']],
  [131, ['Language pack files are missing']],
  [200, ['Record access is denied']],
  [202, ['Field access is denied']],
  [211, ['Password has expired']],
  [300, ['File is locked or in use']],
  [301, ['Record is in use by another user']],
  [302, ['Table is in use by another user']],
  [304, ['Layout is in use by another user']],
  [306, ['Record modification ID does not match']],
  [400, ['Find criteria are empty']],
  [401, ['No records match the request']],
  [404, ['Sort order is invalid']],
  [409, ['Import order is invalid']],
  [410, ['Export order is invalid']],
  [508, ['Invalid value entered in Find mode']],
  [510, ['Related value is empty or unavailable']],
  [603, ['Print connection lost']],
  [605, ['Container field is empty']],
  [706, ['EPS file has no preview image']],
  [820, ['File is being closed']],
  [821, ['Host forced a disconnect']],
  [831, ['Invalid PDF password']],
  [875, ['Endpoint is empty']],
  [882, ['Invalid AI request']],
  [887, ['Invalid RAG space action']],
  [901, ['Main spelling dictionary not installed']],
  [923, ['User dictionary is read-only']],
  [954, ['Unsupported XML grammar']],
  [955, ['No database name']],
  [957, ['Conflicting commands']],
  [958, ['Parameter missing']],
  [960, ['Parameter is invalid']],
  [1200, ['Generic calculation error']],
  [1201, ['Too few parameters in the function']],
  [1202, ['Too many parameters in the function']],
  [1203, ['Unexpected end of calculation']],
  [1207, ['Unbalanced parenthesis']],
  [1208, ['Operator missing, function not found or "(" not expected']],
  [1211, ['List usage is not allowed in this function']],
  [1212, ['An operator is expected here']],
  [1217, ['Break field is invalid']],
  [1414, ['SQL statement is too long']],
  [1501, ['SMTP authentication failed']],
  [1626, ['Protocol is not supported']],
  [1627, ['Authentication failed']],
  [1631, ['Connection failed']],
  [1700, ['Resource doesn\'t exist']],
  [1708, ['Parameter value is invalid']],
  [1711, ['Host\'s license has expired']],
  [1714, ['External group name is invalid']],
  [201, ['Field cannot be modified', 'Field can\'t be modified']],
  [210, ['User account is inactive', 'Account is inactive']],
  [214, ['Too many login attempts', 'Too many sign-in attempts']],
  [215, ['Administrator privileges cannot be duplicated', 'Admin privileges can\'t be duplicated']],
  [216, ['Guest account cannot be duplicated', 'Guest account can\'t be duplicated']],
  [303, ['Database schema is in use by another user', 'Schema is in use by another user']],
  [406, ['Replace/reserialize criteria are invalid', 'Replace or reserialize criteria are invalid']],
  [417, ['File is not a supported data source', 'Not a supported data source']],
  [418, ['Internal failure in INSERT operation into a field', 'Internal failure inserting into a field']],
  [509, ['Field requires a valid value', 'Field needs a valid value']],
  [707, ['Graphic translator cannot be found', 'Graphic translator not found']],
  [711, ['Import translator cannot be found', 'Import translator not found']],
  [715, ['Specified Excel worksheet or named range is missing', 'Excel worksheet or named range is missing']],
  [733, ['A table cannot be imported into itself', 'A table can\'t be imported into itself']],
  [805, ['File is damaged; use Recover command', 'File is damaged; use Recover']],
  [811, ['Temporary file cannot be opened as FileMaker Pro file', 'Temporary file can\'t be opened as a FileMaker file']],
  [813, ['Record synchronization error on network', 'Record synchronization error on the network']],
  [815, ['Couldn\'t open lookup file', 'Couldn\'t open the lookup file']],
  [819, ['Cannot save a local copy of a remote file', 'Can\'t save a local copy of a remote file']],
  [824, ['File is damaged or not a FileMaker Pro file', 'File is damaged or not a FileMaker file']],
  [825, ['File is not authorized to reference the protected file', 'File is not authorized to use this protected file']],
  [829, ['No PDF file is open to append to', 'No PDF file is open to add to']],
  [833, ['PDF file is already opened', 'A PDF file is already open']],
  [850, ['Path is not valid for the operating system', 'Path is invalid for the operating system']],
  [852, ['Cannot write a file to the external storage', 'Can\'t write the file to external storage']],
  [885, ['Endpoint is invalid or server is unreachable', 'Endpoint is invalid or the server is unreachable']],
  [886, ['Invalid Custom/Open Source Provider request', 'Invalid custom or open-source provider request']],
  [922, ['User dictionary cannot be found', 'User dictionary not found']],
  [1204, ['Number, text constant, field name, or "(" expected', 'Number, text, field name or "(" expected']],
  [1205, ['Comment is not terminated with "*/"', 'Comment is not ended with */']],
  [1206, ['Text constant must end with a quotation mark', 'Text must end with a quotation mark']],
  [1210, ['Plug-in function or script step has already been registered', 'Plug-in function or script step already registered']],
  [1213, ['This variable has already been defined in the Let function', 'Variable is already defined in the Let function']],
  [1218, ['Cannot evaluate the number', 'Can\'t evaluate the number']],
  [1219, ['A field cannot be used in its own formula', 'A field can\'t be used in its own formula']],
  [1220, ['Field type must be normal or calculated', 'Field must be normal or calculated']],
  [1221, ['Data type must be number, date, time, or timestamp', 'Must be number, date, time or timestamp']],
  [1222, ['Calculation cannot be stored', 'Calculation can\'t be stored']],
  [1225, ['Function referred to is not supported in this context', 'Function is not supported in this context']],
  [1632, ['The certificate has expired', 'Certificate has expired']],
  [1633, ['The certificate is self-signed', 'Certificate is self-signed']],
  [1635, ['Connection is unencrypted', 'Connection is not encrypted']],
  [1704, ['Resource doesn\'t support the specified HTTP verb (*)', 'Resource doesn\'t support this HTTP verb']],
  [1706, ['Parameter isn\'t supported (*)', 'Parameter is not supported']],
];

// Every code that had a description before this rewrite; none may lose it.
const CODES_BEFORE = OLD_WORDINGS.map(([code]) => code);

const words = (text: string): string[] => text.toLowerCase().match(/[\w'"()/*-]+/g) ?? [];

function longestSharedRun(a: string, b: string): number {
  const x = words(a), y = words(b);
  let best = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < y.length; j++) {
      let k = 0;
      while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

test('descriptions are in our own words: none equals an earlier wording or shares a run of four words with it', () => {
  for (const [code, olds] of OLD_WORDINGS) {
    const now = errorMeaning(code);
    assert.ok(now, `code ${code} still has a description`);
    for (const old of olds) {
      assert.notEqual(now.toLowerCase(), old.toLowerCase(), `code ${code} still reads "${old}"`);
      assert.ok(longestSharedRun(now, old) < 4, `code ${code} "${now}" shares a run of four words with "${old}"`);
    }
  }
});

test('every code that had a description still has one', () => {
  assert.equal(new Set(CODES_BEFORE).size, CODES_BEFORE.length);
  for (const code of CODES_BEFORE) assert.ok(ERROR_MEANINGS[code], `code ${code} lost its description`);
});
