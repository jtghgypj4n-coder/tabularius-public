# Secret-surface audit (r17g-04)

The regression matrix uses seven distinct synthetic credentials: password, API key,
token, container password, plug-in secret, SMTP credential, and S3 credential.
`packages/scripts/test/secret-seeds.ts` owns the seed table. Each boundary below is
exercised with every seed; assertions inspect actual serialized output, persisted
rows, file bytes, or rendered page state, rather than only the masking helper.

This audit extends `CredentialRedactor`, `REDACTED`, and `isCredentialName` from
PR #1207 (`claude/project-thread-mzj8h2-redaction-diagnostics`). That branch's helpers
were inspected with `git show`. Debugger and recording coverage belongs to that PR;
this change adds structured-output discovery and diagnostic-boundary coverage.
There is no process-wide registry of plaintext secrets.

## Sink table

Unless otherwise noted, test names below are in
`packages/server/test/secret-sinks.test.ts` and expand over all seven seed rows.

| Sink | Production boundary | Regression evidence and policy |
| --- | --- | --- |
| Process log callback / stdout | `serverLog` in `server-logs.ts`, used by `serve` | **logs and notification callback** captures the real callback; credential values are masked before either output receives them. **validation diagnostics retain the field and expected type** preserves `Invalid value for field Token: expected number` alongside a masked assignment. |
| Outbound webhook delivery failures | `Webhooks.deliver` in `changes.ts` | **webhook delivery failure logs only its id and endpoint host** exercises a failed synthetic delivery and inspects the raw callback, stdout callback, notifications and persisted Event log. Only the generated hook id and URL scheme/host (including port) identify the endpoint; userinfo, path, query and fragment are excluded. URLs echoed by errors are sanitized too. |
| Configured endpoint URLs in diagnostics | `redactDiagnosticText`, `serverLog`, `ServerLogs.write`; S3 off-site log callback | **configured endpoint URLs in diagnostics expose only scheme and host** covers HTTP(S), S3, SMTP(S), LDAP(S), PostgreSQL and MySQL with credentials in userinfo, path, query and fragment. **S3 failure callback removes endpoint URL secrets** checks the direct off-site callback. Review found no direct endpoint URL log calls in SMTP or LDAP; connection lifecycle logs name connections, and ACME/sync endpoint logs already select the host. |
| Event, Access, ScriptEvent, fmdapi and Admin logs; log downloads | `ServerLogs.write`, buffered persistence and close | Same test reads every actual log file. Downloads consume those files. Source and message are filtered before persistence. |
| Notification callbacks fed by logs | `ServerLogs.onEntry` | Same test captures callback arguments, after filtering. |
| Request path logging | `redactPath` | **request paths redact conventional secret parameters without hiding secretary** covers `sig`, `signature`, `key`, `token`, `code`, `X-Amz-Signature`, `X-Amz-Credential`, case variants and encoded names. `secretary=bob` remains visible. The original log test also covers session tokens. |
| Fault stderr | `faultLog`, including the outer HTTP catch | **logs and notification callback** supplies an Error with a credential in its message, cause and custom property. `fault-log.test.ts` adds **faults retain frames and cause chains while masking** for every seed: frames in `mcp-tokens.ts` and `credentials.ts` survive, including file URLs, while labelled values and their echoes across causes are masked. Cause cycles terminate; custom properties are never inspected. |
| Caller error text | `callerText` | **error text and malformed credential/backup files** supplies credential-bearing messages. Recognized credential values are replaced; ordinary caller errors retain their existing treatment. |
| Damaged plug-in secret file errors | `readPluginSecrets` | Same test corrupts an actual secret JSON file and inspects the whole thrown Error. Neither a parser excerpt nor an attached cause exposes its contents. |
| Damaged backup metadata errors | `readBackupInfo` | Same test corrupts a manifest. Its error identifies the manifest problem without including JSON contents. |
| Record audit rows: create, update, delete | Store audit writer with `redactSensitive: true` | **persisted record and security audit rows** checks both the public reader and raw persisted `changes` JSON, while preserving a public field. Shared name recognition adds SMTP usernames and S3 access keys. |
| Security audit rows | Account password setter and `securityEvents` | Same test sets an account password and checks the security-event output; authentication events record the action, not the supplied password. |
| Owner export and Save-as-XML authentication metadata | `fmExport`, `saveAsXml` account catalog | **exports: authentication material excluded from owner bundle and XML** sets account credentials and injects verifier material into the account schema; neither export emits it. Export manifests remain present. |
| Database backup bytes, external container bytes and backup metadata | `backupFolder` with a passphrase | **encrypted backups and external containers** seeds all seven values into a real database and external container, checks every output file, then decrypts and reads the database to prove restoration still works. The container-password seed is also the backup passphrase. |
| Conversion JSON and human-readable summary | `conversionReport` | **conversion JSON and summary** creates a credential assignment plus a broken formula repeating the value. Formula literals/comments are masked and discovered credentials are removed from report prose. The diagnostic and summary still exist. |
| Corpus report JSON and Markdown, failure details | `errorClass`, `buildReport`, `reportMarkdown` | **corpus JSON and Markdown** supplies an unlabelled decoder echo. Only a fixed error class and repository code location are retained; arbitrary decoder text cannot enter shareable reports. Formula shapes already mask literal values. |
| AI record and portal output | `recordForModel` | **AI tool record output** seeds a named credential and an innocently named copy. Both are hidden. |
| AI SQL output | `rowsForModel` | **AI tool SQL output** checks an alias of each credential column, using column origin metadata. |
| AI decoded script/design output | `redactStep` and shared `CredentialRedactor.data` | **AI tool step output** checks unquoted credentials, arrays and a preceding sibling alias. A separate control confirms public numbers and nulls retain their types. |
| AI audit output | `auditForModel` | **AI tool audit output** checks old/new arrays and copied values. Secret discovery handles individual repetitions, and security-entry changes receive the same policy. |
| Browser-facing connection state, AI connection listings and persisted connection test messages | `Connections.test`, `Connections.list`, encrypted vault | **web client connection state and saved test results** simulates a service echoing its credential, then checks the result, displayed projection, log callback, persisted connection JSON and encrypted secret file. |
| Browser credential input and error display | `connectionCard` | `packages/web/test/connection-secret-state.test.ts` runs every seed through success and failure. It holds the request pending, checks that the input is already empty, then checks all rendered text, attributes and input values. Failure responses deliberately echo the credential. Detached old inputs are empty too. |

## Data boundaries and limits

A restorable backup and an owner-requested record export are data products, not
redacted diagnostics. Unencrypted backups, CSV/XML record exports, container
exports, full design exports and design history can intentionally contain stored
application data, including hard-coded credentials. Their access controls and
backup encryption remain necessary. This change does not silently destroy that
data or claim that plaintext backups contain no secrets. The export test above
covers authentication metadata, not arbitrary credential-valued record cells.
Record-audit redaction remains the administrator's existing opt-in setting; it
does not rewrite historical audit rows or change hash chains.

Operational credentials must stay in their dedicated password/token/plug-in/
connection stores. Connection projections expose only whether a secret is set.
Active session tokens and credentials awaiting transmission necessarily exist in
request memory; the browser test covers retention and display after submission,
not erasure of an active authentication context.

Free-form diagnostics mask labelled credential values and known key formats,
preserving surrounding text and stack locations. They cannot identify an arbitrary, unlabelled plaintext password without
its input context. The run-local redactor handles known values and copies; corpus
errors and secret-file parse failures avoid arbitrary text entirely. Derived,
encoded or transformed application data is not a general information-flow proof.

## Validation

Run the new matrix with a light process limit:

```sh
npm run typecheck
node --no-warnings --test --test-concurrency=2 packages/server/test/secret-sinks.test.ts packages/server/test/fault-log.test.ts packages/scripts/test/credential-diagnostics.test.ts packages/web/test/connection-secret-state.test.ts packages/server/test/server-logs.test.ts
```

These five test files use synthetic data only. The server-log integration test
creates its own database. Run tests with a stub-only PATH containing Node and
`launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo` stubs that write a
marker and exit 99; fail the run if that marker exists.

Adjacent regression coverage includes fault logs, server logs, conversion reports
and guides, corpus scanning, plug-in secret storage, REST connections, AI output,
and record audit surfaces. HTTP integration tests need permission to bind a local
test listener. No network service or new dependency is needed by the new matrix.
