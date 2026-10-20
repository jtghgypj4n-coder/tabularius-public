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

import { cleanSql, maskSql, sqlName, sqlTokens } from '../../store/src/sql-tokens.ts';
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
  const parts = sql.split(/('(?:[^']|'')*')/);
  for (let i = 0; i < parts.length; i += 2) {
    let p = parts[i]
      .replace(/("pg_catalog"|\bpg_catalog)\s*\.\s*/gi, '')
      .replace(/(?:"public"|\bpublic)\s*\.\s*(?=["\w])/gi, '')
      .replace(/::\s*("[^"]+"|\w+(?:\s+varying|\s+precision|\s+with(?:out)?\s+time\s+zone)?)(\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(\s*\[\s*\])?/gi, '')
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
      .replace(/\bgenerate_series\s*\(\s*((?:[^(),]|\([^()]*\))+?)\s*,\s*((?:[^(),]|\([^()]*\))+?)\s*\)\s+(?:AS\s+)?(\w+)\s*\(\s*(\w+)\s*\)/gi,
        (_, from: string, to: string, alias: string, col: string) => `(WITH RECURSIVE s(${col}) AS (SELECT ${from} UNION ALL SELECT ${col} + 1 FROM s WHERE ${col} < ${to}) SELECT ${col} FROM s) AS ${alias}`);
  }
  return sqlTokens(out, true).map((t) => kept.get(t.text) ?? t.text).join('');
}

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
