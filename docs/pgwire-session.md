# PostgreSQL wire session statements

The SQL connection is read-only. It accepts common PostgreSQL session commands so clients can connect, but a command tag alone does not mean the requested behavior took effect. Accepted commands with no effect emit a PostgreSQL `NoticeResponse` before `CommandComplete`. Its severity fields `S` and `V` are `WARNING`, `C` is SQLSTATE `01000` for an unsupported/no-op command or a transaction-class code for a transaction-state warning, and `M` explains the limitation.

| Statement | Behavior |
| --- | --- |
| `BEGIN` / `START TRANSACTION` | Tracks protocol transaction status and snapshots session settings for `ROLLBACK`; emits `01000` because no storage transaction starts. Repeated `BEGIN` emits `25001`. |
| `COMMIT` / `END` / `ROLLBACK` | Ends tracked transaction state; emits `01000` because there is no storage transaction to commit or roll back. Outside a transaction, emits `25P01`. A failed transaction ends with the `ROLLBACK` tag. Savepoints and transaction chaining are refused. |
| `SET application_name` | Emulated in the session, including `SET LOCAL` and rollback of settings. `SHOW application_name` reflects it. |
| `SET client_encoding = 'UTF8'`, `SET DateStyle = 'ISO, MDY'` | Accepted as the only supported values. Other values emit `01000` and leave the fixed value unchanged. |
| Other `SET` parameters | Accepted with `01000` and ignored. In particular, `search_path` cannot select another schema and `statement_timeout` is not enforced. Unknown names also warn. `SET LOCAL` for a supported parameter outside a transaction emits `25P01`. |
| `SET TRANSACTION` | Accepted with the `SET` tag and `01000`; isolation and access mode do not change. |
| `SHOW` | Returns the current value for every parameter sent in startup `ParameterStatus`, plus `transaction_read_only`, `transaction isolation level`, `search_path` (`public`), and `statement_timeout` (`0`, no timeout). Unknown names are refused with `42704` rather than an empty value. |
| `DISCARD` | Accepted with the `DISCARD ALL` tag and `01000`; it does not clear session state or prepared statements. |
| `RESET` | Accepted with the `RESET` tag and `01000`; it does not reset a parameter. |
| `DEALLOCATE` | Accepted with the `DEALLOCATE` tag and `01000`; it does not remove prepared statements. They can be removed by the protocol Close message. |
| `DECLARE` / `FETCH` / `MOVE` / `CLOSE` (cursors), SQL `PREPARE` / `EXECUTE` | Refused with `0A000` and a message that says what to do instead: run the `SELECT` itself, or use the protocol's Parse, Bind and Execute (a driver's fetch size pages through a result with Execute's row limit). They are not reported as syntax errors. |
| `COPY`, `LISTEN`, `UNLISTEN`, `NOTIFY` and other non-queries | Refused with `25006` (the connection is read-only). |

Warnings are sent when a statement executes, including extended-protocol `Execute`, not during `Parse`, `Bind`, or `Describe`. The notice fields follow the [PostgreSQL protocol definition](https://www.postgresql.org/docs/current/protocol-error-fields.html).
