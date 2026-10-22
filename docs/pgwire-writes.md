# SQL writes over the PostgreSQL port

The SQL connection (`--sql-port`) is read-only unless the server is started with `--sql-writes`. With the switch on, a client can run `INSERT`, `UPDATE` and `DELETE`, so reporting tools and ETL jobs can write to a hosted file the way ODBC and JDBC drivers do. The switch is off by default: a write is a new way to change data, and the connection stays exactly as [pgwire-session.md](pgwire-session.md) describes until someone turns it on.

<!-- docs-example: illustrative -->
```sh
tabularius serve <folder> --sql-port 5432 --sql-writes
```

`--sql-writes` (or `TABULARIUS_SQL_WRITES=1`) is only meaningful with `--sql-port`; giving it without one stops the server at start and says so. Without it, a write is refused with SQLSTATE `25006` and a message that names the switch.

## How a write is carried out

The statement is never handed to SQLite. It is read token by token into a plan, and every change is made through the same record methods the Data API uses (create, edit and delete a record). That means validation, auto-enter values such as serial numbers, record and field privileges, the audit log (the signed-in account, surface `sql`), the journal and live updates behave exactly as for a write from any other surface.

The account needs the `fmxdbc` extended privilege and must be able to view every record and field, as for reading. A write also needs the record privilege for the statement (create for `INSERT`, edit for `UPDATE`, delete for `DELETE`) and every field it writes must be modifiable for the account. All of this is checked when the statement runs, not when it is prepared, so a statement prepared before a privilege was taken away fails. A statement that matches no record is checked too: an account that cannot edit gets the refusal even when the `WHERE` finds nothing.

## What is accepted

| Form | Notes |
| --- | --- |
| `INSERT INTO table (field, …) VALUES (value, …)[, (…)]` | One or several rows. A slot may be the word `DEFAULT`: the field is left out so its auto-enter applies. |
| `INSERT INTO table DEFAULT VALUES` | One record with every field left to its auto-enter. |
| `UPDATE table SET field = value[, …] [WHERE condition]` | A value may read the record's own fields (`SET Count = Count + 1`). Without `WHERE` every record is changed. |
| `DELETE FROM table [WHERE condition]` | Without `WHERE` every record is deleted. |
| a trailing `RETURNING field[, …]` or `RETURNING *` | Gives back the stored row after the change (before the delete for `DELETE`). |

A value or a condition may use only literals (text, numbers, `NULL`, `TRUE`, `FALSE`), `$n` parameters, the operators `+ - * / % = <> != < > <= >=`, `AND`, `OR`, `NOT`, `IS`, `LIKE`, `GLOB`, `IN`, `BETWEEN`, `ESCAPE`, parentheses, and, in `UPDATE` and in a `WHERE`, the names of fields of the same table. Comments, quoted names and string literals are read as they are for a query.

The table is a table occurrence of the file the connection is for, and field names match without regard to case.

## What is refused

Each refusal says why and changes nothing.

- Functions (`upper(Name)`), subqueries, `INSERT … SELECT`, joins (`UPDATE … FROM`, `DELETE … USING`), qualified names (`Items.Name`), more than one statement in a prepared statement, and any other shape not in the table above.
- Assigning SQL `NULL` (including a `NULL` parameter), and assigning `DEFAULT` in `UPDATE`. Give `''` to empty a field, or use the Data API.
- Binary and container values, calculation fields, repeating fields and field repetitions such as `Name(2)`. Use the Data API for these.
- Fields whose names begin with `_fm_` (the file's own columns): error 201.
- A table occurrence that belongs to another hosted file. Connect to that file to change it.
- `INSERT` without a column list, `ON CONFLICT`, `ORDER BY` and `LIMIT` on a write.
- Data definition (`CREATE`, `ALTER`, `DROP`), `TRUNCATE` and `COPY`: SQLSTATE `0A000`. Change the design in design mode or with the design tools.

## Transactions

Outside `BEGIN`, each write statement is one unit that is kept or undone whole: a multi-row `INSERT` whose third row breaks a validation rule leaves none of the rows. A simple query made only of writes (several statements separated by semicolons) is also one unit, so a later statement that fails undoes the earlier ones, as PostgreSQL does.

`BEGIN` opens a storage transaction that the connection holds across messages. `COMMIT` keeps it and `ROLLBACK` undoes it. An error inside `BEGIN` puts the connection in the failed state: every command answers `25P02` until the end of the block, and `COMMIT` then undoes everything and answers `ROLLBACK`. Savepoints and chained transactions are not supported. Reads inside the transaction see its own uncommitted changes.

While a connection holds a transaction, the file is held: another session's write to that file is refused with `55P03` (FileMaker error 301) until the transaction ends. To keep a connection from holding a file for good:

- A connection idle inside `BEGIN` for 30 seconds is rolled back and closed with a `FATAL` error, SQLSTATE `25P03`. `TABULARIUS_PGWIRE_TX_IDLE_MS` sets another limit in milliseconds, read at each `BEGIN`; `0` means no limit.
- A transaction open for more than 5 minutes is rolled back and closed the same way, however busy the connection is, so a client that keeps sending queries cannot hold the file for good. `TABULARIUS_PGWIRE_TX_MAX_MS` sets another limit in milliseconds; `0` means no limit.
- A connection that closes, and a server that shuts down, roll back what they hold.

A running write cannot be cancelled from another connection: a cancel request only closes the connection it arrived on. Closing the connection that runs the write rolls the statement back.

One limit cannot be removed. A `SELECT` inside a transaction runs on the connection that holds the transaction, which has no numeric view of native decimal columns, so a comparison on a native decimal field in that `SELECT` compares the stored text. The values and conditions of a write itself are not affected: a native decimal field named in them is read as a number, so the same records match inside `BEGIN` as outside it. <!-- known-difference: SQL and calculations ;; A comparison on a native decimal field in a SELECT inside a SQL transaction compares the stored text, not the number ;; A query that compares a decimal with a number inside BEGIN can give a different answer than outside it ;; A way to give the transaction's connection the same numeric view as the read connection -->

## Error codes

A store error keeps its wording, prefixed with `FileMaker <code>: ` so the code can be looked up.

| SQLSTATE | When | FileMaker code |
| --- | --- | --- |
| `42501` | The account may not do this: no record privilege, or a field it may only view | 200, 201 |
| `23505` | A unique value is already used | 504 |
| `23502` | A required field is empty | 509 |
| `23514` | Another validation rule failed | 500 to 511 |
| `55P03` | The file is held by another transaction, or a record is in use | 301 |
| `54000` | Too many records or rows (see Limits) | 812 |
| `0A000` | A statement this connection does not take | none |
| `25P02` | An earlier statement in this block failed | none |
| `25P03` | The connection sat idle inside `BEGIN` too long (FATAL) | none |

## RETURNING

`RETURNING` is a Tabularius extension on this connection. Whether the product this one is compatible with accepts it on its ODBC and JDBC drivers is unverified. <!-- known-difference: SQL and calculations ;; RETURNING on an INSERT, UPDATE or DELETE over the SQL connection is a Tabularius extension; whether FileMaker's ODBC and JDBC drivers accept it is unverified ;; A client that sends RETURNING to FileMaker may get a syntax error where Tabularius answers rows ;; A run of RETURNING through FileMaker's ODBC or JDBC driver --> The rows come back as for a `SELECT` (text or binary, as the client asked), and `Describe` of a write with `RETURNING` answers its columns from the table without running it. A write without `RETURNING` answers no rows.

`INSERT … DEFAULT VALUES` and the per-slot `DEFAULT` follow the file's auto-enter rules. Whether the other product's drivers treat them the same way is unverified. <!-- known-difference: SQL and calculations ;; INSERT … DEFAULT VALUES and a DEFAULT in a VALUES list leave the field to its auto-enter; how FileMaker's drivers treat them is unverified ;; A field with an auto-enter may be filled differently than through FileMaker's driver ;; A run of both forms through FileMaker's ODBC or JDBC driver -->

A table occurrence that belongs to another hosted file is refused for writes here. Whether the other product allows a write through such an occurrence over ODBC is unverified. <!-- known-difference: SQL and calculations ;; A SQL write through a table occurrence that belongs to another hosted file is refused here; whether FileMaker's drivers allow it is unverified ;; The statement fails here with a message to connect to the other file ;; A run of an INSERT through such an occurrence over FileMaker's ODBC driver -->

## Limits

- One statement may change at most **100,000 records**; more fails with error 812 (SQLSTATE `54000`) before anything is kept. Split it with a `WHERE` condition.
- `RETURNING` obeys `TABULARIUS_PGWIRE_MAX_ROWS` ([pgwire-results.md](pgwire-results.md)): a statement that would give back more rows fails with `54000` and writes nothing.
- The idle limit and the maximum age of a transaction above.
- The usual per-account and per-server connection limits.

## When to use the Data API instead

Use the [Data API](data-api-compatibility.md) for what this connection refuses: `NULL` and container values, repeating fields, related records, scripts, and a write to a table of another file.
