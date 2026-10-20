# FileMaker Server migration and sync runbook

Use this when moving a hosted file from FileMaker Server or keeping a trial
Tabularius copy in step. Work on a copy of the FileMaker Server folder after
closing the source files. The migration command reads the Admin API and copies
hosted files and external container folders; the sync commands exchange records
through the Data API. Claris documents the Admin API as version 2 and directs
record access to the Data API ([Admin API introduction](https://help.claris.com/en/admin-api-guide/content/index.html),
“version 2” and “access data”).

## Prepare

1. Keep an untouched source backup. Make sure the source files are closed or
   quiescent before copying; a file that changes during copying is rejected.
2. Check free space for the source files, their external container folders,
   and staging copies. Use `tabularius migrate-fms <folder> --fms-dir <fms-folder>
   --from <server-url> --dry-run` to inspect the list and size.
3. Supply the Admin Console password at the prompt or only for this invocation
   in `TABULARIUS_FMS_PASSWORD`. Do not put it in `--save` exports or sync JSON.
   The export holds server configuration, not the password.

## Copy and resume

Run `tabularius migrate-fms <folder> --fms-dir <fms-folder> --from
<server-url>`. It reports files checked and an elapsed-time ETA. Files and
external container folders are staged and SHA-256 checked before being made
visible. A stopped run can be repeated with the same command. Existing files
and container folders are checked against the source; a difference is an error
to investigate rather than an automatic overwrite. An abandoned hidden
`.tabularius-migrate-*` staging directory can be removed after no migration
process is running. Do not remove `.openhbam-*` state files.
If the live Admin API cannot provide its database or schedule list, the export
stops rather than treating the missing list as empty. Claris lists “List
databases” and “List schedules” as supported FileMaker Server calls
([List of Admin API calls](https://help.claris.com/en/admin-api-guide/content/admin-api-calls.html)).

Read the final file and schedule lists. A missing file is left out, with its
name in the output. Confirm the expected hosted files and external container
folders are present before serving the new folder. The existing
[migration guide](../ADMIN.md#moving-from-filemaker-server) lists schedule,
certificate, and encrypted-file limits.

## Sync and reconcile

Create `sync.json` as described in the [sync guide](../ADMIN.md#keeping-a-filemaker-server-copy-in-step).
Use `tabularius sync-plan <folder> <database> --config sync.json` to inspect
conflicts before writes. Run `tabularius sync-apply <folder> <database> --config
sync.json --write --pull` when both directions are intended. The configuration
must explicitly allow writes. Add `--allow-deletes` only when the planned
deletions are intended. Use a password prompt or a process-scoped
`TABULARIUS_FMS_PASSWORD`; neither the sync configuration nor its log stores
the password.

Claris documents range reads with `_offset` and `_limit` and describes their
values as a “starting record” and a “maximum number of records”
([Get a range of records](https://help.claris.com/en/data-api-guide/content/get-range-of-records.html)).
Tabularius checks page counts and reads empty and multi-page layouts twice before it
plans. If either pass changes, the table pauses; wait for the source to settle
and run the command again. A timeout or stopped write is reconciled by UUID and
the sync log on the next run. Use `tabularius sync-log <folder> <database>` to
see what completed or was interrupted. Claris documents a single-record read
by record ID ([Get a single record](https://help.claris.com/en/data-api-guide/content/get-single-record.html),
“record ID”), which the adapter uses during reconciliation.

The apply output reports planned record steps processed and an ETA derived from
the measured rate. After every live apply it makes a fresh source connection
and reports exact local and remote counts, SHA-256 checksums for up to 16
deterministically sampled keyed records per table, and SHA-256 hashes of local
table versus remote layout field-name lists. Differences are printed plainly.
Claris documents `fieldMetaData` for layout metadata
([Get layout metadata](https://help.claris.com/en/data-api-guide/content/get-layout-metadata.html),
“fieldMetaData”). The field-name hash is a scope-limited design comparison;
it is not a full FileMaker schema equivalence check. A sample match is not
proof that every record matches. Resolve any differences, run the sync again,
and check the fresh verification output and pending changes in `sync-plan`.

## Stop conditions

| Output | Action |
| --- | --- |
| `changed while it was read` | Pause writes to the source and rerun; no plan is made from the mixed page set. |
| `differs from the source` during migration | Compare the source and destination copy; preserve both until the discrepancy is understood. |
| A held conflict or deletion | Review the record policy or delete opt-in, then rerun. |
| `DIFFERENCE` in verification | Check the counts, sampled checksums, or field lists named in the report; rerun after correction. |

The Data API does not provide a documented transaction snapshot across these
range requests; an atomic cross-server migration and timing under concurrent
writes are **unverified**. Keep the source quiet for the final pass. <!-- known-difference: Data API ;; Whether a migration or sync run over the Data API sees one consistent snapshot while the source takes writes is unverified; the range requests are not wrapped in a transaction ;; A record written on the source during a run can be missing from, or half-present in, the copy ;; A FileMaker Server run that migrates while a script writes to the source -->
