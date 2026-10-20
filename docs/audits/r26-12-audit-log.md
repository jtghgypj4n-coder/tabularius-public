# r26-12 audit log: completeness, integrity and output safety

The existing implementation provides hash-chain verification, signed external anchors and substantial security-event logging. It does **not** provide a complete security audit trail. This pass audits completeness and integrity without changing their behavior, and fixes output safety as explicitly requested. It does not certify compliance or Claris equivalence.

## Prior work retained

Read first: `packages/store/src/audit-anchor.ts`, the security and record chain implementations, CLI verification, security-event definitions, and the corresponding store/server/CLI tests. The checkout already implements `tabularius audit verify`, `--chain security|records`, `--sign-key` and `--check`, read-only verification workers, transactional security appends, record retention checkpoints, and tamper/concurrent-writer tests. Those implementations remain intact. No files identified as r19/r25 audit reports were found in docs/notes; attribution to those rounds could not be established without history. No git command was used.

## Completeness

The [generated matrix](r26-12-action-matrix.md) inventories **436 method/path actions and 216 script steps**, from the existing REST route tables and `SCRIPT_STEP_NAMES`. Classification is explicit per action in `scripts/audit-classifications.json`; missing, stale and invalid classifications fail the test. Route expressions are checked against their source-specific reference groups. Reviewed source digests in `scripts/audit-route-sources.json` also fail on routing-source changes, including a new method behind an existing path. Updating a digest requires reviewing the method/path classifications; the report generator deliberately does not update digests or classifications.

These are conservative classifications of action families, not 652 successful behavioral probes. A partial family can include a read or delegated operation which writes no event. Public/local classifications exclude privileged effects performed later by other actions. The scanner inherits the reference generator's static expression grammar; dynamically registered routes or protocols outside these route/step tables require separate review. MCP tool-level, CLI command-level, plug-in capability and pgwire operation inventories are not exhaustively enumerated here.

Required event dimensions are actor, address under an explicit privacy policy, object and outcome. Success is often implicit in an event kind; failures have selective dedicated kinds, not a universal outcome field. No universal no-secret guarantee was established. A synthetic probe of four password/token mutations found **4 missing actors and 4 missing addresses**, even inside an attributed writer, and **0 occurrences of the supplied password/token secrets**. An HTTP probe of two admin sign-in outcomes and one configuration write found **0 added security entries**.

| Required action | Existing evidence | Missing coverage / dimensions |
| --- | --- | --- |
| Sign-in success/failure | `Store.auditSignIn`; session entry points call it | Admin console sign-ins have no chained event; stateless MCP authentication is deliberately excluded. Object is usually implicit in account. |
| Lockout/unlock | `store.ts` lockout callbacks and `auditLockoutCleared` | Console lockouts are separate in-memory state; unlock lacks acting account. Address lockout can lack account by construction. |
| Password changes | `setPassword` emits added/changed | Caller/address absent in sampled events; rejected attempts lack universal outcomes. |
| Privilege-set edits | saved/deleted/assigned kinds | Actor/address vary by method; unsuccessful edits are not universally logged. |
| Account create/delete/enable | added/removed/enabled/disabled kinds | Some methods accept actor metadata, others omit it; address/outcome not universal. |
| Token create/revoke | API/SCIM token event kinds; bearer values excluded in sampled operations | API-token actor/address absent; revoke object is an ID inside detail rather than a uniform target field. |
| Design changes | `applyDesign` emits a batch count and op histogram | Actor depends on caller; address absent; individual objects are not all named; denied batches not universal. |
| Schedule changes | Console `handleSchedules` and Admin API schedule routes | No universal chained create/update/delete/run event. |
| Restore | Record restore writes record changes; file restore restores backup history | File restore has no durable chained event tying old/new heads, actor, address and outcome together. |
| Backup deletion | Retention removes old sets in `backupFolder` | No per-set security event; no uniform actor/address/object/outcome. |
| Plug-in install | `auditPluginInstall` records installed/refused outcomes from the script installer | Actor optional, address absent; administrative enable/disable/secret edits are separate gaps. Arbitrary failure text was not proven secret-free. |
| AI settings | AI on/off, policy, isolation and masking kinds | Partial per-file coverage; provider configuration, caller/address and failed settings changes are not universally covered. |
| Outbound-mail enable | Server configuration / startup policy | No universal security event for enabling outbound mail. Sending mail is a different action. |
| Data export | Read logging is optional; export steps perform output | No mandatory export event with destination/object, actor, address and outcome. |
| Bulk record deletes | Per-record deletes or truncate count in record chain | Actor depends on caller; address absent; failed/denied operations are not universally recorded. |
| Admin API calls | Some delegated store writes produce events | No universal request audit, including authenticated reads and failures. Ordinary server log strings are not chained security entries. |
| Config changes | Some per-file security settings have specific kinds | Folder/server configuration changes lack universal chained events. |

Primary source locations: `packages/store/src/store.ts` (`logSecurity`, `audit`, security mutation methods), `packages/server/src/admin.ts` (`handle`, `handleSchedules`, `handlePlugins`), `packages/server/src/adminapi.ts`, `packages/server/src/backup.ts` and `packages/scripts/src/engine.ts` (export/mail/installation steps).

**Privacy finding:** `docs/privacy.md` describes outbound information but specifies no audit-address minimization or retention policy. Existing sign-ins accept a caller-supplied `from` value; record events do not have an address column, and some denial events use a surface as `from`. “Address per the privacy doc” cannot currently be certified. No privacy policy was invented or silently applied to stored evidence.

## Integrity

The existing operator command remains:

<!-- docs-example: illustrative -->
```sh
tabularius audit verify HOSTED_FOLDER DATABASE --chain security --sign-key OPERATOR_KEY
tabularius audit verify HOSTED_FOLDER DATABASE --chain security --sign-key OPERATOR_KEY --check ANCHOR.json
```

Use the `anchor` object from the first result as `ANCHOR.json`; repeat with `--chain records` for record history. Keep anchors and signing keys outside the server's write authority. An anchor protects its prefix, not events written after it. Verification exit codes remain 0 for consistency/matching anchor, 1 for broken history/anchor failure, and 2 for unprotected history.

| Case | Evidence / result |
| --- | --- |
| Edit stored event | Existing security and synthetic record tests detect altered hashes. |
| Delete middle / reorder | Existing security tests detect both; record tests cover missing/out-of-order history. |
| Truncate tail, retain head | Existing security and record verification detect missing tail. |
| Truncate tail and rewrite head | A locally consistent chain cannot detect this by itself; external anchor detects loss at the anchored position. |
| Replace whole history | Synthetic CLI and store tests detect mismatch/missing against an external signed anchor, even when replacement verifies internally. |
| Append after anchor | Signed prefix continues to match; anchor is not a requirement to freeze the log. |
| Concurrent workers | Four guarded child processes append 600 security events; one consistent chain survives reopening. SQLite transaction/lock behavior is retained. |
| Restore from backup | Real `restoreBackup` test restores a consistent older security and record chain; both newer external anchors report missing. Current password credentials survive reconciliation, but the corresponding newer password-change audit event does not. |
| Legacy / retention | Existing tests exercise unprotected histories, migration baselines and retained record checkpoints. These are not proof of earlier completeness. |

**Open integrity finding:** exported `anchorHead` uses a verifier's head without checking `ok`. A synthetic corrupt chain still gets an anchor from this helper. CLI checks `ok` before calling it, but verifies again through a separate call; this does not provide an atomic verified-and-signed snapshot against a hostile concurrent rewrite. No integrity implementation was changed in this read-only portion.

No anchor can distinguish an intentional authorized restore from an attacker rolling back to the same bytes. The operator must preserve the previous anchor, retain evidence of the restore decision, investigate the mismatch and explicitly establish a new trusted baseline. Automatically replacing the old anchor would erase the rollback evidence.

## Output fixes

`packages/store/src/audit-output.ts` provides presentation-only escaping. C0/C1 controls, format controls (including direction overrides/isolates), and Unicode line/paragraph separators appear as visible `\u{…}` text. Literal backslashes are escaped distinctly. Ordinary international text is preserved. Displayed text/CSV fields have a 4,096-code-unit escaped budget with an explicit original-length truncation marker. CSV formula-leading text still gets the existing apostrophe guard after display escaping. No attacker-controlled physical row separators survive inside audit CSV fields.

CLI audit text remains JSONL. Ordinary entries preserve decoded values while escaping otherwise invisible Unicode controls. An entry exceeding 65,536 serialized characters becomes a labelled preview containing its sequence, original character count and truncation flag. Consumers requiring complete oversized entries must use the stored evidence or authenticated JSON endpoint; they must not treat a preview as a full audit record.

The admin security, audit and record-history renderers apply the same bounded display rule before HTML escaping. Exact table identities remain in escaped action attributes so history/restore still address the correct object. Raw authenticated JSON API responses and stored/hash-covered bytes are unchanged. Existing HTML escaping is retained; this pass fixes visual control/direction and length attacks as well as CSV physical-row spoofing.

Regression coverage includes controls, newlines, direction overrides, long names, literal escape lookalikes, formula cells, HTML-like names, record table/change/source/script metadata, real CSV endpoints, real CLI output, and actual production renderer functions executed with a DOM adapter. The adapter is not a browser layout or accessibility test.

## Validation and review

All inputs are synthetic/generated. No corpus or fixture file was opened. Existing record-chain and CLI-anchor tests now generate their own stores. Child-process tests use a PATH containing only marker-writing stubs for launchctl, systemctl, sc, git, npm, curl and sudo; a marker fails the test. Children launch Node by absolute executable path. No service, install, upgrade, git-pull or external network command is run.

Small CI profile: Node meeting the repository engine requirement, 2 test workers, 2 CPU cores, 2 GiB RAM, 1 GiB free temporary disk. There is no corpus-scale requirement for this item and no larger-runner profile is needed. The concurrent-writer probe has a 30-second timeout and completed in under one second in the initial run; no timing assertions with tight margins were added.

```sh
node --test --test-concurrency=2 \
  packages/store/test/audit-output.test.ts \
  packages/store/test/security-audit-chain.test.ts \
  packages/store/test/record-audit-chain.test.ts \
  packages/cli/test/audit-verify-cli.test.ts \
  packages/server/test/audit-output.test.ts \
  packages/server/test/audit-ui-output.test.ts \
  packages/server/test/audit-completeness.test.ts \
  packages/server/test/audit-integrity.test.ts \
  packages/server/test/audit-matrix.test.ts \
  packages/server/test/security-audit-verify.test.ts \
  packages/server/test/admin-page.test.ts
node scripts/audit-matrix.ts --check
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

Final combined run: **75 passed, 0 failed, 0 skipped**, in 21.36 seconds. The slowest individual test was the CLI anchor scenario at under 16 seconds; all files stayed below 60 seconds. Matrix check: **652 classified actions, current**. TypeScript: **passed, 0 diagnostics**. After the review requested a positive current-password assertion, `node --test --test-concurrency=2 packages/server/test/audit-integrity.test.ts` passed **3/3**, with 0 failures.

Initial development runs caught a sandbox loopback-listening denial and one test typing error (surface/script belong to writer context); loopback permission and the test context were corrected before the final run. A restore assertion was corrected to check credential preservation, matching the implemented restore contract. These were not final-run failures.

A separate GPT-6 Astra read-only review found no confirmed exploitable escaping defect. It identified weak source/method drift detection and missing renderer/record-metadata regressions; this pass adds source digests, source-specific anchors, real renderer execution and expanded endpoint tests in response. The follow-up review found no blocking output-safety issue and requested the positive current-password assertion now covered by the passing restore test.

Not performed: universal completeness repairs, integrity behavior repairs, production or corpus inspection, live browser visual verification, full repository test suite, deployment, commits or pushes. Claris audit/restore/output equivalence is **unverified**; this report makes no claim about undocumented Claris behavior and uses no external quotations. <!-- known-difference: Privileges and security ;; Whether FileMaker's audit, restore and output behaviour matches this audit log is not settled ;; Nothing shows; the report makes no claim about undocumented Claris behaviour ;; A FileMaker run of the same audit, restore and output checks -->
