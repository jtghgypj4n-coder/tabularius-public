# PostgreSQL wire session statements

The SQL connection is read-only unless the server was started with `--sql-writes` ([pgwire-writes.md](pgwire-writes.md)); the rows below describe the read-only default and say what changes with the switch. It accepts common PostgreSQL session commands so clients can connect, but a command tag alone does not mean the requested behavior took effect. Accepted commands with no effect emit a PostgreSQL `NoticeResponse` before `CommandComplete`. Its severity fields `S` and `V` are `WARNING`, `C` is SQLSTATE `01000` for an unsupported/no-op command or a transaction-class code for a transaction-state warning, and `M` explains the limitation.

| Statement | Behavior |
| --- | --- |
| `BEGIN` / `START TRANSACTION` | Tracks protocol transaction status and snapshots session settings for `ROLLBACK`; emits `01000` because no storage transaction starts. Repeated `BEGIN` emits `25001`. With `--sql-writes` it opens a storage transaction held across messages, with no `01000` notice; the connection is rolled back and closed (`25P03`) when it sits idle inside it too long, or keeps it open past the maximum age. |
| `COMMIT` / `END` / `ROLLBACK` | Ends tracked transaction state; emits `01000` because there is no storage transaction to commit or roll back (with `--sql-writes` it commits or rolls the storage transaction back instead, with no notice). Outside a transaction, emits `25P01`. A failed transaction ends with the `ROLLBACK` tag. Savepoints and transaction chaining are refused. |
| `SET application_name` | Emulated in the session, including `SET LOCAL` and rollback of settings. `SHOW application_name` reflects it. |
| `SET client_encoding = 'UTF8'`, `SET DateStyle = 'ISO, MDY'` | Accepted as the only supported values. Other values emit `01000` and leave the fixed value unchanged. |
| Other `SET` parameters | Accepted with `01000` and ignored. In particular, `search_path` cannot select another schema and `statement_timeout` is not enforced. Unknown names also warn. `SET LOCAL` for a supported parameter outside a transaction emits `25P01`. |
| `SET TRANSACTION` | Accepted with the `SET` tag and `01000`; isolation and access mode do not change. |
| `SHOW` | Returns the current value for every parameter sent in startup `ParameterStatus`, plus `transaction_read_only` (`on`; `off` with `--sql-writes`), `transaction isolation level`, `search_path` (`public`), and `statement_timeout` (`0`, no timeout). Unknown names are refused with `42704` rather than an empty value. |
| `DISCARD` | Accepted with the `DISCARD ALL` tag and `01000`; it does not clear session state or prepared statements. |
| `RESET` | Accepted with the `RESET` tag and `01000`; it does not reset a parameter. |
| `DEALLOCATE` | Accepted with the `DEALLOCATE` tag and `01000`; it does not remove prepared statements. They can be removed by the protocol Close message. |
| `DECLARE` / `FETCH` / `MOVE` / `CLOSE` (cursors), SQL `PREPARE` / `EXECUTE` | Refused with `0A000` and a message that says what to do instead: run the `SELECT` itself, or use the protocol's Parse, Bind and Execute (a driver's fetch size pages through a result with Execute's row limit). They are not reported as syntax errors. |
| `COPY`, `LISTEN`, `UNLISTEN`, `NOTIFY` and other non-queries | Refused with `25006` (the connection is read-only), or with `0A000` when `--sql-writes` is on. |

Warnings are sent when a statement executes, including extended-protocol `Execute`, not during `Parse`, `Bind`, or `Describe`. The notice fields follow the [PostgreSQL protocol definition](https://www.postgresql.org/docs/current/protocol-error-fields.html).

## Store errors

ErrorResponse uses these mappings to the conditions in
[PostgreSQL Appendix A](https://www.postgresql.org/docs/current/errcodes-appendix.html).
These are Tabularius mappings; matching another product's SQL error behavior is
**unverified** <!-- known-difference: SQL and calculations ;; The SQLSTATE sent for a Store error code is a Tabularius mapping, not confirmed against another product's SQL error behavior ;; A client sees the mapped SQLSTATE and the Store message ;; A comparison of another product's SQL errors for the same conditions -->.

| Store code | Meaning | SQLSTATE |
| --- | --- | --- |
| 102 | Missing or unavailable field | `42703` (`undefined_column`) |
| 106 | Missing table | `42P01` (`undefined_table`) |
| 200 | Access denied | `42501` (`insufficient_privilege`) |
| 212 | Account or authentication refused | `28000` (`invalid_authorization_specification`) |
| 301 | Record/transaction lock unavailable or expired | `55P03` (`lock_not_available`) |
| 812 | Host resource capacity exceeded (locks, CPU or memory) | `53000` (`insufficient_resources`) |
| 8310 | SQL statement, read-access or parameter restriction | `42000` (`syntax_error_or_access_rule_violation`) |
| Other store codes | No specific mapping, including 201's mixed field-modification restrictions | `42000` |

SQLite's missing-table and missing-column errors also return `42P01` and `42703`.
Other SQL-engine errors, such as an unknown function, retain `42000`. Protocol
errors and recognized syntax errors keep their existing SQLSTATEs; unexpected
server faults remain `XX000`.
