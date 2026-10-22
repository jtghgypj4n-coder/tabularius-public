# Plan and apply a sync

Use this guide when a hosted Tabularius copy must exchange records with the same solution on FileMaker Server during a migration or trial. Sync is an explicit plan-and-apply workflow; review the plan before writing to either side.

## 1. Choose the direction and scope

Identify the Tabularius file, FileMaker Server file, tables, and conflict policy before starting. Both copies need a UUID field and a modification timestamp field in each synced table. The FileMaker Server account needs the `fmrest` extended privilege and access to every record in the table. Make a verified backup first. Do not treat sync as a substitute for a backup or as a merge of arbitrary simultaneous edits.

## 2. Generate a plan

Create a `sync.json` configuration that names the FileMaker Server URL, database, sync account, and each local table / remote layout pair. Store the password in `TABULARIUS_FMS_PASSWORD` or enter it at the prompt; do not put it in the JSON file. Use the sync plan command to compare both copies. Review the proposed records in each direction and any conflicts. Confirm the file names and table policies before applying the plan.

<!-- docs-example: run -->
```sh
tabularius help sync-plan
```

The command's help describes required paths and available options. Keep the configuration and plan output with the change record so another operator can review what was applied. Before the first successful sync, differences are treated as conflicts unless a policy selects a side.

## 3. Apply and inspect the result

`sync-apply` is dry-run by default. Sending records to FileMaker Server requires both `allowWrites: true` in the configuration and `--write`; bringing records from FileMaker Server requires `--pull`. Conflict resolution must be explicit. Inspect the sync log and verification output, then sample records on both sides. If a plan reports an unexpected delete or conflict, stop and resolve it before applying.

## Check afterwards

- A backup is verified and can be restored.
- The reviewed plan targets the intended source, destination, and tables.
- The sync log and sampled records on both sides agree with the plan.

## References and differences

- [FileMaker Server migration and sync runbook](../../fms-migration-runbook.md) · [Backup and restore](../../tutorials/backup-and-restore.md) · [Known differences](../../known-differences.md)
- Conflict rules and plan output are Tabularius behavior. Source-side snapshot consistency across Data API requests is **unverified**; the runbook explains the stop conditions and limits. No parity with a FileMaker sync product is claimed. <!-- known-difference: Server operation ;; Source-side snapshot consistency across Data API requests is unverified ;; A sync that reads while the source changes may not be a consistent snapshot ;; A test that changes the source during a sync run -->
