# r25-22 date, time, and timestamp function audit

<!-- known-difference-file: Date and time functions ;; YearName is not implemented because its exact output (Japanese era names) could not be read from the Claris page, and negative or fractional times, ambiguous locale-dependent text parsing and mixed text coercions follow Tabularius choices that the Claris pages do not define ;; A calculation using YearName returns an error, and one that builds a time outside a clock day or parses ambiguous date text may give a different answer from FileMaker ;; A readable Claris YearName reference or a FileMaker run of YearName, out-of-range times and ambiguous date text -->

Scope: calculator date/time behavior in `@tabularius/calc`. The generated table at `packages/calc/test/data/date-time-functions.json` contains 34 synthetic expressions, expected results, and a Claris help URL for every case. The associated regression test exercises all rows.

## Main coverage

The branch already implemented the core date/time families, locale-aware parsing, two digit years, current date/time/timestamp access, Japanese day/month names, conversions (`GetAsText`, `GetAsDate`, `GetAsTime`, `GetAsTimestamp`), arithmetic, and numeric `Round`/`Truncate`. This change adds table-driven documented edge examples and type/arithmetic regression checks; it does not duplicate that implementation.

Claris's function reference describes `GetAsDate`/`GetAsTime`/`GetAsTimestamp` and `GetAsText` as the conversion family. The requested names `DateToText`, `TimeToText`, `TextToDate`, `TextToTime`, `TextToTimestamp`, and `TimestampToText` are not listed as FileMaker functions in that reference, so they remain unsupported rather than being guessed aliases. See [Functions reference](https://help.claris.com/archive/fm21/en/pro-help/content/functions-reference.html) (short expressions: “GetAsDate”, “GetAsTimestamp”).

## KNOWN / unverified

| Behavior | Status | Reason |
| --- | --- | --- |
| `YearName` | Unverified; not implemented | Claris documents Japanese era formats and the first-year special case, but its help page's output characters are embedded as inaccessible images in the available page text. Exact strings cannot be established without guessing. See [YearName](https://help.claris.com/es/pro-help/content/yearname.html) (short expressions: “formato abreviado”, “rei”, “gen”). |
| Negative/fractional times and component extraction | Unverified | Numeric time construction permits values outside a clock day in this implementation, but the reviewed function pages do not define normalization or negative component behavior. |
| Locale-dependent ambiguous parsing and mixed text coercions | Unverified beyond existing regression coverage | Claris documents system formatting effects, but the reviewed pages do not specify all ambiguous-text parsing or mixed-type coercion outcomes. |
| `DateToText`-style function names | Unsupported names | The Claris reference lists the `GetAs*` functions instead; these names are not documented native functions. |

The 34-row table records synthetic expected results only. No corpus or customer data is used.
