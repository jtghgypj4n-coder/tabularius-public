// FileMaker's error codes (Get ( LastError ), EvaluationError, Data API
// messages) with what each means, in short words of our own. The numbers
// follow Claris's current list, help.claris.com/en/pro-help/content/error-codes.html;
// docs/error-codes.md says which codes the script engine returns for which
// failing steps, and how sure we are of each.

// Application extension: a passkey challenge is required after password authentication.
export const PASSKEY_SECOND_FACTOR_REQUIRED = 9000;

export const ERROR_MEANINGS: Readonly<Record<number, string>> = {
  [-1]: 'Cause not known', 0: 'Completed without a problem', 1: 'The person stopped the action', 2: 'Memory failure',
  3: 'Command is unavailable (wrong operating system or mode)', 4: 'Command not recognized', 5: 'Command used incorrectly',
  6: 'File can only be read', 7: 'Memory is nearly exhausted', 9: 'Privileges do not allow this', 10: 'The data asked for is not there',
  11: 'Name cannot be used', 12: 'That name is taken', 13: 'Another process holds the file or object', 14: 'Value outside the allowed range',
  15: 'Division by zero', 16: 'Operation did not finish; try again', 17: "Couldn't convert the character set to UTF-16",
  18: 'Account information is needed', 19: 'Text has characters other than A-Z, a-z, 0-9', 20: 'Canceled by a triggered script',
  21: 'Not supported by the file system',
  100: 'No such file', 101: 'No such record', 102: 'No such field', 103: 'No such relationship',
  104: 'No such script', 105: 'No such layout', 106: 'No such table', 107: 'No such index',
  108: 'No such value list', 109: 'No such privilege set', 110: 'No related tables found',
  111: 'Repetition number not allowed for the field', 112: 'No such window', 113: 'No such function', 114: 'No such file reference',
  115: 'No such menu set', 116: 'No such layout object', 117: 'No such data source', 118: 'No such theme',
  119: 'No email client', 130: 'Files are damaged or missing', 131: 'Language pack files not found',
  200: 'Access to the record is refused', 201: 'Field is protected from changes', 202: 'Access to the field is refused',
  203: 'No records to print, or no access to print', 204: "Sort order has fields you can't access",
  205: "Can't create records; the import would overwrite data", 206: "Can't change the password, or the file is locked",
  207: "Can't change the database schema, or the file is locked", 208: 'Password is too short',
  209: 'New password must differ from the old one', 210: 'The account is turned off', 211: 'The password is out of date',
  212: 'Account name or password is wrong', 213: 'Account does not exist (in FileMaker 14’s list; no longer in Claris’s)',
  214: 'Sign-in attempts exceeded the limit', 215: 'Cannot copy the administrator privilege set', 216: 'Cannot copy the guest account',
  217: "Can't change the admin account", 218: "Passwords don't match", 219: 'Only licensed users may open this file',
  300: 'File locked or busy', 301: 'Another user is working in the record', 302: 'Another user is working in the table',
  303: 'Another user is working in the schema', 304: 'Another user is working in the layout', 305: "Couldn't create the layout",
  306: 'Record changed since it was read (modification ID differs)', 307: "Couldn't lock the transaction (host communication)",
  308: 'Theme is locked by another user', 310: 'Another user is changing these items',
  400: 'No find criteria given', 401: 'Nothing matches the request', 402: "Field can't be a lookup match field",
  404: 'Sort specification not usable', 405: "Can't omit that many records", 406: 'Criteria for replacing or reserializing are not valid',
  407: 'A match field is missing (invalid relationship)', 408: 'Wrong field type for this operation',
  409: 'Import field order not usable', 410: 'Export field order not usable', 412: 'Wrong FileMaker version to recover the file',
  413: 'Wrong field type for this operation', 414: "The layout can't show the result", 415: 'Needed related records are unavailable',
  416: 'The data source table needs a primary key', 417: 'Source cannot serve as a data source', 418: 'Could not insert the value into the field (internal failure)',
  500: 'Date fails its validation', 501: 'Time fails its validation', 502: 'Number fails its validation',
  503: 'Value is outside its validation range', 504: 'Value is not unique', 505: 'Value is not an existing value in the file',
  506: 'Value is not on its value list', 507: 'Value fails its validation calculation', 508: 'Find mode rejected the value typed',
  509: 'Field cannot be left without a valid entry', 510: 'Related value is blank or cannot be reached', 511: 'Value is longer than the field allows',
  512: 'The record was already changed by another user', 513: 'Value too large for the field (no validation set)',
  600: 'Print error', 601: 'Header and footer are taller than the page', 602: "Body doesn't fit the page's columns",
  603: 'Printer connection dropped', 604: 'Not container data', 605: 'Nothing is stored in the container field', 606: 'Container data is not a PDF',
  607: 'PDF password is missing or wrong', 608: 'PDF security settings block printing',
  700: 'Wrong file type for import', 706: 'EPS file lacks a preview picture', 707: 'No graphic translator available',
  708: "Can't import the file (needs color)", 711: 'No import translator available', 714: 'Privileges block this operation',
  715: 'Named Excel worksheet or range not found', 716: 'ODBC import allows only SELECT', 717: 'Not enough XML/XSL information',
  718: 'XML parse error', 719: 'XSL transform error', 720: "Export format doesn't support repeating fields",
  721: 'Unknown parser or transformer error', 722: "Can't import into a file with no fields", 723: 'No permission to add or change records',
  724: 'No permission to add records', 725: 'No permission to change records', 726: 'Source has more records than the target',
  727: 'Target has more records than the source', 729: 'Errors occurred; records not imported', 730: 'Unsupported Excel version',
  731: 'The import file has no data', 732: "Can't insert a file that contains other files", 733: 'Cannot import a table onto itself',
  734: "This file type can't be shown as a picture", 735: 'Inserted as a file, not a picture', 736: 'Export data too large; truncated',
  738: 'The theme being imported already exists',
  800: "Can't create the file on disk", 801: "Can't create a temporary system file", 802: "Can't open the file",
  803: 'File is single-user, or the host is missing', 804: "Can't open the file read-only now", 805: 'File is corrupt; recover it first',
  806: "This version can't open the file", 807: 'Not a FileMaker file, or badly damaged', 808: 'Access privileges are damaged',
  809: 'Disk is full', 810: 'Disk is locked', 811: 'Temp file is not usable as a FileMaker database', 812: 'Host capacity exceeded',
  813: 'Network failure while synchronizing records', 814: 'Too many files open', 815: 'Lookup file could not be opened',
  816: "Can't convert the file", 817: "File isn't part of this solution", 819: 'A remote file cannot be saved as a local copy',
  820: 'File is shutting down', 821: 'Host ended the connection', 822: 'FileMaker files are missing', 823: "Can't go single-user; guests are connected",
  824: 'File is corrupt or is not a FileMaker database', 825: 'Protected file may not be referenced by this file', 826: 'File path is invalid',
  827: 'File not created (empty source, or a reference)', 829: 'No open PDF to append onto', 830: 'Invalid PDF file',
  831: 'PDF password rejected', 832: "PDF password doesn't allow changing pages", 833: 'PDF already open',
  850: 'Path not usable on this operating system', 851: "Can't delete the external file", 852: 'External storage write failed',
  853: "Some containers didn't transfer", 870: 'Another user is changing the file', 871: "Couldn't load the Core ML model",
  872: 'Core ML model has unsupported parameters', 875: 'No endpoint given', 876: "The layout doesn't show the table's records",
  877: 'AI account not found', 878: 'Options JSON is malformed', 879: 'Parameters JSON is malformed', 882: 'AI request not valid',
  883: 'Invalid custom model provider request', 885: 'Endpoint is wrong or the server cannot be reached',
  886: 'Provider request (custom or open source) not valid', 887: 'RAG space action not valid', 892: 'RAG account not found',
  900: 'Spelling engine error', 901: 'Primary spelling dictionary missing', 903: 'Command not allowed in a shared file',
  905: 'Command needs an active field', 906: 'File is not shared', 920: "Couldn't start the spelling engine",
  921: "Couldn't load the user dictionary", 922: 'Cannot locate the user dictionary', 923: 'User dictionary can only be read',
  951: 'Unexpected error', 952: 'Invalid Data API token', 953: 'Data transmission limit exceeded', 954: 'XML grammar not supported',
  955: 'Database name not given', 956: 'Too many database or Admin API sessions', 957: 'Commands clash', 958: 'A required parameter was left out',
  959: 'Custom Web Publishing is off', 960: 'A parameter has an unusable value',
  1200: 'Calculation failed for an unspecified reason', 1201: 'Function given fewer parameters than it needs', 1202: 'Function given more parameters than it takes',
  1203: 'Calculation ends too soon', 1204: 'Expected a number, a text value, a field or "("', 1205: 'Comment never closed with */',
  1206: 'Text literal needs a closing quotation mark', 1207: 'Parentheses do not pair up', 1208: 'Missing operator, unknown function or stray "("',
  1209: 'Name is missing', 1210: 'Plug-in function or step registered twice', 1211: 'This function cannot take a list',
  1212: 'An operator belongs here', 1213: 'Let function declares the variable more than once',
  1214: 'An expression is used where a field alone is needed', 1215: 'Invalid Get function parameter',
  1216: 'Only summary fields can be the first argument of GetSummary', 1217: 'Break field not usable', 1218: 'Number could not be evaluated',
  1219: 'A formula cannot refer to its own field', 1220: 'Only normal or calculated fields allowed', 1221: 'Only numbers, dates, times and timestamps allowed',
  1222: 'This calculation cannot be kept in storage', 1223: 'Function is not implemented yet', 1224: "Function doesn't exist",
  1225: 'Function cannot be used here',
  1400: "ODBC driver couldn't start", 1401: "Couldn't allocate the ODBC environment", 1402: "Couldn't free the ODBC environment",
  1403: "Couldn't disconnect from ODBC", 1404: "Couldn't allocate the ODBC connection", 1405: "Couldn't free the ODBC connection",
  1406: "Couldn't check for SQL API", 1407: "Couldn't allocate the ODBC statement", 1408: 'Extended ODBC error', 1409: 'ODBC error',
  1413: 'ODBC communication link failed', 1414: 'SQL statement exceeds the length limit', 1415: 'ODBC connection is disconnecting',
  1450: 'Needs the PHP privilege extension', 1451: 'Needs the current file to be remote',
  1501: 'SMTP sign-in was rejected', 1502: 'SMTP server refused the connection', 1503: 'SSL error',
  1504: 'SMTP server needs an encrypted connection', 1505: "SMTP server doesn't support that authentication",
  1506: "Email wasn't sent", 1507: "Couldn't sign in to the SMTP server", 1541: "Couldn't make the JWT (check the private key)",
  1542: "Couldn't get an access token", 1543: "Test email wasn't sent",
  1550: "Plug-in can't load or is invalid", 1551: "Plug-in can't be installed",
  1626: 'This protocol cannot be used', 1627: 'Sign-in was rejected', 1628: 'SSL error', 1629: 'Connection timed out',
  1630: 'URL is not in the right format', 1631: 'Could not connect', 1632: 'Certificate is out of date',
  1633: 'Certificate signs itself', 1634: "Certificate couldn't be verified", 1635: 'Connection lacks encryption',
  1638: 'Host is not taking new connections; try later',
  1700: 'No such resource', 1701: "Host can't take requests now", 1702: 'Authorization header is malformed',
  1703: 'Account name, password or JWT is invalid', 1704: 'HTTP verb not accepted by the resource', 1705: 'Required HTTP header is missing',
  1706: 'Parameter not accepted', 1707: 'Required parameter is missing', 1708: 'Parameter value rejected',
  1709: 'Not valid in the resource’s current state', 1710: 'JSON input is malformed', 1711: 'The host license is out of date',
  1712: 'Private key file already exists', 1713: 'Not supported on this operating system', 1714: 'External group name not allowed',
  1715: 'External server sign-in is not on',
  // 8310 is also returned by FileMaker SQL/OData in practice, although absent from Claris's published list.
  8310: 'SQL or OData request is invalid or not allowed',
  // Tabularius application extension; outside the observed FileMaker 8309/8310 SQL/OData range.
  [PASSKEY_SECOND_FACTOR_REQUIRED]: 'Passkey second factor is required',
};

/** What a FileMaker or documented Tabularius error code means; plug-in (1552-1559) and Revert Transaction (5000-5499) codes included. */
export function errorMeaning(code: number): string | undefined {
  if (ERROR_MEANINGS[code] !== undefined) return ERROR_MEANINGS[code];
  if (code >= 1552 && code <= 1559) return 'Error from a plug-in';
  if (code >= 5000 && code <= 5499) return 'Custom error from Revert Transaction';
  return undefined;
}

/**
 * What to do about the bare messages FileMaker's own Data API gives (and ours
 * copy), which say what failed but not what to try. The wording FileMaker
 * clients match on stays first; the advice follows in brackets. The status is
 * the HTTP status the error goes out with.
 */
const HINTS: { code: number; message: string; status?: number; hint: string }[] = [
  { code: 802, message: 'Unable to open file', hint: 'no hosted file has that name, or this account may not open it; GET /fmi/data/vLatest/databases lists the files it can' },
  { code: 3, message: 'Command is unavailable', status: 404, hint: "this server has no such address; docs/reference/rest.md lists the ones it has" },
  { code: 3, message: 'Command is unavailable', status: 405, hint: "that address doesn't take this HTTP method; docs/reference/rest.md says which it takes" },
  { code: 3, message: 'Command is unavailable', status: 400, hint: "that command isn't one this server knows" },
  { code: 3, message: 'Not supported', status: 405, hint: "that address doesn't take this HTTP method; docs/reference/rest.md says which it takes" },
  { code: 104, message: 'No such script', hint: "check the script's name against the layout's or file's script list" },
  { code: 952, message: 'Invalid FileMaker Data API token (*)', hint: 'the session ended or timed out (15 minutes without a call); sign in again with POST /sessions' },
  { code: 960, message: 'Invalid JSON', hint: 'the request body must be valid JSON; look for a stray comma, a missing quote or a body sent as form data' },
  { code: 960, message: 'Request body too large', hint: 'send less in one request, or split it into several' },
];

/** The message with advice on what to try, when it's one of the bare messages above; otherwise as it is. */
export function plainMessage(code: number, message: string, status?: number): string {
  const h = HINTS.find((x) => x.code === code && x.message === message && (x.status === undefined || x.status === status));
  return h ? `${message} (${h.hint})` : message;
}
