# BI tools on the PostgreSQL connection

BI tools and drivers do not only run your queries. When they connect, and when you browse a schema, they send their own queries to PostgreSQL's catalog. A tool that gets a hang, a crash or a surprising answer to one of those shows an empty schema or refuses to connect. This page lists what was tried, where each query came from, what the server answers, and what is not verified.

The queries are in [`packages/server/test/data/bi-tool-queries.json`](../packages/server/test/data/bi-tool-queries.json), each with the page or file it follows. `packages/server/test/bi-tool-queries.test.ts` runs every one against a served file.

## What was run

| Tool | Queries | Where they came from |
| --- | --- | --- |
| psql 16 | 54: `\l`, `\l+`, `\dn`, `\dt`, `\d`, `\d table`, `\d+ table`, `\df`, `\du`, `\dT`, `\dx`, `\dp`, `\dD`, `\dC`, `\dE`, `\dm`, `\dF`, `\dO`, `\db`, `\dy`, `\dd`, `\dRp`, `\dRs`, `\dL`, `\dA`, `\dc`, `\sv`, `\sf` | Captured from a real psql 16.15 started with `-E`, which prints each query it sends. |
| JDBC (pgjdbc) | 15: connection setup, `getSchemas`, `getCatalogs`, `getTables`, `getColumns`, `getPrimaryKeys`, `getImportedKeys`, `getIndexInfo`, the type lookups, a fetch size | `PgDatabaseMetaData.java` and `TypeInfoCache.java` on the project's master branch, and the JDBC documentation for cursors. |
| DBeaver | 12: server version, database list, settings, schemas, tables, columns, constraints, indexes | `PostgreDataSource.java`, `PostgreDatabase.java`, `PostgreSchema.java` on the `devel` branch. |
| Metabase | 6: enum types, tables, table privileges, indexes, `SET SESSION TIMEZONE`, `SET ROLE` | `driver/postgres.clj`. The tables query is the HoneySQL map written out by hand; the rest are transcribed. |
| Npgsql (Power BI's driver) | 2: `SELECT version()` and the type-loading batch | `PostgresDatabaseInfo.cs`. |
| SQLAlchemy (Apache Superset) | 7: server version, default schema, `standard_conforming_strings`, isolation level, `SET SESSION CHARACTERISTICS`, `COMMIT`, `SET SESSION search_path` | The dialect's `base.py` and its documentation. |
| psycopg2 (SQLAlchemy `stream_results`) | 3: a named cursor's `DECLARE`, `FETCH`, `CLOSE` | Written from the documented behaviour; the statement text was not fetched. |
| Any client | `PREPARE` and `EXECUTE`, typed parameters (int4, text, bool, numeric, timestamptz, unspecified), `current_schema()`, `current_schemas(true)`, `format_type`, `array_agg` | The PostgreSQL manual pages named in the file. |

Every query was run as an account with SQL access. The test also checks, for every query, that:

- the answer has the columns the entry lists (where it lists them), or the documented error code,
- it comes back within 10 seconds and the connection answers `SELECT 1` straight after,
- no answer holds a table, name or row of another file the server hosts (a second file with a table called `Secret` is served beside the one under test, and asked for by name in several spellings),
- an account whose privilege set has no `fmxdbc` extended privilege, or cannot see every record, is refused at sign-in with `42501`,
- an account that loses `fmxdbc` while connected gets `42501`, and no rows, from every query in the list.

## What the server answers

Every query in the list answers, except the ones that ask for something this connection does not do:

| Query | Answer |
| --- | --- |
| Cursors: `DECLARE`, `FETCH`, `MOVE`, `CLOSE` | `0A000`, with a message that says to run the `SELECT` itself or use a fetch size. A fetch size works: it is the protocol's Execute row limit, not a cursor. |
| SQL `PREPARE` and `EXECUTE` | `0A000`, with a message that says to use Parse, Bind and Execute. Drivers do. |
| `array_agg(DISTINCT x)` | `42000`, naming `array_agg`. |
| `FROM table, unnest(table.column)` (a join against an array in another table's column) | `42703` (the outer column is unavailable here). `unnest` in a subquery that reads the outer row, as Metabase writes it, works. |
| `SET` of a setting the server does not keep (`SET ROLE`, `SET SESSION TIMEZONE`, `search_path`, isolation level) | Accepted with a warning that `SET` had no effect. The connection stays the account that signed in. |

Unknown tables and columns return `42P01` and `42703`. Other SQL-engine problems,
including unknown functions, retain `42000` with the engine's message. See the
[store error mappings](pgwire-session.md#store-errors) and
[date/time result types](pgwire-results.md#date-and-time-result-types).

## Known differences

- The catalog shows the one file you connected to, as one schema (`public`), with its tables and columns. No indexes, constraints, views, functions or comments, so the catalog tables for them are there, with their PostgreSQL columns, and empty.
- Whole-number catalog columns (`oid`, `relnatts`, `attnum`) are reported as `numeric`, the type the server uses for numbers, and not as `oid`, `int2` or `int4`. A driver that reads them as integers converts them. Whether Npgsql accepts that when it loads types was not run (see below).
- The privilege functions (`has_table_privilege`, `has_schema_privilege` and the rest) answer with `1` or `0` as numbers, not `t` or `f`. They answer for a connection that only reads: `select`, `references` and `usage` are held, `insert`, `update`, `delete`, `create` and the like are not. A tool that treats any number as true, including 0, would see every privilege as held; Metabase's privilege query is written in a language that does (Clojure), but how its JDBC layer hands these columns over was not run.
- `array_agg` gives PostgreSQL's array text (`{a,"b c",NULL}`), as `text`, not as an array type. `array_to_string`, `array_remove`, `array_length` and `array_upper` read that text.
- `format_type` has no type modifiers, so `varchar(100)` is `character varying`.
- A hidden `tableoid` column is there when a query names it and is not part of `SELECT *`.

## Fixed by running the list

- `pg_cast`, `pg_ts_config`, `pg_conversion`, `pg_language`, `pg_opfamily`, `pg_opclass`, `pg_subscription` and `pg_event_trigger` did not exist; `pg_enum` had no `oid`.
- `pg_database_size`, `pg_collation_is_visible` (and the other `*_is_visible` functions), `pg_tablespace_location`, `pg_get_functiondef`, `pg_stat_get_numscans`, `pg_has_role`, `getdatabaseencoding`, `pg_char_to_encoding` and `array_remove` did not exist.
- `unnest(...) AS t(x)` and `unnest(...) WITH ORDINALITY AS k(a, n)` were syntax errors.
- A bare name in `ORDER BY` that is also a column of two joined tables (Npgsql's `ORDER BY oid`) was ambiguous. PostgreSQL reads it as the output column, and so does the server now.
- Words such as `table`, `update` and `select` after `AS` (Metabase's privilege query) were syntax errors in a catalog query.
- `current_schemas(true)` failed outside a catalog query, and `array_agg` did not exist.
- Cursor and `PREPARE` statements were reported as syntax errors.
- The privilege functions answered `1` for everything, `insert` and `delete` included. `pg_has_role` now says yes only for the signed-in account's own name, and none claim a grant option.
- A data read with a `pg_` name in it that is not a catalog table (`pg_has_role(...)`, an alias called `pg_x`) skipped the read log. Only a query that names one of the catalog's tables or views is left out of it now.
- Found by a second-opinion review of this change and fixed in it: `ORDER BY name LIMIT n` lost the space before `LIMIT`, nested `array_agg` produced broken SQL, and the new rewrites took quadratic time on very long queries (many `array_agg` calls, unclosed comments); they are linear now, and `array_agg` nested more than 20 deep is refused.

## Read log

With read logging on, a query is logged as a read of each table of the file it names, unless it names one of the catalog's tables or views. A query that joins a table of the file with a catalog table (`FROM Customers, pg_class`) is treated as a catalog query and is not logged. This was so before this change and is not changed by it.

## Not verified

These are in the `notVerified` list of the data file with the reason for each:

- Grafana's PostgreSQL data source: its source could not be fetched and no Grafana was run.
- Tableau's PostgreSQL connector: closed source, no public list of its queries.
- Power BI beyond Npgsql's type loading: closed source.
- SQLAlchemy's reflection (Superset's table and column lists): built at run time, and SQLAlchemy was not run.
- Which columns DBeaver reads by name from `SELECT c.*`: the classes that read them were not fetched.
- The exact driver and tool versions: sources are from their main branches on the day of the work. Only psql was a real client.
- Whether Npgsql loads types from the `numeric` columns above: it was not run.
