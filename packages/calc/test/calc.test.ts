import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluate, evaluateText, NameTable, num, text, CalcError, type CalcContext } from '../src/index.ts';

test('owner-only plug-in ids return ? without crashing', () => {
  const formula = '<plugin:PCCC:17> ( 1 )';
  assert.equal(evaluateText(formula), '?');
  assert.equal(evaluate(`EvaluationError ( ${formula} )`).value, 0);
});

const fields: Record<string, ReturnType<typeof text>> = { 'First Name': text('ada'), Last: text('lovelace'), Qty: num(3) };
const ctx: CalcContext = {
  names: new NameTable({ fields: Object.keys(fields), occurrences: [['Line Items', ['Amount', 'Unit Price']]] }),
  occurrence: 'Invoices',
  field: (r) => (r.occurrence ? num(5) : fields[r.field]),
  related: () => [num(5), num(7)],
  now: () => new Date(2026, 9, 11, 14, 30, 0),
};
const t = (f: string) => evaluateText(f, ctx);

test('operators and precedence', () => {
  assert.equal(t('1 + 2 * 3'), '7');
  assert.equal(t('1 + 2 & 3'), '33');
  assert.equal(t('-2^2'), '4');
  assert.equal(t('2^3^2'), '64');
  assert.equal(t('0.1 + 0.2'), '0.3');
  assert.equal(t('1/3'), '0.3333333333333333');
  assert.equal(t('not 1 = 2 and 3'), '1');
  assert.equal(t('"x" = "X"'), '1');
  assert.equal(t('1/0'), '?');
  assert.equal(t('/* c */ 1 // x'), '1');
});

test('field names with spaces and related fields', () => {
  assert.equal(t('Proper ( First Name & " " & Last )'), 'Ada Lovelace');
  assert.equal(t('Sum ( Line Items::Amount ) * Qty'), '36');
  assert.equal(t('List ( Line Items::Amount ; "x" )'), '5\r7\rx');
  assert.equal(t('Count ( Line Items::Unit Price )'), '2');
  assert.equal(t('Invoices::Qty + 1'), '4');
  assert.equal(compile('Line Items::Unit Price * Qty', ctx.names).fields.length, 2);
});

test('logic, Let and While', () => {
  assert.equal(t('Let ( [ a = 2 ; b = a * 3 ] ; a + b )'), '8');
  assert.equal(t('Case ( Qty > 5 ; "big" ; Qty > 2 ; "mid" ; "small" )'), 'mid');
  assert.equal(t('If ( 0 ; 1 )'), '');
  assert.equal(t('Choose ( 1 ; "a" ; "b" )'), 'b');
  assert.equal(t('While ( [ i = 0 ; s = 0 ] ; i < 5 ; [ i = i + 1 ; s = s + i ] ; s )'), '15');
  assert.equal(t('EvaluationError ( Evaluate ( "1+" ) )'), '1203');
  assert.equal(t('Evaluate ( "1+1" )'), '2');
});

test('text and values', () => {
  assert.equal(t('Substitute ( "abc" ; [ "a" ; "x" ] ; [ "b" ; "y" ] )'), 'xyc');
  assert.equal(t('Position ( "banana" ; "an" ; 1 ; 2 )'), '4');
  assert.equal(t('Middle ( "hello" ; 2 ; 3 )'), 'ell');
  assert.equal(t('ValueCount ( "a¶b¶" )'), '2');
  assert.equal(t('GetValue ( "a¶b¶c" ; 2 )'), 'b');
  assert.equal(t('LeftValues ( "a¶b¶c" ; 2 )'), 'a\rb\r');
  assert.equal(t('Char ( 9700065 )'), 'Aa');
  assert.equal(t('Code ( "Aa" )'), '9700065');
  assert.equal(t('Quote ( "a\\"b¶c" )'), '"a\\"b\\\rc"'); // Claris: a return is written with a backslash before it
  assert.equal(t('SerialIncrement ( "INV0099" ; 1 )'), 'INV0100');
  assert.equal(t('Filter ( "(555) 123-4567" ; "0123456789" )'), '5551234567');
});

test('numbers', () => {
  assert.equal(t('Round ( 2.345 ; 2 )'), '2.35');
  assert.equal(t('Round ( -2.5 ; 0 )'), '-3');
  assert.equal(t('Truncate ( 2.789 ; 1 )'), '2.7');
  assert.equal(t('Mod ( -7 ; 3 )'), '2');
  assert.equal(t('Int ( -2.7 )'), '-2');
  assert.equal(t('Average ( 1 ; 2 ; 6 )'), '3');
});

test('dates and times', () => {
  assert.equal(t('Date ( 2 ; 29 ; 2024 ) + 1'), '3/1/2024');
  assert.equal(t('GetAsNumber ( Date ( 1 ; 1 ; 2024 ) )'), '738886');
  assert.equal(t('Date ( 3 ; 1 ; 2024 ) - Date ( 2 ; 1 ; 2024 )'), '29');
  assert.equal(t('GetAsText ( Time ( 25 ; 3 ; 4 ) )'), '25:03:04');
  assert.equal(t('Timestamp ( Date ( 1 ; 2 ; 2020 ) ; Time ( 3 ; 4 ; 5 ) )'), '1/2/2020 3:04:05');
  assert.equal(t('DayName ( Date ( 10 ; 11 ; 2026 ) )'), 'Sunday');
  assert.equal(t('Get ( CurrentDate )'), '10/11/2026');
  assert.equal(t('Hour ( Get ( CurrentTime ) )'), '14');
  assert.equal(evaluateText('Date ( 10 ; 11 ; 2026 )', { dateOrder: 'DMY' }), '11/10/2026');
  // Files whose dates have two-digit months and days write them that way as text.
  const padded = { dateOrder: { order: 'MDY', padded: true } } as const;
  assert.equal(evaluateText('"Artwork: " & Date ( 9 ; 5 ; 2026 )', padded), 'Artwork: 09/05/2026');
  assert.equal(evaluateText('Timestamp ( Date ( 1 ; 2 ; 2020 ) ; Time ( 3 ; 4 ; 5 ) )', padded), '01/02/2020 3:04:05');
  assert.equal(evaluateText('Day ( "09/05/2026" )', padded), '5');
});

test('JSON', () => {
  assert.equal(t('JSONSetElement ( "{}" ; [ "b" ; 1 ; JSONNumber ] ; [ "a.c" ; "x" ; JSONString ] )'), '{"a":{"c":"x"},"b":1}');
  assert.equal(t('JSONGetElement ( "{\\"a\\":[1,2,{\\"b\\":\\"q\\"}]}" ; "a[2].b" )'), 'q');
  assert.equal(t('JSONListKeys ( "{\\"b\\":1,\\"a\\":2}" ; "" )'), 'a\rb');
});

test('custom functions and variables', () => {
  const vars = new Map<string, ReturnType<typeof num>>();
  const c: CalcContext = {
    customFunction: (n) => (n === 'Fact' ? { parameters: ['n'], formula: 'If ( n ≤ 1 ; 1 ; n * Fact ( n - 1 ) )' } : undefined),
    variable: (n) => vars.get(n),
    setVariable: (n, _r, v) => void vars.set(n, v as ReturnType<typeof num>),
  };
  assert.equal(evaluateText('Fact ( 5 )', c), '120');
  assert.equal(evaluateText('Let ( $x = 4 ; $x * 2 )', c), '8');
  assert.equal(evaluateText('$x', c), '4');
});

test('errors carry FileMaker codes', () => {
  assert.throws(() => evaluate('Nope ( 1 )'), (e: CalcError) => e.code === 1208);
  assert.throws(() => evaluate('Missing + 1', { field: () => undefined }), (e: CalcError) => e.code === 102);
  assert.throws(() => evaluate('Left ( "a" )'), (e: CalcError) => e.code === 1201);
});

test('Let names hide fields of the same name', () => {
  const names = new NameTable({ fields: ['Result', 'Input'] });
  const c: CalcContext = { names, field: (r) => (r.field === 'Input' ? text('x') : r.field === 'Result' ? text('field') : undefined) };
  assert.equal(evaluateText('Let ( [ result = Input & "!" ; f = result & result ] ; f )', c), 'x!x!');
  assert.deepEqual(compile('Let ( result = Input ; result )', names).fields.map((f) => f.name), ['Input']);
});

test('$variable repetitions given by an expression', () => {
  const vars = new Map<string, ReturnType<typeof text>>();
  const c: CalcContext = {
    variable: (n, r) => vars.get(`${n}[${r}]`),
    setVariable: (n, r, v) => void vars.set(`${n}[${r}]`, v),
  };
  assert.equal(evaluateText('Let ( [ i = 1 + 1 ; $q[i] = 3 ; $q[i] = $q[i] + 1 ] ; $q[1] & "|" & $q[2] )', c), '|4');
  assert.equal(evaluateText('While ( [ i = 0 ] ; i < 3 ; [ i = i + 1 ; $w[i] = i * 10 ] ; $w[3] )', c), '30');
  // CustomList-style: a list built by evaluating text that names $variable repetitions.
  assert.equal(evaluateText('Let ( [ k = 7 ; $n[k] = 0 ; s = Substitute ( "___" ; "_" ; "Let([$n[" & k & "]=$n[" & k & "]+1;x=$n[" & k & "]];x*2)&\\¶&¶" ) ] ; Evaluate ( s & "\\"\\"" ) )', c), '2\r4\r6\r');
});

test('$variable names with spaces', () => {
  const vars = new Map<string, ReturnType<typeof text>>();
  const c: CalcContext = {
    variable: (n, r) => vars.get(`${n}[${r}]`),
    setVariable: (n, r, v) => void vars.set(`${n}[${r}]`, v),
  };
  assert.equal(evaluateText('Let ( $SSL cURL Option = "Require" ; Case ( $SSL cURL Option = "Require" ; "yes" ; "no" ) )', c), 'yes');
  assert.ok(vars.has('$SSL cURL Option[1]'));
  assert.equal(evaluateText('Let ( [ $a = 1 ; $b = 0 ] ; $a and $b )', c), '0');
  assert.equal(evaluateText('Let ( $Message Plain Text = "hi" ; $Message Plain Text & "!" )', c), 'hi!');
  assert.equal(evaluateText('GetThumbnail ( "pic.png" ; 10 ; 10 )', c), 'pic.png');
});

test('paths, NumToJText, TrimAll', () => {
  assert.equal(t('ConvertFromFileMakerPath ( "filemac:/Macintosh HD/Users/a/b c.txt" ; PosixPath )'), '/Macintosh HD/Users/a/b c.txt');
  assert.equal(t('ConvertFromFileMakerPath ( "filewin:/C:/Users/a/b.txt" ; WinPath )'), 'C:\\Users\\a\\b.txt');
  assert.equal(t('ConvertFromFileMakerPath ( "file:/x/b c.txt" ; URLPath )'), 'file:///x/b%20c.txt');
  // ConvertToFileMakerPath turns each back.
  assert.equal(t('ConvertToFileMakerPath ( "/Users/a/b c.txt" ; PosixPath )'), '/Users/a/b c.txt');
  assert.equal(t('ConvertToFileMakerPath ( "C:\\\\Users\\\\a\\\\b.txt" ; WinPath )'), '/C:/Users/a/b.txt');
  assert.equal(t('ConvertToFileMakerPath ( "file:///x/b%20c.txt" ; URLPath )'), '/x/b c.txt');
  assert.equal(t('ConvertToFileMakerPath ( "http://x/y" ; URLPath )'), '?');
  assert.equal(t('ConvertToFileMakerPath ( "\\\\\\\\srv\\\\share\\\\a.txt" ; WinPath )'), '//srv/share/a.txt');
  assert.equal(t('ConvertToFileMakerPath ( "a.txt" ; WinPath )'), '?');
  assert.equal(t('ConvertFromFileMakerPath ( "nonsense" ; PosixPath )'), '?');
  assert.equal(t('NumToJText ( 1234567.5 ; 1 ; 0 )'), '1,234,567.5');
  assert.equal(t('NumToJText ( 1234567 ; 0 ; 1 )'), '１２３４５６７');
  assert.equal(t('NumToJText ( 120034567 ; 2 ; 0 )'), '1億2003万4567');
  assert.equal(t('TrimAll ( "  a   b " ; 0 ; 0 )'), 'a b');
  assert.equal(t('TrimAll ( " a b " ; 0 ; 3 )'), 'ab');
  assert.equal(t('Timestamp ( "" ; 0 )'), '?');
  assert.equal(t('Timestamp ( "" ; "" )'), '');
});

test('MBS: offline-safe functions run, the rest are refused', () => {
  const c: CalcContext = {};
  assert.equal(evaluateText('MBS ( "Path.LastPathComponent" ; "/Users/a/art work.jpg" )', c), 'art work.jpg');
  assert.equal(evaluateText('MBS ( "Text.EncodeURLComponent" ; "a b&c" ; "utf8" )', c), 'a%20b%26c');
  assert.equal(evaluateText('MBS ( "Files.FileExtension" ; "clip.mp3" )', c), 'mp3');
  assert.equal(evaluateText('MBS ( "IsError" )', c), '0');
  assert.equal(evaluateText('MBS ( "CURL.New" )', c), '16000');
  assert.equal(evaluateText('MBS ( "IsError" )', c), '0');
  assert.match(evaluateText('MBS ( "CURL.Perform" ; 16000 )', c), /^\[MBS\] ERROR:.*off/);
  assert.equal(evaluateText('MBS ( "IsError" )', c), '1');
  assert.match(evaluateText('MBS ( "SMTP.Send" ; 1 )', c), /^\[MBS\] ERROR/);
  assert.equal(evaluateText('MBS ( "ProgressDialog.Show" )', c), 'OK');
  assert.equal(evaluateText('MBS ( "IsError" )', c), '0');
});

test('runaway custom function recursion is "?", not a crash', () => {
  // A custom Months ( start ; end ) in a private sample never ends when start is not a date.
  const c: CalcContext = { customFunction: (n) => (n.toLowerCase() === 'forever' ? { parameters: ['n'], formula: 'Forever ( n + 1 )' } : undefined) };
  assert.equal(evaluateText('Forever ( 1 )', c), '?');
  assert.throws(() => evaluate('Forever ( 1 )', c), (e: unknown) => e instanceof CalcError && e.code === 1200);
});

test('BaseElements JSON functions', () => {
  const c: CalcContext = {};
  assert.equal(evaluateText('BE_JSONPath ( "{ \\"a\\" : [ 1, { \\"b\\": \\"x\\" } ] }" ; "$" )', c), '{"a":[1,{"b":"x"}]}');
  assert.equal(evaluateText('BE_JSONPath ( "{\\"a\\":[1,{\\"b\\":\\"x\\"}]}" ; "$.a[1].b" )', c), 'x');
  assert.equal(evaluateText('BE_JSONPath ( "{\\"a\\":1}" ; "$.missing" )', c), '?');
  assert.notEqual(evaluateText('BE_JSON_Error_Description', c), '');
  assert.equal(evaluateText('BE_JSONPath ( "not json" ; "$" )', c), '?');
  assert.equal(evaluateText('BE_JSON_Encode ( "" ; "say \\"hi\\"" )', c), '"":"say \\"hi\\""');
  // jsonAv keeps what follows the first colon, so text holding a colon survives.
  assert.equal(evaluateText('Let ( e = BE_JSON_Encode ( "" ; "a:b" ) ; Right ( e ; Length ( e ) - Position ( e ; ":" ; 1 ; 1 ) ) )', c), '"a:b"');
  assert.equal(evaluateText('BE_JSON_Encode ( "n" ; 12 )', c), '"n":12');
  assert.equal(evaluateText('BE_EvaluateJavaScript ( "1+1" )', c), '?');
});

test('Get parameters win over fields of the same name', () => {
  const names = new NameTable({ fields: ['ScriptParameter'] });
  const c: CalcContext = { names, field: () => text('field'), get: (n) => (n.toLowerCase() === 'scriptparameter' ? text('param') : undefined) };
  assert.equal(evaluateText('Get (ScriptParameter) & ScriptParameter', c), 'paramfield');
});

test('custom functions without parameters need no parentheses', () => {
  const c: CalcContext = { customFunction: (n) => (n.toLowerCase() === 'triggers.areallowed' ? { parameters: [], formula: '1 + 1' } : undefined) };
  assert.equal(evaluateText('Triggers.AreAllowed * 10', c), '20');
  assert.equal(evaluateText('Triggers.AreAllowed ()', c), '2');
});

test('GetFieldName sees the field a custom function parameter was given', () => {
  const fns: Record<string, { parameters: string[]; formula: string }> = {
    'sql.getfieldname': { parameters: ['field'], formula: 'Let ( fn = GetFieldName ( field ) ; Case ( fn = "?" ; field ; fn ) )' },
    'outer': { parameters: ['f'], formula: 'SQL.GetFieldName ( f )' },
  };
  const c: CalcContext = {
    occurrence: 'Party', names: new NameTable({ fields: ['Name'], occurrences: [['Person', ['Id']]] }),
    field: () => text('value'), customFunction: (n) => fns[n.toLowerCase()],
  };
  assert.equal(evaluateText('SQL.GetFieldName ( Person::Id )', c), 'Person::Id');
  assert.equal(evaluateText('Outer ( Name )', c), 'Party::Name');
  assert.equal(evaluateText('SQL.GetFieldName ( "Person::Id" )', c), 'Person::Id');
  // A Let variable bound to a field passes the field on, as FileMaker does; one bound to a value does not.
  assert.equal(evaluateText('Let ( w = Person::Id ; GetFieldName ( w ) )', c), 'Person::Id');
  assert.equal(evaluateText('Let ( [ w = Person::Id ; v = w ] ; SQL.GetFieldName ( v ) )', c), 'Person::Id');
  assert.equal(evaluateText('Let ( w = Name ; Outer ( w ) )', c), 'Party::Name');
  assert.equal(evaluateText('Let ( x = 5 ; GetFieldName ( x ) )', c), '?');
});

test('Substitute takes a function call as the search text', () => {
  assert.equal(evaluateText('Substitute ( "a" & Char ( 9 ) & "b" ; Char ( 9 ) ; "-" )'), 'a-b');
  assert.equal(evaluateText('Substitute ( "abc" ; [ "a" ; "1" ] ; [ Lower ( "B" ) ; "2" ] )'), '12c');
});

test('formulas FileMaker stores with gaps still parse', () => {
  // Deleted fields/functions fail only when reached; unresolved reader IDs return ?.
  assert.equal(evaluateText('If ( 1 ; "ok" ; <Function Missing> ( 1 ) )'), 'ok');
  assert.equal(evaluateText('If ( 0 ; Globals::<Field Missing> ; "ok" )', { field: () => undefined }), 'ok');
  assert.equal(evaluate('⟨fn:3a⟩ ( 2.5 )').value, '?');
  assert.equal(evaluateText('List ( "a" ; "b" ; )'), 'a\rb');
  assert.equal(evaluateText('// only a comment'), '');
  assert.equal(evaluateText('/*/* a */ 1 + */ 2'), '2'); // block comments nest
  assert.equal(evaluateText('/* path/*.txt */ 3'), '3'); // an unclosed inner one does not swallow the formula
});

test('text styles and repetition functions', () => {
  assert.equal(evaluateText('TextStyleAdd ( "To: " ; Bold ) & TextFormatRemove ( "x" )'), 'To: x');
  assert.equal(evaluateText('Proper ( "new york" ) & Floor ( -1.5 ) & Ceiling ( 1.2 )'), 'New York-22');
});

test('Get parameters named like a field', () => {
  const names = new NameTable({ fields: ['FoundCount'] });
  assert.deepEqual(compile('Get(FoundCount) <> 1', names).node, { k: 'bin', op: '<>', a: { k: 'get', param: 'FoundCount' }, b: { k: 'num', value: 1 } });
});

test('division by zero gives "?" instead of stopping', () => {
  assert.equal(evaluateText('1 / 0'), '?');
  assert.equal(evaluateText('Round ( 5 / 0 ; 2 )'), '?');
  assert.equal(evaluateText('Mod ( 5 ; 0 ) & "|" & Div ( 5 ; 0 )'), '?|?');
  assert.equal(evaluateText('If ( 0 ; 1 / 0 ; "ok" )'), 'ok');
  // Empty over empty stays empty (a private sample's stored ratios).
  assert.equal(evaluateText('Round ( GetAsNumber ( "Varies" ) / GetAsNumber ( "" ) ; 2 )'), '');
  assert.equal(evaluateText('"" / 0'), '?');
  // So does empty over a number (a private sample's image sizes on empty containers).
  assert.equal(evaluateText('Round ( "" / 131072 ; 2 )'), '');
  assert.equal(evaluateText('"" * 3 & "|" & "" + 1'), '0|1');
});

test('WordCount keeps 1,000 together but splits words at a comma', () => {
  assert.equal(evaluateText('WordCount ( "Over 1,000 copies, sold" )'), '4');
  assert.equal(evaluateText('WordCount ( "red,green" )'), '2');
  assert.equal(evaluateText('LeftWords ( "1,250,000 readers" ; 1 )'), '1,250,000');
});

test('Get(SystemAppearance) is empty, as on a Linux host', () => {
  assert.equal(evaluateText('Get(SystemAppearance) = ""'), '1');
});

test('names with spaces: Let names, custom function names and parameters', () => {
  assert.equal(evaluateText('Let ( [ a b = 2 ; a b c = a b * 3 ] ; a b c + a b )'), '8');
  // A custom function that gets the original window name, trimmed.
  const formula = `Let( [
  right word = RightWords( window name; 1 );
  right word is number = Filter( right word; "0123456789" ) = right word ];
If( not right word is number; window name;
  Let( [ suffix = " - " & right word; suffix length = Length( suffix ) ];
  If( Right( window name; suffix length ) ≠ suffix; window name; Left( window name; Length( window name ) - suffix length ) ) ) ) )`;
  const c: CalcContext = {
    customFunction: (n) => (n.toLowerCase() === 'get original window name' ? { parameters: [' window name '], formula } : undefined),
  };
  assert.equal(evaluateText('Get Original Window Name ( "Contacts - 2" )', c), 'Contacts');
  assert.equal(evaluateText('Get Original Window Name ( "Contacts" ) & "!"', c), 'Contacts!');
  // Words before "(" are joined only when nothing else could be meant.
  assert.equal(evaluateText('not Length ( "a" ) = 1'), '0');
});

test('comparison operators: text against a number compares as text', () => {
  // FileMaker compares in text space when either side is text (filemakerhacks.com, "When 2 is greater than 10").
  assert.equal(evaluateText('"2" > 10'), '1');
  assert.equal(evaluateText('2 > 10'), '0');
  assert.equal(evaluateText('"10" = 10'), '1');
  // How a parameter function tells text from a number: a script in a private sample got $ObjectName = -5 from "…-5" before.
  assert.equal(evaluateText('"Tab-5" ≠ GetAsNumber ( "Tab-5" )'), '1');
  assert.equal(evaluateText('"12" ≠ GetAsNumber ( "12" )'), '0');
  assert.equal(evaluateText('GetAsNumber ( "2" ) > 10'), '0');
  // Max and Min still take numbers as numbers.
  assert.equal(evaluateText('Max ( "2" ; 10 )'), '10');
});

test('a plug-in that isn\'t installed gives "?", with or without parentheses', () => {
  // A plug-in check script in a private sample: If [ GetAsNumber ( EmailVersion ) < 1.61 ], then tells the user to install it.
  assert.equal(evaluateText('EmailVersion'), '?');
  assert.equal(evaluateText('GetAsNumber ( EmailVersion ) < 1.61'), '1');
  assert.equal(evaluateText('EmailDisconnect'), '?');
  // The arguments aren't evaluated: nothing is connected or sent.
  assert.equal(evaluateText('EmailConnectIMAP ( Missing::Field ; "user" ; "password" ; "ssl=true" )'), '?');
  // A field of the same name still wins.
  assert.equal(evaluateText('EmailVersion', { field: (r) => (r.field === 'EmailVersion' ? text('2.0') : undefined) }), '2.0');
});

test('any plug-in Tabularius has no version of gives "?" like FileMaker without it', () => {
  // A call the reader couldn't name, owned by a plug-in (Troi here): "?", arguments not evaluated.
  assert.equal(evaluate('⟨TrFl:12⟩ ( Missing::Field ; "x" )').value, '?');
  assert.equal(evaluateText('If ( ⟨TrFl:3⟩ = "?" ; "not installed" ; "installed" )'), 'not installed');
  // Unresolved built-in/design IDs use the same fallback, without guessing their behavior.
  assert.equal(evaluate('⟨FMDR:99⟩ ( "x" )').value, '?');
  assert.equal(evaluate('⟨fn:37⟩ ( 1 )').value, '?');
  // Plug-in family prefixes: BaseElements functions without a tabularius version, Troi, SMTPit.
  assert.equal(evaluate('BE_HTTP_GET ( "https://example.com" )').value, '?');
  assert.equal(evaluate('TrFile_Exists ( "-Unused" ; "/tmp/x" )').value, '?');
  assert.equal(evaluate('SMTPit_Send').value, '?');
  // BaseElements functions Tabularius does run still run.
  assert.equal(evaluateText('BE_StackCount ( "s" )'), '0');
  // An ordinary unknown function is still an error.
  assert.throws(() => evaluate('NoSuchFunction ( 1 )'));
});

test('every plug-in function the reader decodes runs in Tabularius or gives "?"', async () => {
  const { PLUGIN_FUNCTIONS } = await import('../../fmp12/src/index.ts');
  const { FUNCTIONS, pluginNotInstalled } = await import('../src/functions.ts');
  for (const f of PLUGIN_FUNCTIONS) assert.ok(FUNCTIONS.has(f.toLowerCase()) || pluginNotInstalled(f), f);
});

test('BaseElements value lists, digests, vectors, variables and arrays work as the plug-in does', () => {
  const t = (f: string, c: CalcContext = {}) => evaluateText(f, c);
  // Value lists: empty values kept by Unique and Trim, dropped by the others.
  assert.equal(t('BE_ValuesUnique ( "b¶a¶B¶¶b¶" )'), 'b\ra\rB\r');
  assert.equal(t('BE_ValuesUnique ( "b¶a¶B" ; 0 )'), 'b\ra');
  assert.equal(t('BE_ValuesFilterOut ( "a¶b¶c¶b" ; "c" )'), 'a\rb\rb');
  assert.equal(t('BE_ValuesFilterOut ( "a¶B¶b" ; "A" ; 0 )'), 'B');
  assert.equal(t('BE_ValuesContainsDuplicates ( "a¶b¶A" )'), '0');
  assert.equal(t('BE_ValuesContainsDuplicates ( "a¶b¶A" ; 0 )'), '1');
  assert.equal(t('BE_ValuesSort ( "b¶C¶a" )'), 'C\ra\rb');
  assert.equal(t('BE_ValuesSort ( "10¶9¶x" ; 0 ; 1 )'), '10\r9\rx');
  assert.equal(t('BE_ValuesTimesDuplicated ( "b¶a¶b¶c¶a" ; 2 )'), 'a\rb');
  assert.equal(t('BE_ValuesTrim ( " a ¶b " )'), 'a\rb');
  // Constants are their id modulo 1000.
  assert.equal(t('BE_MessageDigestAlgorithmMD5 & BE_EncodingBase64 & BE_ButtonCancel'), '122');
  assert.equal(t('BE_MessageDigest ( "abc" )'), 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD');
  assert.equal(t('BE_MessageDigest ( "abc" ; BE_MessageDigestAlgorithmMD5 ; BE_EncodingBase64 )'), 'kAFQmDzST7DWlj99KOF/cg==');
  assert.equal(t('BE_MessageDigest ( "abc" ; BE_MessageDigestAlgorithmMDC2 )'), '?');
  assert.equal(t('BE_XOR ( "AB" ; 1 )'), '4043');
  assert.equal(t('BE_VectorDotProduct ( "1¶2" ; "3¶4¶5" )'), '11');
  assert.equal(t('BE_VectorEuclideanDistance ( "0¶0" ; "3¶4" )'), '5');
  // Variables and arrays last for the session.
  const c: CalcContext = {};
  assert.equal(t('BE_VariableSet ( "x" ; "1" ) & BE_VariableGet ( "x" )', c), '11');
  assert.equal(t('BE_VariableSet ( "x" ; "" ) & BE_VariableGet ( "x" )', c), '');
  assert.equal(t('BE_ArraySetFromValueList ( "a¶b¶A" ) & BE_ArraySetFromValueList ( "z" )', c), '12');
  assert.equal(t('BE_ArrayGetSize ( 1 ) & "|" & BE_ArrayGetValue ( 1 ; 2 ) & "|" & BE_ArrayFind ( 1 ; "a" )', c), '3|b|1\r3');
  assert.equal(t('BE_ArrayChangeValue ( 1 ; 2 ; "q" ) & BE_ArrayGetValue ( 1 ; 2 ) & BE_ArrayChangeValue ( 1 ; 9 ; "q" )', c), '1q0');
  assert.equal(t('BE_ArrayDelete ( 1 ) & BE_ArrayGetValue ( 1 ; 1 )', c), 'z');
  // Words a calculation uses, skipping strings and comments.
  assert.equal(t('BE_TextExtractWords ( "Let ( $a = 1 ; \\"$b\\" & $c ) // $d¶ & $a" )'), '$a\r$c');
  assert.equal(t('BE_JSON_ArraySize ( "{\\"a\\":{\\"b\\":[1,2,3]}}" ; "a.b" ) & BE_JSON_ArraySize ( "[1]" ) & BE_JSON_ArraySize ( "x" )'), '310');
  // Milliseconds since 0001-01-01.
  assert.equal(t('BE_TimeUTCMilliseconds', { now: () => new Date(0) }), '62135596800000');
  // The names BaseElements registers today, beside the older ones.
  assert.equal(t('BE_VersionPro'), 'tabularius');
  assert.equal(t('BE_FolderSelectDialog ( "x" )'), '?');
});

test('BaseElements AES, ciphers and gzip match the plug-in', () => {
  const t = (f: string) => evaluateText(f);
  // Known answer from OpenSSL with BaseElements' own calls (EVP_BytesToKey sha1 x5, AES-256-CFB128).
  const encrypted = 'cfeWyVN3Jyj077gxAO1MAAAAAAAAAAAAAAAAAAAAAAANNYK6PFaFsJtj7bTXpiEWLtr8';
  assert.equal(t('BE_EncryptAES ( "secret" ; "Hello BaseElements" )'), encrypted);
  assert.equal(t(`BE_DecryptAES ( "secret" ; "${encrypted}" )`), 'Hello BaseElements');
  assert.equal(t('BE_DecryptAES ( "secret" ; "bm90aGluZw==" )'), '');
  // AES-128-CBC known answer (NIST SP 800-38A F.2.1, first block, no padding).
  const cbc = 'BE_CipherEncrypt ( "aes-128-cbc" ; "6bc1bee22e409f96e93d7e117393172a" ; "2b7e151628aed2a6abf7158809cf4f3c" ; "000102030405060708090a0b0c0d0e0f" ; 0 )';
  assert.equal(t(cbc), '7649ABAC8119B246CEE98E9B12E9197D');
  assert.equal(t(`BE_CipherDecrypt ( "aes-128-cbc" ; ${cbc} ; "2b7e151628aed2a6abf7158809cf4f3c" ; "000102030405060708090a0b0c0d0e0f" ; 0 )`), '6BC1BEE22E409F96E93D7E117393172A');
  assert.equal(t('BE_CipherEncrypt ( "no-such-cipher" ; "00" ; "00" ; "00" )'), '?');
  const zipped = evaluate('BE_Gzip ( HexDecode ( "68656c6c6f" ; "a.txt" ) )');
  assert.equal(zipped.type === 'container' && zipped.value, 'a.txt.gz');
  assert.equal(evaluateText('HexEncode ( BE_UnGzip ( g ) ) & GetAsText ( BE_UnGzip ( g ) )', { field: (r) => (r.field === 'g' ? zipped : undefined) }), '68656C6C6Fa.txt');
});

test('an enabled plug-in function runs ahead of custom functions and the not-installed "?"', async () => {
  const { checkFormula } = await import('../src/index.ts');
  const calls: string[] = [];
  const troi: Record<string, { min: number; max?: number; call: (a: import('../src/index.ts').Value[]) => import('../src/index.ts').Value }> = {
    'trfile_exists': { min: 1, max: 2, call: (a) => (calls.push(a.map((x) => String(x.value)).join(',')), num(1)) },
    '⟨trfl:12⟩': { min: 1, max: 2, call: () => num(1) },
    'trfile_version': { min: 0, max: 0, call: () => text('12.0') },
  };
  const ctx: CalcContext = {
    plugin: (n) => troi[n.toLowerCase()],
    customFunction: (n) => (n === 'TrFile_Exists' ? { parameters: ['p'], formula: '"custom"' } : undefined),
  };
  // Arguments arrive evaluated; the plug-in wins over a custom function of the same name.
  assert.equal(evaluateText('TrFile_Exists ( "a" & "b" )', ctx), '1');
  assert.deepEqual(calls, ['ab']);
  assert.equal(evaluateText('⟨TrFl:12⟩ ( "x" )', ctx), '1');
  assert.equal(evaluateText('TrFile_Version', ctx), '12.0');
  assert.throws(() => evaluate('TrFile_Exists ( 1 ; 2 ; 3 )', ctx), /Too many/);
  // Not enabled: "?" as before.
  assert.equal(evaluate('TrFile_Exists ( "a" )').value, '?');
  // The formula check knows enabled plug-ins and their argument counts.
  const plugins: [string, number, number | undefined][] = [['TrFile_Exists', 1, 2]];
  assert.equal(checkFormula('TrFile_Exists ( "a" )', { plugins }).ok, true);
  assert.equal(checkFormula('TrFile_Exists', { plugins }).ok, false);
  assert.equal(checkFormula('TrFile_Exists ( 1 ; 2 ; 3 )', { plugins }).ok, false);
});

test('BE_XPath and BE_XPathAll read XML as BaseElements does', () => {
  const xml = '<feed xmlns=\\"http://www.w3.org/2005/Atom\\"><entry id=\\"1\\"><title>One</title></entry><entry id=\\"2\\"><title>Two &amp; more</title></entry></feed>';
  const t = (f: string) => evaluateText(f);
  assert.equal(t(`BE_XPath ( "${xml}" ; "//a:title" ; "a=http://www.w3.org/2005/Atom" )`), 'One');
  assert.equal(t(`BE_XPathAll ( "${xml}" ; "//a:entry/@id" ; "a=http://www.w3.org/2005/Atom" )`), '1\r2');
  assert.equal(t(`BE_XPath ( "${xml}" ; "count(//a:entry)" ; "a=http://www.w3.org/2005/Atom" )`), '2');
  assert.equal(t(`BE_XPath ( "${xml}" ; "//a:entry[2]/a:title" ; "a=http://www.w3.org/2005/Atom" ; 0 )`), '<title>Two &amp; more</title>');
  // Without the namespace registered, the default-namespace elements don't match (XPath 1.0).
  assert.equal(t(`BE_XPath ( "${xml}" ; "//title" )`), '');
  assert.equal(t('BE_XPath ( "<a>" ; "/a" ) & BE_GetLastError'), '?-1');
});

test('BaseElements XML tools: parse check, canonical form, tidy and DDR clean-up', async () => {
  const { canonicalXml, tidyXml, stripInvalidUtf16 } = await import('../src/xmltools.ts');
  const t = (f: string) => evaluateText(f);
  assert.equal(t('BE_XMLParse ( "<a><b/></a>" )'), '');
  assert.notEqual(t('BE_XMLParse ( "<a><b></a>" )'), '');
  // The same bytes xmllint --c14n11 writes for this document.
  const doc = '<?xml version="1.0"?>\n<!-- top --><r xmlns="urn:a" xmlns:b="urn:b" z="1" b:y="2" a="&amp;&#9;">\n  <c xmlns:b="urn:b" xmlns="urn:a"><![CDATA[<x>]]> t&#13;</c><e/><b:f xmlns="" q="1" p="2"/><!-- in -->\n</r>';
  assert.equal(canonicalXml(doc), '<!-- top -->\n<r xmlns="urn:a" xmlns:b="urn:b" a="&amp;&#x9;" z="1" b:y="2">\n  <c>&lt;x&gt; t&#xD;</c><e></e><b:f xmlns="" p="2" q="1"></b:f><!-- in -->\n</r>');
  assert.equal(t('BE_XMLCanonical ( "<a  y=\\"2\\" x=\\"1\\"/>" )'), '<a x="1" y="2"></a>');
  assert.equal(t('BE_XMLCanonical ( "<a>" )'), '');
  assert.equal(tidyXml('<a k="v"><b x="1" y="2"><c>hi</c></b> <d/></a>'), '<a k="v">\r\t<b\r\t\tx="1"\r\t\ty="2">\r\t\t<c>hi</c>\r\t</b>\r\t<d></d>\r</a>\r');
  assert.equal(t('BE_XMLTidy ( "<a>" ) & "/" & BE_GetLastError'), '?/718');
  // Big-endian unless marked otherwise; tab, line feed and return stay.
  const le = new Uint8Array([0xff, 0xfe, 0x41, 0, 0x01, 0, 0x09, 0, 0x0b, 0]);
  assert.deepEqual([...stripInvalidUtf16(le).data], [0xff, 0xfe, 0x41, 0, 0x09, 0]);
  assert.equal(stripInvalidUtf16(le).skipped, 4);
  assert.equal(stripInvalidUtf16(new Uint8Array([0, 0x41, 0, 0x02])).skipped, 2);
});

test('BE_XSLT_ApplyInMemory transforms XML, and reports a bad stylesheet as text', () => {
  const xslt = '<xsl:stylesheet version=\\"1.0\\" xmlns:xsl=\\"http://www.w3.org/1999/XSL/Transform\\"><xsl:output method=\\"text\\"/>¶<xsl:template match=\\"/\\"><xsl:for-each select=\\"//p\\"><xsl:sort select=\\"@n\\" data-type=\\"number\\"/><xsl:value-of select=\\".\\"/>,</xsl:for-each></xsl:template></xsl:stylesheet>';
  assert.equal(evaluateText(`BE_XSLT_ApplyInMemory ( "<r><p n=\\"2\\">b</p><p n=\\"1\\">a</p></r>" ; "${xslt}" )`), 'a,b,');
  assert.notEqual(evaluateText('BE_XSLT_ApplyInMemory ( "<r/>" ; "<nope" )'), '');
});

test('BE_ContainerCompress marks data compressed without changing what it reads as', () => {
  const t = (f: string) => evaluateText(f);
  assert.equal(t('Let ( c = BE_ContainerCompress ( TextEncode ( "hi" ; "utf-8" ; 1 ) ; "a.txt" ) ; BE_ContainerIsCompressed ( c ) & GetContainerAttribute ( c ; "filename" ) )'), '1a.txt');
  assert.equal(t('Let ( c = BE_ContainerUncompress ( BE_ContainerCompress ( TextEncode ( "hi" ; "utf-8" ; 1 ) ) ) ; BE_ContainerIsCompressed ( c ) & Base64Encode ( c ) )'), '0aGk=');
  assert.equal(t('BE_ContainerIsCompressed ( "text" )'), '?');
});

test('text functions count characters, so an emoji is one and is never split', () => {
  assert.equal(t('Length ( "a👍b" )'), '3');
  assert.equal(t('Left ( "a👍b" ; 2 )'), 'a👍');
  assert.equal(t('Right ( "a👍b" ; 2 )'), '👍b');
  assert.equal(t('Middle ( "a👍b😀c" ; 2 ; 3 )'), '👍b😀');
  assert.equal(t('Left ( "👍" ; 1 )'), '👍');
  assert.equal(t('Replace ( "a👍b" ; 2 ; 1 ; "x" )'), 'axb');
  assert.equal(t('Replace ( "a👍b" ; 3 ; 1 ; "x" )'), 'a👍x');
  assert.equal(t('Position ( "😀😁" ; "😁" ; 1 ; 1 )'), '2');
  assert.equal(t('Position ( "a😀b😀c" ; "😀" ; 3 ; 1 )'), '4');
  assert.equal(t('Position ( "a😀b😀c" ; "😀" ; 5 ; -1 )'), '4');
  assert.equal(t('Position ( "a😀b😀c" ; "😀" ; 99 ; -1 )'), '4');
  assert.equal(t('PatternCount ( "😀😀😀" ; "😀" )'), '3');
  // Plain text behaves as before.
  assert.equal(t('Position ( "banana" ; "an" ; 1 ; 2 )'), '4');
  assert.equal(t('Right ( "hello" ; 3 )'), 'llo');
});
