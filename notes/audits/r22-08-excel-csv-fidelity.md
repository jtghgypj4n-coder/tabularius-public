# r22-08 Excel and CSV fidelity audit

Tabularius exports a generated record through Save Records as Excel and through
CSV, TSV, Merge, FMPXMLRESULT, and HTML table. The test validates the entire
Excel OPC package, then imports Excel, CSV, TSV, Merge, and FMPXMLRESULT with
the production Import Records path. HTML is checked as an exported table;
there is no HTML Import Records format.

## CSV safety rule

CSV, TSV, and Merge text values that begin with `=`, `+`, `-`, `@`, a control
character (including tab or carriage return), or one of these after leading
whitespace receive a leading apostrophe. Numeric, date, time, and timestamp fields keep
their leading minus sign. Quoting does not replace this guard. Imported text
retains the apostrophe; it is never removed by guessing whether it was
intentional. Whether Claris makes the same choice is **unverified**.

## KNOWN

| Item | Observed round-trip result | Scope |
| --- | --- | --- |
| Numeric negative zero | The store canonicalizes `-0` to `0` on ingestion. The standalone Excel writer and reader retain `-0` when supplied directly. | All exports from stored records |
| Formula-like text in CSV, TSV, Merge | The safety apostrophe remains on import into a text field. | Delimited exports |
| Text newlines | The store normalizes line endings to carriage returns; delimited files encode returns as vertical tabs and the importer restores them. | Stored records and delimited files |
| Excel text line breaks | Carriage returns are written as `&#13;` in worksheet XML, so XML newline normalization does not change them. | Excel |
| Tabs and other control characters in text values | Written as visible `\uXXXX` text (the delimiter is a tab, so a raw tab cannot stay); display-only, import keeps the text and does not turn it back into a tab. | CSV, TSV, Merge |
| Container contents | The export carries the filename reference, not the binary payload. | All tested formats |
| HTML table | Exported values can be read from the table, but Import Records does not import HTML. | HTML |
| Boolean value | The schema has no native boolean field; the generated record uses a numeric `1` and checks that it returns as `1`. | All formats |
| Numbers exceeding Excel precision | Behavior across spreadsheet applications is **unverified**. The test covers `1e21`; it does not claim decimal precision beyond the number representation. | Excel |

The strict checker verifies ZIP headers, sizes and CRCs; XML well-formedness;
content types; internal package and workbook relationships; shared string and
style references; workbook and worksheet structures; and Excel row, column,
sheet-name, and cell-string limits. A corrupted CRC is rejected in a negative
test. A generated shared-string workbook exercises shared-string lookup and
rejects an invalid index. The generated tests use temporary SQLite files and
no corpus files.

## Verification

The targeted run of five generated-input test files passed 40 tests with
`--test-concurrency=2` in about 1.25 seconds. The generated-input export
isolation file passed another 12 tests in under 1 second. The fidelity test
file passed 10 tests in under 1 second, and TypeScript typechecking passed. No
corpus or vendor files were opened, and no release action was taken.

## Second-model review

A second model reviewed the merged Export Records, the formula guard and the workbook writer, with probes it ran itself. It found no defect in the refusal paths (the partial file is removed on every one) or in the row check. One fix came out of it: a table name made only of control characters used to give an empty sheet name; it now falls back to `Sheet1`, with a regression test.

Left as they are, and recorded for the owner:

- Text that starts with `-`, `+` or `@` (phone numbers such as `+1 555…`, `@handle`) now gets the safety apostrophe on export, and an import into a text field keeps it, so a round trip changes that text once. The test asserts this on purpose.
- Full-width `＝ ＋ － ＠`, U+2212 and the zero-width space are not guarded. Whether Excel or LibreOffice read them as formulas is **unverified**.
- The guard type comes from a repeating field's first value only, so a repeating number field whose first value is negative is not guarded.
- A name cut at 31 characters can split a surrogate pair. Whether Excel accepts a name of spaces only is **unverified**.
- The HTML table export has no guard; whether Excel treats `=…` in a cell as a formula there is **unverified**.
