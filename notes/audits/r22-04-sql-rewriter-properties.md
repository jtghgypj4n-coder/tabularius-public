# r22-04: Tabularius SQL rewrite and tokenizer properties

## Scope and inventory

Searched `main` before implementation. Existing coverage already checked basic
SELECT-only access, ATTACH/VACUUM refusal, internal tables, SQL parameter
numbering, and row/field privilege scoping. Dropped duplicating those basic
examples and adding a property-testing dependency. The current branch also had
newer grammar, date, and privilege-matrix coverage; those tests remain in use.
Fixture-backed protocol tests and stored query collections were excluded from
execution. All new data is generated locally.

## Preservation model

The generator constructs typed atoms (code words, literals, quoted identifiers,
parameters, punctuation, whitespace, and comments). Expected boundaries and masks
come from those atoms, independently of the production scanner. Properties
check lossless tokenization, opaque literal/name preservation, code-word and
parameter preservation, statement counts, and values observed after actual
execution. Intentional dialect translations are also checked through generated
catalog and array queries.

Inputs include doubled single/double quotes, backticks, square brackets,
PostgreSQL escape strings and dollar delimiters, Unicode text and typographic
quotes, keyword-bearing literals, nested comments, semicolons, escaped table
names, unusual parameter type OIDs, 220–250 KB strings, NULs, malformed UTF-8,
and mixed byte encodings. Unknown text parameter OIDs are tested for safe bound
value transport, not for vendor type semantics.

Default seed: `570739454` (`0x2204cafe`). Override with
`OPENHBAM_SQL_PROPERTY_SEED`. Property failures print the seed, case index,
shrunk input, and underlying assertion. Shrinkers remove model atoms/statements
or reduce payload text, with a bounded number of attempts. One observed failure
reported `seed=570739454 case=13` and shrank the session-expression payload to
`{"value":"USER CURRENT_USER POSITI","oid":25}`.

## Repairs and regressions

- Table occurrence rewriting matched FROM/JOIN inside literals. Matches now
  require a code keyword token at the exact source position.
- Doubled quotes in occurrence names were parsed incorrectly. Identifier lookup
  now decodes them while retaining SQL identifier quoting.
- Privilege shadowing searched raw SQL substrings, missing escaped table names
  in comma joins. It now uses decoded name tokens, including SQLite's non-ASCII
  bare identifiers. A pre-fix regression returned the denied `quoted-value`
  instead of no rows; the regression now also covers a Unicode table name.
- ROWMODID substitution changed longer quoted identifiers. Only the complete
  special identifier is translated.
- PostgreSQL compatibility rewrites changed quoted names and keyword literals.
  Opaque token placeholders protect them, with array and quoted-catalog
  compatibility checks and bounded placeholder-name selection.
- The statement splitter mishandled escaped quotes and nested comments.
  Shared lexical boundaries now preserve their contents and statement counts.
- Parameter numbering and cast inference inspected comments/literals. They now
  inspect code only. Invalid or excessive parameter indices are refused before
  prepared-statement type allocation.
- Session-expression substitutions operated inside literals and could reprocess
  inserted names. Substitutions now inspect code positions in a single pass.
- The raw store accepted trailing statements because SQLite prepared only the
  first. The read-only gate now requires one statement and screens dangerous
  code/function tokens before preparation.
- SQL NULs and malformed/mixed wire encodings could be truncated or replacement
  decoded. They are refused before SQL rewriting or text parameter binding;
  malformed Parse framing is refused before reading type entries.
- Single-quoted SQLite catalog names bypassed the textual catalog screen.
  Table-position/function tokens and compiled root-page inspection now also
  reject the main and temporary schema catalogs and quoted pragma functions. Existing
  compiled internal-table/write checks remain the second line of enforcement.

Regression tests accompany these repairs. Additional properties check restricted
rows and fields after CTE/join/occurrence rewriting, live HTTP/wire authorization,
unchanged records after refused writes, and errors without unrelated generated
table names, field names, or values. File/extension functions are registered as
fakes; tests prove token rejection occurs before any fake executes.

## Compatibility limits

Claris behavior for nested comments, SQLite quote extensions, typographic quotes
used as delimiters, malformed encodings, and unsupported PostgreSQL string escape
forms is **unverified**. These tests establish Tabularius preservation/refusal
behavior; they do not claim vendor parity. Typographic quotes are not converted
to ASCII SQL delimiters. Unsupported escape forms are explicitly refused.

SQLite's permissive string-as-table syntax also requires compiled-query checks;
lexical screening alone is not treated as an authorization boundary. Authorized
external table occurrences retain the existing target-file authorization policy;
raw ATTACH/file functions and attempts to access an unbound schema are refused.
HTTP and PostgreSQL still require full row/field visibility; the calculation
SQL path retains its existing scoped-row and hidden-field behavior.

## Validation

The targeted run passed **584 tests, zero failures or skips**, across these eight
files in **15.35 seconds** total (therefore each file completed below 60 seconds):

- `packages/store/test/sql-rewriter-properties.test.ts`
- `packages/server/test/sql-rewriter-properties.test.ts`
- `packages/store/test/sql-grammar.test.ts`
- `packages/store/test/sql-checks.test.ts`
- `packages/store/test/sql-dates.test.ts`
- `packages/store/test/sql-scope.test.ts`
- `packages/server/test/privilege-matrix-sql.test.ts`
- `packages/server/test/privilege-matrix-pgwire.test.ts`

After the final quote-form generator and syntax-error compatibility additions,
the two property files passed again: **26 tests in 1.98 seconds**. The final
targeted TypeScript check passed with no diagnostics; `git diff --check` passed.
All command-stub marker checks passed.

Four existing PostgreSQL syntax patterns were checked directly without loading
the fixture-backed test module. A targeted TypeScript check covers both new test
files and their imported source graph. No timing assertion was added.

Tests use generated stores,
loopback listeners on `127.0.0.1`, and `--test-concurrency=2`. Test processes run
with a stub PATH: launchctl, systemctl, sc, git, npm, curl and sudo write a marker
and exit 99; either marker check fails the run. No dependencies, commits, pushes,
workflow changes, publication, or excluded-directory edits are part of this item.
