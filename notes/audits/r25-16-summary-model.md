# r25-16: summary model audit

<!-- known-difference-file: Summary fields ;; Fraction of Total does not honour the Subtotaled option, GetSummary in a standalone calculation with no window sort keeps the earlier all-record grouping, the order of a List summary under a sort follows the found set, and which accented spellings break a sub-summary group is not specified by Claris ;; A summary or GetSummary result can differ from FileMaker's in those cases ;; A FileMaker run of each case -->

The reference model recomputes each supported aggregate from the current found set, then partitions the sorted set into consecutive runs for each break level. Eight deterministic seeds generated 48 records, sort directions, omissions, finds, and edits. The suite also covers empty and single-record found sets, null numeric inputs, text lists, calculations over summaries, related summaries, and canonical Unicode break values. All data is synthetic.

Claris's [Options for Summary Field dialog box](https://help.claris.com/en/pro-help/content/options-summary-field.html) says summary data "reflects records currently being browsed" and recalculates after an edit or found-set change. Its table defines total, average, count, extrema, standard deviation, and fraction. [GetSummary](https://help.claris.com/en/pro-help/content/getsummary.html) says the result is blank when the file "isn't sorted by the break field." These are the documented rules used by the model.

## Result

The synthetic store model passed for nine existing summary types. The web report handler was checked for grouped totals, the Data API serializer for totals and fractions, and the script path for GetSummary, Preview state, and PDF subtotal text. These checks run directly without starting a service or browser. A targeted run of seven test files passed 40 tests with no failures or skips; both TypeScript projects passed type checking.

The fixes made per-record fractions available in found-set reads, made list summaries follow the supplied record order, gave calculations over summaries the same found set as the record they appear on, evaluated calculated and global break fields for groups, grouped canonically equivalent Unicode text, and required an active break sort in script GetSummary.

## KNOWN

| Rule | Status | Evidence or limit |
| --- | --- | --- |
| Running total and running count, with restart by sorted group | Documented, not represented by the current field schema | [Options for Summary Field dialog box](https://help.claris.com/en/pro-help/content/options-summary-field.html): "Restart summary for each sorted group." No running or restart option is retained by the current schema or clipboard import. |
| Weighted average | Documented, not represented by the current field schema | [Options for Summary Field dialog box](https://help.claris.com/en/pro-help/content/options-summary-field.html): "Weighted average." The weight field is not retained. |
| Summarize repetitions together or individually | Documented, not represented by the current summary schema | [Options for Summary Field dialog box](https://help.claris.com/en/pro-help/content/options-summary-field.html): "All together" and "Individually." The current collector reads the first repetition only. |
| Fraction of Total with a subtotal field | Documented, not represented by the current field schema | [Options for Summary Field dialog box](https://help.claris.com/en/pro-help/content/options-summary-field.html): "Subtotaled." Base per-record fractions are covered; the subtotal option is not. |
| GetSummary in a standalone store calculation without window sort state | Known difference | The script path now follows the [GetSummary](https://help.claris.com/en/pro-help/content/getsummary.html) sort rule. Standalone `Store.evaluate` has no sort state and retains its earlier all-record grouping behavior. |
| List summary order under a sort | Unverified | Claris documents "non-blank values" in [Options for Summary Field dialog box](https://help.claris.com/en/pro-help/content/options-summary-field.html) but does not specify list order there. The model and implementation use found-set order. |
| Case and accent equivalence for English sub-summary breaks | Unverified | Claris documents that [sorting records](https://help.claris.com/en/pro-help/content/sorting-records.html) uses a field's language, but does not specify equality for each accented pair. The existing language-group behavior is retained; canonical Unicode spellings now group together. |

End-to-end browser rendering and live HTTP requests were outside this no-service test run. The direct Preview check verifies the sorted found set and mode; the PDF check verifies the emitted report text.
