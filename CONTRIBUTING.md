# Contributing

Thank you for helping. This page is the short version of how changes are made here, so a pull request lands on the first try.

## Set up

Node 22.20 or newer (`.nvmrc` has it; a `.editorconfig` has the whitespace). There is no build step: the code is TypeScript that Node runs directly.

```sh
npm install
npm run fixtures     # downloads the public sample FileMaker files some tests read (they are never committed)
npm test             # everything; npm run test:ci is what the automatic check runs
npm run typecheck
```

To run one test file: `node --no-warnings --test packages/server/test/some.test.ts`.

## Rules that save a round trip

- **Tests first.** A fix starts with a test that fails, and a feature with a test that shows it working. Tests live in `packages/*/test` next to the package they test. Make the test small, offline and fast: no network, and no sleeping for a fixed time.
- **No sample files in the repository.** Never commit a `.fmp12` file, a customer's data or anything under `fixtures/`. Build the data a test needs in the test (a store made by `Store.create`, a design folder from `tabularius design-apply`, bytes generated on the spot). `npm test` checks this.
- **Generated pages are regenerated, not edited.** `docs/reference/mcp.md` and `rest.md` come from the code: run `npm run docs:reference` after you add, rename or describe a tool or a route, and commit the result. `npm run docs:reference -- --check` says whether they are current, and the test suite fails on a stale one. The plug-in compatibility page is the same with `npm run docs:plugins`. To be told before you push, run `npm run hooks:install` once: a pre-push hook then checks both pages and names the command that fixes them (`git push --no-verify` skips it).
- **Never send or commit a sample of someone's data.** That includes FileMaker files, backups, record exports and screenshots of records. To describe a file that does not convert without sending it, see [reporting a file that does not open](docs/reporting-a-file-that-does-not-open.md); a test needs its data built on the spot, or from the public files `npm run fixtures` downloads.
- **A new guide goes in `docs/contents.json`.** `npm run docs:build` turns every guide into a static, searchable site (default `dist/docs-site`; open `index.html` from disk). Its menu comes from `docs/contents.json`, and a test fails until each new page is listed there, so add the page to a section. A guide needs a `#` title and no heading level skipped.
- **Documentation that shows commands is run.** The tutorials in `docs/tutorials` and the folders in `examples` have tests that execute them. Change one and run its test.
- **Say what is not done.** If a feature only partly works, the docs and the error message say so, in plain words. A message that a person can read and act on beats a code.
- **The program has no runtime dependencies**, and a pull request should keep it that way: it runs on Node's own modules (`package.json` lists only development tools: TypeScript, Node's types, a browser driver and an accessibility checker). A new dependency, even a development one, needs a reason in the description; the licence check (`packages/cli/test/dependency-gate.test.ts`) refuses a licence we cannot ship. Prefer the standard library.
- **Packages import downward only**: fmp12, then calc, then store, then scripts and plugins, then server, then cli; the web client imports nothing from the other packages. The same gate refuses a new upward import (`ALLOWED_IMPORTS` in `scripts/dependency-gate.ts`). Move shared code down instead.

## Before you push

Run `npm run precheck`. It runs the type check, repository gates and tests related to changed files with at most two test workers. Push only when its last line says `precheck: PASS`; copy that line into the pull request description. If it fails and you cannot fix it, start the PR title with `[precheck failing]` and explain why. The opt-in pre-push hook (`npm run hooks:install`) runs `npm run precheck -- --quick` after its generated-page checks. `git push --no-verify` still skips the hook.

## Making a pull request

- One change per pull request, and one open at a time if you can.
- Branch from `main`. Write the description as **Before** (what a person sees now), **After** (what they see with your change) and **How** (a short paragraph on the approach).
- The automatic check runs the type check and all the tests. Make it green before asking for a review, and run `npm run typecheck` and the tests for the package you changed first.
- Keep the code in the style around it: the same names, comment density and idiom.
- The pull request form (`.github/pull_request_template.md`) has the same three headings, then a short checklist; tick what applies and say in the description what you did not check.

## Conduct

Everyone in the project's spaces is asked to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Security reports

Please do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md): open a private security advisory on the repository (**Security**, then **Report a vulnerability**); it also says what to expect and what is in scope.

## Licence

By contributing you agree that your work is released under the repository's [MIT licence](LICENSE).
