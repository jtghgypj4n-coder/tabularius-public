// What each MCP tool input means and what the tool is called in a client's tool list. A tool's own registration
// wins; these fill in what it leaves out, so an AI client reads a sentence beside every input, not just its name.

/** A tool input, by `tool.input` (one tool) or `input` (the same meaning everywhere). */
export const INPUT_HINTS: Record<string, string> = {
  // The same everywhere.
  recordId: 'The record id, as find_records and get_record show it',
  limit: 'Most results to return',
  id: 'The batch id from the earlier result; leave out to list the recent batches',
  formula: 'A FileMaker calculation, e.g. Sum ( Line Items::Amount ) * 1.1',
  layout: 'Layout name or id',
  script: 'Script name',
  preview: 'true shows what would change and saves nothing',

  // Records.
  'find_records.query': 'FileMaker find requests, one object per request, field name to criterion (e.g. [{"Status": "Open"}, {"Status": "Pending"}]); each is ORed; "omit": true on a request leaves its matches out. Leave out for all records',
  'find_records.sort': 'Sort order, most significant first',
  'update_record.modId': 'The record\'s modId as last read; the change fails if someone has changed the record since',
  'upload_container.field': 'The container field\'s name',
  'upload_container.repetition': 'Which repetition of the field, from 1',
  'upload_container.filename': 'The file\'s name, with its extension',
  'upload_container.mime': 'The file\'s media type, e.g. application/pdf',
  'get_container.container': 'The container field\'s value from a record (a download URL), or its container id',
  'delete_record.recordId': 'The record to delete',
  'sql_query.sql': 'One SELECT statement in the SQLite dialect; quote table and field names with double quotes',
  'sql_query.limit': 'Most rows to return',
  'search_records.limit': 'Most records to return',
  'summarize_records.groupBy': 'Up to 3 fields to break the totals down by (omit for one overall total)',
  'summarize_records.measures': 'What to work out for each group: a field and count, sum, average, min, max or distinct (count of different values)',
  'import_records.headerRow': 'Whether the first row holds column names rather than data',
  'import_records.keys': 'Fields that identify a record (an email, an id), to spot rows that repeat one',
  'import_records.skipDuplicates': 'Leave out rows that repeat a record already there or an earlier row',
  'import_records.skipIssues': 'Leave out rows with a value that could not be fixed',

  // Scripts.
  'get_script.script': 'The script\'s name',
  'get_script.detail': 'true adds each step\'s decoded options',
  'run_script.script': 'The script\'s name',
  'run_script.trace': 'true lists every step that ran, with its error code',
  'debug_script.script': 'The script\'s name',
  'debug_script.parameter': 'Get ( ScriptParameter )',
  'debug_script.breakpoints': 'Steps to stop at, each a step number from 1 (and the script, if not the one run)',
  'debug_script.pauseOnError': 'true also stops at each step that sets an error',
  'debug_script.maxStops': 'The run is halted after this many stops',
  'explain_script_failure.script': 'The script\'s name',
  'check_solution.account': 'Also check what this account can reach: buttons for scripts it may not run, the layout the file opens on',
  'lint_script.script': 'The script\'s name or id; leave out to check every script',

  // Understanding a solution.
  'explain_solution.item': 'A table, layout, script, field, custom function or value list name, for that one in detail (leave out for the whole map)',
  'document_solution.section': 'Only this part of the documentation',
  'where_used.name': 'The thing to look for: "Table::Field", a script, layout, table, table occurrence, custom function or value list',
  'where_used.limit': 'Most places to list',
  'search_solution.text': 'The words to look for; all must appear',
  'search_solution.limit': 'Most matches to return',
  'check_calculation.formula': 'The formula to check, as typed in Specify Calculation',
  'check_formula.formula': 'The formula to check, as typed in Specify Calculation',
  'lint_formulas.table': 'Only this table\'s fields',
  'check_change_impact.kind': 'What is being renamed or deleted',
  'design_history.limit': 'Most changes to return',
  'audit_log.recordId': 'Only changes to this record',
  'audit_log.account': 'Only changes made by this account',
  'audit_log.limit': 'Most entries to return',
  'explain_record_history.recordId': 'The record to explain',

  // Data cleanup.
  'fix_data_problems.fixes': 'Values to change: {field, from, to} gives every record with that value the new one',
  'fix_data_problems.merges': 'Duplicates to merge: {keep, remove: [record ids], fill?} keeps one record and moves the others\' related records to it',
  'undo_import.id': 'The import\'s id from import_records; leave out to list recent imports',
  'undo_data_fix.id': 'The batch id from fix_data_problems; leave out to list the batches',
  'refresh_stale_calcs.fields': 'The stored calculations to bring up to date, each {table, field, recordIds?} (all records when recordIds is left out)',
  'undo_stale_refresh.id': 'The refresh\'s id from refresh_stale_calcs; leave out to list the refreshes',

  // Dashboards and automations.
  'save_dashboard.name': 'The dashboard\'s name',
  'save_dashboard.description': 'What the dashboard shows, for people reading the list',
  'save_dashboard.widgets': 'The charts, tables and numbers, up to 24',
  'save_dashboard.preview': 'true works the numbers out and saves nothing',
  'save_dashboard.replace': 'true to save over a dashboard with the same name',
  'try_automation.name': 'The automation\'s name',
  'try_automation.description': 'What it does, in a sentence',
  'try_automation.enabled': 'Whether it runs once saved (default true)',
  'try_automation.test': 'The change that sets it off, field name to new value (e.g. {"Status": "Paid"}), made on a throwaway copy',
  'save_automation.name': 'The automation\'s name',
  'save_automation.description': 'What it does, in a sentence',
  'save_automation.enabled': 'Whether it runs now (default true)',
  'save_automation.replace': 'true to save over an automation with the same name',
  'delete_automation.automation': 'The automation\'s name or id',

  // Design.
  'get_theme.theme': 'The theme\'s name or id',
  'get_layout_design.layout': 'The layout\'s name or id',
  'lint_layout.layout': 'The layout\'s name or id',
  'fix_layout.layout': 'The layout\'s name or id',
  'speed_up_layout.layout': 'The layout\'s name or id',
  'edit_layout_objects.layout': 'The layout\'s name or id',
  'restyle_layout.layout': 'The layout to restyle, by name or id',
  'restyle_layout.preview': 'true (the default) shows what would change and saves nothing',
  'restyle_file.consistent': 'true also drops local formatting so every object takes the theme\'s style',
  'restyle_file.layouts': 'Only these layout ids (default every layout)',
  'restyle_file.preview': 'true (the default) shows what would change on each layout and saves nothing',
  'modernize_interfaces.tables': 'Only these tables (default every table)',
  'modernize_interfaces.styles': 'Only these kinds of layout (default all of them)',
  'modernize_interfaces.folder': 'false puts the new layouts at the top level instead of in a "Modernized interfaces" folder',
  'modernize_interfaces.fromLayouts': 'true builds a modern copy of each existing layout, following the fields that layout shows, instead of a generic one per table',
  'modernize_interfaces.preview': 'true (the default) lists the layouts and saves nothing',
  'draft_layout.name': 'The new layout\'s name',
  'draft_layout.occurrence': 'The table occurrence the layout shows, by name or id',
  'draft_layout.view': 'list (rows) or form (one record)',
  'draft_layout.fields': 'Fields to show, in order',
  'draft_layout.totals': 'Number fields to total in a grand summary, or existing summary fields',
  'draft_layout.omit': 'true makes the find leave out the matches instead of finding them',
  'draft_layout.sort': 'Fields to sort by',
  'draft_layout.preview': 'true (the default) returns the draft and saves nothing',
  'copy_for_filemaker.tables': 'Table ids (from get_design)',
  'copy_for_filemaker.fields': 'Fields to copy: {table: the table\'s id, ids: field ids}',
  'copy_for_filemaker.scripts': 'Script ids',
  'copy_for_filemaker.customFunctions': 'Custom function ids',
  'copy_for_filemaker.valueLists': 'Value list ids',
  'copy_for_filemaker.layout': 'A layout whose objects to copy, by name or id (with the object ids)',
  'add_image.filename': 'The image\'s name, with its extension',
  'add_image.mime': 'The image\'s media type, e.g. image/png',
  'change_security.changes': 'The changes, applied together or not at all, each {op, ...} as the description lists',
};

/** Names that read badly when only capitalised. */
const WORDS: Record<string, string> = { sql: 'SQL', filemaker: 'FileMaker', ai: 'AI', ui: 'UI' };

/** A tool's title for a client's tool list: its name as words ("find_records" is "Find records"). */
export function toolTitle(name: string): string {
  const words = name.split('_').map((w) => WORDS[w] ?? w);
  const first = words[0]!;
  words[0] = first === first.toUpperCase() ? first : first[0]!.toUpperCase() + first.slice(1);
  return words.join(' ');
}
