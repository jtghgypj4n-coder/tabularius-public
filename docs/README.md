# Documentation

Start with the [quickstart](../QUICKSTART.md), or browse the [examples](../examples/README.md).

To read these pages offline with search, build the site: `npm run docs:build` writes it to `dist/docs-site`, and `index.html` there opens from disk with no server.

## Getting started and tutorials

- [Moving a solution](moving-a-solution.md) — Bring a FileMaker solution, accounts and workflows to Tabularius.
- [FileMaker Server migration and sync runbook](fms-migration-runbook.md) — Copy hosted files and container folders from FileMaker Server, and keep a trial copy in step through the Data API.
- [For FileMaker developers](for-filemaker-developers.md) — Find where each FileMaker menu path, tool and habit lives in Tabularius, and whether it matches.
- [Known differences](known-differences.md) — See every place Tabularius differs from FileMaker or is not settled yet, and what would settle it.
- [Starter solutions](starter-solutions.md) — Start a new database from a ready-to-use contacts, stock, invoicing, tasks or booking app.
- [Moving in from other tools](moving-in-from-other-tools.md) — Bring Airtable, Notion, Google Sheets and Excel data in as new tables.
- [Move a FileMaker file in](tutorials/move-a-file-in.md) — Host a file, check its conversion and query it through the Data API.
- [Add a Data API client](tutorials/data-api-client.md) — Create a contacts file and use it from curl and Node.
- [Let an AI use your file safely](tutorials/let-an-ai-use-your-file-safely.md) — Connect an AI app with scoped access and review its work.
- [Connect an S3 bucket](tutorials/connect-an-s3-bucket.md) — Set up a named storage connection with credentials kept on the server.

## Working with a solution

- [Design mode](design-mode.md) — Build and change tables, relationships, layouts, calculations and scripts.
- [How text is compared](text-comparison.md) — See where case, accents and different spellings of the same letter count as equal.
- [Numbers and precision](numbers-and-precision.md) — See how calculations, stored number fields and server output handle large and decimal values.
- [Languages for sorting](sort-languages.md) — See how a field's Default language orders sorts, ranges, SQL and groups, and how far each language is checked.
- [Web client coverage](web-client.md) — Check which Browse, Find and Preview features work in the browser.
- [Walkthrough recorder](walkthrough-recorder.md) — Capture a synthetic browser walkthrough as an accessible standalone SVG.
- [The alternative client](next-client.md) — Work in a hosted file from a calmer, data-first browser client at /next/: lists, a command bar, pickers, boards and saved views.
- [Connect an AI app](connect-ai.md) — Connect an MCP client to a hosted file.
- [Local embeddings](local-embeddings.md) — Set up semantic search and retrieval with an embedding model on your computer.
- [Writing a plug-in](writing-a-plugin.md) — Add calculation functions in JavaScript or WebAssembly.
- [Native field types](native-field-types.md) — Use boolean, integer, decimal, JSON and UUID fields in native files.
- [Native foreign keys](native-foreign-keys.md) — Declare a relationship as a named foreign key with an ON DELETE choice in native files.
- [Checking a solution](check-solution.md) — Find missing references, unavailable steps and empty privilege sets before they fail.
- [Calendar feeds](calendar-feeds.md) — Subscribe to a layout's dates in a calendar app, and import events from an .ics file.

## APIs and compatibility

- [REST reference](reference/rest.md) — Look up the server's REST routes.
- [MCP reference](reference/mcp.md) — Look up the server's MCP tools.
- [MCP conformance](mcp-conformance.md) — Check how the MCP server follows each section of the specification, and where it chooses.
- [Data API compatibility](data-api-compatibility.md) — Compare endpoints, requests, responses and errors with FileMaker's Data API.
- [OpenAPI description](openapi.md) — The server's OpenAPI 3.1 description of the Data API and OData, and TypeScript types written from it.
- [Admin API coverage](admin-api-coverage.md) — Check which FileMaker Admin API calls are answered.
- [fmcsadmin parity](fmcsadmin-parity.md) — Compare administrative commands and their support here.
- [Plug-in compatibility](plugin-compatibility.md) — Check built-in replacements for FileMaker plug-in functions.
- [DynaPDF stage 2](dynapdf-stage2.md) — See what the offline import and copy of existing PDF pages supports, and its limits.
- [Solution patterns](solution-patterns.md) — Check which common FileMaker patterns (separation model, portals, summary reports, card windows) work here.
- [Get ( ) functions](get-functions.md) — See what Get ( ) answers here, including version strings and unknown names.
- [Script step support](script-steps-support.md) — Check script steps that are partial, unavailable or do nothing.
- [Script step reference](reference/script-steps/index.md) — Browse every registered step, grouped by task, with support status and an offline example.
- [Script error codes](error-codes.md) — Look up script failures and how their codes compare with FileMaker.

## Troubleshooting and performance

- [Environment variables](environment-variables.md) — Set `serve` options, backups, sign-in providers and the AI assistant from the environment instead of flags.
- [Monitoring](monitoring.md) — Check server health and scrape its Prometheus metrics.
- [Clock audit](clock-audit.md) — Which time checks use the monotonic clock, which stay on wall time, and the limits across restarts.
- [What workers agree on](cluster-consistency.md) — What several `--workers` processes guarantee about record locks, modification ids and live updates, and the few places one may lag.
- [Standby servers](standby-guarantees.md) — What a standby keeps, what a takeover gives you, what both sides taking writes does, the upgrade order, and what is not copied or not specified.
- [Consistency across surfaces](consistency.md) — Where SQL, the web client and calculations agree, and where FileMaker's behaviour is not documented.
- [Unknown tokens](unknown-token-ground-truth.md) — What a calculation does with a function or Get option the reader cannot name yet, and how `tabularius pair-tokens` names them from clipboard XML without printing private names.
- [Calculation reads and field privileges](calculation-privileges.md) — What a calculation sees of a no-access, masked or read-only field, and how that compares with Claris documentation.
- [Troubleshooting](troubleshooting.md) — Find a displayed error message and the steps to resolve it.
- [Web client troubleshooting](troubleshooting-web-client.md) — A blank page, a sign-in that stays put, an old version after an update, a failed import or upload, and what to check in the browser client.
- [Runbook](runbook.md) — When something goes wrong: forgotten passwords, lockouts, a runaway script, a damaged file, a full disk, a bad certificate, a wrong clock, a moved folder, a lost server. What you see, what to run, how to check it, what is lost.
- [Upgrading](upgrading.md) — What a new version does to your files, what is promised across versions, and how to roll back.
- [Reporting a file that does not open](reporting-a-file-that-does-not-open.md) — What to send, and what never to send, when a FileMaker file will not convert or open.
- [Performance](performance.md) — Review benchmark results for common operations on large files.
- [In-memory lease and TTL clocks](in-memory-lease-clocks.md) — Which timers and leases use the monotonic clock, and how tests replace it.
- [PostgreSQL session statements](pgwire-session.md) — See which session commands the SQL connection accepts and which only warn.
- [BI tools on the PostgreSQL connection](pgwire-bi-tools.md) — The queries psql, JDBC, DBeaver, Metabase, Npgsql and SQLAlchemy send on connect and when browsing, where each came from, what answers, and what is not verified.
- [FileMaker SQL grammar conformance](sql-grammar-conformance.md) — The SQL grammar checked construct by construct against Claris's SQL reference, through ExecuteSQL and the SQL connection: what was found, what was fixed, what still differs, and what the pages do not settle.
- [PostgreSQL result limits](pgwire-results.md) — Understand query row limits and memory measurements.
- [SQL statement deadline feasibility](pgwire-statement-deadline.md) — Why an opt-in statement deadline cannot safely use a worker pool with node:sqlite on Node 22, and what was observed.

## Security and release operations

- [Outbound requests](outbound-requests.md) — What the server refuses to connect to, how an administrator lets scripts reach the own network, and every place the server connects out.
- [Privacy](privacy.md) — Nothing leaves your computer unless you turn something on; what each thing that can be turned on sends, to whom and when, and the tests that prove the rest.
- [Service files](service-files.md) — What `service install` writes for systemd, launchd and Task Scheduler, setting by setting, and why; what is left out on purpose; what install refuses.
- [Security defaults](security-defaults.md) — Every security setting, what it is when you start the server with nothing else, what changes it, and what goes wrong if you change it; a test holds the page to the running server.
- [Threat model](threat-model.md) — What Tabularius defends, against whom, what it relies on, and what is out of scope.
- [Personal data isolation](personal-data-isolation.md) — Keep selected personal data out of AI requests.
- [Remote connector exposure](remote-connector-exposure.md) — Review the proposed plan for exposing a local server to a remote connector.
- [Upload and request body audit](security-upload-auth-audit.md) — Which callers are refused before a body is read, and the limits on request bodies.
- [Security mutation audit](audit-mutation.md) — Which security checks were mutated, how many mutants the tests killed, and the six exclusions.
- [Privilege matrix audit](audit-privilege-matrix.md) — What each privilege shape can do through the Data API, OData, web client, MCP, SQL, pgwire, Admin API and scripts, and the gaps it found.
- [Token file-scope audit](token-file-scope-audit.md) — Review how request handlers enforce token scope and per-file privileges.
- [Secret-surface audit](audit-secret-sinks.md) — A seeded-secret check for every place a secret could be written out (logs, errors, exports, backups, pages), and what each one hides.
- [Execution-refusal catches](execution-refusal-catches.md) — Review fixes and validation for execution refusals caught by the calculation and store layers.
- [Versions](versioning.md) — What a version number means, what stays put between versions, which platforms are tested, and how release notes are made.
- [Release builds](release-builds.md) — Rebuild a release and get the same bytes, read its bill of materials, and check a stored copy against its checksums.
- [Signing releases](signing.md) — Configure signing and notarization for release programs.

## Architecture, design and research

- [Architecture and roadmap](ARCHITECTURE.md) — Understand the platform's structure and planned capabilities.
- [Design guide](design-guide.md) — Follow the visual and interaction conventions for Tabularius's own pages.
- [Visual regression baselines](visual-regression.md) — Compare or review the core client and admin screen screenshots.
- [Accessibility](accessibility.md) — Review accessibility checks, fixes and remaining gaps.
- [File format](research/fmp12-format.md) — Explore what is known about the .fmp12 format and the evidence behind it.
- [Prior work](research/prior-work.md) — Find the projects and sources behind the format research.
- [Write-back study](research/write-back.md) — Explore how design changes could be written back to a FileMaker file.
- [UUIDv7 record identity](research/n3-uuid-record-ids.md) — Explore the design note for giving native-file records a durable, portable id beside the file-local record number.
- [Secret taint tracking](research/secret-taint-tracking.md) — Explore a defense-in-depth design for preventing AI tools from returning values derived from secret fields.
- [Script step privileges](research/r17b-01-script-step-privileges.md) — Review which script steps check privileges like their non-script paths, and the deliberate exceptions.
- [Hosted file lifecycle tests](file-lifecycle-concurrency.md) — See what the file open, close and replace races are tested against, and how to run those tests.
