# Container storage audit (r25-20)

<!-- known-difference-file: Container fields ;; Insert File's reference option (store only a link) is not offered, so Tabularius embeds the bytes, and Claris's exact reference and cache behaviour for externally stored containers beyond its documented statements is unverified ;; A script that inserts a file as a reference gets an embedded copy instead, and external container storage can behave differently from FileMaker ;; A FileMaker run of Insert File by reference and of external container storage -->

## Baseline and scope

The requested `audit-corruption.md` and r24-07 round-trip report were absent from this checkout. Existing code already provided external move in/out with crash recovery, explicit orphan reporting and purge, resumable uploads, external-file backups, and container cache version tokens. This change builds on those paths. All new tests use generated data.

Claris documents that container data is embedded by default and that external storage may be secure or open ([Setting up container fields to store data externally](https://help.claris.com/archive/fm20/en/pro-help/content/store-data-externally.html), “by default embedded”). It documents that a self-contained copy embeds external container data ([Saving and copying files](https://help.claris.com/en/pro-help/content/saving-copying-files.html), “embedded in the file’s container fields”). It also documents Insert File's reference option ([Insert File](https://help.claris.com/archive/help/13/fmp/en/html/scripts_ref1.36.58.html), “store only a link”). Tabularius does not implement that reference mode; its script Insert File path reads and embeds bytes. Exact Claris reference and cache behavior beyond those statements remains **unverified**.

## Model and findings

- New embedded uploads with equal bytes, name, and MIME share a container row by SHA-256, but only within the same table field; fields never share a row, so a move to open external storage cannot carry another field's data with it. The digest is computed from the bytes, including spooled uploads; a caller's announced hash is not trusted as a storage key, and candidate stored bytes are checked again before reuse. Distinct metadata retains distinct rows. Legacy rows are not rewritten.
- Reference counts are reconstructed from live records and retained undo sources for each report or purge. Purge now takes the database write lock before its scan, preserving any row another writer referenced first. A same-process backup lease makes purge and moving files back into the database fail with 301 while a backup is active (they are refused, not deferred). Undo sources that name a table or field now in design trash are kept as potential container references, so restoring the table or field and then a record still finds its file. Resumable upload parts live outside the store's container table and survive its purge.
- An interrupted external write now removes its partial file, and field assignment runs as one database transaction. A saved copy embeds external files before it is delivered; a missing or size-changed file rejects the copy and removes its incomplete output (earlier builds saved such a copy without the file). The copy is published with an exclusive hard link, falling back to an exclusive file copy where the file system cannot hard-link, and is written with the rollback journal so nothing stays in a write-ahead log.
- The integrity summary counts referenced rows, rows with multiple references, orphans, missing rows, missing or size-changed external files, and chunk rows without a container. It appears in the admin orphan endpoint and `tabularius optimize --json`. Orphan byte counts now include chunked bytes. Purge removes dangling chunks.

## Synthetic evidence

The focused model suite passed 16 of 16 cases: shared writes, two sequential connections (not concurrent), concurrent child processes, corrupted candidate bytes, chunked orphan size, backup lease, open upload resume and cap, self-contained copy and clone, export/insert round trip, interrupted write, SQLite full, integrity counts, and a forced-exit move recovery. The existing external storage and orphan suites passed 26 of 26 cases; two synthetic optimization move checks passed. The external backup/restore suite passed 2 of 2 cases; four thumbnail worker checks passed. TypeScript and generated-reference checks passed.

The forced-exit child used a stub executable search path for service, install, network, package, and version-control commands; its marker remained absent. No corpus files were opened. The fixture-backed admin/MCP server test could not bind a loopback port in this sandbox, so that route's new response shape has only typecheck coverage here.

## Second-model review

An independent review reproduced three defects, all fixed here with regression tests: identical bytes uploaded to two fields shared one row, so moving one field to open storage moved the other's file (including a secure-storage field's) out of the database; purge dropped undo references for a table or field in design trash (the second also exists on main); and moving files back in could delete an external file a running backup still needed. Smaller points: the "purge takes the write lock first" and "lease used by backup" statements are supported by code reading, not by a dedicated test; the lease test calls the lease directly rather than through the backup.

## Remaining limits

- The integrity summary is approximate: `shared` counts undo-history references as well as records, and `missingRows` can over-count when a non-container field sits in design trash. Both err toward keeping rows.
- A shared row keeps the first uploader's stored time.
- Same-field deduplication checks that the field already holds the row with a table scan, so uploading a duplicate into a very large table costs one scan.

- Deduplication shares a row only when display metadata also matches. Full payload sharing across different filenames or MIME types needs a separate content table and migration.
- Retained audit and undo history can keep replaced blobs indefinitely. Repeated identical uploads have bounded row growth, and explicit purge reclaims rows only after all retained references are gone. Arbitrary distinct replacements therefore have no automatic storage bound without an undo-retention policy.
- The backup lease covers backups and purge in one process. A backup in another process is not coordinated by that lease.
- `tabularius doctor` remains read-only and does not scan container references; use the admin integrity summary or `tabularius optimize --json` for these counts.
- The streamed-write test forces a short source after a partial write, and the database test forces `SQLITE_FULL`. An external-filesystem `ENOSPC` fault was not injectable in this sandbox.
