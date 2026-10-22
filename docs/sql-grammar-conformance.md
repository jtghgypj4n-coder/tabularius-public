# FileMaker SQL grammar conformance

`ExecuteSQL`, the [HTTP SQL endpoint](reference/rest.md#sql), and the SQL connection (the PostgreSQL protocol, see [BI tools](pgwire-bi-tools.md)) take FileMaker's SQL and run it on SQLite. This page says which parts of FileMaker's SQL grammar were checked against [Claris's public SQL reference](https://help.claris.com/en/sql-reference/content/index.html), what each check found, and what still differs.

The grammar is in [`packages/server/test/data/sql-grammar.json`](../packages/server/test/data/sql-grammar.json): one entry per construct, with the example query, the Claris page it comes from, and the result. `packages/server/test/sql-grammar.test.ts` runs every entry through `ExecuteSQL`, the PostgreSQL connection, and the HTTP SQL endpoint against a small synthetic file and prints how many constructs it checked. Entries with `?` parameters run through `ExecuteSQL` and HTTP SQL, which accept that placeholder syntax.

## What was checked

227 entries, 221 with an expectation and 6 recorded as not verified (below). Each entry with an expectation runs on the applicable paths.

| Area | Constructs |
| --- | --- |
| SELECT list (alias, `DISTINCT`, `*`, `t.*`, qualified and quoted names, names with spaces and reserved words, expressions) | 17 |
| FROM (table aliases, self-join, `INNER JOIN`, `LEFT OUTER JOIN`, the unsupported `RIGHT` and `FULL`, subquery in FROM, unknown table and column) | 9 |
| WHERE (the relational operators, `LIKE`, `BETWEEN`, `IN`, `EXISTS`, `IS NULL`, `ANY`, `ALL`, `AND`/`OR`/`NOT`, precedence) | 36 |
| GROUP BY, HAVING | 8 |
| Aggregates (`SUM`, `AVG`, `COUNT`, `MAX`, `MIN`, `DISTINCT`, aggregate in a function) | 11 |
| UNION, ORDER BY (names, ordinals, `ASC`/`DESC`, binary order) | 13 |
| OFFSET, FETCH FIRST (`ROW`/`ROWS`, count omitted, `WITH TIES`, `PERCENT`, subqueries, count under 1) | 23 |
| Constants and operators (strings, scientific notation, `DATE`/`TIME`/`TIMESTAMP`, `{D '...'}`, `^`, `**`, precedence, string `+` and `-`, date arithmetic) | 26 |
| Functions: string, numeric, date, `CASE`, `COALESCE`, `NULLIF`, `CAST`, container `GetAs` | 66 |
| `FOR UPDATE` cursor clause | 1 |
| System tables and columns (`FileMaker_Tables`, `FileMaker_Fields`, `FileMaker_BaseTables`, `ROWID`, `ROWMODID`) | 6 |
| Statements that write (`INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `ALTER TABLE`, `CREATE`/`DROP INDEX`, `TRUNCATE`) | 8 |
| `?` parameters (one, multiple in order, a value containing a quote) | 3 |

99 results are ones the Claris page states, with the example it gives. 122 are worked out from the rule the page states (marked `derived` in the file), for example the result of a function the page names but gives no example for. Six entries are marked `unverified` because the vendor result is not stated. Every entry names its page. The `?` cases follow [Claris's ExecuteSQL help](https://help.claris.com/en/pro-help/content/executesql.html), which specifies argument binding order; the quoted-name cases follow its `"Last Name"` example and the [reserved keyword rule](https://help.claris.com/en/sql-reference/content/reserved-sql-keywords.html). <!-- known-difference-ok: describes evidence categories rather than a product behavior difference -->

## What the check found and what changed

The first run disagreed with the pages on 42 entries. Some were mistakes in the expectations (fixed in the file); the rest were real differences, and each fix has a test in `packages/store/test/sql-grammar.test.ts` as well as its entry in the grammar file.

| Construct | Before | Now |
| --- | --- | --- |
| `SELECT *` | Also returned the record id and modification count columns | Returns the fields only; `ROWID` and `ROWMODID` still work when asked for |
| `FETCH FIRST ROW ONLY` and `FETCH NEXT` | A syntax error | One row, as the page says the count defaults to 1 |
| `FETCH FIRST 0 ROWS ONLY` | No rows | An error (the count is at least 1) |
| `FETCH FIRST ... WITH TIES` without `ORDER BY` | A syntax error | The documented error |
| `OFFSET` and `FETCH` inside a subquery | Applied to the whole query by mistake | An error, as the page says they are not supported there |
| `OFFSET`/`FETCH` text inside a string constant or a comment | Rewritten as if it were SQL | Left alone |
| `RIGHT OUTER JOIN`, `FULL OUTER JOIN` | Accepted (SQLite has them) | Refused; the page says they are not supported |
| `x = ANY (subquery)`, `x <> ALL (subquery)` | A syntax error | Run as `IN` and `NOT IN` |
| `x > ALL (subquery)`, `x < ANY (subquery)` and the other quantified comparisons | A syntax error | Run as `NOT EXISTS` / `EXISTS` over the subquery (below) |
| `FETCH FIRST n ROWS WITH TIES` | "Not supported" | The first n rows and every row that sorts equal to the last one (below) |
| `2 ^ 3`, `2 ** 3` | A syntax error | Exponent, with the unary minus above it (`-2 ^ 2` is 4) |
| `ROUND(123.456, -2)` | 123 | 100; rounds half away from zero, in decimal (`ROUND(1.005, 2)` is 1.01) |
| `NUMVAL('abc')` | NULL | An error; the page says the function fails |
| `DATE '2020-13-45'` and the other constants | Kept as the text it was given | An error when the query runs |
| `'a' + 'b'`, `first + ' ' + last`, `'a' - 'b'` | `0` (SQLite adds the numbers) | Joined; `-` moves the first string's trailing blanks to the end |
| `hire_date + 5`, `hire_date - 10`, `date - date`, `CURRENT_DATE - 1` | The year number plus 5, and so on | A date plus or minus days; a date minus a date is the days between |
| `SELECT dept, last_name, SUM(salary) ... GROUP BY dept`, and a non-grouped column in `HAVING` | Ran, returning one record's value | An error (FQL0025), as the page says (notes below) |
| `SELECT last_name ... UNION SELECT salary ...` | Ran | An error (FQL0027), as the page says (notes below) |
| `STRVAL(4 = 5)` | `0` | `False` (and `True`), as the page's example gives |
| `FileMaker_BaseTables`, `FileMaker_BaseTableFields` | No such table | Provided, one row per base table, scoped by the account's privileges as `FileMaker_Tables` is |
| `CAST(container AS VARCHAR)` for an embedded file | Returned the internal container ID | Returns its filename, as the [container example](https://help.claris.com/en/sql-reference/content/for-update-clause.html) says; a query under record or field scoped privileges retains the ordinary CAST to avoid reading the container catalog through a derived alias |

The two rewrites with the widest reach are the string and date operators and the star.

- **`+` and `-`** are rewritten only where an operand shows what it is. A string constant or the result of a string function (`UPPER`, `LEFT`, `STRVAL`...) joins with anything. A text field joins only a string or another text field, so a number kept in a text field still adds (`Code + 0`). A date constant, date function or date field makes it date arithmetic, which falls back to ordinary arithmetic when the value is not a date. Two numbers, or a number and a field of unknown type, keep SQLite's arithmetic. An operand that is followed or preceded by `*`, `/` or `%` takes the whole product (`'n=' + Pay * 2`). Fields are told apart by name across the file's tables, and a name that two tables give different types is not rewritten. A name the account cannot read is not looked up. An alias or derived column that shares a text field's name is read as that field.
- **Quantified comparisons.** `x > ALL (S)` is rewritten to `NOT EXISTS (WITH q(v) AS (S) SELECT 1 FROM q WHERE NOT COALESCE(x > v, 0))` and `x < ANY (S)` to `EXISTS (WITH q(v) AS (S) SELECT 1 FROM q WHERE x < v)`; `= ALL` and `<> ANY` the same way. The column list names the subquery's one column, so a subquery with two columns is an error. `ALL` over no rows is true, `ANY` over none is false, and a NULL among the values keeps `ALL` from being true (the SQL standard; the Claris page gives no example of either). The left side must be a name, a constant or a call: `a + b > ALL (...)` is left for SQLite to report, because the rewrite would take only `b`. Under a `NOT` the three-valued logic of a NULL is lost (`NOT (x > ALL (S))` is true where S holds a NULL).
- **`WITH TIES`.** `FETCH FIRST n ROWS WITH TIES` becomes a limit equal to the number of rows whose `RANK()` over the `ORDER BY` is no greater than the rank of the row at position offset + n, less the offset. The `ORDER BY` items that are a select-list alias or a position are replaced by their expressions for that count. A `DISTINCT`, a `UNION`/`INTERSECT`/`EXCEPT` and a query with no `FROM` are refused: the page does not say what ties mean there. A tie is equality on every `ORDER BY` key, with SQLite's ordering and collation.
- **FQL0025 and FQL0027.** Both checks read the query text outside strings, quoted names and comments, and refuse only what they can see for certain, so a query FileMaker accepts is never refused. A column is ungrouped when its name is a field of the file, it stands outside every aggregate (`SUM`, `AVG`, `COUNT`, `MAX`, `MIN`, and SQLite's `TOTAL`, `GROUP_CONCAT`) and every subquery, and no `GROUP BY` item covers it. A `GROUP BY` item may be a column, a column with a table qualifier, an expression the select list repeats exactly (`UPPER(dept)`), a select-list alias, or a position; the page lists only column expressions, so the alias and position forms are accepted without being verified. The `HAVING` clause may name a select-list alias. An item with a window function (`OVER`), a subquery, a name that is not a field of the file, or a select with no `GROUP BY` is not checked. A select with an aggregate and a plain column but no `GROUP BY` (`SELECT dept, COUNT(*) FROM emp`) is also not checked: the pages read do not say whether FileMaker refuses it, so SQLite's behaviour stands (one row, a record's value). Two sides of a `UNION` are compared column by column only where both columns are plain fields, each with one type across the file's tables (text, number, date, time or timestamp); a side with a star, a computed column, a field the account cannot read or a name two tables give different types is not compared. The error names the column, not the code Claris's drivers return.
- **`STRVAL`** of a condition: when the argument's top level (outside brackets and `CASE`) holds a comparison, `AND`, `OR`, `NOT`, `IS`, `LIKE`, `BETWEEN`, `IN` or `EXISTS`, the result is `True` or `False` (and empty when the condition is unknown). A comparison kept in a variable or returned by a subquery is a number as before; only the form the page shows is read.
- **Integer division** is not changed (see Not verified).
- **`x + INTERVAL n UNIT`** is a separate rewrite and is untouched.
- **The star** is written out as the fields only when every table in its FROM is a table occurrence (or has an alias); otherwise it stays as written, and a name that the query itself defines (`WITH Q AS (...)`) is not a table occurrence.
- **Limits.** A query over 200,000 characters, an operand over 5,000 characters, more than 2,000 operator rewrites in one query, more than 500 quantified comparisons (or nested more than 20 deep), and more than 50 selects when expanding stars are left as SQLite reads them. Result columns that are unlabeled expressions are named after the rewritten text (`fm_cat(...)`, `power(...)`), so label them with `AS`.
- **A bad constant** (`DATE '2020-13-45'`) is an error when the query evaluates it: a query that never evaluates it (no rows, or `WHERE 0`) does not fail.

## What still differs (the KNOWN list)

Each of these is an entry in the file with `known` set to the reason, and the test insists the entry still disagrees: fixing one means taking its `known` out.

| Id | Construct | Why it is not fixed |
| --- | --- | --- |
| agg-09 | An aggregate inside another function (`ROUND(SUM(x))`) | An error in FileMaker (8309, FQL0005); works here. Left lenient for the same reason. |
| fetch-07 | `FETCH FIRST n PERCENT ROWS ONLY` | Valid FileMaker SQL, refused with a plain "not supported" error; the page does not say how a fraction of a row rounds. |
| expr-06 | `{D '...'}` braces in `ExecuteSQL` | The page says `ExecuteSQL` refuses them; here they work, because one translation serves the SQL connection, which accepts them. |

## Not verified

The pages read do not say, so the file marks these entries `unverified` with no expected result (`paths: []`). The test reports current behavior on all three paths: <!-- known-difference: SQL grammar ;; vendor results for six constructs are unspecified in the cited pages ;; the conformance test records current behavior without an expected result ;; compare each construct with FileMaker and record the observed result -->

- `where-13`: whether `LIKE` ignores case. All three paths currently match `smith` to `Smith`.
- `expr-10b`: whether `6 / 4` is 1 or 1.5. All three paths currently return 1 because SQLite divides two integers as integers. The reference gives no quotient example.
- `cond-07`: `CAST(number AS VARCHAR)` currently returns `20000.0` on all three paths. The [Claris container example](https://help.claris.com/en/sql-reference/content/for-update-clause.html) documents `CAST(container AS VARCHAR)`, but does not specify numeric casting.
- `getas-01`: `GetAs(container, 'FILE')` currently errors on all three paths because the SQL function is absent. The reference says it returns binary data, but gives no representation for `ExecuteSQL`'s text result or these connections.
- `for-update-01`: `FOR UPDATE OF salary` currently gives a syntax error on all three paths. The reference specifies cursor locking for ODBC/JDBC; it does not say whether `ExecuteSQL` accepts this clause. The SQL connections here have no positioned update cursor.
- `sys-02b`: `FieldType` currently returns `decimal` for Payroll's numeric field on all three paths. The reference does not list the names `FieldType` holds; `FieldName` is checked.

Other choices that the pages do not settle, and what was done:

- `+` or `-` on strings with an empty operand: an empty field here is `NULL`, and a `NULL` operand gives `NULL`. The page does not say what an empty operand gives.
- Date arithmetic is for dates only. A timestamp or time plus a number is not rewritten.
- The column names of `FileMaker_BaseTables` and `FileMaker_BaseTableFields` (`BaseTableName`, `BaseFileName`, `FieldName`, `FieldType`, `FieldId`, `FieldClass`, `FieldReps`, `ModCount`) follow the `FileMaker_Tables` and `FileMaker_Fields` tables; only `BaseTableName` and `FieldName` are exercised by the grammar file.
- `PERCENT` with a count that does not divide the rows.

## Errors

The check asks that a documented error case is an error on both paths. It does not compare the code or the text. Claris's errors have codes of the form `FQL0001` to `FQL0056` and wording of their own; here the engine's messages come back (`ExecuteSQL` as the text, the SQL connection as SQLSTATE `42000`, or `42601` for a syntax error). Matching Claris's codes would need each rewrite and each SQLite error mapped to one; that is not done.

The statements that write (`INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `DROP INDEX`, `TRUNCATE`) are refused on both paths. The Claris pages say `ExecuteSQL` supports only `SELECT`, and that the ODBC and JDBC drivers support the others; the SQL connection is read-only by design (SQLSTATE `25006`), so these are a difference from the ODBC and JDBC drivers, not a gap in the grammar. Started with `--sql-writes`, the SQL connection can run `INSERT`, `UPDATE` and `DELETE` in a narrow grammar ([pgwire-writes.md](pgwire-writes.md)); `CREATE`, `ALTER`, `DROP` and `TRUNCATE` stay refused.

## How the pages were read

The Claris pages (`help.claris.com/en/sql-reference/content/`) were read through a tool that summarizes a page, not a copy of its text. Where a result is marked `result`, the example and its result were in the summary; a summary can drop a detail, so a disagreement with a page deserves a look at the page before a fix. The grammar file names the page of every entry for that.

## Adding a construct

Add an entry to `sql-grammar.json` (id, area, construct, source page, `sql`, and `rows` or `error`), set `expected` to `result` only when the page states the result, and run `node --test --test-concurrency=2 packages/server/test/sql-grammar.test.ts`. A construct whose vendor result cannot be pinned down gets `expected: "unverified"`, `paths: []`, and a `note` saying why; the test reports its current behavior on each path. A construct that differs and is not fixed gets `known` with the reason, and a line in the table above (the test checks that every `known` id appears on this page). <!-- known-difference-ok: gives contributor instructions rather than stating another product difference -->
