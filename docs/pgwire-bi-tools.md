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
| `FROM table, unnest(table.column)` (a join against an array in another table's column) | `42000`. `unnest` in a subquery that reads the outer row, as Metabase writes it, works. |
| `SET` of a setting the server does not keep (`SET ROLE`, `SET SESSION TIMEZONE`, `search_path`, isolation level) | Accepted with a warning that `SET` had no effect. The connection stays the account that signed in. |

Problems from the SQL engine itself (an unknown table or function) come back as `42000` with the engine's message, not as PostgreSQL's `42P01` or `42883`.

## Known differences

- A query that names a table of a second hosted file (a user-interface file over a data file) runs against that file with the account's privileges there; it needs the account to read every record and field of it. It does **not** need the SQL extended privilege (`fmxdbc`) in the second file unless an administrator turned that on for the file: `tabularius sql-privilege <folder> <name> on`, the **SQL from other files** column of the console's hosted files, or `POST /tabularius/admin/v1/sql-privilege/{database}`. It is off by default for every file, so an existing install behaves as before. A connection made to a file itself always needs `fmxdbc` in it. With the switch on and the privilege missing, the HTTP endpoint answers error 9 (403) and leaves the file's tables out of its table list, and this port answers `42501`. This port's catalog still lists table names, as it already does for an account that cannot read every record. Not covered by it: `ExecuteSQL` in a calculation or script, which has never needed `fmxdbc`.
- The catalog shows the one file you connected to, as one schema (`public`), with its tables and columns. No indexes, constraints, views, functions or comments, so the catalog tables for them are there, with their PostgreSQL columns, and empty.
- Whole-number catalog columns (`oid`, `relnatts`, `attnum`) are reported as `numeric`, the type the server uses for numbers, and not as `oid`, `int2` or `int4`. A driver that reads them as integers converts them. Whether Npgsql accepts that when it loads types was not run (see below).
- The privilege functions (`has_table_privilege`, `has_schema_privilege` and the rest) answer with `1` or `0` as numbers, not `t` or `f`. They answer for a connection that only reads: `select`, `references` and `usage` are held, `insert`, `update`, `delete`, `create` and the like are not. A tool that treats any number as true, including 0, would see every privilege as held; Metabase's privilege query is written in a language that does (Clojure), but how its JDBC layer hands these columns over was not run.
- `array_agg` gives PostgreSQL's array text (`{a,"b c",NULL}`), as `text`, not as an array type. `array_to_string`, `array_remove`, `array_length` and `array_upper` read that text.
- `format_type` has no type modifiers, so `varchar(100)` is `character varying`.
- SQL casts convert (`'1.5'::int` is 1, `1::text` is text) and name and type their result column; a cast to a type with no counterpart here keeps the value, and a type name PostgreSQL does not have is refused. See [Upgrading](upgrading.md#changes-that-can-affect-existing-use).
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

## Binary formats

asyncpg, Npgsql, psycopg 3, pgx and pgjdbc in binary mode ask for values in PostgreSQL's binary format instead of text. The server reads and writes it per value, as Bind asks: no format code means text, one code applies to every parameter (or every column), otherwise there is one code per parameter (or column). Code lives in `packages/server/src/pgbinary.ts`; the byte-level tests are `packages/server/test/pgbinary.test.ts` (each type) and `packages/server/test/pgwire-binary.test.ts` (over the protocol, against a file the test makes).

| Type | Binary parameter | Binary result |
| --- | --- | --- |
| `bool`, `int2`, `int4`, `int8`, `oid`, `float4`, `float8` | Read | Written |
| `numeric` (NaN and the infinities included) | Read, up to 1,000 digits before the point (`22003` past it) | Written, with the same cap and exponents up to 1,000 (`22003` past them); a number field holding text that is not a number is NULL, as in the text format |
| `text`, `varchar`, `bpchar`, `name`, `json`, unspecified | Read; invalid UTF-8 or a NUL byte is `22021`, as in the text format | Written |
| `jsonb` | Read (version 1) | Written |
| `uuid` | Read | Written; a stored value that is not a uuid is `22P02` and not written short |
| `bytea` | Read, as the text format's `\x` form | Written |
| `date`, `time`, `timestamp`, `timestamptz` | Read, BC dates and `infinity` included; outside PostgreSQL's range is `22008` | Written (no column is described with these types: dates and times are `text`, as the file keeps them) |
| `interval` | Read, as PostgreSQL's default interval text (`1 year 2 mons 3 days 04:05:06`) | None: no column is an interval |
| Arrays of every type above (`int4[]`, `text[]`, `oid[]` and the rest) | Read, as PostgreSQL's array text (`{1,"a b",NULL}`), up to 6 dimensions | None: `array_agg` gives text |
| Anything else (`point`, `timetz`, ...) | `0A000`, saying to send the value as text | Never described |

A parameter is read into the value its text format gives, so a query finds the same rows whichever format the client picked; the tests check that for every type in the table. A cast in the query (`$1::numeric`, `$2::oid[]`) names a parameter's type when Parse leaves it unspecified, and Describe tells the client, so a driver that encodes by type sends that type.

The rules of the extended protocol that drivers rely on hold as in PostgreSQL, each with a byte-level test: a Bind with more than one format code but fewer than its parameters, with a different number of parameters than the statement, or with more than one result format code but not one per column is refused with `08P01` at Bind; a statement with no rows takes any number of result codes; Describe of a statement before Bind gives its parameter types and text formats, Describe of the portal the formats Bind asked for.

Malformed binary input is answered with an error, and the connection goes on after Sync: a value shorter than its type or a length below -1 or past the end of the message is `08P01`, a value longer than its type or with a bad header (numeric sign, scale or digit, jsonb version, array flags) is `22P03`, an array of another element type is `42804`, more than 6 dimensions is `54000`. An array that claims more elements than its bytes can hold is refused before any is read.

A binary value cannot grow much past what was sent, so a few small Bind messages cannot fill the server's memory (a prepared portal keeps its parameters). A numeric may have at most 1,000 digits before the point, where PostgreSQL allows 131,072: ten bytes could otherwise read as 131 KB of text. FileMaker numbers keep 400. The text that one Bind's numeric and array parameters expand to is limited to 256 KiB plus four characters per byte of the message, which every element type's text fits in (a numeric alone can read as 16 KB of text from ten bytes, and a Bind holds up to 65,535 parameters). Past it the Bind is refused with `54000` and no portal is kept. The decoders are a target of the repository's fuzzer (`npm run fuzz -- --target pgwire-binary`), and the fixed-seed smoke in `packages/server/test/fuzz.test.ts` runs it.

Binary results come from the same rows as text ones and go through the same checks. This connection has no field masks: SQL reads every record and field, so a privilege set that hides a field, masks one (last four characters or a placeholder), hides fields by default, limits records by a calculation or cannot view a table is refused at sign-in, and if it is narrowed to one of those while connected, the next Execute of a portal that already holds rows, in either format, is refused with `42501` and sends none. The tests run each of those six kinds.

What these tests do not show: no driver named above was run against the server in this change, so none is claimed to work beyond the bytes the tests send, which follow the PostgreSQL protocol documentation and source. Where a float element of an array switches to exponent notation follows JavaScript, which can differ from PostgreSQL for very large and very small values; an interval of -1 of a unit is written `-1 days`, as PostgreSQL's interval code reads, which was not checked against a running server. <!-- known-difference: PostgreSQL connection ;; Binary array parameters with float elements, and intervals of exactly -1 of a unit, are read into text that may differ from PostgreSQL's (exponent notation thresholds; singular or plural) and is unverified against a running server ;; A query comparing such a parameter with stored text could find different rows than on PostgreSQL ;; A run of asyncpg or Npgsql against PostgreSQL and this server with the same parameters -->

Three things the binary format does not change, and which are the same in the text format: a container field reads as its reference number, not its bytes; a decimal field is described as `text` by the extended protocol (Describe reads declared types, and the decimal's column has none) where a simple query describes it as `numeric` from its values; and a decimal with more significant digits than a double holds comes back rounded to a double in either protocol.

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
