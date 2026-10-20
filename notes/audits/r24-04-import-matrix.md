# r24-04: Import Records option matrix

Scope: the scripted **Import Records** step in this checkout, with synthetic source data. The earlier import-stream and import-option work already supplies the source readers, all three actions, positional field mapping, repeating values, privilege checks, found-set replacement, and transaction handling. This audit extends that work. It does not infer binary option bits from undecoded `.fmp12` steps. No corpus data was inspected.

## How to read the matrix

The matrix is a Cartesian product of the tables below. Pick one **source**, one **action**, one **arrangement**, one **auto-enter** state, one **add-remaining** state, and any relevant **effect** rows. The resulting tuple is **documented** only when *each* selected cell says documented and the cited Claris page states the interaction; otherwise it is **unverified**. For an unverified tuple, the KNOWN table records what this checkout currently does; it does not claim Claris behaves that way. `N/A` means the option has no effect for that action. This rule gives a status to every tuple without implying that independent Claris statements prove an undocumented interaction.

Claris's [import action and field mapping page](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) describes the action, mapping, auto-enter, repeating, validation summary, and found-set controls together. The [Import Records step page](https://help.claris.com/en/pro-help/content/import-records.html) describes script-specific source and mapping behavior. The [supported formats page](https://help.claris.com/en/pro-help/content/import-export-formats.html) identifies the source formats.

| Source axis | Claris status | Current reader / limitation |
| --- | --- | --- |
| CSV | Documented: importable; a chosen row may supply names. [Formats](https://help.claris.com/en/pro-help/content/import-export-formats.html) | Positional rows; no `Use as Field Names` option in scripted import. |
| TSV / tab-separated | Documented as custom-separated import. [Formats](https://help.claris.com/en/pro-help/content/import-export-formats.html) | Positional rows; no saved header-row choice. |
| Merge | Documented: format retains field names. [Formats](https://help.claris.com/en/pro-help/content/import-export-formats.html) | First row is skipped as a header; mapping remains positional. |
| FMPXMLRESULT | Documented XML grammar for import; field-name mapping depends on XML metadata. [XML import](https://help.claris.com/en/pro-help/content/importing-xml.html) | Reads FMPXMLRESULT rows; mapping remains positional. |
| XLSX | Documented: importable; worksheet choice and a chosen row may supply names. [Formats](https://help.claris.com/en/pro-help/content/import-export-formats.html), [existing file](https://help.claris.com/en/pro-help/content/importing-data-into-file.html) | First or named worksheet; no saved header-row choice. |
| Another hosted FileMaker file | Documented: open source imports its found set; closed source imports all records. [Import Records](https://help.claris.com/en/pro-help/content/import-records.html), [existing file](https://help.claris.com/en/pro-help/content/importing-data-into-file.html) | Hosted source resolution and selected source fields; open-source-window found-set equivalence is unverified. |

| Action axis | Documented result | Current behavior |
| --- | --- | --- |
| Add | One new target record per importable source record. [Importing data](https://help.claris.com/en/pro-help/content/importing-data.html) | Creates records; successful imports become the found set. |
| Update matching | Match only within the target found set; update all matching targets; the last matching source row supplies the final values. All-empty match fields update no target. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Matches original found set, updates every hit per source row, retains last result. |
| Replace | Source and target found-set records pair in order from the first; excess targets remain. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html), [importing data](https://help.claris.com/en/pro-help/content/importing-data.html) | Replaces by found-set order; excess targets remain. |

| Arrange axis | Claris status | Current behavior |
| --- | --- | --- |
| Explicit field mapping | Documented: each source field may import, match, or be skipped. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | `fieldMapping` entries use source-column positions. |
| Matching Names | Documented only when source has field names; scripted matching is dynamic at run time. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html), [Import Records](https://help.claris.com/en/pro-help/content/import-records.html) | **Known implementation gap**: no dynamic matching-names option; positional mapping is retained. CSV/TSV without a selected name row cannot use this choice. |
| Last Order | Documented: previous import order, or creation order when none exists. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | **Known implementation gap**: no previous-order state; absent mapping uses target creation order. |

| Auto-enter axis | Claris status | Current behavior |
| --- | --- | --- |
| Off | Documented: auto-enter values are not entered for selected fields. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Explicit `performAutoEnter: false` suppresses serials, values, calculations and lookups; stored calculations still run. |
| On | Documented: chosen auto-enter values run and may overwrite imported data. Per-field choices are supported by Claris. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Explicit `true` runs auto-enter; per-field choices are unavailable. An unspecified option uses the store default (`true`), which is **unverified** as a Claris default. |

| Add remaining axis | Documented result | Current behavior |
| --- | --- | --- |
| Add × off/on | N/A; the action already adds source records. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Flag has no effect. |
| Update × off | Unmatched rows are not added. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Unmatched rows skipped. |
| Update × on | Unmatched rows are added. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Unmatched rows added, except all-empty match keys. |
| Replace × off | Extra source rows are not added. [Importing data](https://help.claris.com/en/pro-help/content/importing-data.html) | Extra rows skipped. |
| Replace × on | Extra source rows are added. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Extra rows added. |

## Effect overlays

| Effect | Claris result / status | Current behavior or KNOWN exception |
| --- | --- | --- |
| Repeating source fields | Documented choice: keep repetitions in one record or split repetitions into records, duplicating non-repeating values. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Keeps group-separated text or XML `DATA` repetitions in one record. Split mode is unavailable. Padding, truncation, and matching on repeating targets are **unverified**. |
| Serial number and next value | Documented: run `Set Next Serial Value` after import when needed, particularly with auto-enter off. [Import Records](https://help.claris.com/en/pro-help/content/import-records.html), [Set Next Serial Value](https://help.claris.com/en/pro-help/content/set-next-serial-value.html) | Auto-enter on generates serials for unmapped fields; importing explicit serial values does not reset the next value. Other interactions are **unverified**. |
| Validation failure mid-file | Documented: Not empty or calculated validation skips the record; other validation skips that field and allows other fields in the record. Import summary counts skipped records and fields. [Validation](https://help.claris.com/en/pro-help/content/validating-data-import.html) | Continues after a failed row. This change retries a rejected mapped field, including unique-value collisions, while retaining other fields. Validation of an unmapped generated field is **unverified**. It returns the first error code; exact `Get ( LastError )` precedence is **unverified**. |
| Calculation and summary target fields | Documented: cannot import into them. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Mapping omits those target fields; stored calculations recompute from imported normal fields. |
| Global target field | Documented: last imported item determines the global value. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Store global assignment runs per imported row. Failed-row interactions are **unverified**. |
| Relationships and lookups | Documented: import into the table that owns a related field; auto-enter lookup data can overwrite incoming values when selected. [Importing data](https://help.claris.com/en/pro-help/content/importing-data.html), [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Writes one target table; auto-enter lookups run when enabled. Relationship-side effects and exact lookup order are **unverified**. |
| `OnRecordCommit` | Documented: Import Records applies directly to table data and does not activate script triggers. [Triggers](https://help.claris.com/en/pro-help/content/actions-dont-activate-triggers.html) | Import writes do not fire this trigger; a pending active-record commit before import is a separate event. |
| Open Transaction | Documented: Import Records participates in a transaction; Skip auto-enter overrides the import option, and when not skipped auto-enter runs at Commit Transaction; import summary is hidden. [Open Transaction](https://help.claris.com/en/pro-help/content/open-transaction.html) | Rollback/commit and skip override are present. Auto-enter currently runs on each imported write, so commit-time timing is a **known gap**. |
| Found set after import | Documented: imported records become the found set; after Update it contains updated and newly added records. [Mapping](https://help.claris.com/en/pro-help/content/import-action-field-mapping.html) | Successful add/update/replace IDs are shown, errors excluded. Exact placement of records with every mapped field skipped is **unverified**. |
| Modification IDs | **Unverified** for the imported record's exact ID increment and failed-field retries; the Import Records pages do not specify it. | Create returns mod ID 0; a successful update increments once per successful write. |
| Error codes and counts | Documented: Import Summary has counts of records added/updated, records skipped, and fields skipped. The [error-code list](https://help.claris.com/en/pro-help/content/error-codes.html) defines individual codes, but Import Records does not specify which one survives multiple failures. | Script result exposes `Get ( LastError )` and found count, not the three summary counters; first failure is retained. Exact aggregate/error precedence is **unverified**. |

## KNOWN: current runtime choices and gaps

This table records current behavior for tuples marked unverified and the documented Claris options this checkout does not yet implement. It is not a guess about Claris.

| Key | Current rule |
| --- | --- |
| `names` | Import mapping is positional, even for named sources. |
| `last-order` | No persisted last-import mapping; absent mapping uses target creation order. |
| `auto-unspecified` | Store default runs auto-enter; no per-field import switch. |
| `repetitions` | Keep one row, map group-separated values to repetitions, clear missing repetitions on update; no split mode. |
| `serial` | Explicit imported serials do not advance the field's next serial value. |
| `global-failure` | Global values are assigned by the store during each row's write attempt; failure ordering is unverified. |
| `transaction-timing` | Auto-enter runs on row writes within the transaction, rather than being deferred to Commit Transaction. |
| `errors-counts` | First error code is retained; Import Summary's three counters are not exposed by the scripted result. |
| `modification-id` | Add begins at 0; each successful update increments by 1. |
| `hosted-found-set` | The hosted source reader is available; exact open-window found-set selection is unverified. |

## Synthetic verification

The existing `import-records.test.ts` source/action matrix covers CSV, TSV, XLSX, FMPXMLRESULT and a hosted file against Add, Update and Replace. Its option cases cover matching fields, add remaining, auto-enter, repeating values, serials, calculations, validation, privileges, transactions and found sets. This change added **three** unique-collision cases (one per action) and **one** mid-file record-validation case. No corpus files or customer records were read.
