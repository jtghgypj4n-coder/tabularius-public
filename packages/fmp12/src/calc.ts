// Calculation source text from the token stream FileMaker stores next to the
// compiled form (key 5 of a calculation node; key 6 is the compiled form).
// The token stream keeps the author's spacing and comments, so decoding it
// gives back the formula as written.
//
// Token layout (verified against a FileMaker 2026 Database Design Report):
//   0C 13 n text 00      whitespace          0E 13 n text 00   // comment
//   0D 13 n text 00      /* comment */
//   13 n text 00         "string"            1A n name         $variable / $$global
//   0B n name 00 00      Let variable        10 …              number literal
//   16 flags refs rep    field reference (flags & 4: written as TO::field)
//   03 ; 04 ( 05 ) 06 [ 07 ]                 9B Get, 9C n      Get ( parameter )
//   F8–FD n              two-byte function   anything else     one-byte function or operator
// Text is XOR 0x5A like the rest of the file. The function and operator
// tables below hold the ids seen so far; unknown ids decode as ⟨fn:xx⟩.

import { pathValue } from './chunks.ts';
import { decodeTextChars } from './scsu.ts';

// Ids were matched from formulas whose meaning is plain from context
// (argument shapes, comments, neighbouring ids, values FileMaker stored).
const ONE_BYTE: Record<number, string> = {
  0x1e: 'not', 0x1f: 'and', 0x20: 'or', 0x21: 'xor', 0x22: 'True', 0x23: 'False', 0x24: '¶',
  0x25: '+', 0x26: '-', 0x27: '*', 0x28: '/', 0x29: '^', 0x2a: 'Div', 0x2b: 'Mod', 0x2d: 'Abs', 0x2f: 'Int',
  // 0x36 / 0x37: Floor (a ms timestamp split into seconds and Right ( utc ; 3 ))
  // and its pair Ceiling; inferred, no stored value to confirm them.
  0x36: 'Floor', 0x37: 'Ceiling',
  // 0x3a: digit count as Int ( Log ( n ) ) + 1 (private samples); 0x53: word count beside Length (private samples).
  0x3a: 'Log', 0x53: 'WordCount',
  // 0x33 Sign: Choose ( 1 + Sign ( n ) ; ... ) with three branches for < 0, 0 and > 0 (fmIDE's fmJAML).
  0x33: 'Sign',
  0x30: 'GetAsText', 0x31: 'Random', 0x32: 'Round', 0x3e: 'GetAsBoolean', 0x3f: 'GetValue',
  0x41: '<', 0x42: '<=', 0x43: '≤', 0x44: '=', 0x45: '<>', 0x46: '≠', 0x47: '>=', 0x48: '≥', 0x49: '>', 0x4a: 'EvaluationError',
  // 0x51 Exact: not IsEmpty ( t ) and Exact ( GetAsNumber ( t ) ; t ) tests for a number (fmIDE's fmJAML.IsNumber).
  0x51: 'Exact',
  0x4b: 'If', 0x4c: 'Case', 0x4d: 'Choose', 0x4e: 'IsEmpty', 0x4f: 'IsValid', 0x50: '&',
  0x52: 'Length', 0x54: 'Lower', 0x55: 'Upper', 0x56: 'Proper', 0x57: 'Left', 0x58: 'Middle', 0x59: 'Right',
  0x5a: 'LeftWords', 0x5b: 'MiddleWords', 0x5c: 'RightWords', 0x5d: 'LeftValues', 0x5e: 'MiddleValues', 0x5f: 'RightValues',
  0x60: 'PatternCount', 0x61: 'Position', 0x62: 'Replace', 0x63: 'Substitute', 0x64: 'Trim', 0x65: 'Filter', 0x66: 'FilterValues',
  // 0x6f SerialIncrement: Year ( d ) & SerialIncrement ( "-00" ; Month ( d ) ) pads to two digits (fmIDE's fmJAML).
  0x6f: 'SerialIncrement',
  0x68: 'GetAsNumber', 0x69: 'GetAsTimestamp', 0x6a: 'GetAsTime', 0x6b: 'GetAsDate', 0x6d: 'GetAsCSS', 0x6e: 'ValueCount',
  // 0x70-0x79 run through FileMaker's date functions in alphabetical order.
  0x70: 'Date', 0x71: 'Day', 0x72: 'DayName', 0x73: 'DayOfWeek', 0x74: 'DayOfYear', 0x75: 'Month', 0x76: 'MonthName',
  0x77: 'WeekOfYear', 0x78: 'WeekOfYearFiscal', 0x79: 'Year',
  0x7a: 'Hour', 0x7b: 'Minute', 0x7c: 'Seconds', 0x7d: 'Time', 0x7e: 'Timestamp',
  0x80: 'Count', 0x81: 'Max', 0x82: 'Min', 0x83: 'StDev', 0x85: 'Sum', 0x86: 'GetSummary', 0x87: 'List', 0x88: 'Extend', 0x8b: 'GetNthRecord', 0x9b: 'Get',
  // 0xa6 TextStyleRemove: TextStyleAdd ( TextStyleRemove ( "/" ; Bold ) ; 0 ), between its pair and RGB (fmIDE).
  0xa3: 'TextSize', 0xa4: 'TextColor', 0xa5: 'TextStyleAdd', 0xa6: 'TextStyleRemove', 0xa7: 'RGB',
  // Text styles in the order of FileMaker 7's list (0xb0 Strikethrough is confirmed by a field named so).
  0xaa: 'Plain', 0xab: 'Bold', 0xac: 'Italic', 0xad: 'Underline', 0xae: 'Condense', 0xaf: 'Extend', 0xb0: 'Strikethrough',
  0xb1: 'SmallCaps', 0xb2: 'Superscript', 0xb3: 'Subscript', 0xb4: 'Uppercase', 0xb5: 'Lowercase', 0xb6: 'Titlecase',
  0xb7: 'WordUnderline', 0xb8: 'DoubleUnderline', 0xb9: 'AllStyles', 0xbb: 'TextFormatRemove', 0xdc: 'Evaluate', 0xdd: 'GetField', 0xde: 'IsValidExpression', 0xdf: 'Let', 0xe2: 'Quote',
  // 0xec NumToJText ( n ; 1 ; 0 ) adds thousands separators in FormatNumberAsText; 0xf3 TrimAll ( t ; 0 ; 0 ).
  0xec: 'NumToJText', 0xf3: 'TrimAll',
};

const TWO_BYTE: Record<number, string> = {
  0xf800: 'While', 0xf901: 'GetLayoutObjectAttribute', 0xf902: 'ExecuteSQL', 0xf903: 'Base64Decode', 0xf905: 'SortValues',
  0xf906: 'UniqueValues', 0xf907: 'JSONSetElement',
  // 0xf908 HexDecode of a hex GIF (fmIDE's _ColorImageRGB); 0xf910 GetRecordIDsFromFoundSet ( 0 ) as a
  // return-delimited list for FilterValues (Beezwax MultiSelect).
  0xf908: 'HexDecode', 0xf910: 'GetRecordIDsFromFoundSet',
  0xfa00: 'Self', 0xfa01: 'JSONString', 0xfa02: 'JSONNumber', 0xfa03: 'JSONObject', 0xfa04: 'JSONArray',
  0xfa05: 'JSONBoolean', 0xfa06: 'JSONNull', 0xfa07: 'JSONRaw',
  // Path formats: WinPath when Get ( SystemPlatform ) = -2, else PosixPath (a private sample); URLPath between them.
  0xfa08: 'PosixPath', 0xfa09: 'URLPath', 0xfa0a: 'WinPath', 0xfb00: 'GetAsURLEncoded', 0xfb01: 'GetFieldName', 0xfb02: 'Code',
  0xfb03: 'Char', 0xfb07: 'Base64Encode', 0xfb09: 'JSONFormatElements', 0xfc00: 'GetContainerAttribute', 0xfc01: 'JSONGetElement',
  0xfc02: 'JSONDeleteElement', 0xfc03: 'JSONListKeys', 0xfc04: 'JSONListValues', 0xfc05: 'CryptDigest', 0xfc06: 'Base64EncodeRFC',
  0xfc0c: 'ConvertFromFileMakerPath', 0xfc0d: 'ConvertToFileMakerPath', 0xfc0e: 'JSONGetElementType', 0xfd00: 'GetThumbnail', 0xfd02: 'TextEncode',
  // 0xfc12 GetTableDDL ( table list ; True ) builds agentic-fm's ~ddl variable for a model's prompt;
  // 0xfc07 TextDecode ( $bytes ; "utf-8" ) turns bytes into text (fmIDE).
  0xfc07: 'TextDecode', 0xfc12: 'GetTableDDL',
  // FileMaker 2024 AI (Beezwax's public semantic search demos): CosineSimilarity ( embedding ; GLOBAL::semantic_input_embedding )
  // in a calculation field, GetEmbedding ( account ; model ; text ) in Set Field.
  0xfc10: 'CosineSimilarity', 0xfd04: 'GetEmbedding',
};

/** FileMaker's built-in function names decoded so far (operators and constants left out). */
export const FILEMAKER_FUNCTIONS: readonly string[] = [...Object.values(ONE_BYTE), ...Object.values(TWO_BYTE)]
  .filter((n) => /^[A-Z][A-Za-z0-9]*$/.test(n) && n !== 'True' && n !== 'False');
const FUNCTION_NAMES = new Set(FILEMAKER_FUNCTIONS);

// Get ( ) parameters; most were read off solutions that list them by name. 0x2d
// SystemAppearance is inferred from a private sample's custom function.
const GET_PARAMS: Record<number, string> = {
  0x01: 'ApplicationVersion', 0x02: 'CurrentDate', 0x03: 'LastError', 0x04: 'ActiveFieldName', 0x05: 'FileName', 0x06: 'FileSize',
  0x07: 'FoundCount', 0x08: 'HostName', 0x0a: 'LayoutName', 0x0b: 'LayoutNumber', 0x0d: 'WindowMode', 0x0e: 'MultiUserState',
  // Inferred from layout symbols: {{1015}} alone in report footers is the page number; {{1024}} X {{1025}} labelled "Screen WxH".
  0x0f: 'PageNumber', 0x18: 'ScreenWidth', 0x19: 'ScreenHeight',
  0x10: 'SystemPlatform', 0x11: 'ActivePortalRowNumber', 0x13: 'TotalRecordCount', 0x14: 'RecordNumber', 0x15: 'ActiveRepetitionNumber', 0x1a: 'ScriptName', 0x1b: 'SortState',
  0x1c: 'SystemVersion', 0x1d: 'CurrentTime', 0x1e: 'UserCount', 0x1f: 'UserName', 0x20: 'AccountName', 0x21: 'LastMessageChoice',
  0x23: 'TriggerModifierKeys', 0x24: 'NetworkProtocol', 0x25: 'RecordID', 0x26: 'RecordModificationCount', 0x27: 'ActiveFieldContents', 0x28: 'FilePath', 0x29: 'LastODBCError',
  0x2a: 'LayoutAccess', 0x2b: 'RecordAccess', 0x2d: 'SystemAppearance', 0x2e: 'StatusAreaState', 0x2f: 'LayoutViewState',
  0x30: 'WindowName', 0x31: 'WindowHeight', 0x32: 'WindowLeft', 0x33: 'WindowTop', 0x34: 'WindowVisible', 0x35: 'WindowWidth',
  0x37: 'SystemIPAddress', 0x38: 'ActiveFieldTableName', 0x39: 'ActiveSelectionSize', 0x3a: 'ActiveSelectionStart', 0x3b: 'ApplicationLanguage',
  0x3c: 'CurrentHostTimestamp', 0x3d: 'LayoutTableName', 0x3e: 'ScriptParameter', 0x3f: 'CurrentTimestamp',
  0x40: 'WindowDesktopHeight', 0x41: 'WindowDesktopWidth', 0x42: 'WindowContentHeight', 0x43: 'WindowContentWidth', 0x44: 'CalculationRepetitionNumber', 0x46: 'AllowAbortState',
  0x47: 'ErrorCaptureState', 0x48: 'DesktopPath', 0x49: 'DocumentsPath', 0x4b: 'HostIPAddress', 0x4e: 'RecordOpenCount', 0x4f: 'RecordOpenState', 0x50: 'ScriptResult',
  0x51: 'SystemDrive', 0x52: 'TextRulerVisible', 0x53: 'AllowFormattingBarState', 0x55: 'WindowZoomLevel', 0x56: 'CustomMenuSetName',
  0x58: 'ActiveLayoutObjectName', 0x59: 'TemporaryPath', 0x5a: 'HostApplicationVersion', 0x5b: 'ActiveModifierKeys', 0x5c: 'TriggerKeystroke', 0x5e: 'AccountPrivilegeSetName',
  0x5f: 'AccountExtendedPrivileges', 0x60: 'QuickFindText', 0x62: 'TriggerTargetPanel', 0x63: 'WindowStyle', 0x64: 'InstalledFMPlugins', 0x65: 'UUID', 0x66: 'PersistentID', 0x67: 'ConnectionState',
  0x68: 'CurrentTimeUTCMilliseconds', 0x69: 'Device', 0x6e: 'ModifiedFields', 0x7a: 'UUIDNumber',
};

/** A Get ( ) parameter's name from its id (layout symbols store 1000 + this id). */
export function getParameterName(id: number): string | undefined {
  return GET_PARAMS[id];
}

const EXTERNAL: Record<string, string> = {
  // Design functions, matched by their arguments and how results are used.
  'FMDR:1': 'DatabaseNames', 'FMDR:7': 'FieldType', 'FMDR:8': 'FieldComment', 'FMDR:18': 'ValueListItems',
  'FMDR:19': 'WindowNames', 'FMDR:21': 'LayoutObjectNames',
  // MonkeyBread MBS ( "Function.Name" ; ... ).
  'MBSP:1': 'MBS',
  // BaseElements, matched from Todd Geist's json* custom functions: BE_Version is compared
  // with "?" to see whether the plug-in is there; BE_JSONPath ( json ; "$" ) normalizes JSON.
  'GyBE:102': 'BE_Version', 'GyBE:300': 'BE_JSONPath', 'GyBE:301': 'BE_JSON_Error_Description',
  'GyBE:303': 'BE_JSON_Encode', 'GyBE:600': 'BE_EvaluateJavaScript',
  // From custom functions and scripts of private samples (the arguments
  // and their use fix them): clipboard formats and text, read and write a text file, choose
  // a folder, FileMaker SQL ( sql ; column sep ; row sep ; file ), run a shell command.
  'GyBE:104': 'BE_ClipboardFormats', 'GyBE:105': 'BE_ClipboardGetText', 'GyBE:106': 'BE_ClipboardSetText',
  'GyBE:110': 'BE_FileReadText', 'GyBE:111': 'BE_FileWriteText', 'GyBE:113': 'BE_SelectFolder',
  'GyBE:151': 'BE_FileMakerSQL', 'GyBE:1120': 'BE_ExecuteSystemCommand',
  // Every other BaseElements function, from the plug-in's own name table (Resources/en.lproj/Localizable.strings
  // in GoyaPtyLtd/BaseElements-Plugin): the id is the function index FileMaker stores.
  'GyBE:103': 'BE_VersionAutoUpdate', 'GyBE:107': 'BE_FolderCreate', 'GyBE:108': 'BE_FileDelete',
  'GyBE:109': 'BE_FileExists', 'GyBE:112': 'BE_FileSelectDialog', 'GyBE:114': 'BE_DialogDisplay',
  'GyBE:115': 'BE_XSLT_Apply', 'GyBE:116': 'BE_TextExtractWords', 'GyBE:117': 'BE_XMLStripInvalidCharacters',
  'GyBE:118': 'BE_FileMove', 'GyBE:119': 'BE_FileCopy', 'GyBE:121': 'BE_FileListFolder', 'GyBE:124': 'BE_OpenURL',
  'GyBE:125': 'BE_FileOpen', 'GyBE:126': 'BE_FileSize', 'GyBE:127': 'BE_FileModificationTimestamp',
  'GyBE:134': 'BE_DebugInformation', 'GyBE:135': 'BE_ClipboardGetFile', 'GyBE:136': 'BE_ClipboardSetFile',
  'GyBE:137': 'BE_GetSystemDrive', 'GyBE:141': 'BE_VersionPro', 'GyBE:150': 'BE_ScriptExecute',
  'GyBE:152': 'BE_HTTP_GET', 'GyBE:153': 'BE_GetLastError', 'GyBE:154': 'BE_MessageDigest',
  'GyBE:155': 'BE_GetLastDDLError', 'GyBE:156': 'BE_HTTP_GETFile', 'GyBE:157': 'BE_DialogProgress',
  'GyBE:158': 'BE_DialogProgressUpdate', 'GyBE:159': 'BE_Pause', 'GyBE:160': 'BE_PreferenceSet',
  'GyBE:161': 'BE_PreferenceGet', 'GyBE:162': 'BE_PreferenceDelete', 'GyBE:169': 'BE_Unzip',
  'GyBE:170': 'BE_Unzip_Deprecated', 'GyBE:171': 'BE_Zip', 'GyBE:174': 'BE_SetTextEncoding',
  'GyBE:176': 'BE_ExportFieldContents', 'GyBE:177': 'BE_FileImport', 'GyBE:178': 'BE_FilePatternCount',
  'GyBE:179': 'BE_FileReplaceText', 'GyBE:180': 'BE_HTTP_POST', 'GyBE:181': 'BE_HTTP_ResponseCode',
  'GyBE:182': 'BE_HTTP_ResponseHeaders', 'GyBE:183': 'BE_HTTP_SetCustomHeader', 'GyBE:184': 'BE_HTTP_DELETE',
  'GyBE:185': 'BE_HTTP_PUTFile', 'GyBE:186': 'BE_HTTP_SetProxy', 'GyBE:187': 'BE_CurlSetOption',
  'GyBE:188': 'BE_HTTP_PUTData', 'GyBE:189': 'BE_FTP_Upload', 'GyBE:190': 'BE_CurlTrace',
  'GyBE:191': 'BE_FTP_Delete', 'GyBE:192': 'BE_HTTP_PATCH', 'GyBE:193': 'BE_FTP_UploadFile',
  'GyBE:194': 'BE_CurlGetInfo', 'GyBE:195': 'BE_BackgroundTaskAdd', 'GyBE:196': 'BE_BackgroundTaskList',
  'GyBE:200': 'BE_XSLT_ApplyInMemory', 'GyBE:201': 'BE_XPath', 'GyBE:202': 'BE_XPathAll',
  'GyBE:210': 'BE_XMLStripNodes', 'GyBE:211': 'BE_XMLParse', 'GyBE:212': 'BE_SplitBEFileNodes',
  'GyBE:213': 'BE_XMLValidate', 'GyBE:214': 'BE_XMLCanonical', 'GyBE:215': 'BE_XMLTidy',
  'GyBE:220': 'BE_TimeCurrentMilliseconds', 'GyBE:221': 'BE_TimeUTCMilliseconds', 'GyBE:222': 'BE_TimeZoneOffset',
  'GyBE:230': 'BE_FileSaveDialog', 'GyBE:240': 'BE_RegularExpression', 'GyBE:250': 'BE_ContainerIsCompressed',
  'GyBE:251': 'BE_ContainerCompress', 'GyBE:252': 'BE_ContainerUncompress', 'GyBE:253': 'BE_ContainerListTypes',
  'GyBE:254': 'BE_ContainerGetType', 'GyBE:260': 'BE_Gzip', 'GyBE:261': 'BE_UnGzip', 'GyBE:271': 'BE_JPEGRecompress',
  'GyBE:272': 'BE_ContainerConvertImage', 'GyBE:302': 'BE_JSON_ArraySize', 'GyBE:304': 'BE_JSON_jq',
  'GyBE:350': 'BE_ValuesUnique', 'GyBE:351': 'BE_ValuesFilterOut', 'GyBE:352': 'BE_ValuesContainsDuplicates',
  'GyBE:353': 'BE_ValuesSort', 'GyBE:354': 'BE_ValuesTimesDuplicated', 'GyBE:355': 'BE_ValuesTrim',
  'GyBE:400': 'BE_SMTPServer', 'GyBE:401': 'BE_SMTPSend', 'GyBE:402': 'BE_SMTPAddAttachment',
  'GyBE:403': 'BE_SMTPSetHeader', 'GyBE:470': 'BE_VariableSet', 'GyBE:471': 'BE_VariableGet',
  'GyBE:472': 'BE_StackPush', 'GyBE:473': 'BE_StackPop', 'GyBE:474': 'BE_StackCount', 'GyBE:475': 'BE_StackDelete',
  'GyBE:500': 'BE_EncryptAES', 'GyBE:501': 'BE_DecryptAES', 'GyBE:502': 'BE_SignatureGenerateRSA',
  'GyBE:503': 'BE_SignatureVerifyRSA', 'GyBE:504': 'BE_CipherEncrypt', 'GyBE:505': 'BE_CipherDecrypt',
  'GyBE:506': 'BE_EncryptWithKey', 'GyBE:507': 'BE_DecryptWithKey', 'GyBE:508': 'BE_CreateKeyPair',
  'GyBE:509': 'BE_GetPublicKey', 'GyBE:540': 'BE_Notification', 'GyBE:650': 'BE_ArraySetFromValueList',
  'GyBE:651': 'BE_ArrayGetSize', 'GyBE:652': 'BE_ArrayGetValue', 'GyBE:653': 'BE_ArrayDelete',
  'GyBE:654': 'BE_ArrayFind', 'GyBE:655': 'BE_ArrayChangeValue', 'GyBE:700': 'BE_ConvertContainer',
  'GyBE:750': 'BE_PDFAppend', 'GyBE:751': 'BE_PDFPageCount', 'GyBE:752': 'BE_PDFGetPages', 'GyBE:800': 'BE_XOR',
  'GyBE:850': 'BE_ScriptStepInstall', 'GyBE:851': 'BE_ScriptStepRemove', 'GyBE:852': 'BE_ScriptStepPerform',
  'GyBE:900': 'BE_VectorDotProduct', 'GyBE:901': 'BE_VectorEuclideanDistance', 'GyBE:950': 'BE_GetMachineName',
  'GyBE:1001': 'BE_ButtonOK', 'GyBE:1002': 'BE_ButtonCancel', 'GyBE:1003': 'BE_ButtonAlternate',
  'GyBE:2001': 'BE_MessageDigestAlgorithmMD5', 'GyBE:2002': 'BE_MessageDigestAlgorithmSHA256',
  'GyBE:2004': 'BE_MessageDigestAlgorithmMDC2', 'GyBE:2006': 'BE_MessageDigestAlgorithmSHA',
  'GyBE:2007': 'BE_MessageDigestAlgorithmSHA1', 'GyBE:2008': 'BE_MessageDigestAlgorithmSHA224',
  'GyBE:2009': 'BE_MessageDigestAlgorithmSHA384', 'GyBE:2010': 'BE_MessageDigestAlgorithmSHA512',
  'GyBE:3000': 'BE_FileTypeAll', 'GyBE:3001': 'BE_FileTypeFile', 'GyBE:3002': 'BE_FileTypeFolder',
  'GyBE:4001': 'BE_EncodingHex', 'GyBE:4002': 'BE_EncodingBase64', 'GyBE:5000': 'BE_ScriptControlHalt',
  'GyBE:5001': 'BE_ScriptControlExit', 'GyBE:5002': 'BE_ScriptControlResume', 'GyBE:5003': 'BE_ScriptControlPause',
  // DataGuard (WorldSync): a private sample's delete-logging script has a commented-out copy
  // of the same call written as DataGuard_PostDelete with the same six arguments.
  'AUDI:3': 'DataGuard_PostDelete',
  // fmIDE's Quick Link lists "$base_table_name" with 23 and "$base_table_id" with 22 beside TableNames and TableIDs.
  'FMDR:22': 'BaseTableIDs', 'FMDR:23': 'BaseTableNames',
  'FMDR:3': 'FieldIDs', 'FMDR:4': 'FieldNames', 'FMDR:9': 'LayoutIDs', 'FMDR:10': 'LayoutNames', 'FMDR:11': 'TableIDs',
  'FMDR:12': 'TableNames', 'FMDR:14': 'ScriptIDs', 'FMDR:15': 'ScriptNames', 'FMDR:16': 'ValueListIDs', 'FMDR:17': 'ValueListNames',
  // 360Works Email, from a private sample's mail scripts against the plug-in's documented
  // signatures: register ( key ; name ), version compared with 1.61, "ERROR" then the last
  // error, connect ( host ; user ; password ; "ssl=" ) for the inbound server, read messages
  // ( "mailbox=" ; "max=" ; ... ), next message as a loop's exit, message values ( "from" ),
  // list mailboxes ( "" ; True ), disconnect in "Close ... Connection", and a validation check.
  '3MLR:19905': 'EmailRegister', '3MLR:46524': 'EmailVersion', '3MLR:9357': 'EmailLastError',
  '3MLR:10659': 'EmailConnectIMAP', '3MLR:57698': 'EmailReadMessages', '3MLR:2810': 'EmailGetNextMessage',
  '3MLR:19972': 'EmailReadMessageValue', '3MLR:10424': 'EmailListMailboxes', '3MLR:25912': 'EmailDisconnect',
  '3MLR:17942': 'IsValidEmail',
};

/** Plug-in owners seen in FileMaker files; a function name is not implied by an owner id. */
export const PLUGIN_OWNERS: readonly string[] = ['PCCC', 'sSSw', 'FMAU', 'SCBE', 'EeID', '24FT', 'FMMB'];

/** Plug-in function names the decoder knows (FileMaker's own design functions left out). */
export const PLUGIN_FUNCTIONS: readonly string[] = Object.entries(EXTERNAL).filter(([k]) => !k.startsWith('FMDR:')).map(([, v]) => v);

const PUNCTUATION: Record<number, string> = { 0x03: ';', 0x04: '(', 0x05: ')', 0x06: '[', 0x07: ']' };

/** Resolves a field reference to text, e.g. "Field" or "TO::Field". */
export type FieldNamer = (tableOccurrenceId: number | undefined, fieldId: number | undefined, qualified: boolean) => string;

interface NamingSchema {
  tables: { id: number; fields: { id: number; name: string }[] }[];
  tableOccurrences: { id: number; name: string; baseTableId?: number; dataSourceId?: number }[];
}

/**
 * Field names the way FileMaker shows them, including its "<Field Missing>"
 * markers. A field of a table in another file can't be named from this file
 * alone, so it reads `⟨field:TO id.field id⟩` (the whole `TO::Field`), for a
 * host that has the other file to resolve (see `externalFieldNames`).
 */
export function schemaFieldNamer(schema: NamingSchema): FieldNamer {
  const occurrences = new Map(schema.tableOccurrences.map((to) => [to.id, to]));
  const tables = new Map(schema.tables.map((table) => [table.id, new Map(table.fields.map((field) => [field.id, field.name]))]));
  return (toId, fieldId, qualified) => {
    const to = occurrences.get(toId ?? -1);
    if (to?.dataSourceId && qualified) return `⟨field:${to.id}.${fieldId}⟩`;
    const name = tables.get(to?.baseTableId ?? -1)?.get(fieldId ?? -1) ?? '<Field Missing>';
    if (!qualified) return name;
    return `${to?.name ?? '<Table Missing>'}::${name}`;
  };
}

const EXTERNAL_FIELD = /⟨field:(\d+)\.(\d+)⟩/g;

/** Replaces `⟨field:TO.field⟩` markers with `TO::Field`, given a way to name a field of another file. */
export function externalFieldNames(
  formula: string,
  name: (tableOccurrenceId: number, fieldId: number) => string | undefined,
): string {
  return formula.includes('⟨field:') ? formula.replace(EXTERNAL_FIELD, (m, to, field) => name(Number(to), Number(field)) ?? m) : formula;
}

export interface CalcDecodeResult {
  text: string;
  /** Token ids not in the tables yet; their text is a placeholder. */
  unknown: string[];
}

const hex = (n: number, w = 2) => n.toString(16).padStart(w, '0');

/** Number literal: limbs of 9 decimal digits, integer limbs then two fraction limbs. */
function decodeNumber(b: Uint8Array, at: number): { text: string; end: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const intLimbs = v.getUint16(at + 1);
  let p = at + 5;
  let int = '';
  for (let i = 0; i < intLimbs; i++, p += 4) int += i === 0 ? String(v.getUint32(p)) : String(v.getUint32(p)).padStart(9, '0');
  let frac = '';
  for (let i = 0; i < 2; i++, p += 4) frac += String(v.getUint32(p)).padStart(9, '0');
  frac = frac.replace(/0+$/, '');
  const neg = b[at] === 0x01 || b[at] === 0x03; // inferred; source literals are non-negative
  return { text: (neg ? '-' : '') + (int.replace(/^0+(?=\d)/, '') || '0') + (frac ? '.' + frac : ''), end: p + 2 };
}

/** The token stream of a calculation node: key 5, inline or as a long value. */
export function calcTokens(n: { kv: Map<number, Uint8Array>; segments: Map<number, Uint8Array>; child(...p: number[]): { longBytes(): Uint8Array | undefined } | undefined } | undefined): Uint8Array | undefined {
  return n && (n.kv.get(5) ?? n.segments.get(5) ?? n.child(5)?.longBytes());
}

/**
 * What a decode meets, for counting across many files (tabularius corpus-scan):
 * `token` for each function, Get ( ) option, plug-in call ("OWNR:index") and
 * custom function call; `formula` once per decoded formula.
 */
export interface CalcObserver {
  /** A plug-in call's id is "OWNR:index", with its name when the decoder knows it. */
  token(kind: 'function' | 'get' | 'plugin' | 'custom' | 'unknown-function' | 'unknown-get', id: string, name?: string): void;
  /** Each decoded formula: its text, and its shape (names, strings, comments and long numbers masked). */
  formula?(text: string, shape: string): void;
}

let observer: CalcObserver | undefined;

/** Runs body with every decodeCalc inside it reported to o. */
export function observeCalcs<T>(o: CalcObserver, body: () => T): T {
  const prev = observer;
  observer = o;
  try {
    return body();
  } finally {
    observer = prev;
  }
}

export function decodeCalc(
  b: Uint8Array,
  nameField: FieldNamer = (_t, f) => `⟨field:${f}⟩`,
  nameFunction: (customFunctionId: number) => string = (id) => `⟨cf:${id}⟩`,
): CalcDecodeResult {
  let out = '';
  const unknown: string[] = [];
  let i = 0;
  // The formula with every name, string, comment and long number masked, for observer.formula.
  const shaping = !!observer?.formula;
  let shape = '';
  // 13, length in characters (one byte, or two with the top bit set), SCSU text, 00.
  const literal = (at: number): { text: string; end: number } => {
    if (b[at] !== 0x13) throw new Error(`expected literal at ${at}`);
    let p = at + 1;
    let n = b[p++];
    if (n & 0x80) n = ((n & 0x7f) << 8) | b[p++];
    const { text, end } = decodeTextChars(b.subarray(p), n);
    return { text, end: p + end + 1 };
  };
  while (i < b.length) {
    const c = b[i];
    const from = out.length;
    let masked: string | undefined;
    if (c === 0x0c || c === 0x0d || c === 0x0e) {
      const { text, end } = literal(i + 1);
      out += c === 0x0e ? '//' + text : c === 0x0d ? `/*${text}*/` : text;
      masked = ' ';
      i = end;
    } else if (c === 0x13) {
      const { text, end } = literal(i);
      // Inside quotes FileMaker shows a return as ¶ and escapes \ " ¶. U+E004
      // evaluates as a space: a private sample stores "<html>" + U+E004 + 3 spaces
      // as "<html>" + 4 spaces, and splits SQL clauses with it.
      out += '"' + text.replace(/[\\"¶]/g, '\\$&').replace(/\n/g, '¶').replace(/\uE004/g, ' ') + '"';
      if (shaping && (text.length > 3 || /\p{L}|\p{N}/u.test(text))) masked = '"…"';
      i = end;
    } else if (c === 0x1a || c === 0x0b) {
      const { text, end } = decodeTextChars(b.subarray(i + 2), b[i + 1]);
      out += text;
      masked = c === 0x0b ? '«var»' : text.startsWith('$$') ? '$$var' : text.startsWith('$') ? '$var' : '«var»';
      i += 2 + end + (c === 0x0b ? 2 : 0);
    } else if (c === 0x10) {
      const { text, end } = decodeNumber(b, i + 1);
      out += text;
      if (/\d{5}/.test(text)) masked = '‹number›';
      i = end;
    } else if (c === 0x16) {
      const flags = b[i + 1];
      let j = i + 2;
      let to: number | undefined;
      let field: number | undefined;
      // Tagged refs: 04 = table occurrence, 02 or 03 = field (03 meaning unknown).
      while (b[j] === 0x02 || b[j] === 0x03 || b[j] === 0x04) {
        const n = b[j + 1];
        const value = pathValue(b.subarray(j + 2, j + 2 + n));
        if (b[j] === 0x04) to = value;
        else field = value;
        j += 2 + n;
      }
      out += nameField(to, field, (flags & 0x04) !== 0);
      masked = '«field»';
      i = j + 2; // repetition (u16); written separately as [n] when not 1
    } else if (c === 0x1d) {
      // External function: 1D 00 00 15, 4-byte owner id, u16 function index. "FMDR" owns
      // the design functions (LayoutIDs = 9); others belong to plug-ins.
      const owner = String.fromCharCode(...b.subarray(i + 4, i + 8));
      const index = (b[i + 8] << 8) | b[i + 9];
      const name = EXTERNAL[`${owner}:${index}`];
      if (!name) unknown.push(`${owner}:${index}`);
      if (owner === 'FMDR') observer?.token(name ? 'function' : 'unknown-function', name ?? `${owner}:${index}`);
      else observer?.token('plugin', `${owner}:${index}`, name);
      out += name ?? (PLUGIN_OWNERS.includes(owner) ? `<plugin:${owner}:${index}>` : `⟨${owner}:${index}⟩`);
      i += 10;
    } else if (c === 0x1b && b[i + 1] === 0x14) {
      // Custom function call: 1B 14 len, then a length-prefixed id.
      const n = b[i + 3];
      out += nameFunction(pathValue(b.subarray(i + 4, i + 4 + n)) ?? -1);
      observer?.token('custom', '');
      masked = '«cf»';
      i += 3 + b[i + 2];
    } else if (PUNCTUATION[c]) {
      out += PUNCTUATION[c];
      i++;
    } else if (c === 0x9c) {
      out += GET_PARAMS[b[i + 1]] ?? (unknown.push(`9c${hex(b[i + 1])}`), `⟨get:${hex(b[i + 1])}⟩`);
      observer?.token(GET_PARAMS[b[i + 1]] ? 'get' : 'unknown-get', GET_PARAMS[b[i + 1]] ?? hex(b[i + 1]));
      i += 2;
    } else if (c >= 0xf8 && c <= 0xfd) {
      const id = (c << 8) | b[i + 1];
      out += TWO_BYTE[id] ?? (unknown.push(hex(id, 4)), `⟨fn:${hex(id, 4)}⟩`);
      observer?.token(TWO_BYTE[id] ? 'function' : 'unknown-function', TWO_BYTE[id] ?? hex(id, 4));
      i += 2;
    } else {
      out += ONE_BYTE[c] ?? (unknown.push(hex(c)), `⟨fn:${hex(c)}⟩`);
      if (observer && (!ONE_BYTE[c] || FUNCTION_NAMES.has(ONE_BYTE[c]))) observer.token(ONE_BYTE[c] ? 'function' : 'unknown-function', ONE_BYTE[c] ?? hex(c));
      i++;
    }
    if (shaping) shape += masked ?? out.slice(from);
  }
  observer?.formula?.(out, shape.replace(/\s+/g, ' ').trim());
  return { text: out, unknown };
}
