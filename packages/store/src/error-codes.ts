// FileMaker's error codes (Get ( LastError ), EvaluationError, Data API
// messages) with what each means, in short words of our own. The numbers
// follow Claris's current list, help.claris.com/en/pro-help/content/error-codes.html;
// docs/error-codes.md says which codes the script engine returns for which
// failing steps, and how sure we are of each.

// Application extension: a passkey challenge is required after password authentication.
export const PASSKEY_SECOND_FACTOR_REQUIRED = 9000;

export const ERROR_MEANINGS: Readonly<Record<number, string>> = {
  [-1]: 'Unknown error', 0: 'No error', 1: 'User canceled action', 2: 'Memory error',
  3: 'Command is unavailable (wrong operating system or mode)', 4: 'Command is unknown', 5: 'Command is invalid',
  6: 'File is read-only', 7: 'Running out of memory', 9: 'Insufficient privileges', 10: 'Requested data is missing',
  11: 'Name is not valid', 12: 'Name already exists', 13: 'File or object is in use', 14: 'Out of range',
  15: "Can't divide by zero", 16: 'Operation failed; request retry', 17: "Couldn't convert the character set to UTF-16",
  18: 'Account information is needed', 19: 'Text has characters other than A-Z, a-z, 0-9', 20: 'Canceled by a triggered script',
  21: 'Not supported by the file system',
  100: 'File is missing', 101: 'Record is missing', 102: 'Field is missing', 103: 'Relationship is missing',
  104: 'Script is missing', 105: 'Layout is missing', 106: 'Table is missing', 107: 'Index is missing',
  108: 'Value list is missing', 109: 'Privilege set is missing', 110: 'Related tables are missing',
  111: 'Field repetition is invalid', 112: 'Window is missing', 113: 'Function is missing', 114: 'File reference is missing',
  115: 'Menu set is missing', 116: 'Layout object is missing', 117: 'Data source is missing', 118: 'Theme is missing',
  119: 'No email client', 130: 'Files are damaged or missing', 131: 'Language pack files are missing',
  200: 'Record access is denied', 201: "Field can't be modified", 202: 'Field access is denied',
  203: 'No records to print, or no access to print', 204: "Sort order has fields you can't access",
  205: "Can't create records; the import would overwrite data", 206: "Can't change the password, or the file is locked",
  207: "Can't change the database schema, or the file is locked", 208: 'Password is too short',
  209: 'New password must differ from the old one', 210: 'Account is inactive', 211: 'Password has expired',
  212: 'Account name or password is wrong', 213: 'Account does not exist (in FileMaker 14’s list; no longer in Claris’s)',
  214: 'Too many sign-in attempts', 215: "Admin privileges can't be duplicated", 216: "Guest account can't be duplicated",
  217: "Can't change the admin account", 218: "Passwords don't match", 219: 'Only licensed users may open this file',
  300: 'File is locked or in use', 301: 'Record is in use by another user', 302: 'Table is in use by another user',
  303: 'Schema is in use by another user', 304: 'Layout is in use by another user', 305: "Couldn't create the layout",
  306: 'Record modification ID does not match', 307: "Couldn't lock the transaction (host communication)",
  308: 'Theme is locked by another user', 310: 'Another user is changing these items',
  400: 'Find criteria are empty', 401: 'No records match the request', 402: "Field can't be a lookup match field",
  404: 'Sort order is invalid', 405: "Can't omit that many records", 406: 'Replace or reserialize criteria are invalid',
  407: 'A match field is missing (invalid relationship)', 408: 'Wrong field type for this operation',
  409: 'Import order is invalid', 410: 'Export order is invalid', 412: 'Wrong FileMaker version to recover the file',
  413: 'Wrong field type for this operation', 414: "The layout can't show the result", 415: 'Needed related records are unavailable',
  416: 'The data source table needs a primary key', 417: 'Not a supported data source', 418: 'Internal failure inserting into a field',
  500: 'Date fails its validation', 501: 'Time fails its validation', 502: 'Number fails its validation',
  503: 'Value is outside its validation range', 504: 'Value is not unique', 505: 'Value is not an existing value in the file',
  506: 'Value is not on its value list', 507: 'Value fails its validation calculation', 508: 'Invalid value entered in Find mode',
  509: 'Field needs a valid value', 510: 'Related value is empty or unavailable', 511: 'Value is longer than the field allows',
  512: 'The record was already changed by another user', 513: 'Value too large for the field (no validation set)',
  600: 'Print error', 601: 'Header and footer are taller than the page', 602: "Body doesn't fit the page's columns",
  603: 'Print connection lost', 604: 'Not container data', 605: 'Container field is empty', 606: 'Container data is not a PDF',
  607: 'PDF password is missing or wrong', 608: 'PDF security settings block printing',
  700: 'Wrong file type for import', 706: 'EPS file has no preview image', 707: 'Graphic translator not found',
  708: "Can't import the file (needs color)", 711: 'Import translator not found', 714: 'Privileges block this operation',
  715: 'Excel worksheet or named range is missing', 716: 'ODBC import allows only SELECT', 717: 'Not enough XML/XSL information',
  718: 'XML parse error', 719: 'XSL transform error', 720: "Export format doesn't support repeating fields",
  721: 'Unknown parser or transformer error', 722: "Can't import into a file with no fields", 723: 'No permission to add or change records',
  724: 'No permission to add records', 725: 'No permission to change records', 726: 'Source has more records than the target',
  727: 'Target has more records than the source', 729: 'Errors occurred; records not imported', 730: 'Unsupported Excel version',
  731: 'The import file has no data', 732: "Can't insert a file that contains other files", 733: "A table can't be imported into itself",
  734: "This file type can't be shown as a picture", 735: 'Inserted as a file, not a picture', 736: 'Export data too large; truncated',
  738: 'The theme being imported already exists',
  800: "Can't create the file on disk", 801: "Can't create a temporary system file", 802: "Can't open the file",
  803: 'File is single-user, or the host is missing', 804: "Can't open the file read-only now", 805: 'File is damaged; use Recover',
  806: "This version can't open the file", 807: 'Not a FileMaker file, or badly damaged', 808: 'Access privileges are damaged',
  809: 'Disk is full', 810: 'Disk is locked', 811: "Temporary file can't be opened as a FileMaker file", 812: 'Host capacity exceeded',
  813: 'Record synchronization error on the network', 814: 'Too many files open', 815: "Couldn't open the lookup file",
  816: "Can't convert the file", 817: "File isn't part of this solution", 819: "Can't save a local copy of a remote file",
  820: 'File is being closed', 821: 'Host forced a disconnect', 822: 'FileMaker files are missing', 823: "Can't go single-user; guests are connected",
  824: 'File is damaged or not a FileMaker file', 825: 'File is not authorized to use this protected file', 826: 'File path is invalid',
  827: 'File not created (empty source, or a reference)', 829: 'No PDF file is open to add to', 830: 'Invalid PDF file',
  831: 'Invalid PDF password', 832: "PDF password doesn't allow changing pages", 833: 'A PDF file is already open',
  850: 'Path is invalid for the operating system', 851: "Can't delete the external file", 852: "Can't write the file to external storage",
  853: "Some containers didn't transfer", 870: 'Another user is changing the file', 871: "Couldn't load the Core ML model",
  872: 'Core ML model has unsupported parameters', 875: 'Endpoint is empty', 876: "The layout doesn't show the table's records",
  877: 'AI account not found', 878: 'Options JSON is malformed', 879: 'Parameters JSON is malformed', 882: 'Invalid AI request',
  883: 'Invalid custom model provider request', 885: 'Endpoint is invalid or the server is unreachable',
  886: 'Invalid custom or open-source provider request', 887: 'Invalid RAG space action', 892: 'RAG account not found',
  900: 'Spelling engine error', 901: 'Main spelling dictionary not installed', 903: 'Command not allowed in a shared file',
  905: 'Command needs an active field', 906: 'File is not shared', 920: "Couldn't start the spelling engine",
  921: "Couldn't load the user dictionary", 922: 'User dictionary not found', 923: 'User dictionary is read-only',
  951: 'Unexpected error', 952: 'Invalid Data API token', 953: 'Data transmission limit exceeded', 954: 'Unsupported XML grammar',
  955: 'No database name', 956: 'Too many database or Admin API sessions', 957: 'Conflicting commands', 958: 'Parameter missing',
  959: 'Custom Web Publishing is off', 960: 'Parameter is invalid',
  1200: 'Generic calculation error', 1201: 'Too few parameters in the function', 1202: 'Too many parameters in the function',
  1203: 'Unexpected end of calculation', 1204: 'Number, text, field name or "(" expected', 1205: 'Comment is not ended with */',
  1206: 'Text must end with a quotation mark', 1207: 'Unbalanced parenthesis', 1208: 'Operator missing, function not found or "(" not expected',
  1209: 'Name is missing', 1210: 'Plug-in function or script step already registered', 1211: 'List usage is not allowed in this function',
  1212: 'An operator is expected here', 1213: 'Variable is already defined in the Let function',
  1214: 'An expression is used where a field alone is needed', 1215: 'Invalid Get function parameter',
  1216: 'Only summary fields can be the first argument of GetSummary', 1217: 'Break field is invalid', 1218: "Can't evaluate the number",
  1219: "A field can't be used in its own formula", 1220: 'Field must be normal or calculated', 1221: 'Must be number, date, time or timestamp',
  1222: "Calculation can't be stored", 1223: 'Function is not implemented yet', 1224: "Function doesn't exist",
  1225: 'Function is not supported in this context',
  1400: "ODBC driver couldn't start", 1401: "Couldn't allocate the ODBC environment", 1402: "Couldn't free the ODBC environment",
  1403: "Couldn't disconnect from ODBC", 1404: "Couldn't allocate the ODBC connection", 1405: "Couldn't free the ODBC connection",
  1406: "Couldn't check for SQL API", 1407: "Couldn't allocate the ODBC statement", 1408: 'Extended ODBC error', 1409: 'ODBC error',
  1413: 'ODBC communication link failed', 1414: 'SQL statement is too long', 1415: 'ODBC connection is disconnecting',
  1450: 'Needs the PHP privilege extension', 1451: 'Needs the current file to be remote',
  1501: 'SMTP authentication failed', 1502: 'SMTP server refused the connection', 1503: 'SSL error',
  1504: 'SMTP server needs an encrypted connection', 1505: "SMTP server doesn't support that authentication",
  1506: "Email wasn't sent", 1507: "Couldn't sign in to the SMTP server", 1541: "Couldn't make the JWT (check the private key)",
  1542: "Couldn't get an access token", 1543: "Test email wasn't sent",
  1550: "Plug-in can't load or is invalid", 1551: "Plug-in can't be installed",
  1626: 'Protocol is not supported', 1627: 'Authentication failed', 1628: 'SSL error', 1629: 'Connection timed out',
  1630: 'URL is not in the right format', 1631: 'Connection failed', 1632: 'Certificate has expired',
  1633: 'Certificate is self-signed', 1634: "Certificate couldn't be verified", 1635: 'Connection is not encrypted',
  1638: 'Host is not taking new connections; try later',
  1700: "Resource doesn't exist", 1701: "Host can't take requests now", 1702: 'Authorization header is malformed',
  1703: 'Account name, password or JWT is invalid', 1704: "Resource doesn't support this HTTP verb", 1705: 'Required HTTP header is missing',
  1706: 'Parameter is not supported', 1707: 'Required parameter is missing', 1708: 'Parameter value is invalid',
  1709: 'Not valid in the resource’s current state', 1710: 'JSON input is malformed', 1711: "Host's license has expired",
  1712: 'Private key file already exists', 1713: 'Not supported on this operating system', 1714: 'External group name is invalid',
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
