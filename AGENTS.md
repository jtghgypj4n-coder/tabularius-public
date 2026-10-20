# Agent guide

Read this first if you are an AI coding agent (Claude Code, Codex or similar). It is the short version; each section links to the full page instead of copying it. `CLAUDE.md` points here, so both tools read the same text.

## What Tabularius is

An open-source (MIT), AI-native platform that opens and hosts FileMaker `.fmp12` files: it reads the file, converts it once into a SQLite store, serves a Data API-compatible REST API, a web client with a design mode, a script engine, a calculation engine and a built-in MCP server. It is for all FileMaker developers and solutions, not one company's files. `openhbam` is a deprecated alias of the name; new work uses Tabularius. Start with [README.md](README.md), then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/known-differences.md](docs/known-differences.md).

## Layout

- `packages/fmp12`: reads `.fmp12` files (tables, fields, layouts, scripts, records, containers).
- `packages/calc`: the calculation-formula evaluator and its functions.
- `packages/store`: the SQLite store, design import/export, security and privileges.
- `packages/scripts`: the script engine (script steps, triggers, transactions).
- `packages/server`: HTTP server, Data API, MCP tools, pgwire, admin API, auth, backups (`admin/` holds the admin console pages, `evals/` the AI evals).
- `packages/web`: the browser client and design mode (plain HTML, CSS and JS; `e2e/` holds the browser tests).
- `packages/cli`: the `tabularius` command (`launch.cjs` is the entry point).
- `packages/plugins`: the plug-in system.
- `docs/`: guides (menu in `docs/contents.json`), `docs/reference/` is generated. `examples/`, `scripts/` (repo tooling and gates), `packaging/`, `claude-plugin/` (skills for Claude).

Every package has its tests in its own `test/` folder, named `*.test.ts`.

## Build and test

Node 22.20 or newer (`.nvmrc`). There is no build step: Node runs the TypeScript directly. Runtime dependencies are not allowed except the few in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); prefer the standard library, and a new dependency needs a reason in the PR.

```sh
npm ci
npm run fixtures        # downloads public sample files some tests read; never committed
npm run typecheck
npm run test:ci         # the whole suite, what the automatic check runs
npm run precheck        # type check, repo gates and the tests for what you changed; push only on "precheck: PASS"
```

- One test file: `node --no-warnings --test packages/server/test/some.test.ts`.
- Browser tests need Chromium and are not part of `test:ci`: `npm run smoke:web`, `npm run a11y:web`, `npm run test:e2e` (they run in the `browser-tests` workflow for changes under `packages/web` and the server pages; `scripts/require-browser.ts` checks a browser is found).
- After adding, renaming or describing an MCP tool, a route or a setting, run `npm run docs:reference` (and `npm run docs:plugins` for the plug-in page) and commit the result. The suite fails on a stale generated page.
- A new guide page must be listed in `docs/contents.json`; a guide needs a `#` title and no skipped heading level.

## Code conventions

- Match the code around you: names, comment density and idiom. Two-space indent, LF, final newline (`.editorconfig`).
- Tests first: a fix starts with a failing test. Tests are small, offline and fast; no network and no fixed sleeps. Build the data a test needs inside the test.
- Say plainly what is not done. An error message a person can act on beats a code; partial features are labelled partial in the docs.
- Documentation that shows commands is run by tests (`docs/tutorials`, `examples`); change one, run its test.
- Layouts: fully support existing FileMaker layouts, and encourage new ones in HTML, CSS and JavaScript.

## Rules for commits and pull requests

- **Author**: commit as `Tabularius contributors <noreply@tabularius.invalid>`. Set it with `git config user.name "Tabularius contributors"` and `git config user.email noreply@tabularius.invalid`. Never put a real name or personal email in a commit, file or PR.
- **No token-shaped strings**, not even fake ones: GitHub push protection blocks them. Build fake secrets in tests from parts at runtime (for example `['sk', 'test', 'abc'].join('_')`).
- **No sample or customer data**: never commit a `.fmp12` file, a backup, a record export, a screenshot of records or anything under `fixtures/`. A test builds its data on the spot.
- **No former-employer material** and no names from files that belong to someone else; `scripts/banned-names.ts` and its test enforce the second.
- **Trademarks**: do not put "FileMaker" or "Claris" in product names, domains, repository descriptions or logos, and never use Claris logos. Describe the product factually ("opens and hosts .fmp12 files").
- **Workflow files** (`.github/workflows/`) cannot be changed by the Claude GitHub app; ask the owner to paste such a change.
- Branch from `main`, one change per PR. Fill in `.github/pull_request_template.md` (Before, After, How, Checked) and paste the `precheck: PASS` line. Make the automatic check green before asking for review; merge only reviewed green PRs. Security-related PRs need a review by a different model or person before merging.
- Report vulnerabilities privately, never in a public issue: [SECURITY.md](SECURITY.md).

## Where the deeper docs are

| Need | Page |
|---|---|
| Install and run | [QUICKSTART.md](QUICKSTART.md), [ADMIN.md](ADMIN.md) |
| Contribution rules in full | [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| Security | [SECURITY.md](SECURITY.md), [docs/threat-model.md](docs/threat-model.md), [docs/security-defaults.md](docs/security-defaults.md) |
| Licence | [LICENSE](LICENSE) (MIT), [NOTICE](NOTICE) |
| Design and roadmap | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/design-mode.md](docs/design-mode.md) |
| Compatibility with FileMaker | [docs/known-differences.md](docs/known-differences.md), [docs/data-api-compatibility.md](docs/data-api-compatibility.md), [docs/script-steps-support.md](docs/script-steps-support.md), [docs/plugin-compatibility.md](docs/plugin-compatibility.md) |
| MCP and AI | [docs/connect-ai.md](docs/connect-ai.md), [docs/reference/mcp.md](docs/reference/mcp.md) |
| Troubleshooting and ops | [docs/troubleshooting.md](docs/troubleshooting.md), [docs/runbook.md](docs/runbook.md), [docs/environment-variables.md](docs/environment-variables.md) |
| Everything else | [docs/README.md](docs/README.md) and `docs/contents.json` |
