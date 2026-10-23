// PostgreSQL's system catalogs for a hosted file, so tools that browse a
// database (psql's \d, BI tools' table pickers, ODBC and JDBC metadata) see
// its tables and columns. Each table occurrence is a table in the "public"
// schema, as in FileMaker SQL; its columns are the table's stored fields.
//
// Catalog queries are PostgreSQL SQL, and the file runs SQLite, so they are
// rewritten first (pgSyntax): casts and the pg_catalog prefix go, regular
// expression operators become REGEXP. Then the catalog tables a query names
// are put in front of it as a WITH clause (withCatalog), built from the
// file's design, and the functions they call are defined (catalogFunctions).

import { cleanSql, maskSql, sqlName, sqlTokens, type SqlToken } from '../../store/src/sql-tokens.ts';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import type { Store } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { assertPatternNesting, guardedTest, RegexTimeout } from '../../calc/src/regex-guard.ts';

export const NS = { pg_catalog: 11, public: 2200, information_schema: 13_000 } as const;
const DATABASE_OID = 16_384;
export const FIRST_TABLE_OID = 16_400;

/** Types a catalog query may look up, by oid. */
const TYPES: [oid: number, name: string, len: number, category: string][] = [
  [16, 'bool', 1, 'B'], [17, 'bytea', -1, 'U'], [18, 'char', 1, 'S'], [19, 'name', 64, 'S'], [20, 'int8', 8, 'N'], [21, 'int2', 2, 'N'],
  [23, 'int4', 4, 'N'], [25, 'text', -1, 'S'], [26, 'oid', 4, 'N'], [700, 'float4', 4, 'N'], [701, 'float8', 8, 'N'],
  [1042, 'bpchar', -1, 'S'], [1043, 'varchar', -1, 'S'], [1082, 'date', 4, 'D'], [1083, 'time', 8, 'D'], [1114, 'timestamp', 8, 'D'],
  [1184, 'timestamptz', 8, 'D'], [1700, 'numeric', -1, 'N'],
];
/** format_type's names, which differ from typname for a few. */
const FORMATTED: Record<number, string> = {
  16: 'boolean', 18: '"char"', 20: 'bigint', 21: 'smallint', 23: 'integer', 700: 'real', 701: 'double precision',
  1042: 'character', 1043: 'character varying', 1083: 'time without time zone', 1114: 'timestamp without time zone', 1184: 'timestamp with time zone',
};

/** Settings, as current_setting() and pg_settings show them. */
const SETTINGS: Record<string, string> = {
  server_version: '14.0', server_version_num: '140000', server_encoding: 'UTF8', client_encoding: 'UTF8', timezone: 'UTC', datestyle: 'ISO, MDY',
  search_path: 'public', standard_conforming_strings: 'on', default_transaction_read_only: 'on', transaction_read_only: 'on',
  max_index_keys: '32', max_identifier_length: '63', max_function_args: '100', block_size: '8192', integer_datetimes: 'on', lc_collate: 'C', lc_ctype: 'C',
};

type Col = [name: string, type: 'INTEGER' | 'TEXT' | 'REAL' | 'BOOLEAN'];
interface Relation {
  cols: Col[];
  rows?: (c: CatalogData) => Record<string, SqlValue>[];
}

/** What the catalog shows: the file's tables and their columns. */
export interface CatalogData {
  database: string;
  user: string;
  tables: { oid: number; name: string; columns: { name: string; oid: number }[] }[];
}

const I = (...names: string[]): Col[] => names.map((n) => [n, 'INTEGER']);
const T = (...names: string[]): Col[] => names.map((n) => [n, 'TEXT']);
/** True or false: 1 or 0 to SQLite, t or f to the client (see BOOLEAN_COLUMNS). */
const B = (...names: string[]): Col[] => names.map((n) => [n, 'BOOLEAN']);

const RELATIONS: Record<string, Relation> = {
  pg_namespace: {
    cols: [...I('oid', 'nspowner'), ...T('nspname', 'nspacl')],
    rows: () => Object.entries(NS).map(([nspname, oid]) => ({ oid, nspname, nspowner: 10 })),
  },
  pg_class: {
    cols: [
      ...I('oid', 'relnamespace', 'reltype', 'reloftype', 'relowner', 'relam', 'relfilenode', 'reltablespace', 'relpages', 'relallvisible', 'reltoastrelid', 'relnatts', 'relchecks', 'relfrozenxid', 'relminmxid'),
      ['reltuples', 'REAL'],
      ...B('relhasindex', 'relisshared', 'relhasrules', 'relhastriggers', 'relhassubclass', 'relrowsecurity', 'relforcerowsecurity', 'relispopulated', 'relispartition', 'relhasoids'),
      ...T('relname', 'relpersistence', 'relkind', 'relreplident', 'relrewrite', 'relacl', 'reloptions', 'relpartbound'),
    ],
    rows: (c) => c.tables.map((t) => ({
      oid: t.oid, relname: t.name, relnamespace: NS.public, reltype: 0, reloftype: 0, relowner: 10, relam: 2, relfilenode: t.oid, reltablespace: 0,
      relpages: 0, reltuples: -1, relallvisible: 0, reltoastrelid: 0, relhasindex: 0, relisshared: 0, relpersistence: 'p', relkind: 'r',
      relnatts: t.columns.length, relchecks: 0, relhasrules: 0, relhastriggers: 0, relhassubclass: 0, relrowsecurity: 0, relforcerowsecurity: 0,
      relispopulated: 1, relreplident: 'd', relispartition: 0, relhasoids: 0, relrewrite: 0, relfrozenxid: 0, relminmxid: 0,
    })),
  },
  pg_attribute: {
    cols: [
      ...I('attrelid', 'atttypid', 'attlen', 'attnum', 'attndims', 'attcacheoff', 'atttypmod', 'attstattarget', 'attcollation', 'attinhcount'),
      ...B('attbyval', 'attnotnull', 'atthasdef', 'atthasmissing', 'attisdropped', 'attislocal'),
      ...T('attname', 'attalign', 'attstorage', 'attcompression', 'attidentity', 'attgenerated', 'attacl', 'attoptions', 'attfdwoptions', 'attmissingval'),
    ],
    rows: (c) => c.tables.flatMap((t) => t.columns.map((col, i) => ({
      attrelid: t.oid, attname: col.name, atttypid: col.oid, attlen: TYPES.find((x) => x[0] === col.oid)?.[2] ?? -1, attnum: i + 1, attndims: 0,
      attcacheoff: -1, atttypmod: -1, attstattarget: -1, attcollation: col.oid === 25 ? 100 : 0, attinhcount: 0, attbyval: 0, attnotnull: 0,
      atthasdef: 0, atthasmissing: 0, attisdropped: 0, attislocal: 1, attalign: 'i', attstorage: 'x', attcompression: '', attidentity: '', attgenerated: '',
    }))),
  },
  pg_type: {
    cols: [
      ...I('oid', 'typnamespace', 'typowner', 'typlen', 'typrelid', 'typelem', 'typarray', 'typbasetype', 'typtypmod', 'typndims', 'typcollation'), ...B('typbyval', 'typispreferred', 'typisdefined', 'typnotnull'),
      ...T('typname', 'typtype', 'typcategory', 'typdelim', 'typinput', 'typoutput', 'typreceive', 'typsend', 'typalign', 'typstorage', 'typdefault', 'typacl'),
    ],
    rows: () => TYPES.map(([oid, typname, typlen, typcategory]) => ({
      oid, typname, typnamespace: NS.pg_catalog, typowner: 10, typlen, typbyval: typlen > 0 && typlen <= 8 ? 1 : 0, typtype: 'b', typcategory,
      typispreferred: 0, typisdefined: 1, typdelim: ',', typrelid: 0, typelem: 0, typarray: 0, typnotnull: 0, typbasetype: 0, typtypmod: -1,
      typndims: 0, typcollation: typcategory === 'S' ? 100 : 0, typalign: 'i', typstorage: 'x',
    })),
  },
  pg_database: {
    cols: [...I('oid', 'datdba', 'encoding', 'datconnlimit', 'dattablespace'), ...B('datistemplate', 'datallowconn'), ...T('datname', 'datcollate', 'datctype', 'datacl')],
    rows: (c) => [{ oid: DATABASE_OID, datname: c.database, datdba: 10, encoding: 6, datcollate: 'C', datctype: 'C', datistemplate: 0, datallowconn: 1, datconnlimit: -1, dattablespace: 1663 }],
  },
  pg_roles: {
    cols: [...I('oid', 'rolconnlimit'), ...B('rolsuper', 'rolinherit', 'rolcreaterole', 'rolcreatedb', 'rolcanlogin', 'rolreplication', 'rolbypassrls'), ...T('rolname', 'rolpassword', 'rolvaliduntil', 'rolconfig')],
    rows: (c) => [{ oid: 10, rolname: c.user, rolsuper: 0, rolinherit: 1, rolcreaterole: 0, rolcreatedb: 0, rolcanlogin: 1, rolreplication: 0, rolbypassrls: 0, rolconnlimit: -1, rolpassword: '********' }],
  },
  pg_user: {
    cols: [...I('usesysid'), ...B('usecreatedb', 'usesuper', 'userepl', 'usebypassrls'), ...T('usename', 'passwd', 'valuntil', 'useconfig')],
    rows: (c) => [{ usesysid: 10, usename: c.user, usecreatedb: 0, usesuper: 0, userepl: 0, usebypassrls: 0, passwd: '********' }],
  },
  pg_am: { cols: [...I('oid', 'amhandler'), ...T('amname', 'amtype')], rows: () => [{ oid: 2, amname: 'heap', amhandler: 0, amtype: 't' }] },
  pg_tables: {
    cols: [...T('schemaname', 'tablename', 'tableowner', 'tablespace'), ...B('hasindexes', 'hasrules', 'hastriggers', 'rowsecurity')],
    rows: (c) => c.tables.map((t) => ({ schemaname: 'public', tablename: t.name, tableowner: c.user, hasindexes: 0, hasrules: 0, hastriggers: 0, rowsecurity: 0 })),
  },
  pg_settings: {
    cols: T('name', 'setting', 'unit', 'category', 'short_desc', 'context', 'vartype', 'source'),
    rows: () => Object.entries(SETTINGS).map(([name, setting]) => ({ name, setting, context: 'internal', vartype: /^\d+$/.test(setting) ? 'integer' : 'string', source: 'default' })),
  },
  // Empty: the file has no indexes, constraints, views or the like to show.
  pg_index: { cols: [...I('indexrelid', 'indrelid', 'indnatts', 'indnkeyatts'), ...B('indisunique', 'indisprimary', 'indisexclusion', 'indimmediate', 'indisclustered', 'indisvalid', 'indcheckxmin', 'indisready', 'indislive', 'indisreplident', 'indnullsnotdistinct'), ...T('indkey', 'indcollation', 'indclass', 'indoption', 'indexprs', 'indpred')] },
  pg_constraint: { cols: [...I('oid', 'connamespace', 'conrelid', 'contypid', 'conindid', 'conparentid', 'confrelid', 'coninhcount'), ...B('condeferrable', 'condeferred', 'convalidated', 'conislocal', 'connoinherit'), ...T('conname', 'contype', 'confupdtype', 'confdeltype', 'confmatchtype', 'conkey', 'confkey', 'conpfeqop', 'conppeqop', 'conffeqop', 'conexclop', 'conbin')] },
  pg_inherits: { cols: [...I('inhrelid', 'inhparent', 'inhseqno'), ...B('inhdetachpending')] },
  pg_description: { cols: [...I('objoid', 'classoid', 'objsubid'), ...T('description')] },
  pg_attrdef: { cols: [...I('oid', 'adrelid', 'adnum'), ...T('adbin')] },
  pg_trigger: { cols: [...I('oid', 'tgrelid', 'tgparentid', 'tgfoid', 'tgtype', 'tgconstrrelid', 'tgconstrindid', 'tgconstraint', 'tgnargs'), ...B('tgisinternal', 'tgdeferrable', 'tginitdeferred'), ...T('tgname', 'tgenabled', 'tgattr', 'tgargs', 'tgqual', 'tgoldtable', 'tgnewtable')] },
  pg_policy: { cols: [...I('oid', 'polrelid'), ...B('polpermissive'), ...T('polname', 'polcmd', 'polroles', 'polqual', 'polwithcheck')] },
  pg_rewrite: { cols: [...I('oid', 'ev_class'), ...B('is_instead'), ...T('rulename', 'ev_type', 'ev_enabled', 'ev_qual', 'ev_action')] },
  pg_statistic_ext: { cols: [...I('oid', 'stxrelid', 'stxnamespace', 'stxowner', 'stxstattarget'), ...T('stxname', 'stxkeys', 'stxkind', 'stxexprs')] },
  pg_publication: { cols: [...I('oid', 'pubowner'), ...B('puballtables', 'pubinsert', 'pubupdate', 'pubdelete', 'pubtruncate', 'pubviaroot'), ...T('pubname')] },
  pg_publication_rel: { cols: [...I('oid', 'prpubid', 'prrelid'), ...T('prqual', 'prattrs')] },
  pg_publication_namespace: { cols: I('oid', 'pnpubid', 'pnnspid') },
  pg_foreign_table: { cols: [...I('ftrelid', 'ftserver'), ...T('ftoptions')] },
  pg_partitioned_table: { cols: [...I('partrelid', 'partnatts', 'partdefid'), ...T('partstrat', 'partattrs', 'partclass', 'partcollation', 'partexprs')] },
  pg_proc: { cols: [...I('oid', 'pronamespace', 'proowner', 'prolang', 'prorettype', 'pronargs'), ...B('proretset'), ...T('proname', 'prokind', 'proargtypes', 'proargnames', 'prosrc')] },
  pg_collation: { cols: [...I('oid', 'collnamespace', 'collowner', 'collencoding'), ...B('collisdeterministic'), ...T('collname', 'collprovider', 'collcollate', 'collctype')] },
  pg_tablespace: { cols: [...I('oid', 'spcowner'), ...T('spcname', 'spcacl', 'spcoptions')] },
  pg_depend: { cols: [...I('classid', 'objid', 'objsubid', 'refclassid', 'refobjid', 'refobjsubid'), ...T('deptype')] },
  pg_sequence: { cols: [...I('seqrelid', 'seqtypid', 'seqstart', 'seqincrement', 'seqmax', 'seqmin', 'seqcache'), ...B('seqcycle')] },
  pg_enum: { cols: [...I('oid', 'enumtypid'), ['enumsortorder', 'REAL'], ...T('enumlabel')] },
  pg_extension: { cols: [...I('oid', 'extowner', 'extnamespace'), ...B('extrelocatable'), ...T('extname', 'extversion', 'extconfig', 'extcondition')] },
  pg_views: { cols: T('schemaname', 'viewname', 'viewowner', 'definition') },
  pg_matviews: { cols: [...T('schemaname', 'matviewname', 'matviewowner', 'tablespace', 'definition'), ...B('hasindexes', 'ispopulated')] },
  pg_indexes: { cols: T('schemaname', 'tablename', 'indexname', 'tablespace', 'indexdef') },
  pg_range: { cols: I('rngtypid', 'rngsubtype', 'rngmultitypid', 'rngcollation', 'rngsubopc', 'rngcanonical', 'rngsubdiff') },
  pg_cast: { cols: [...I('oid', 'castsource', 'casttarget', 'castfunc'), ...T('castcontext', 'castmethod')] },
  pg_ts_config: { cols: [...I('oid', 'cfgnamespace', 'cfgowner', 'cfgparser'), ...T('cfgname')] },
  pg_conversion: { cols: [...I('oid', 'connamespace', 'conowner', 'conforencoding', 'contoencoding', 'conproc'), ...B('condefault'), ...T('conname')] },
  pg_language: { cols: [...I('oid', 'lanowner', 'lanplcallfoid', 'laninline', 'lanvalidator'), ...B('lanispl', 'lanpltrusted'), ...T('lanname', 'lanacl')] },
  pg_opfamily: { cols: [...I('oid', 'opfmethod', 'opfnamespace', 'opfowner'), ...T('opfname')] },
  pg_subscription: { cols: [...I('oid', 'subdbid', 'subowner'), ...B('subenabled', 'subbinary', 'subdisableonerr'), ...T('subname', 'subconninfo', 'subslotname', 'subsynccommit', 'subpublications', 'substream', 'subtwophasestate')] },
  pg_opclass: { cols: [...I('oid', 'opcmethod', 'opcnamespace', 'opcowner', 'opcfamily', 'opcintype', 'opckeytype'), ...B('opcdefault'), ...T('opcname')] },
  pg_event_trigger: { cols: [...I('oid', 'evtowner', 'evtfoid'), ...T('evtname', 'evtevent', 'evtenabled', 'evttags')] },
  pg_stat_user_tables: { cols: [...I('relid', 'seq_scan', 'idx_scan', 'n_live_tup', 'n_dead_tup'), ...T('schemaname', 'relname', 'last_analyze', 'last_autoanalyze')] },
  pg_stat_activity: { cols: [...I('datid', 'pid', 'usesysid'), ...T('datname', 'usename', 'application_name', 'client_addr', 'state', 'query', 'backend_start')] },

  // The SQL standard's views, as BI tools read them.
  information_schema__schemata: {
    cols: T('catalog_name', 'schema_name', 'schema_owner', 'default_character_set_catalog', 'default_character_set_schema', 'default_character_set_name', 'sql_path'),
    rows: (c) => Object.keys(NS).map((schema_name) => ({ catalog_name: c.database, schema_name, schema_owner: c.user })),
  },
  information_schema__tables: {
    cols: T('table_catalog', 'table_schema', 'table_name', 'table_type', 'self_referencing_column_name', 'reference_generation', 'user_defined_type_catalog', 'user_defined_type_schema', 'user_defined_type_name', 'is_insertable_into', 'is_typed', 'commit_action'),
    rows: (c) => c.tables.map((t) => ({ table_catalog: c.database, table_schema: 'public', table_name: t.name, table_type: 'BASE TABLE', is_insertable_into: 'NO', is_typed: 'NO' })),
  },
  information_schema__columns: {
    cols: [
      ...T('table_catalog', 'table_schema', 'table_name', 'column_name', 'column_default', 'is_nullable', 'data_type', 'udt_catalog', 'udt_schema', 'udt_name', 'is_identity', 'is_generated', 'is_updatable', 'domain_name', 'collation_name', 'interval_type', 'generation_expression'),
      ...I('ordinal_position', 'character_maximum_length', 'character_octet_length', 'numeric_precision', 'numeric_precision_radix', 'numeric_scale', 'datetime_precision', 'dtd_identifier'),
    ],
    rows: (c) => c.tables.flatMap((t) => t.columns.map((col, i) => ({
      table_catalog: c.database, table_schema: 'public', table_name: t.name, column_name: col.name, ordinal_position: i + 1, is_nullable: 'YES',
      data_type: FORMATTED[col.oid] ?? TYPES.find((x) => x[0] === col.oid)?.[1] ?? 'text', udt_catalog: c.database, udt_schema: 'pg_catalog',
      udt_name: TYPES.find((x) => x[0] === col.oid)?.[1] ?? 'text', is_identity: 'NO', is_generated: 'NEVER', is_updatable: 'NO', dtd_identifier: i + 1,
      numeric_precision_radix: col.oid === 1700 ? 10 : null,
    }))),
  },
  information_schema__views: { cols: T('table_catalog', 'table_schema', 'table_name', 'view_definition', 'check_option', 'is_updatable', 'is_insertable_into') },
  information_schema__table_constraints: { cols: T('constraint_catalog', 'constraint_schema', 'constraint_name', 'table_catalog', 'table_schema', 'table_name', 'constraint_type', 'is_deferrable', 'initially_deferred', 'enforced') },
  information_schema__key_column_usage: { cols: [...T('constraint_catalog', 'constraint_schema', 'constraint_name', 'table_catalog', 'table_schema', 'table_name', 'column_name'), ...I('ordinal_position', 'position_in_unique_constraint')] },
  information_schema__referential_constraints: { cols: T('constraint_catalog', 'constraint_schema', 'constraint_name', 'unique_constraint_catalog', 'unique_constraint_schema', 'unique_constraint_name', 'match_option', 'update_rule', 'delete_rule') },
  information_schema__routines: { cols: T('specific_catalog', 'specific_schema', 'specific_name', 'routine_catalog', 'routine_schema', 'routine_name', 'routine_type', 'data_type') },
};

/** The oid of each catalog table as PostgreSQL numbers them, which its rows give as their hidden tableoid column. */
const TABLEOIDS: Record<string, number> = {
  pg_class: 1259, pg_attribute: 1249, pg_proc: 1255, pg_type: 1247, pg_namespace: 2615, pg_database: 1262, pg_constraint: 2606, pg_language: 2612,
  pg_description: 2609, pg_trigger: 2620, pg_rewrite: 2618, pg_am: 2601, pg_cast: 2605, pg_conversion: 2607, pg_opclass: 2616, pg_opfamily: 2753,
  pg_extension: 3079, pg_collation: 3456, pg_enum: 3501, pg_ts_config: 3602, pg_event_trigger: 3466, pg_tablespace: 1213, pg_index: 2610,
  pg_attrdef: 2604, pg_inherits: 2611, pg_depend: 2608,
};

/** Catalog columns that are booleans, which clients read as t or f. */
export const BOOLEAN_COLUMNS = new Set(Object.values(RELATIONS).flatMap((r) => r.cols.filter((c) => c[1] === 'BOOLEAN').map((c) => c[0])));

/** Whether a query names one of the catalog's tables or views, so it needs them added in front. */
export function namesCatalogRelation(sql: string): boolean {
  return Object.keys(RELATIONS).some((name) => new RegExp(`\\b${name}\\b`, 'i').test(sql));
}

/** Whether a query uses anything with a catalog's name, a table or a function, so the catalog's functions are defined for it. */
export function readsCatalog(sql: string): boolean {
  return /\b(pg_\w+|information_schema__\w+)\b/i.test(sql);
}

/**
 * The query with the catalog tables it names in front, as a WITH clause.
 * A query that has its own WITH clause gets the catalog's added to it.
 */
export function withCatalog(sql: string, data: () => CatalogData): string {
  const named = Object.keys(RELATIONS).filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(sql));
  if (!named.length) return sql;
  const c = data();
  const ctes = named.map((name) => {
    const r = RELATIONS[name];
    const rows = r.rows?.(c) ?? [];
    // FileMaker names ignore case, so 'congress' finds Congress.
    const cols = r.cols.map(([col, type]) => `CAST(value->>${lit(col)} AS ${type === 'BOOLEAN' ? 'INTEGER' : type})${type === 'TEXT' ? ' COLLATE NOCASE' : ''} AS ${col}`).join(', ');
    // json_each of an empty array still names the columns.
    // tableoid is a hidden column: it is there when the query names it, and `*` doesn't include it otherwise.
    const tableoid = /\btableoid\b/i.test(sql) ? `, ${TABLEOIDS[name] ?? 0} AS tableoid` : '';
    return `${name} AS (SELECT ${cols}${tableoid} FROM json_each(${lit(JSON.stringify(rows))}))`;
  });
  const own = /^(\s*WITH\s+(?:RECURSIVE\s+)?)/i.exec(sql);
  return own ? `${own[1]}${ctes.join(', ')}, ${sql.slice(own[1].length)}` : `WITH ${ctes.join(', ')} ${sql}`;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * PostgreSQL syntax as SQLite reads it, outside quoted strings. In every
 * query: casts and the pg_catalog and public schema names go, E'...' strings
 * become plain ones, ILIKE becomes LIKE (already case-insensitive),
 * trim(BOTH 'x' FROM s) becomes trim(s, 'x'). In catalog queries also:
 * information_schema views get their catalog names, regular expression
 * operators become REGEXP, arrays (always empty in the catalog) become
 * scalars and `= ANY (...)` becomes IN.
 */
export class UnsupportedPgCast extends Error {}

/** The type and the name of a result column that a PostgreSQL cast decides: the integer type of `x::int`, and the name `x` that PostgreSQL gives it. */
/** `column` marks a name taken from a column the query reads: the result names it as the file declares it, which only the server can look up. */
export interface PgCastColumn { oid?: number; name?: string; column?: boolean }

type Words = SqlToken[];
const isSymbol = (t: SqlToken | undefined, text: string) => t?.kind === 'symbol' && t.text === text;
const isNameToken = (t: SqlToken | undefined): t is SqlToken => t?.kind === 'word' || t?.kind === 'identifier';

/** The index of the parenthesis that closes the one at words[open], or -1. */
function matchingParen(words: Words, open: number): number {
  let depth = 0;
  for (let at = open; at < words.length; at++) {
    if (isSymbol(words[at], '(')) depth++;
    else if (isSymbol(words[at], ')') && --depth === 0) return at;
  }
  return -1;
}

/** Where the operand of a cast that starts at words[from] ends (a literal, a parameter, a possibly dotted name or call, a group), or -1. */
function operandEnd(words: Words, from: number): number {
  const x = words[from];
  if (!x) return -1;
  if (isSymbol(x, '(')) { const close = matchingParen(words, from); return close < 0 ? -1 : close + 1; }
  if (x.kind === 'string' || x.kind === 'parameter') return from + 1;
  // .5, and the prefixed strings x'ff' and b'01'.
  if (isSymbol(x, '.') && words[from + 1]?.kind === 'word' && /^\d/.test(words[from + 1].text)) return from + 2;
  if (x.kind === 'word' && /^[xbn]$/i.test(x.text) && words[from + 1]?.kind === 'string' && words[from + 1].start === x.end) return from + 2;
  if (!isNameToken(x)) return -1;
  let at = from + 1;
  while (isSymbol(words[at], '.') && isNameToken(words[at + 1])) at += 2;
  if (isSymbol(words[at], '(')) { const close = matchingParen(words, at); return close < 0 ? -1 : close + 1; }
  return at;
}

/** Whether the expression is `operand::int` (int4, integer), with integer arithmetic on it: PostgreSQL types it int4. */
function isIntegerCast(words: Words): boolean {
  let at = operandEnd(words, 0);
  if (at < 0 || !isSymbol(words[at], ':') || !isSymbol(words[at + 1], ':') || !/^(?:int|int4|integer)$/i.test(words[at + 2]?.text ?? '') || words[at + 2].kind !== 'word') return false;
  at += 3;
  while (at < words.length) {
    if (words[at].kind !== 'symbol' || !/^[+*-]$/.test(words[at].text) || words[at + 1]?.kind !== 'word' || !/^\d+$/.test(words[at + 1].text)) return false;
    at += 2;
  }
  return true;
}

/** The names PostgreSQL gives the types it reads under other spellings (`int` is `int4`); any other type is named as written. */
const TYPE_NAMES: Record<string, string> = {
  int: 'int4', integer: 'int4', smallint: 'int2', bigint: 'int8', real: 'float4', float: 'float8', decimal: 'numeric', dec: 'numeric', boolean: 'bool', char: 'bpchar', character: 'bpchar', nchar: 'bpchar',
};

/** One type after `::`: its name as PostgreSQL gives it, and where it ends (a length, a time zone suffix and array brackets belong to it), or undefined. */
function castType(words: Words, from: number): { name: string; end: number } | undefined {
  const first = words[from];
  if (!isNameToken(first)) return undefined;
  let at = from + 1;
  let last = first;
  let dotted = false;
  while (isSymbol(words[at], '.') && isNameToken(words[at + 1])) { last = words[at + 1]; at += 2; dotted = true; }
  const lower = (t: SqlToken | undefined) => (t?.kind === 'word' ? t.text.toLowerCase() : '');
  let name = last.kind === 'word' ? last.text.toLowerCase() : sqlName(last);
  const bare = !dotted && first.kind === 'word' ? name : '';
  if (bare === 'double' && lower(words[at]) === 'precision') { name = 'float8'; at++; }
  else if ((bare === 'character' || bare === 'char' || bare === 'bit') && lower(words[at]) === 'varying') { name = bare === 'bit' ? 'varbit' : 'varchar'; at++; }
  else if (bare in TYPE_NAMES) name = TYPE_NAMES[bare];
  // A length or precision: (10) or (10, 2).
  if (isSymbol(words[at], '(')) {
    if (words[at + 1]?.kind !== 'word' || !/^\d+$/.test(words[at + 1].text)) return undefined;
    // float(24) and below is a single precision number.
    if (bare === 'float' && Number(words[at + 1].text) <= 24) name = 'float4';
    let close = at + 2;
    if (isSymbol(words[close], ',') && words[close + 1]?.kind === 'word' && /^\d+$/.test(words[close + 1].text)) close += 2;
    if (!isSymbol(words[close], ')')) return undefined;
    at = close + 1;
  }
  if ((bare === 'time' || bare === 'timestamp') && /^with(?:out)?$/.test(lower(words[at])) && lower(words[at + 1]) === 'time' && lower(words[at + 2]) === 'zone') {
    if (lower(words[at]) === 'with') name = `${bare}tz`;
    at += 3;
  }
  // Array brackets, with or without a size.
  while (isSymbol(words[at], '[')) {
    const close = words[at + 1]?.kind === 'word' && /^\d+$/.test(words[at + 1].text) ? at + 2 : at + 1;
    if (!isSymbol(words[close], ']')) return undefined;
    at = close + 1;
  }
  return { name, end: at };
}

const NOT_AN_ALIAS = /^(?:AND|OR|NOT|IN|IS|ISNULL|NOTNULL|LIKE|ILIKE|BETWEEN|COLLATE|AT|NULL|TRUE|FALSE|SIMILAR|OVERLAPS|ESCAPE|ASC|DESC|NULLS|FETCH|FOR|OFFSET|LIMIT|WINDOW|ORDER|GROUP|HAVING|WHERE|UNION|EXCEPT|INTERSECT)$/i;

/** What a cast item is: its operand (for the name), the last type, and whether the single name after the type is an alias written without AS. Undefined for any other expression. */
function castShape(words: Words): { operand: Words; type: string; alias: boolean } | undefined {
  const end = operandEnd(words, 0);
  if (end < 0 || !isSymbol(words[end], ':') || !isSymbol(words[end + 1], ':')) return undefined;
  let at = end;
  let type = '';
  while (isSymbol(words[at], ':') && isSymbol(words[at + 1], ':')) {
    const t = castType(words, at + 2);
    if (!t) return undefined;
    type = t.name;
    at = t.end;
  }
  if (at === words.length) return { operand: words.slice(0, end), type, alias: false };
  // PostgreSQL reads a name after a complete type as the column's alias: b::int x. Anything longer (IS NULL, IN (...)) is another expression.
  if (at === words.length - 1 && isNameToken(words[at]) && !(words[at].kind === 'word' && NOT_AN_ALIAS.test(words[at].text))) return { operand: words.slice(0, end), type, alias: true };
  return undefined;
}

/** The tokens without the parentheses that wrap all of them: (b) is b. One pass finds the matching parentheses, then each pair is stripped in a step. */
function unwrapped(words: Words): Words {
  if (!isSymbol(words[0], '(') || !isSymbol(words[words.length - 1], ')')) return words;
  const match = new Int32Array(words.length).fill(-1);
  const open: number[] = [];
  for (let at = 0; at < words.length; at++) {
    if (isSymbol(words[at], '(')) open.push(at);
    else if (isSymbol(words[at], ')') && open.length > 0) match[open.pop()!] = at;
  }
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi && match[lo] === hi) { lo++; hi--; }
  return words.slice(lo, hi + 1);
}

/** Whether the operand is a constant, a parameter or an arithmetic or comparison expression: PostgreSQL gives these no name, so a cast of one is named after its type. */
function unnamedOperand(operand: Words): boolean {
  const words = unwrapped(operand);
  if (words.length === 1 && (words[0].kind === 'string' || words[0].kind === 'parameter' || (words[0].kind === 'word' && /^(?:TRUE|FALSE|NULL)$/i.test(words[0].text)))) return true;
  // 1, 1.5, .5, x'ff'
  if (words.length > 0 && words.every((t) => (t.kind === 'word' && /^\d/.test(t.text)) || isSymbol(t, '.') || (t.kind === 'word' && /^[xbn]$/i.test(t.text)) || t.kind === 'string')
    && (/^\d/.test(words[0].text) || isSymbol(words[0], '.') || words[1]?.kind === 'string')) return true;
  let depth = 0;
  for (const [i, t] of words.entries()) {
    if (isSymbol(t, '(')) depth++;
    else if (isSymbol(t, ')')) depth--;
    else if (i > 0 && depth === 0 && t.kind === 'symbol' && /^[-+*/%^|<>=!]/.test(t.text)) return true;
  }
  return false;
}

/** What names the operand of a cast: a column (as written; `column`) or a function; undefined for anything else. */
function operandName(operand: Words): { name: string; column?: boolean } | undefined {
  const words = unwrapped(operand);
  if (!isNameToken(words[0]) || (words[0].kind === 'word' && /^(?:\d|TRUE$|FALSE$|NULL$)/i.test(words[0].text))) return undefined;
  let at = 1;
  while (isSymbol(words[at], '.') && isNameToken(words[at + 1])) at += 2;
  if (at === words.length) return { name: sqlName(words[at - 1]), column: true };
  if (at === 1 && isSymbol(words[1], '(') && matchingParen(words, 1) === words.length - 1) return { name: words[0].kind === 'word' ? words[0].text.toLowerCase() : sqlName(words[0]) };
  return undefined;
}

/** The name PostgreSQL gives `operand::type[::type...]`: the column or function its operand names, else the last type. Undefined for any other expression. */
function castName(words: Words): { name: string; column?: boolean; operand: Words } | undefined {
  const shape = castShape(words);
  if (!shape || shape.alias) return undefined;
  const named = operandName(shape.operand);
  if (named) return { ...named, operand: unwrapped(shape.operand) };
  return unnamedOperand(shape.operand) ? { name: shape.type, operand: shape.operand } : undefined;
}

/** The items of a query's select list as tokens, and where the list starts and ends in the text (at FROM, or the end). Undefined for anything that is not a SELECT. */
function selectList(sql: string): { items: Words[]; start: number; end: number } | undefined {
  const tokens = sqlTokens(sql, true).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  if (tokens[0]?.kind !== 'word' || tokens[0].text.toUpperCase() !== 'SELECT') return undefined;
  const items: Words[] = [[]];
  let depth = 0;
  let end = sql.length;
  for (let at = 1; at < tokens.length; at++) {
    const t = tokens[at];
    if (t.kind === 'symbol' && (t.text === '(' || t.text === '[')) depth++;
    else if (t.kind === 'symbol' && (t.text === ')' || t.text === ']')) depth--;
    else if (depth === 0 && t.kind === 'symbol' && t.text === ',') { items.push([]); continue; }
    else if (depth === 0 && t.kind === 'word' && t.text.toUpperCase() === 'FROM') { end = t.start; break; }
    items[items.length - 1].push(t);
  }
  const first = items[0][0];
  if (first?.kind === 'word' && /^(?:DISTINCT|ALL)$/i.test(first.text)) items[0].shift();
  return { items, start: items[0][0]?.start ?? end, end };
}

/** What an item is once an alias is set aside: the expression, and whether a name follows it with or without AS. */
function itemParts(item: Words): { expr: Words; aliased: boolean } {
  const last = item[item.length - 1];
  const asAlias = item.length > 2 && item[item.length - 2].kind === 'word' && item[item.length - 2].text.toUpperCase() === 'AS' && isNameToken(last);
  // b::int x: an alias without AS, which names the column and is not part of the expression.
  const bare = !asAlias && castShape(item)?.alias === true;
  return { expr: asAlias ? item.slice(0, -2) : bare ? item.slice(0, -1) : item, aliased: asAlias || bare };
}

/**
 * What the PostgreSQL casts in a query's select list decide about its result columns, one entry per select item, or none when the items do not line up
 * with the columns (a star expands to the table's columns). Read from the tokens: a long run of spaces costs no more than any other text.
 */
export function pgCastColumns(sql: string): PgCastColumn[] {
  const list = selectList(sql);
  if (!list) return [];
  const out: PgCastColumn[] = [];
  for (const item of list.items) {
    const { expr, aliased } = itemParts(item);
    // A star expands to as many columns as the table has, so the items no longer line up with the result columns.
    if (expr.length > 0 && expr[expr.length - 1].text === '*' && expr[expr.length - 1].kind === 'symbol' && (expr.length === 1 || isSymbol(expr[expr.length - 2], '.'))) return [];
    const column: PgCastColumn = {};
    if (isIntegerCast(expr)) column.oid = 23;
    if (!aliased) { const named = castName(expr); if (named) { column.name = named.name; if (named.column) column.column = true; } }
    out.push(column);
  }
  return out;
}

/**
 * The query with each cast of a column in its select list replaced by the bare column, or undefined when there is none. The name SQLite gives the bare column
 * (the file's spelling, a subquery's own) is the name of the cast, the same as for the column itself, whatever the query's tables are.
 */
export function pgCastProbe(sql: string, casts: PgCastColumn[]): string | undefined {
  if (!casts.some((c) => c.column)) return undefined;
  const list = selectList(sql);
  if (!list || list.items.length !== casts.length || list.items.some((item) => item.length === 0)) return undefined;
  const text = (tokens: Words) => sql.slice(tokens[0].start, tokens[tokens.length - 1].end);
  const parts = list.items.map((item, i) => (casts[i].column ? text(castName(itemParts(item).expr)!.operand) : text(item)));
  return `${sql.slice(0, list.start)}${parts.join(', ')}${list.end < sql.length ? ' ' : ''}${sql.slice(list.end)}`;
}

/** PostgreSQL types a cast converts to SQLite's own. */
const CAST_CONVERT = new Map<string, string>([
  ['int', 'INTEGER'], ['int2', 'INTEGER'], ['int4', 'INTEGER'], ['int8', 'INTEGER'], ['integer', 'INTEGER'], ['smallint', 'INTEGER'], ['bigint', 'INTEGER'],
  ['numeric', 'NUMERIC'], ['decimal', 'NUMERIC'], ['float', 'REAL'], ['float4', 'REAL'], ['float8', 'REAL'], ['real', 'REAL'], ['double precision', 'REAL'],
  ['text', 'TEXT'], ['varchar', 'TEXT'], ['character varying', 'TEXT'],
]);

/** PostgreSQL types a cast names that SQLite has no counterpart for: the value is kept as it is, as before casts were converted. */
const CAST_KEEP = new Set(('date time timetz timestamp timestamptz interval bool boolean bytea uuid json jsonb xml oid name char character bpchar bit varbit money '
  + 'inet cidr macaddr macaddr8 citext hstore tsvector tsquery point int4range int8range numrange daterange tsrange tstzrange serial smallserial bigserial '
  + 'regclass regtype regnamespace regproc regprocedure regrole regoperator regoper regconfig regdictionary int2vector oidvector pg_node_tree aclitem '
  + 'pg_lsn txid_snapshot anyelement anyarray record void unknown cstring').split(' '));

/** Words that end an operand's left side: an operator or a clause word, not a value. */
const NOT_OPERAND = /^(?:AND|OR|NOT|IN|IS|LIKE|ILIKE|BETWEEN|SELECT|WHERE|WHEN|THEN|ELSE|FROM|ON|BY|HAVING|WITH|AS|CASE|DISTINCT|ALL|UNION|LIMIT|OFFSET)$/i;

const MAX_OPERAND_CHAIN = 100;

/** A token of the query, or a cast already rewritten (a group); `nesting` is how many casts are inside the group. */
interface CastItem { text: string; kind: SqlToken['kind'] | 'group'; nesting?: number }

/** Casts inside casts deeper than this are refused: each level copies the operand before it, and SQLite reads no expression more than a thousand deep. */
const MAX_CAST_NESTING = 500;

/** Where the operand that ends at items[end] begins, or -1: a literal, a name, a call, a bracketed group, an index, a CASE expression, or an earlier cast. */
function castOperandStart(items: CastItem[], end: number, chain = 0): number {
  // A chain of FILTER, OVER or index clauses this long is not an operand: left to the error below instead of the stack.
  if (chain > MAX_OPERAND_CHAIN) return -1;
  const sig = (from: number) => { let at = from; while (at >= 0 && (items[at].kind === 'space' || items[at].kind === 'comment')) at--; return at; };
  const isOpen = (x: CastItem, c: string) => x.kind === 'symbol' && x.text === c;
  const dotted = (at: number) => {
    let start = at;
    for (;;) {
      const dot = sig(start - 1);
      const name = dot >= 0 && isOpen(items[dot], '.') ? sig(dot - 1) : -1;
      if (name < 0 || (items[name].kind !== 'word' && items[name].kind !== 'identifier') || NOT_OPERAND.test(items[name].text)) return start;
      start = name;
    }
  };
  const it = items[end];
  if (it.kind === 'group' || it.kind === 'string' || it.kind === 'parameter') return end;
  if (it.kind === 'identifier') return dotted(end);
  if (it.kind === 'word') {
    if (/^END$/i.test(it.text)) {
      let depth = 0;
      for (let j = end; j >= 0; j--) {
        if (items[j].kind !== 'word') continue;
        if (/^END$/i.test(items[j].text)) depth++;
        else if (/^CASE$/i.test(items[j].text) && --depth === 0) return j;
      }
      return -1;
    }
    if (NOT_OPERAND.test(it.text)) return -1;
    // sum(a) OVER w: the call before OVER is the operand.
    const over = sig(end - 1);
    if (over >= 0 && items[over].kind === 'word' && /^OVER$/i.test(items[over].text)) { const prior = sig(over - 1); return prior >= 0 ? castOperandStart(items, prior, chain + 1) : -1; }
    return dotted(end);
  }
  if (it.kind === 'symbol' && (it.text === ')' || it.text === ']')) {
    let depth = 0;
    let open = end;
    for (; open >= 0; open--) {
      const x = items[open];
      if (x.kind !== 'symbol') continue;
      if (x.text === ')' || x.text === ']') depth++;
      else if ((x.text === '(' || x.text === '[') && --depth === 0) break;
    }
    if (open < 0) return -1;
    const before = sig(open - 1);
    if (before < 0) return open;
    const b = items[before];
    // count(*) FILTER (WHERE a), sum(a) OVER (...), percentile_cont(.5) WITHIN GROUP (...): the call before the clause is the operand.
    if (items[open].text === '(' && b.kind === 'word') {
      const clause = /^(?:FILTER|OVER)$/i.test(b.text) ? before : /^GROUP$/i.test(b.text) && /^WITHIN$/i.test(items[sig(before - 1)]?.text ?? '') ? sig(before - 1) : -1;
      if (clause >= 0) { const prior = sig(clause - 1); return prior >= 0 ? castOperandStart(items, prior, chain + 1) : -1; }
    }
    if (items[open].text === '[') {
      const inner = b.kind === 'word' ? !NOT_OPERAND.test(b.text) || /^ARRAY$/i.test(b.text) : b.kind === 'identifier' || b.kind === 'group' || (b.kind === 'symbol' && (b.text === ')' || b.text === ']'));
      return inner ? castOperandStart(items, before, chain + 1) : open;
    }
    return (b.kind === 'word' && !NOT_OPERAND.test(b.text)) || b.kind === 'identifier' ? dotted(before) : open;
  }
  return -1;
}

/** `value::type` in a query of the file's own tables: types with a SQLite counterpart convert, other known types keep the value as it is, and a name PostgreSQL does not have is refused. */
function rewritePgCasts(sql: string, catalog: boolean, kept: Map<string, string>): string {
  if (!sql.includes('::')) return sql;
  const tokens = sqlTokens(sql, true);
  const items: CastItem[] = [];
  const significant = (at: number) => { while (at < tokens.length && (tokens[at].kind === 'space' || tokens[at].kind === 'comment')) at++; return at; };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.kind === 'symbol' && t.text === ':' && tokens[i + 1]?.text === ':' && tokens[i + 1].start === t.end)) { items.push({ text: t.text, kind: t.kind }); continue; }
    let at = significant(i + 2);
    const name = tokens[at];
    if (!name || (name.kind !== 'word' && name.kind !== 'identifier')) throw new UnsupportedPgCast('This PostgreSQL cast expression is not supported');
    // Quoted names were replaced by opaque keys; the type's own name is read from the original.
    const nameOf = (token: SqlToken) => sqlName({ ...token, text: kept.get(token.text) ?? token.text }).toLowerCase();
    const writtenOf = (token: SqlToken) => kept.get(token.text) ?? token.text;
    let type = nameOf(name);
    let written = writtenOf(name);
    at++;
    if (tokens[at]?.text === '.' && (tokens[at + 1]?.kind === 'word' || tokens[at + 1]?.kind === 'identifier')) {
      type = nameOf(tokens[at + 1]);
      written = `${written}.${writtenOf(tokens[at + 1])}`;
      at += 2;
    }
    const wordAt = (k: number, re: RegExp) => { const n = significant(k); return tokens[n]?.kind === 'word' && re.test(tokens[n].text) ? n : -1; };
    const follow = (re: RegExp) => { const n = wordAt(at, re); if (n >= 0) at = n + 1; return n >= 0; };
    // Two-word names.
    if (type === 'double') { if (follow(/^precision$/i)) type = 'double precision'; }
    else if (type === 'character' || type === 'bit') { if (follow(/^varying$/i)) type = type === 'bit' ? 'varbit' : 'character varying'; }
    // A length or precision: (10) or (10, 2).
    const lengthAt = significant(at);
    if (tokens[lengthAt]?.text === '(') {
      let k = significant(lengthAt + 1);
      if (tokens[k]?.kind === 'word' && /^\d+$/.test(tokens[k].text)) {
        k = significant(k + 1);
        if (tokens[k]?.text === ',' && tokens[significant(k + 1)]?.kind === 'word' && /^\d+$/.test(tokens[significant(k + 1)].text)) k = significant(significant(k + 1) + 1);
        if (tokens[k]?.text === ')') at = k + 1;
      }
    }
    // The time zone suffix of the date and time types, which follows the precision: timestamp(3) without time zone.
    if ((type === 'timestamp' || type === 'time') && follow(/^with(?:out)?$/i) && !(follow(/^time$/i) && follow(/^zone$/i))) throw new UnsupportedPgCast(`The PostgreSQL cast to ${written} is not supported`);
    let end = at;
    let array = false;
    for (;;) {
      const bracket = significant(end);
      const t2 = tokens[bracket];
      // A bracket pair with a space in it is read as a quoted name, and cleaned to a name made of spaces.
      if (t2 && t2.kind === 'identifier' && /^(?:\[\s*\]|"\s*")$/.test(kept.get(t2.text) ?? t2.text)) { array = true; end = bracket + 1; continue; }
      if (t2?.text === '[' && tokens[significant(bracket + 1)]?.text === ']') { array = true; end = significant(bracket + 1) + 1; continue; }
      break;
    }
    i = end - 1;
    let last = items.length - 1;
    while (last >= 0 && (items[last].kind === 'space' || items[last].kind === 'comment')) last--;
    const start = last < 0 ? -1 : castOperandStart(items, last);
    if (start < 0) throw new UnsupportedPgCast('This PostgreSQL cast expression is not supported');
    const operand = items.slice(start, last + 1);
    let nesting = 1;
    for (const x of operand) if ((x.nesting ?? 0) >= nesting) nesting = x.nesting! + 1;
    if (nesting > MAX_CAST_NESTING) throw new UnsupportedPgCast('PostgreSQL casts are nested too deeply');
    const value = operand.map((x) => x.text).join('');
    items.length = start;
    // Catalog queries came from tools that expect PostgreSQL's own types, which the catalog's values already have: casts there are dropped, as they always were.
    const converted = array || catalog ? undefined : CAST_CONVERT.get(type);
    if (!catalog && !converted && !CAST_KEEP.has(type) && !CAST_CONVERT.has(type)) throw new UnsupportedPgCast(`The PostgreSQL cast to ${written} is not supported`);
    items.push({ text: converted ? `CAST(${value} AS ${converted})` : value, kind: 'group', nesting });
  }
  return items.map((x) => x.text).join('');
}

export function pgSyntax(sql: string): string {
  sql = cleanSql(sql, true);
  // Opaque tokens keep regex compatibility rewrites away from user values and
  // quoted identifiers, including rewrites that span a string argument.
  const used = new Set([...sql.matchAll(/__sql_opaque_(\d+)_/g)].map((m) => m[1]));
  let serial = 0;
  while (used.has(String(serial))) serial++;
  const prefix = `__sql_opaque_${serial}_`;
  const kept = new Map<string, string>();
  const tokens = sqlTokens(sql, true);
  const catalog = tokens.some((t) => (t.kind === 'word' || t.kind === 'identifier') && /^(?:pg_\w+|information_schema)$/i.test(sqlName(t)));
  const significant = tokens.filter((t) => t.kind !== 'space');
  const positions = new Map(significant.map((t, i) => [t.start, i]));
  sql = tokens.map((t) => {
    if (t.kind !== 'string' && t.kind !== 'identifier') return t.text;
    const at = positions.get(t.start)!;
    const next = significant[at + 1];
    const prior = significant[at - 1];
    const schema = significant[at - 2];
    if (t.kind === 'identifier' && ((prior?.text === '.' && schema && sqlName(schema).toLowerCase() === 'information_schema' && /^\w+$/.test(sqlName(t)))
      || (next?.text === '.' && /^(?:pg_catalog|public|information_schema)$/i.test(sqlName(t)))
      || (prior?.text.toUpperCase() === 'COLLATE' && /^(?:default|C|POSIX)$/.test(sqlName(t))))) return t.text;
    const quote = t.kind === 'string' ? "'" : '"';
    const key = quote + prefix + kept.size + quote;
    kept.set(key, t.text);
    return key;
  }).join('');
  sql = rewritePgCasts(sql, catalog, kept);
  const parts = sql.split(/('(?:[^']|'')*')/);
  for (let i = 0; i < parts.length; i += 2) {
    let p = parts[i]
      .replace(/("pg_catalog"|\bpg_catalog)\s*\.\s*/gi, '')
      .replace(/(?:"public"|\bpublic)\s*\.\s*(?=["\w])/gi, '')
      .replace(/\bILIKE\b/gi, 'LIKE');
    if (catalog) {
      p = p
        // The schema search path is public.
        .replace(/\(\s*current_schemas\(\s*\w*\s*\)\s*\)\s*\[[^\]]*\]/gi, `'public'`)
        .replace(/\bcurrent_schemas\(\s*\w*\s*\)/gi, `'{public}'`)
        // Index keys (JDBC's primary keys) come from arrays and records; there are no indexes.
        .replace(/\(\s*(?:information_schema\s*\.\s*)?_pg_expandarray\s*\([^()]*\)\s*\)\s*\.\s*\w+/gi, 'NULL')
        .replace(/(?:information_schema\s*\.\s*)?_pg_expandarray\s*\([^()]*\)/gi, 'NULL')
        .replace(/\(\s*\w+\s*\.\s*\w+\s*\)\s*\.\s*\w+/g, 'NULL')
        .replace(/(?:"information_schema"|\binformation_schema)\s*\.\s*"?(\w+)"?/gi, (_, v: string) => `information_schema__${v.toLowerCase()}`)
        .replace(/\bCOLLATE\s+(?:"default"|default|"C"|"POSIX")/gi, '')
        // PostgreSQL lets any word follow AS as a column name (Metabase's `AS table`, `AS update`); SQLite wants those quoted.
        .replace(/"(?:[^"]|"")*"|\bAS\s+(table|update|select|insert|delete|order|group|default|column|check|primary|unique|references|limit|offset|user|values|index)\b(?!\s*\()/gi, (m, word?: string) => (word ? `AS "${word}"` : m))
        .replace(/\bOPERATOR\s*\(\s*(!?~\*?)\s*\)/gi, ' $1 ')
        .replace(/(^|[\w)"\]])(\s*)(!?)~\*?/g, (_, before: string, space: string, not: string) => `${before}${space} ${not ? 'NOT ' : ''}REGEXP `)
        .replace(/\bARRAY\s*\(\s*(?=SELECT\b)/gi, '(')
        .replace(/(?<!\bARRAY)([\w)])\[[^[\]]*\]/gi, '$1');
      p = unnest(p);
    }
    p = p.replace(/\bcurrent_schemas\(\s*\w*\s*\)/gi, `'{public}'`);
    parts[i] = p;
  }
  // These span string literals.
  let out = parts.join('').replace(/\btrim\s*\(\s*(BOTH|LEADING|TRAILING)?\s*('(?:[^']|'')*')\s+FROM\s+([^()]*(?:\([^()]*\)[^()]*)*)\)/gi,
    (_, side: string | undefined, chars: string, value: string) => `${{ LEADING: 'ltrim', TRAILING: 'rtrim' }[side?.toUpperCase() ?? ''] ?? 'trim'}(${value}, ${chars})`);
  out = arrayAgg(out);
  if (catalog) {
    out = orderByOutputNames(out)
      .replace(/=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]\s*\)/gi, 'IN ($1)')
      .replace(/=\s*ANY\s*\(/gi, 'IN (')
      .replace(GENERATE_SERIES,
        (_, from: string, to: string, alias: string, col: string) => `(WITH RECURSIVE s(${col}) AS (SELECT ${from} UNION ALL SELECT ${col} + 1 FROM s WHERE ${col} < ${to}) SELECT ${col} FROM s) AS ${alias}`);
  }
  return sqlTokens(out, true).map((t) => kept.get(t.text) ?? t.text).join('');
}

/**
 * `generate_series(from, to) AS alias(col)`. An argument is units (a character that is not a bracket, comma or blank, or a
 * bracketed group) with blanks only between units, so a run of blanks can be read one way and the pattern is linear; a lazy
 * argument followed by `\s*,` read a long run of blanks once per position.
 */
const SERIES_ARG = String.raw`(?:[^(),\s]|\([^()]*\))(?:\s*(?:[^(),\s]|\([^()]*\)))*`;
export const GENERATE_SERIES = new RegExp(String.raw`\bgenerate_series\s*\(\s*(${SERIES_ARG})\s*,\s*(${SERIES_ARG})\s*\)\s+(?:AS\s+)?(\w+)\s*\(\s*(\w+)\s*\)`, 'gi');

/** The text with quoted strings, quoted names and comments blanked out (same length), so brackets and keywords can be found by position. */
function masked(sql: string): string {
  return maskSql(sql, true);
}

/** Where each top-level (not inside brackets) match of a pattern starts, in masked text. */
function topLevel(text: string, re: RegExp): { index: number; end: number }[] {
  const depth: number[] = [];
  let d = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ')') d--;
    depth.push(d);
    if (text[i] === '(') d++;
  }
  return [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))]
    .filter((m) => depth[m.index] === 0).map((m) => ({ index: m.index, end: m.index + m[0].length }));
}

/** Splits at the commas outside brackets. */
function commaSplit(text: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let d = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    if (text[i] === '(') d++;
    else if (text[i] === ')') d--;
    else if (text[i] === ',' && d === 0) { out.push([start, i]); start = i + 1; }
  }
  out.push([start, to]);
  return out;
}

/**
 * PostgreSQL reads a bare name in ORDER BY as an output column first (`SELECT typ.oid, enumlabel ... ORDER BY oid`), where
 * SQLite reads it as a table column and finds several. A bare name that is the name of one plain `table.column` in the
 * select list becomes that column.
 */
function orderByOutputNames(sql: string): string {
  const m = masked(sql);
  if (topLevel(m, /\b(?:UNION|INTERSECT|EXCEPT)\b/i).length) return sql;
  const select = topLevel(m, /\bSELECT\b/i)[0];
  const from = select && topLevel(m, /\bFROM\b/i).find((f) => f.index > select.index);
  const order = topLevel(m, /\bORDER\s+BY\b/i).at(-1);
  if (!select || !from || !order || order.index < from.index) return sql;
  const names = new Map<string, string | null>();
  for (const [a, b] of commaSplit(m, select.end, from.index)) {
    const item = /^\s*(?:DISTINCT\s+)?(\w+)\.(\w+)\s*$/i.exec(sql.slice(a, b));
    const name = (item ? item[2] : /^\s*(\w+)\s*$/.exec(sql.slice(a, b))?.[1] ?? /\bAS\s+"?(\w+)"?\s*$/i.exec(sql.slice(a, b))?.[1])?.toLowerCase();
    if (!name) continue;
    names.set(name, names.has(name) || !item ? null : `${item[1]}.${item[2]}`);
  }
  const end = topLevel(m, /\b(?:LIMIT|OFFSET|FETCH|FOR)\b/i).find((x) => x.index > order.index)?.index ?? m.length;
  let out = sql.slice(0, order.end);
  let last = order.end;
  for (const [a, b] of commaSplit(m, order.end, end)) {
    const term = /^(\s*)(\w+)((?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?)(\s*)$/i.exec(sql.slice(a, b));
    const column = term && names.get(term[2].toLowerCase());
    if (column) { out += sql.slice(last, a) + term[1] + column + term[3] + term[4]; last = b; }
  }
  return out + sql.slice(last);
}

/**
 * array_agg(x [ORDER BY y]) as PostgreSQL's array text, {a,b}, built by SQLite's group_concat from elements quoted the way
 * arrays quote them. No rows give NULL, as in PostgreSQL. array_agg(DISTINCT x) stays as it is and fails as an unknown function.
 */
function arrayAgg(sql: string): string {
  if (!/\barray_agg\s*\(/i.test(sql)) return sql;
  const text = masked(sql);
  // Where each bracket closes, found once.
  const close = new Int32Array(text.length).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') open.push(i);
    else if (text[i] === ')' && open.length) close[open.pop()!] = i;
  }
  const rewrite = (from: number, to: number, depth: number): string => {
    if (depth > 20) throw new Error('array_agg is nested too deeply');
    const re = /\barray_agg\s*\(/gi;
    re.lastIndex = from;
    const out: string[] = [];
    let last = from;
    for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
      const start = m.index + m[0].length;
      const end = close[start - 1];
      if (end < 0 || end >= to) break;
      re.lastIndex = end + 1;
      out.push(sql.slice(last, m.index));
      last = end + 1;
      const inner = text.slice(start, end);
      // DISTINCT stays as it is, and fails as an unknown function; what is inside it is still rewritten.
      if (/^\s*(?:DISTINCT|ALL)\b/i.test(inner)) { out.push(sql.slice(m.index, start), rewrite(start, end, depth + 1), ')'); continue; }
      const order = topLevel(inner, /\bORDER\s+BY\b/i)[0];
      const value = rewrite(start, order ? start + order.index : end, depth + 1);
      const by = order ? ` ${rewrite(start + order.index, end, depth + 1)}` : '';
      out.push(`('{' || group_concat(tabularius_array_item(${value}), ','${by}) || '}')`);
    }
    out.push(sql.slice(last, to));
    return out.join('');
  };
  return rewrite(0, sql.length, 0);
}

/** `FROM unnest(array) x`, `unnest(array) AS t(x)` and `unnest(array) WITH ORDINALITY AS t(x, n)` as a table of the array's values. */
function unnest(sql: string): string {
  const re = /\bunnest\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let depth = 1;
    let end = re.lastIndex;
    for (; end < sql.length && depth; end++) depth += sql[end] === '(' ? 1 : sql[end] === ')' ? -1 : 0;
    const arg = sql.slice(re.lastIndex, end - 1);
    const alias = /^\s+(?:(WITH\s+ORDINALITY)\s+)?(?:AS\s+)?(?!(?:WHERE|JOIN|ON|ORDER|GROUP|LIMIT|UNION|LEFT|INNER|CROSS|RIGHT|FULL|NATURAL)\b)(\w+)(?:\s*\(\s*(\w+(?:\s*,\s*\w+)*)\s*\))?/i.exec(sql.slice(end));
    if (!alias) continue;
    const names = alias[3]?.split(/\s*,\s*/);
    const value = names?.[0] ?? alias[2];
    const ordinal = alias[1] ? `, key + 1 AS ${names?.[1] ?? 'ordinality'}` : '';
    const table = `(SELECT value AS ${value}${ordinal} FROM json_each(${arg})) AS ${alias[2]}`;
    sql = sql.slice(0, m.index) + table + sql.slice(end + alias[0].length);
    re.lastIndex = m.index + table.length;
  }
  return sql;
}

const defined = new WeakSet<Store>();

/** One element of an array's text: quoted when it is empty, says NULL, or holds a comma, brace, quote, backslash or space. */
function arrayItem(v: SQLOutputValue | string): string {
  if (v === null || v === undefined) return 'NULL';
  const text = String(v);
  return text === '' || /^null$/i.test(text) || /[{},"\\\s]/.test(text) ? `"${text.replace(/["\\]/g, '\\$&')}"` : text;
}

/** Parse PostgreSQL's one-dimensional array text, respecting quoted and escaped delimiters. */
function arrayElements(value: string): (string | null)[] {
  const body = value.replace(/^\{|\}$/g, '');
  if (!body) return [];
  const elements: (string | null)[] = [];
  let element = '';
  let quoted = false;
  let wasQuoted = false;
  let escaped = false;
  const push = () => { elements.push(!wasQuoted && /^null$/i.test(element) ? null : element); element = ''; wasQuoted = false; };
  for (const char of body) {
    if (escaped) {
      element += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
      wasQuoted = true;
    } else if (char === ',' && !quoted) {
      push();
    } else {
      element += char;
    }
  }
  if (escaped) element += '\\';
  push();
  return elements;
}

/**
 * Whether a pattern can backtrack without end on some input, so one query could stall the server: a repeated group
 * that itself repeats or chooses ((a+)+, (a|aa)*), or a back-reference. Catalog lookups (psql's \\d name, a BI tool's
 * table filter) never need either.
 */
export function riskyPattern(pattern: string): boolean {
  if (/\\[1-9]|\\k</.test(pattern)) return true;
  // Escapes and character classes can't repeat on their own; drop them first.
  const bare = pattern.replace(/\\./g, 'x').replace(/\[(?:\\.|[^\]])*\]/g, 'x');
  const open: { inner: boolean }[] = [];
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (c === '(') open.push({ inner: false });
    else if (c === ')') {
      const g = open.pop();
      if (!g) continue;
      const repeated = /[*+{]/.test(bare[i + 1] ?? '');
      if (repeated && g.inner) return true;
      // A group that repeats or chooses makes any group around it risky to repeat.
      if (open.length && (g.inner || repeated)) open[open.length - 1].inner = true;
    } else if (open.length && (c === '*' || c === '+' || c === '{' || c === '|')) open[open.length - 1].inner = true;
  }
  return false;
}

/** The functions catalog queries call, defined for the file's read-only queries. */
export function catalogFunctions(store: Store, data: () => CatalogData): void {
  const define = (name: string, fn: (...a: SQLOutputValue[]) => SQLInputValue) => store.defineQueryFunction(name, fn);
  // The owner is whoever is signed in, so this one is per query.
  define('pg_get_userbyid', () => data().user);
  // The signed-in account is the only role there is.
  define('pg_has_role', (...a) => (String(a.at(-2) ?? '').toLowerCase() === data().user.toLowerCase() ? 1 : 0));
  if (defined.has(store)) return;
  defined.add(store);
  const regex = new Map<string, RegExp>();
  const slow = new Set<string>();
  let spent = 0;
  let lastCall = 0;
  define('regexp', (pattern, value) => {
    if (pattern === null || value === null) return null;
    const p = String(pattern);
    let re = regex.get(p);
    if (!re) {
      if (riskyPattern(p)) throw new Error(`the pattern ${JSON.stringify(p.slice(0, 80))} repeats a repeated group or uses a back-reference, which could take forever; simplify it`);
      // Case-insensitive, as FileMaker names are (psql looks up \d congress in lower case).
      assertPatternNesting(p);
      re = new RegExp(p, 'iu');
      if (regex.size > 100) regex.clear();
      regex.set(p, re);
    }
    // The time all the rows of one statement spend here is limited too, not just each row: a pause between calls starts a new count.
    const began = performance.now();
    if (began - lastCall > 1000) spent = 0;
    if (spent > 2000) throw new Error(`the pattern ${JSON.stringify(p.slice(0, 80))} has taken more than 2 seconds over the rows so far and was stopped; simplify it`);
    if (slow.has(p)) throw new Error(`the pattern ${JSON.stringify(p.slice(0, 80))} ran too long on an earlier row and was stopped; simplify it`);
    try {
      // Under a time limit as well: riskyPattern catches the usual shapes, not every pattern that backtracks without end.
      return guardedTest(re, String(value)) ? 1 : 0;
    } catch (e) {
      if (!(e instanceof RegexTimeout)) throw e;
      // Remembered, so a query over many rows stops at the first one instead of waiting out every row.
      if (slow.size > 100) slow.clear();
      slow.add(p);
      throw new Error(`the pattern ${JSON.stringify(p.slice(0, 80))} ran too long and was stopped; simplify it`);
    } finally {
      lastCall = performance.now();
      spent += lastCall - began;
    }
  });
  for (const yes of ['pg_table_is_visible', 'pg_type_is_visible', 'pg_function_is_visible', 'pg_collation_is_visible', 'pg_conversion_is_visible', 'pg_opclass_is_visible', 'pg_operator_is_visible', 'pg_opfamily_is_visible', 'pg_ts_config_is_visible', 'pg_ts_dict_is_visible', 'pg_ts_parser_is_visible', 'pg_ts_template_is_visible', 'pg_statistics_obj_is_visible']) {
    define(yes, () => 1);
  }
  // The connection reads and never writes: the privileges that read are held, the ones that change data or the design are not.
  const held = (allowed: string[]) => (...a: SQLOutputValue[]) => {
    const text = String(a.at(-1) ?? '').toLowerCase();
    // The account holds no grant option on anything; PostgreSQL answers yes when any privilege listed is held.
    if (text.includes('grant option')) return 0;
    return text.split(',').some((x) => allowed.includes(x.trim())) ? 1 : 0;
  };
  for (const name of ['has_table_privilege', 'has_column_privilege', 'has_any_column_privilege']) define(name, held(['select', 'references']));
  define('has_schema_privilege', held(['usage']));
  define('has_database_privilege', held(['connect']));
  for (const name of ['has_sequence_privilege', 'has_function_privilege', 'has_language_privilege', 'has_type_privilege', 'has_tablespace_privilege', 'has_foreign_data_wrapper_privilege', 'has_server_privilege']) define(name, held(['usage', 'select', 'execute']));
  for (const nothing of ['obj_description', 'col_description', 'shobj_description', 'pg_get_expr', 'pg_get_indexdef', 'pg_get_constraintdef', 'pg_get_viewdef', 'pg_get_triggerdef', 'pg_get_partkeydef', 'pg_get_statisticsobjdef_columns', 'pg_get_function_arguments', 'pg_get_function_result', 'pg_get_functiondef', 'pg_get_function_identity_arguments', 'pg_get_serial_sequence', 'pg_get_ruledef', 'pg_tablespace_location', 'pg_describe_object']) {
    define(nothing, () => null);
  }
  for (const zero of ['pg_database_size', 'pg_indexes_size', 'pg_stat_get_numscans', 'pg_stat_get_tuples_returned', 'pg_stat_get_tuples_fetched', 'pg_stat_get_live_tuples', 'pg_stat_get_dead_tuples']) define(zero, () => 0);
  define('pg_encoding_to_char', () => 'UTF8');
  define('getdatabaseencoding', () => 'UTF8');
  define('pg_char_to_encoding', () => 6);
  define('pg_is_in_recovery', () => 0);
  define('pg_relation_is_publishable', () => 0);
  define('pg_relation_size', () => 0);
  define('pg_total_relation_size', () => 0);
  define('pg_table_size', () => 0);
  define('pg_size_pretty', (n) => `${Number(n ?? 0)} bytes`);
  define('format_type', (oid) => (oid === null ? null : FORMATTED[Number(oid)] ?? TYPES.find((t) => t[0] === Number(oid))?.[1] ?? '???'));
  define('current_setting', (name) => SETTINGS[String(name).toLowerCase()] ?? null);
  define('quote_ident', (s) => (s === null ? null : /^[a-z_][a-z0-9_]*$/.test(String(s)) ? String(s) : `"${String(s).replace(/"/g, '""')}"`));
  define('array_upper', (a, dimension) => (a === null || Number(dimension) !== 1 ? null : arrayElements(String(a)).length || null));
  define('array_length', (a, dimension) => {
    if (a === null || Number(dimension) !== 1) return null;
    return arrayElements(String(a)).length || null;
  });
  define('array_remove', (a, element) => {
    if (a === null) return null;
    const kept = arrayElements(String(a)).filter((x) => (x === null ? element !== null : element === null || x !== String(element)));
    return `{${kept.map(arrayItem).join(',')}}`;
  });
  define('tabularius_array_item', (v) => arrayItem(v));
  define('array_to_string', (a, sep) => (a === null ? null : arrayElements(String(a)).filter((x) => x !== null).join(String(sep ?? ''))));
}
