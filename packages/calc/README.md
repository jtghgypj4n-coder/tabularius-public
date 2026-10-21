# @tabularius/calc

Evaluates FileMaker calculation formulas: the text FileMaker shows in the
Specify Calculation dialog, which is also what `@tabularius/fmp12` decodes from
a file. No dependencies beyond Node.

```ts
import { evaluate, evaluateText, compile, NameTable, text, num } from '@tabularius/calc';

evaluateText('Upper ( "a" ) & 1 + 2');           // "A3"

// A host describes the record the formula runs on.
const names = new NameTable({
  fields: ['First Name', 'Qty'],                    // the context table's fields
  occurrences: [['Line Items', ['Amount']]],        // TO name -> its fields
});
const value = evaluate('Sum ( Line Items::Amount ) * Qty', {
  names,
  occurrence: 'Invoices',
  field: (ref) => ref.field === 'Qty' ? num(3) : undefined,
  related: (ref) => [num(5), num(7)],               // Line Items::Amount of each related record
});
// value = { type: 'number', value: 36 }
```

## API

- `evaluate(formula, context?, resultType?) → Value` evaluates once. It
  throws `CalcError` where FileMaker would show `?` or reject the formula;
  `error.code` is FileMaker's error number (102 field missing, 1200
  calculation error, 1201–1209 syntax errors, …; the numbers follow Claris's list, see docs/error-codes.md).
- `evaluateText(formula, context?) → string` gives the text FileMaker would
  display, with `?` for an error.
- `compile(formula, names?) → Compiled` parses once for repeated use.
  `compiled.fields` lists the fields the formula reads, for working out what
  to recompute when a field changes. `compiled.evaluate(context, resultType)`.
- `NameTable` holds field and table occurrence names so that names with
  spaces or operator characters parse. Build it once per table and reuse it.

## Values

`Value` is `{ type, value }` with type `text`, `number`, `date` (day number,
1/1/0001 = 1), `time` (seconds), `timestamp` (seconds from 1/1/0001) or
`container`. Helpers: `text()`, `num()`, `asText()`, `asNumber()`,
`coerce(value, type)`, and `fromStored()` / `toStored()` to move between
values and the store's column forms (ISO dates and times).

## Context

Everything is optional; a missing member makes the formulas that need it fail
the way FileMaker fails when a field or function is unavailable.

| member | used for |
| --- | --- |
| `names` | parsing field and occurrence names |
| `occurrence` | the context table occurrence; `TO::Field` on it reads the current record |
| `field(ref)` | a field of the current record, or of the first related record when `ref.occurrence` is set; `undefined` means the field does not exist |
| `related(ref)` | all related records' values, for `Sum`, `Count`, `List`, `Max`, `GetNthRecord`, `Last` |
| `repetitions(ref)` | how many repetitions a field has, for `Sum ( repeatingField )` |
| `get(name)` | `Get ( name )`; defaults cover the clock, `UUID`, `UUIDNumber`, `LastError` and a few fixed facts |
| `variable(name, rep)` / `setVariable(name, rep, value)` | `$local` and `$$global` variables, including `Let ( $x = … )` |
| `customFunction(name)` | `{ parameters, formula }` of a custom function |
| `executeSQL(query, args)` | `ExecuteSQL`, as rows of values |
| `design(name, args)` | design functions such as `TableNames`, `LayoutNames` |
| `dateOrder` | `MDY` (default), `DMY` or `YMD`, for dates as text |
| `now()` | the clock, for tests |

Script steps call `evaluate` with a context whose `variable`/`setVariable`
read and write the running script's variables.

## Behaviour notes

- Numbers are doubles shown to 16 significant digits (FileMaker uses
  decimals), so `0.1 + 0.2` gives `0.3` and `1/3` gives `0.3333333333333333`.
- Text comparison ignores case; `Exact` does not.
- `and` / `or` stop as soon as the answer is known.
- Text styles (`TextColor` and friends) return the text unchanged.
- `JSONSetElement` and friends write objects with sorted keys, like FileMaker.
- Let and While names hide fields of the same name, as in FileMaker.
- Supported MBS and BaseElements functions run natively, including text, JSON,
  XML, lists, dictionaries, hashing and selected PDF operations. For example,
  `MBS ( "Text.Length" ; "abc" )` returns `3`.
- Unsupported plug-in functions generally give `?` (error 1208); unsupported
  MBS names return an `[MBS] ERROR` message, and some BaseElements functions
  report failure through `BE_GetLastError` and `BE_JSON_Error_Description`.
- Pure functions work offline. Network and filesystem operations require
  explicit host capabilities and obey the host's access restrictions; registering
  a plug-in name does not grant those capabilities.

## In the store

`@tabularius/store` (packages/store/src/calc.ts) is the host for hosted files:
it builds the context from a record, follows the relationship graph for
`TO::Field` (multikey `=`, `≠`, `<`…, `×`), keeps globals once per file, and
applies FileMaker's rule that a calculation whose referenced fields are all
empty is empty unless the field says otherwise.

XML/XPath queries, XSLT transforms, jq filters and PDF text extraction use a shared
synchronous work budget for nested helpers. The implementation permits 4,000,000
charged work units and 2,500,000 intermediate nodes/entries per operation. XML
operations allow 32,000,000 work units and 8,000,000 node/entry charges to accommodate
repeated traversal of documents within the parser's 8 MB limit. XSLT retains a
separate 4,000,000-unit allowance for instruction and template-matching work.
Nested helpers always consume the caller's remaining budget.

Allocated text is limited to 32,000,000 characters per operation. jq concatenation
charges appended text, and shallow copies check their size and charge copy work
in blocks of 64 entries; retained snapshots also charge their copied entries.
String comparison scans code points without allocating character arrays, and
builtin inputs charge work rather than repeated text allocation. Each string and
the cumulative serialized result are limited to 8,000,000 characters; XSLT also
limits accumulated result-tree text (including temporary trees) to that size.
Recursive evaluation is limited to 128 levels; XPath XML serialization supports
the parser's 256 element levels. XPath source is limited to 20,000 characters,
64 nested groups and 256 operators. These are implementation limits, not
compatibility claims.

A refusal contains `Calculation resource limit:`. Shared checks throw
`ResourceLimitError` (a marked `ComplexityError`); XPath, XSLT and jq preserve their
public error classes when adapting it, and mark the adapted error too. It propagates
through plug-in wrappers and calculation
fallbacks so a caller can unwind writes. Ordinary parse/type errors retain their
existing behavior. Independent operations receive fresh budgets, including after
failure. CID width endpoints must be safe integers in the supported 0–65535 domain.
Non-numeric or truncated PDF width entries stop width parsing tolerantly; unsafe
numeric endpoints and oversized ranges still cause resource refusals.
