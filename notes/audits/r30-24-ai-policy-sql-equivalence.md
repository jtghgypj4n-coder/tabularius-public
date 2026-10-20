# r30-24: AI-visible policy SQL equivalence

## Scope and baseline

The earlier `r22-04-sql-rewriter-properties` audit and the current `ai-policy-sql` tests already covered basic field origins, quoted names, joins, predicates, CTEs, and parameterized calculation literals. No claims folder or r27-r29 backlog file was present in this worktree. This item extends those checks with a filtered-copy oracle and repairs two observed differences. No corpus or fixture data was read.

## Oracle and expected behavior

Each of four fixed seeds generates 16 synthetic rows, then runs 63 SQL queries over two tables: 252 query comparisons in total. The independent SQLite copy contains exactly the first four rows of each table and `NULL` in each privilege-hidden `Password` column. The test compares every returned row and column, preserving duplicate output names as positional arrays. It also checks that changing only `Password` values cannot change a query result without the schema-only planner reporting a `Password` dependency.

| Form | Expected result basis | Public reference |
| --- | --- | --- |
| `JOIN`, `WHERE`, subquery, aggregate, `ORDER BY`, `LIMIT`, `UNION` | Evaluate the original query over the filtered copy; compare ordered rows and all positional columns. | [SQLite SELECT](https://www.sqlite.org/lang_select.html), “compound SELECT”, “ORDER BY”, “LIMIT” |
| `WITH` and a CTE named like a base table | The CTE supplies its own rows; a duplicate policy CTE must not replace it. | [SQLite WITH clause](https://www.sqlite.org/lang_with.html), “temporary views” |
| `ExecuteSQL` query and dynamic arguments | `SELECT` only; `?` arguments follow their occurrence order. | [Claris ExecuteSQL](https://help.claris.com/en/pro-help/content/executesql.html), “SQL SELECT”, “first question mark” |

The store's restricted ExecuteSQL result matched the copy for all 252 query comparisons. The planner reported the hidden field whenever changing only that field changed an observed result. The random generator uses seeds `0x3024cafe` through `0x3024cb01`, with 48 generated choices of source table, output field, predicate, sort, and limit, plus 15 fixed grammar cases per seed.

## Repairs

- A top-level CTE that reused a base-table name caused the policy rewrite to add a duplicate CTE and fail. The rewrite now recognizes top-level CTE names, leaves their references intact, and omits the colliding policy CTE. Regression cases cover plain and quoted/materialized definitions, plus a nested CTE.
- A refusal for a privilege-hidden field disclosed the table and field names before SQL planning. It now gives a generic field refusal while retaining the caller's privilege-set name. A regression checks the error text.
- Direct AI policy SQL checks now require the existing schema-only planner to resolve the read set before store inspection. Unresolved SQL receives a generic refusal.

## KNOWN

| Question | Status |
| --- | --- |
| Whether Claris ExecuteSQL supports SQLite `WITH`, materialization hints, and nested CTE shadowing | **Unverified.** These cases establish Tabularius behavior under its accepted SQLite grammar, not Claris parity. |
| Every possible valid SQL syntax combination and every SQLite optimizer plan | **Unverified.** The fixed and generated cases are differential evidence, not an exhaustive grammar proof. |

## Validation

- Nine SQL and AI policy test files: 299 passed, 0 failed, 0 skipped, `--test-concurrency=2`, 10.11 seconds total.
- TypeScript project check after the final code change: passed with 0 diagnostics.
- Test runs used command stubs for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo`; no stub marker appeared. Tests used generated data only and did not run service, upgrade, install, pull, or network commands.
