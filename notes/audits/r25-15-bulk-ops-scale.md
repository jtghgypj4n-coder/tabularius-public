# r25-15 bulk operations at scale

## Scope and existing behavior

The store already had an opt-in SQL trace hook and WAL checkpoints. Script record loops already committed per record, yielded every 256 checkpoints, and honored the existing Stop request. This work adds counting to that hook, progress, streamed paths, and regression coverage. The generated profile runs the ten requested operations on a new synthetic file. Its default is 1,000,000 rows; `--rows 20000` is the CI-sized profile. No customer or fixture data is read.

## Budgets and measured results

See [performance.md](../../docs/performance.md#bulk-operations) for operation counts, elapsed time, RSS, and WAL measurements. The profile enforces an absolute RSS ceiling of 512 MiB at 20,000 rows and 1,536 MiB at 1,000,000 rows; peak sampled WAL size must stay below 32 MiB and 256 MiB respectively. Each operation has an explicit statement and rows-written ceiling in `scripts/bulk-scale.ts`. The counters are opt-in via `TABULARIUS_COUNT_SQL=1`: statements count prepared `.get`, `.all`, `.run`, and `.iterate` calls; rows written sum SQLite's `.run().changes`. They do not count `exec` statements, trigger side effects, or rewritten database pages. WAL is sampled every 50 ms and at operation end, so a short-lived peak may be missed.

## Progress, Stop, and partial results

Script bulk steps report an operation name and completed/total counts at the start, every 256 records, and at completion. The authenticated web client polls the running session's progress endpoint and offers Stop. Web text, XML and HTML exports write in 500-record pages and honor response backpressure and Stop. Imports yield every 500 records. Planned Add imports preview 2,000 rows when the file has over 20,000 rows, then process the complete input iterator. A stopped import reports the committed prefix and keeps that prefix in the Undo journal. Record writes and deletes finish one record before the next Stop check; a stopped export may leave a partial download. Script sorts yield every 256 keys or results, check Stop, and replace found-set order only after completion. The calculated-field sort now evaluates the requested records' values instead of sorting empty SQLite columns.

These are **Tabularius** results. Where Claris documentation does not specify a mid-operation cancellation boundary or partial result, that Claris behavior is **unverified**:

| Operation | Claris documentation | Tabularius Stop result |
| --- | --- | --- |
| Replace Field Contents | [Replacing field contents](https://help.claris.com/en/pro-help/content/replacing-field-contents.html) says “You can't undo replacing field values.” | Completed records stay committed; the next record is untouched. Claris mid-step partial result: **unverified**. |
| Delete All Records | [Delete All Records](https://help.claris.com/archive/fm20/en/pro-help/content/delete-all-records.html) says it locks and deletes groups, stopping on a group lock failure. The group size is unspecified. | Each completed record stays deleted; the rest remain in the found set. Claris user-Stop result: **unverified**. |
| Omit Multiple | [Omit Multiple Records](https://help.claris.com/en/pro-help/content/omit-multiple-records.html) says it “temporarily hides” records from the found set. | The found set changes without a database write. It completes as one in-memory step. Claris Stop result: **unverified**. |
| Import Records | [Importing data](https://help.claris.com/en/pro-help/content/importing-data.html) documents adding, updating, and replacing data. | Completed rows stay committed; planned Add can Undo its completed prefix. Claris Stop result: **unverified**. |
| Export Records | [Exporting data](https://help.claris.com/en/pro-help/content/export-records.html) documents exporting the found set. | Stop ends the stream; a partial download can remain. Claris partial file behavior: **unverified**. |
| Duplicate Record loops | [Records script steps](https://help.claris.com/en/pro-help/content/records-script-steps.html) lists Duplicate Record/Request. | Completed duplicates stay committed. Claris loop Stop result: **unverified**. |
| Find/Replace | [Perform Find/Replace](https://help.claris.com/en/pro-help/content/perform-find-replace.html) documents “Replace All.” | Completed replacements stay committed. Claris Stop result: **unverified**. |
| Sort, including calculated fields | [Sorting records](https://help.claris.com/en/pro-help/content/sorting-records.html) documents canceling a sort. | A stopped script sort retains the original found-set order. Claris sort cancellation result: **unverified**. |
| Script loop with commits | [Commit Records/Requests](https://help.claris.com/en/pro-help/content/commit-records-requests.html) says it “Commits a record or find request.” | Each committed iteration remains; the next iteration is untouched. Claris loop Stop result: **unverified**. |

## Boundaries still to address

The web import and export paths have a 50 MB upload limit for import. The existing XLSX export still builds its workbook in memory, and planned Update/Replace imports still materialize their rows. A stored-field SQL sort can pause the event loop while SQLite prepares its first ordered row, and the final in-memory calculated-key sort is synchronous; progress and Stop are available during record/key traversal. Related-field or privilege-masked script sorts retain their existing synchronous path. The 1,000,000-row profile is provided for an extended run, but only the 20,000-row profile has been measured here. These limits prevent claiming that every format and every sort has bounded responsiveness at one million rows.
