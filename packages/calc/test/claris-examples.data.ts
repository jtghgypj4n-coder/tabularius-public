// Compact Claris FileMaker Pro Help worked examples already present in the main test suite.
// Each function page is cited directly; expressions and results are kept as short test data.
import { INVENTORY } from './function-inventory.data.ts';
export const PAGE = (fn: string) => INVENTORY.find(({ name }) => name.toLowerCase() === fn.toLowerCase())?.pageUrl
  ?? `https://help.claris.com/en/pro-help/content/${fn.toLowerCase()}.html`;
export const CASES: Record<string, [string, string][]> = {
  position: [
    ["Position ( \"Mississippi\" ; \"iss\" ; 1 ; 1 )", "2"],
    ["Position ( \"Mississippi\" ; \"iss\" ; 1 ; 2 )", "5"],
    ["Position ( \"Mississippi\" ; \"iss\" ; 3 ; 1 )", "5"],
    ["Position ( \"William Smith\" ; \" \" ; Length ( \"William Smith\" ) ; -1 )", "8"],
    ["Position ( \"abc\" ; \"b\" ; 1 ; 0 )", "0"],
    ["Position ( \"ABC\" ; \"b\" ; 1 ; 1 )", "2"],
  ],
  patterncount: [
    ["PatternCount ( \"Mississippi\" ; \"is\" )", "2"],
    ["PatternCount ( \"Mississippi\" ; \"issi\" )", "1"],
    ["PatternCount ( \"aaaa\" ; \"aa\" )", "2"],
    ["PatternCount ( \"ABC\" ; \"b\" )", "1"],
  ],
  factorial: [
    ["Factorial ( 3 )", "6"],
    ["Factorial ( 10 ; 3 )", "720"],
  ],
  combination: [
    ["Combination ( 5 ; 2 )", "10"],
  ],
  proper: [
    ["Proper ( \"ABCD\" )", "Abcd"],
  ],
  getasnumber: [
    ["GetAsNumber ( \"FY20\" )", "20"],
    ["GetAsNumber ( \"$1,254.50\" )", "1254.5"],
    ["GetAsNumber ( \"2 - 2\" )", "22"],
    ["GetAsNumber ( \"2(2)\" )", "22"],
    ["GetAsNumber ( \"-22\" )", "-22"],
    ["GetAsNumber ( \"(22)\" )", "-22"],
    ["GetAsNumber ( \".(22)\" )", "0.22"],
    ["GetAsNumber ( \"TKV35FRG6HH84\" )", "35684"],
    ["GetAsNumber ( Date ( 10 ; 10 ; 2019 ) )", "737342"],
    ["GetAsNumber ( \"QTjPLeRMaCV\" )", ""],
  ],
  getasboolean: [
    ["GetAsBoolean ( \"\" )", "0"],
    ["GetAsBoolean ( \"Some text here.\" )", "0"],
    ["GetAsBoolean ( 1/0 )", "1"],
  ],
  quote: [
    ["Quote ( \"hello\" )", "\"hello\""],
    ["Quote ( \"say \\\"hello\\\" fred\" )", "\"say \\\"hello\\\" fred\""],
    ["Evaluate ( Quote ( \"1 + 2\" ) )", "1 + 2"],
    ["Evaluate ( \"1 + 2&\" & Quote ( \" - 1 + 2\" ) )", "3 - 1 + 2"],
  ],
  code: [
    ["Code ( \"\" )", ""],
    ["Code ( \"a\" )", "97"],
    ["Code ( \"ab\" )", "9800097"],
    ["Code ( \"ä\" )", "228"],
  ],
  round: [
    ["Round ( 123.456 ; 2 )", "123.46"],
    ["Round ( 14.5 ; 0 )", "15"],
    ["Round ( 14.5 ; 2 )", "14.5"],
    ["Round ( 29343.98 ; -3 )", "29000"],
    ["Round ( 123.456 ; -1 )", "120"],
    ["Round ( 0.5 ; 0 )", "1"],
  ],
  truncate: [
    ["Truncate ( 123.456 ; 2 )", "123.45"],
    ["Truncate ( -14.6 ; 0 )", "-14"],
    ["Truncate ( 29343.98 ; -3 )", "29000"],
    ["Truncate ( 123.456 ; 4 )", "123.456"],
    ["Truncate ( 29343.98 ; 5 )", "29343.98"],
  ],
  mod: [
    ["Mod ( 210 ; 4 )", "2"],
    ["Mod ( 16 ; 12 )", "4"],
  ],
  int: [
    ["Int ( 1.45 )", "1"],
    ["Int ( -3.9 )", "-3"],
    ["Int ( 123.9 )", "123"],
    ["Int ( 13/3 )", "4"],
  ],
  trimall: [
    ["TrimAll ( \" Julian Scott Dunn \" ; 0 ; 0 )", "Julian Scott Dunn"],
  ],
  substitute: [
    ["Substitute ( \"Aaa\" ; \"a\" ; \"b\" )", "Abb"],
  ],
  weekofyear: [
    ["WeekOfYear ( \"1/1/2019\" )", "1"],
    ["WeekOfYear ( \"2/2/2019\" )", "5"],
    ["WeekOfYear ( \"1/1/2019\" ) - WeekOfYear ( \"2/2/2019\" )", "-4"],
  ],
  weekofyearfiscal: [
    ["WeekOfYearFiscal ( Date ( 1 ; 7 ; 2008 ) ; 1 )", "2"],
    ["WeekOfYearFiscal ( Date ( 1 ; 1 ; 2009 ) ; 5 )", "1"],
    ["WeekOfYearFiscal ( Date ( 1 ; 2 ; 2009 ) ; 1 )", "53"],
  ],
  base64encode: [["Base64Encode ( \"hello\" )", "aGVsbG8="]],
  jsongetelement: [["JSONGetElement ( \"{ \\\"a\\\" : 11 }\" ; \"a\" )", "11"]],
  average: [["Average ( 1 ; 2 ; 3 )", "2"]],
  degrees: [["Degrees ( Pi / 4 )", "45"]],
  katakana: [["Katakana ( \"ひらがな\" )", "ヒラガナ"]],
  hour: [["Hour ( Time ( 14 ; 30 ; 0 ) )", "14"]],
  fv: [["FV ( 100 ; 0 ; 10 )", "1000"]],
  rgb: [["RGB ( 255 ; 0 ; 0 )", "16711680"]],
  timestamp: [["Timestamp ( Date ( 10 ; 21 ; 2019 ) ; Time ( 9 ; 10 ; 30 ) )", "10/21/2019 9:10:30"]],
  converttofilemakerpath: [["ConvertToFileMakerPath ( \"fmp://fmhost.example.com/My%20Clients.fmp12\" ; URLPath )", "fmnet:/fmhost.example.com/My Clients.fmp12"]],
};

// These Claris examples depend on FileMaker-only runtime state that this calculation context does not provide.
// Keep them visible and cited as unverified instead of predicting an engine value.
export const KNOWN_UNVERIFIED = [
  { status: 'unverified', function: 'Get(AccountExtendedPrivileges)', expression: 'Get ( AccountExtendedPrivileges )', result: 'fmwebdirect', pageUrl: 'https://help.claris.com/en/pro-help/content/get-accountextendedprivileges.html' },
  { status: 'unverified', function: 'Last', expression: 'Last ( ParcelBids )', result: '1500', pageUrl: 'https://help.claris.com/en/pro-help/content/last.html' },
  { status: 'unverified', function: 'CosineSimilarity', expression: 'CosineSimilarity ( "[-0.043686170000000003333, 0.042094484000000001456, ... ]" ; "[-0.049242082999999998993, 0.040926795000000001923, ... ]" )', result: '.90848158767415143622', pageUrl: 'https://help.claris.com/en/pro-help/content/cosinesimilarity.html' },
  { status: 'unverified', function: 'Location', expression: 'Location ( 100 ; 40 )', result: '+37.343123, -122.017593, +65.000000', pageUrl: 'https://help.claris.com/en/pro-help/content/location.html' },
];
