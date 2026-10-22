# r25-11: Filesystem check/use audit and fixes

<!-- known-difference-file: File system races ;; The behaviour under failed or racing file operations is tested only on a local macOS run with injected failures; Linux and Windows behaviour and every other file system or platform error is unverified, and no Claris behaviour is claimed ;; On another platform or file system a failed write, rename or link may leave a different state than the tests show ;; A run of the same failure-injection tests on Linux and Windows -->

Status: targeted hardening and regression coverage delivered; the full hostile-concurrency invariant remains open. The tests establish behavior at the injected boundaries, not atomic containment under arbitrary concurrent filesystem mutation.

No earlier path-link audit notes were available to this work, so it used the implementation and existing tests as its baseline. No corpus files were opened. No Claris behavior is claimed as documented here; Claris compatibility beyond the tested Tabularius behavior is **unverified**.

## Existing defenses retained

The baseline already had container path validation and approved mounts, exclusive external-container creation, private `mkdtemp` directories for several script/container/thumbnail operations, randomized export/atomic-write staging names, and restore journals with rollback. These were retained and extended. Data-at-rest names were preserved.

## Changes and evidence

Locations below are relative to the repository root.

| Area | Implementation | Fix and regression evidence |
| --- | --- | --- |
| Shared boundary | `packages/store/src/fs-boundary.ts:25`, `:75`, `:183`, `:205`, `:220` | Scoped `AsyncLocalStorage` hooks inject actions after checks and after opens. Unarmed hooks do nothing. Guarded opens defer truncation until descriptor identity checks, reject writable hard links, use exclusive creation for missing leaves, request no-follow/nonblocking opens, and default to mode 0600. Parent snapshots detect changes at the boundary. Rename/link/remove checks and inode-bound cleanup reject changed entries. Tests cover leaf swaps, parent renames/symlinks, hard links, deleted temps, read-only directories, injected ENOSPC, private modes, self-copy, and cleanup sentinels. |
| Containers | `packages/store/src/store.ts:1190`, `:1273`, `:6572` | Verified descriptor IO, external writes with compatible umask-filtered permissions, cleanup bound to the created inode, transaction rollback cleanup, and private backup destinations. Tests check no field commit after failed external writes and no outside sentinel access. |
| Atomic writes and restore journals | `packages/store/src/durable.ts:37`, `:178`; `packages/server/src/restore-files.ts:3` | Exclusive private staging, guarded publication, inode-bound cleanup, guarded journal reads. Tests delete/swap staging entries and verify restore rollback. |
| Uploads | `packages/server/src/uploads.ts:204`; `packages/server/src/container-uploads.ts:103`, `:135` | Exclusive private spool files, private directories, guarded writes, and captured cleanup authority. Tests swap spool leaves/parents, add hard links, and check rejected operations preserve outside sentinels. |
| Plug-in installation/loading | `packages/plugins/src/package.ts:208`, `:242`; `packages/plugins/src/sandboxed.ts:130` | Random private install staging replaces predictable staging. Cleanup captures existing entries. Integrity checking uses the exact manifest/main buffers subsequently executed, eliminating their check/reopen gap. Install records reject traversal names. Tests inject installation failure and swap executable content around loading. |
| Backup/restore targets | `packages/server/src/backup.ts:204`; `packages/server/src/backup-external.ts:114`; `packages/server/src/backup-verify.ts:23` | Private staging/native backup outputs and guarded copies/reads/publication. Deduplication links only private regular files; legacy public-mode backups are copied privately without changing older backup permissions. Identity failures do not fall back to a fresh copy. Tests cover replaced sources, native destination permissions, legacy copies, and restore rollback. |
| Documents sandbox, Insert File, Export Records, folder imports | `packages/scripts/src/engine.ts:6773`, `:6833`, `:7045`, `:7877` | Canonical contained paths feed guarded data IO; deletion/movement preserves stable alias entries and requires both target and parent containment. Export staging is exclusive/private and checked before use/publication. Folder imports retain canonical allowed file targets. Tests cover read/write/append races, export staging swaps, Insert File, import failure without partial rows, contained aliases, alias movement/deletion, and an outside-parent alias bridge. |
| Thumbnail temporary files | `packages/server/src/containers.ts:367` | Guarded private converter inputs/output reads and inode-bound directory cleanup. A synthetic converter test runs under the stub PATH. |
| Encryption files | `packages/server/src/encrypt.ts:10`, `:82`, `:171` | Guarded private input/output opens and descriptor writes, including short writes. Input descriptors close if opening the output fails. Tests verify permissions, refusal of unsafe destinations, and descriptor closure. |
| Log rotation | `packages/server/src/stats-log.ts:24`; `packages/server/src/server-logs.ts:127` | Guarded appends/reads/renames. Rotation ignores only missing files; other failures retain pending lines. Tests replace rotation entries and retain outside sentinels. |
| Service-install files | `packages/cli/src/service.ts:223` | Direct placement uses guarded writes; system-install staging uses a random private directory and exclusive private file. Command-free tests exercise placement. Actual service installation was not run. |

New regression files: `packages/store/test/fs-boundary.test.ts`, `packages/scripts/test/fs-races.test.ts`, and `packages/server/test/fs-races.test.ts`. `packages/store/test/support/stub-path.ts` supplies command stubs that write a marker and exit 99; test exit fails if the marker exists. The PATH contains stubs for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, `sudo`, and additional installer/network commands, plus the current Node executable. Tests generate their own data.

## Review

A read-only security review by a different model than the author found, and the work fixed, these: cleanup through replaced parents, missing-entry cleanup authority, stable alias compatibility and entry semantics, outside-parent alias bridges, legacy backup link permissions, self-copy truncation, native backup destination modes, and retrying a failed identity check as a fresh copy. The final review reported no further concrete findings in the remediation pass. It did not independently execute tests or establish the unresolved invariant below.

## Remaining gaps

* Node's portable filesystem API does not provide the descriptor-relative open/rename primitives needed to guarantee containment against hostile concurrent parent-directory replacement. A change after the last pathname check can still redirect a syscall; post-open validation can reject the operation after a private file has already been created elsewhere. A local directory-descriptor path probe was not a usable substitute. These folders must remain under trusted ownership; this patch is not a proof against an attacker who can continuously mutate their ancestry.
* Link-count and mode checks likewise do not serialize a hostile actor's later changes. Descriptor IO prevents reopening a swapped leaf, but cannot prohibit a concurrent actor from linking, moving, or changing permissions on the inode afterward.
* SQLite backup/open APIs, external thumbnail converters, and elevated service installation reopen pathnames. Surrounding checks and private staging reduce exposure but cannot make those APIs atomic. Their final syscall boundaries are not fully injectable through this layer.
* Some metadata/listing, recursive directory creation/copy/removal, startup cleanup, backup/restore tree operations, and upload conversion/host handoff still use pathname APIs outside the integrated boundary. In particular, this is not complete coverage of every PluginFiles/MBS Files.* operation. Recursive cleanup has additional traversal boundaries beyond the captured top-level entry.
* Failure injection includes ENOSPC exceptions, real permission changes, deletion, renames, symlinks, and hard links. It does not physically exhaust a disk or test every filesystem/platform error. Only local macOS execution was performed; Linux and Windows behavior remains unverified.
* The missing audit/follow-up documents could not be reconciled. No service, upgrade, installation, network download, commit, or push operation was performed. Existing server status tests attempted a Git metadata lookup in an earlier run; the stub intercepted it and failed the run, so the real Git executable did not run. The final run used synthetic build metadata to avoid that lookup entirely.

## Validation

Final combined run: **142 passed, 0 failed, 0 skipped**, 24.36 seconds total. Each file therefore completed below the requested 60-second budget. TypeScript: exit 0, no diagnostics. No fixture-dependent test was required in this selected suite.

The server status tests need a synthetic `packages/server/build-info.json` to avoid their Git fallback. This temporary file was created only after checking it was absent, and removed after the run. For reproduction in a checkout without that file:

```sh
python3 - <<'PY'
from pathlib import Path
p = Path('packages/server/build-info.json')
with p.open('x') as f:
    f.write('{"commit":"synthetic-filesystem-test"}\n')
PY

node --import ./packages/store/test/support/stub-path.ts --test --test-concurrency=2 \
  packages/store/test/fs-boundary.test.ts \
  packages/scripts/test/fs-races.test.ts \
  packages/server/test/fs-races.test.ts \
  packages/store/test/external-containers.test.ts \
  packages/store/test/durable-temp.test.ts \
  packages/plugins/test/package.test.ts \
  packages/plugins/test/install-robustness.test.ts \
  packages/plugins/test/sandbox-files.test.ts \
  packages/scripts/test/import-folder.test.ts \
  packages/scripts/test/export-import-roundtrip.test.ts \
  packages/server/test/backup-external.test.ts \
  packages/server/test/backup-durability.test.ts \
  packages/server/test/backup-stop.test.ts \
  packages/server/test/backup-disk.test.ts \
  packages/server/test/restore-recovery.test.ts \
  packages/server/test/thumbnail-cache.test.ts \
  packages/server/test/stats-log.test.ts \
  packages/server/test/upload-idle-sweep.test.ts

python3 - <<'PY'
from pathlib import Path
p = Path('packages/server/build-info.json')
assert p.read_text() == '{"commit":"synthetic-filesystem-test"}\n'
p.unlink()
PY

node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

The selected integration tests require local loopback listeners. Execution permission was granted for those tests; the command stubs remained active. The last source edit after the combined run only removed an unused import; typechecking was repeated afterward.

## Item review remediation

All three subsequent cross-model findings were reproduced with generated data and fixed; no findings were rejected or deferred.

* **MED, stable parent aliases:** parent snapshots now accept directory symlinks and verify both the alias entry/resolved destination and the resolved directory ancestry. Durable directory flushing resolves directory aliases before opening them. The regression invariants are that stable aliases permit synchronous/asynchronous reads, writes, state replacement and directory flushing; generated process counters remain readable through a relative `self` alias; and replacing an alias, its target or its target's parent is still refused at both open boundaries without changing original bytes.
* **MED, external-container permissions:** open external storage again creates files with `0666 & ~umask`. The effective mode is passed explicitly because the guarded open also applies descriptor permissions. A regression checks masks `022`, `027` and `077`, alongside the unchanged path-handling assertion. The existing race test retains its `0600` assertion with an explicit `077` umask; all its refusal and rollback assertions remain intact. Private spool, backup and state defaults are unchanged.
* **LOW, premature truncation:** pathname `writeFileSync` defers truncation until after its descriptor write check. The regression invariant is that a hard link introduced at that check causes refusal while preserving the bytes under both names. This fixes the demonstrated ordering error, without claiming serialization against changes after the final check.

The ten new invariant tests failed before the fixes. The focused post-fix run passed all 71 tests, including `path-handling.test.ts`, in 49.45 seconds total, keeping each changed test file below 60 seconds. No dependencies were added; data-at-rest names were retained.

Final remediation validation: `npm run typecheck` passed both TypeScript projects. The 18-file combined suite listed above, plus `packages/server/test/path-handling.test.ts` and `packages/store/test/durable.test.ts`, passed **182 tests, 0 failures, 0 skips** in 103.89 seconds. It used `--test-concurrency=2`, the command-stub preload, generated data and temporary synthetic build metadata; the metadata was removed afterward. No Git command, commit or push was run.
