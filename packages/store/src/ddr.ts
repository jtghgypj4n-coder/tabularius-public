// The Database Design Report as XML: FileMaker Pro's "Database Design
// Report" (Tools > Database Design Report, XML format), the <FMPReport> file
// that analysis tools read to list a solution's tables, fields,
// relationships, layouts, scripts, value lists, accounts and menus.
//
// Its elements follow the report FileMaker 26 wrote for the Flicks sample
// (fixtures/fmp12/Flicks_ddr.xml); fields, steps and value lists are the same
// XML as FileMaker's clipboard (snippet-xml.ts), with each step's line as
// <StepText>. FileMaker's per-object formatting and theme CSS are left out.
// No password, verifier or data source credential is ever written.

import { scriptStepName, webViewerFlags, type LayoutDesigns, type LayoutObject, type Schema, type ScriptStep } from '../../fmp12/src/index.ts';
import { calc, el, esc, fieldXml, hidden, stepXml, tf, valueListXml } from './snippet-xml.ts';

const OBJECT_TYPES: Record<string, string> = {
  field: 'Field', text: 'Text', graphic: 'Graphic', line: 'Line', rectangle: 'Rect', 'rounded-rectangle': 'RoundRect', oval: 'Oval', group: 'Group',
  portal: 'Portal', button: 'Button', 'tab-control': 'Tab Control', 'tab-panel': 'Tab Panel', 'web-viewer': 'ExternalObject', chart: 'Chart',
  'popover-button': 'Popover Button', popover: 'Popover', 'slide-control': 'Slide Control', 'slide-panel': 'Slide Panel', 'button-bar': 'Button Bar', unknown: 'Unknown',
};
const JOIN_TYPES: Record<string, string> = { '=': 'Equal', '≠': 'NotEqual', '<': 'LessThan', '≤': 'LessThanOrEqualTo', '>': 'GreaterThan', '≥': 'GreaterThanOrEqualTo', '×': 'CartesianProduct' };
const ACCESS: Record<string, string> = { modifiable: 'Modifiable', viewOnly: 'ViewOnly', none: 'NoAccess' };

export interface ReportOptions {
  /** The file's name, e.g. "Invoices.fmp12". */
  fileName: string;
  /** Records in a table, for the report's record counts. */
  records?: (table: string) => number | undefined;
  /** When the report is made (default now). */
  now?: Date;
}

/** The whole file's design as FileMaker's Database Design Report XML. */
export function designReport(schema: Schema, designs: LayoutDesigns, opts: ReportOptions): string {
  const s = schema;
  const notes: string[] = [];
  const now = opts.now ?? new Date();
  const toName = (id: number | undefined) => s.tableOccurrences.find((t) => t.id === id)?.name ?? '';
  // A native file's declared foreign key: its child and parent, by occurrence and field, and what deleting a parent does.
  const foreignKeyXml = (r: Schema['relationships'][number]): string => {
    const fk = r.foreignKey!;
    const [childTo, parentTo] = fk.child === 'left' ? [r.leftTableOccurrenceId, r.rightTableOccurrenceId] : [r.rightTableOccurrenceId, r.leftTableOccurrenceId];
    const field = (tableId: number, id: number) => s.tables.find((t) => t.id === tableId)?.fields.find((f) => f.id === id)?.name ?? '';
    return el('ForeignKey', { name: fk.name, onDelete: fk.onDelete },
      el('ChildField', {}, el('Field', { table: toName(childTo), id: fk.childFieldId, name: field(fk.childTableId, fk.childFieldId) })) +
      el('ParentField', {}, el('Field', { table: toName(parentTo), id: fk.parentFieldId, name: field(fk.parentTableId, fk.parentFieldId) })));
  };
  const out: string[] = [];

  out.push(el('BaseTableCatalog', {}, s.tables.map((t) => el('BaseTable', { id: t.id, records: opts.records?.(t.name), comment: '', name: t.name },
    el('FieldCatalog', {}, t.fields.map((f) => fieldXml(s, t, f, notes)).join('')))).join('')));
  // Manage Containers' base directories (its thumbnail options aren't decoded, so they're left out).
  if (s.containerDirectories?.length) {
    out.push(el('BaseDirectoryCatalog', {}, el('BaseDirectoryList', {}, s.containerDirectories.map((d) => el('BaseDirectory', { id: d.id }, esc(d.path))).join(''))));
  }

  out.push(el('RelationshipGraph', {}, el('TableList', {}, s.tableOccurrences.map((to) => {
    const base = to.dataSourceId ? undefined : s.tables.find((t) => t.id === to.baseTableId);
    const file = to.dataSourceId ? s.dataSources.find((d) => d.id === to.dataSourceId)?.name : undefined;
    return el('Table', { id: to.id, color: to.color, baseTableId: to.baseTableId, baseTable: base?.name, ...(file ? { dataSource: file } : {}), name: to.name });
  }).join('')) + el('RelationshipList', {}, s.relationships.map((r) => {
    const left = toName(r.leftTableOccurrenceId);
    const right = toName(r.rightTableOccurrenceId);
    const fieldOf = (toId: number, id: number, name?: string) => el('Field', { table: toName(toId), id, name: name ?? '' });
    return el('Relationship', { id: r.id }, [
      el('LeftTable', { cascadeCreate: tf(r.leftCreate), cascadeDelete: tf(r.leftDelete), name: left }),
      el('RightTable', { cascadeCreate: tf(r.rightCreate), cascadeDelete: tf(r.rightDelete), name: right }),
      el('JoinPredicateList', {}, r.predicates.map((p) => el('JoinPredicate', { type: JOIN_TYPES[p.operator] ?? 'Equal' },
        el('LeftField', {}, fieldOf(r.leftTableOccurrenceId, p.leftFieldId, p.leftField)) + el('RightField', {}, fieldOf(r.rightTableOccurrenceId, p.rightFieldId, p.rightField)))).join('')),
      // Native files only: the declared foreign key (Tabularius's own element; a FileMaker report has none).
      r.foreignKey ? foreignKeyXml(r) : '',
    ].join(''));
  }).join(''))));

  const designOf = new Map(designs.layouts.map((l) => [l.id, l]));
  const themeName = (id: number | undefined) => designs.themes.find((t) => t.id === id)?.name;
  const objectXml = (o: LayoutObject): string => {
    const type = OBJECT_TYPES[o.kind] ?? 'Unknown';
    const b = o.bounds;
    const parts = [el('Bounds', { top: b.top.toFixed(7), left: b.left.toFixed(7), bottom: b.bottom.toFixed(7), right: b.right.toFixed(7) })];
    if (o.tooltip) parts.push(el('ToolTip', {}, calc(o.tooltip)));
    if (o.field) {
      const f = o.field;
      const to = f.tableOccurrence ?? toName(f.tableOccurrenceId);
      parts.push(el('FieldObj', { numOfReps: f.repetitions || 1 }, [
        el('Name', {}, esc(`${to}::${f.field ?? ''}`)),
        f.valueList ? el('ValueList', {}, esc(f.valueList)) : '',
        el('DDRInfo', {}, el('Field', { name: f.field ?? '', id: f.fieldId, repetition: 1, maxRepetition: f.repetitions || 1, table: to })
          + (f.valueList ? el('ValueList', { name: f.valueList, id: f.valueListId }) : '')),
      ].join('')));
    }
    if (o.text !== undefined && o.kind !== 'field') {
      parts.push(el('TextObj', {}, el('CharacterStyleVector', {}, el('Style', {}, el('Data', {}, esc(o.text))))));
    }
    if (o.action) {
      const a = o.action;
      const step: ScriptStep = { stepId: a.stepId, name: scriptStepName(a.stepId), enabled: true };
      if (a.scriptId !== undefined) step.params = { script: { id: a.scriptId, name: a.script ?? '' }, ...(a.parameter !== undefined ? { parameter: a.parameter } : {}) };
      else if (a.layoutId !== undefined) step.params = { layoutDestination: 'named', layout: { id: a.layoutId, name: a.layout ?? '' } };
      parts.push(el('ButtonObj', {}, stepXml(s, step, notes, true)));
    }
    if (o.portal) {
      const p = o.portal;
      parts.push(el('PortalObj', { numOfRows: p.rows, initialRow: p.initialRow }, el('TableAliasKey', {}, esc(p.tableOccurrence ?? toName(p.tableOccurrenceId)))));
    }
    if (o.webUrl !== undefined) parts.push(el('ExternalObj', { typeID: 'WEBV', ...(o.webOptions ? { externalFlagSet: webViewerFlags(o.webOptions) } : {}) }, el('WebViewer', {}, calc(o.webUrl))));
    for (const c of o.children ?? []) parts.push(objectXml(c));
    return el('Object', { type, key: o.id, ...(o.name ? { name: o.name } : {}) }, parts.join(''));
  };
  const layoutXml = (id: number, name: string, toId: number | undefined) => {
    const d = designOf.get(id);
    return el('Layout', { width: d?.width, includeInMenu: tf(!hidden(s.layoutOrder, id)), id, name }, [
      el('Table', { id: toId, name: toName(toId) }),
      el('CustomMenuSet', { id: d?.menuSetId ?? 0, name: d?.menuSetId === 1 ? '[Standard FileMaker Menus]' : s.customMenuSets.find((m) => m.id === d?.menuSetId)?.name ?? '' }),
      d?.themeId !== undefined ? el('Theme', { name: themeName(d.themeId), id: d.themeId }) : '',
      // Layout Setup, as FileMaker 26's report writes it, once one is set here: they aren't
      // decoded from .fmp12 files yet. (showFieldFrames is False in every sample report.)
      d && (d.recordIndicator === false || d.fieldFrames === false || d.saveRecordChanges === false)
        ? el('Options', { showRecordIndicator: tf(d.recordIndicator !== false), showFieldFramesCurrentRecord: tf(d.fieldFrames !== false), showFieldFrames: 'False', saveRecord: tf(d.saveRecordChanges !== false) })
        : '',
      ...(d?.objects ?? []).map(objectXml),
    ].join(''));
  };
  out.push(el('LayoutCatalog', {}, ordered(s.layoutOrder, s.layouts, (l) => layoutXml(l.id, l.name, l.tableOccurrenceId))));

  out.push(el('ValueListCatalog', {}, s.valueLists.map((v) => valueListXml(s, v, notes)).join('')));

  out.push(el('ScriptCatalog', {}, ordered(s.scriptOrder, s.scripts, (sc) =>
    el('Script', { includeInMenu: tf(!hidden(s.scriptOrder, sc.id)), runFullAccess: tf(sc.fullAccess), id: sc.id, name: sc.name }, el('StepList', {}, sc.steps.map((st) => stepXml(s, st, notes, true)).join(''))))));

  const setName = (id: number | undefined) => s.privilegeSets.find((p) => p.id === id)?.name ?? '';
  out.push(el('AccountCatalog', {}, s.accounts.map((a) => el('Account', { id: a.id, privilegeSet: setName(a.privilegeSetId), managedBy: a.external ? 'External' : 'FileMaker', name: a.name }, '<Description/>')).join('')));
  out.push(el('PrivilegesCatalog', {}, s.privilegeSets.map((p) => el('PrivilegeSet', { comment: p.comment ?? '', id: p.id, name: p.name }, [
    el('Records', { value: p.records.create && p.records.edit && p.records.delete ? 'CreateEditDelete' : p.records.view ? 'ViewOnly' : 'NoAccess' }),
    el('Layouts', { value: ACCESS[p.layouts] }), el('ValueLists', { value: ACCESS[p.valueLists] }), el('Scripts', { value: ACCESS[p.scripts] }),
  ].join(''))).join('')));
  out.push(el('ExtendedPrivilegeCatalog', {}, s.extendedPrivileges.map((x) => {
    const sets = s.privilegeSets.filter((p) => p.extendedPrivileges.includes(x.name));
    return el('ExtendedPrivilege', { id: x.id, comment: (x as { comment?: string }).comment ?? '', name: x.name },
      sets.length ? el('PrivilegeSetList', {}, sets.map((p) => el('PrivilegeSet', { id: p.id, name: p.name })).join('')) : '');
  }).join('')));
  out.push(el('CustomFunctionCatalog', {}, s.customFunctions.map((cf) =>
    el('CustomFunction', { id: cf.id, functionArity: cf.parameters.length, visible: 'True', parameters: cf.parameters.join(';'), name: cf.name }, calc(cf.formula ?? ''))).join('')));
  // File references only: an ODBC source's login is never written.
  // ODBC entries as FileMaker writes them, without the login: Tabularius keeps no data source credentials.
  out.push(el('ExternalDataSourcesCatalog', {}, s.dataSources.map((d) => (d.paths[0]?.startsWith('odbc:')
    ? el('OdbcDataSource', { DSN: d.paths[0].slice(5), id: d.id, name: d.name })
    : el('FileReference', { id: d.id, pathList: d.paths.join(' '), name: d.name }))).join('')));
  out.push(el('CustomMenuSetCatalog', {}, el('CustomMenuSet', { id: 1, name: '[Standard FileMaker Menus]' }, '<CustomMenuList/>') + s.customMenuSets.filter((m) => m.id !== 1).map((m) => el('CustomMenuSet', { id: m.id, name: m.name },
    el('CustomMenuList', {}, m.menuIds.map((id) => el('CustomMenu', { id, name: s.customMenus.find((c) => c.id === id)?.name ?? '' })).join('')))).join('')));
  out.push(el('CustomMenuCatalog', {}, s.customMenus.map((m) => el('CustomMenu', { id: m.id, name: m.name }, [
    m.installWhen ? el('Conditions', {}, el('Install', {}, calc(m.installWhen))) : '',
    m.comment ? el('Comment', {}, esc(m.comment)) : '',
    el('MenuItemList', {}, m.items.map((it) => el('MenuItem', { name: (it as { title?: string }).title ?? '' })).join('')),
  ].join(''))).join('')));
  out.push(el('ThemeCatalog', {}, designs.themes.map((t) => el('Theme', { name: t.name, id: t.id })).join('')));

  const date = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  const time = now.toLocaleTimeString('en-US');
  return `<?xml version="1.0"?>\n${el('FMPReport', { link: 'Summary.xml', creationTime: time, creationDate: date, type: 'Report', version: 'tabularius' },
    el('File', { name: opts.fileName, path: '' }, out.join('\n')))}\n`;
}

/** Items in their list order (folders as <Group>), then any the order leaves out. */
function ordered<T extends { id: number; name: string }>(order: Schema['layoutOrder'], items: T[], write: (item: T) => string): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<number>();
  const out: string[] = [];
  const stack: { depth: number; parts: string[]; open: string }[] = [];
  const close = (depth: number) => {
    while (stack.length && stack[stack.length - 1].depth >= depth) {
      const g = stack.pop()!;
      const xml = `${g.open}${g.parts.join('')}</Group>`;
      (stack.length ? stack[stack.length - 1].parts : out).push(xml);
    }
  };
  const target = () => (stack.length ? stack[stack.length - 1].parts : out);
  for (const o of order) {
    if (o.kind === 'folder-end' || o.kind === 'separator') continue;
    close(o.depth);
    if (o.kind === 'folder') stack.push({ depth: o.depth, parts: [], open: `<Group${` id="${o.id}" name="${esc(o.name)}"`}>` });
    else if (byId.has(o.id) && !seen.has(o.id)) {
      seen.add(o.id);
      target().push(write(byId.get(o.id)!));
    }
  }
  close(0);
  for (const i of items) if (!seen.has(i.id)) out.push(write(i));
  return out.join('');
}
