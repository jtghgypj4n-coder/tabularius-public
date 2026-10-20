import type { Store } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

export const inlinePage = (name: string) => 'data:text/html,' + `<p id="page">${name}</p><p id="call"></p><a href="#one">one</a><div style="height:1200px"></div><div id="one">anchor</div><div style="height:600px"></div><script>parent.postMessage({fixture:'load',page:'${name}'},'*');function mark(v){document.getElementById('call').textContent=v;parent.postMessage({fixture:'call',value:v},'*')}</script>`;

/** Entirely generated: no imported solution files, and every script option is explicit. */
export function refreshFixture(store: Store): void {
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Draft' },
      { name: 'gLimit', type: 'number', options: { global: true } }, { name: 'Repeated', options: { global: true, repetitions: 3 } }] },
    { op: 'createField', table: 'Items', name: 'Value', type: 'number', kind: 'calculation', calculation: 'gLimit', options: { unstored: true } },
    { op: 'createTable', name: 'Rows', fields: [{ name: 'Parent', type: 'number' }, { name: 'Name' }, { name: 'Rank', type: 'number' }, { name: 'Repeated', options: { repetitions: 3 } }] },
    { op: 'createRelationship', left: 'Items', right: 'Rows', predicates: [{ left: 'Id', right: 'Parent' }] },
    { op: 'createField', table: 'Rows', name: 'Value', kind: 'calculation', calculation: 'Items::gLimit & ":" & Name', options: { unstored: true } },
  ]);
  const scripts: Record<string, string> = {
    Object: 'Set Field [ Items::gLimit ; 2 ]\nRefresh Object [ Object Name: "value" ]\nRefresh Object [ Object Name: "hidden" ]',
    Portal: 'Set Field [ Items::gLimit ; 3 ]\nRefresh Portal [ Object Name: "rows" ]',
    Shrink: 'Set Field [ Items::gLimit ; 1 ]\nRefresh Object [ Object Name: "child" ]',
    FoundChild: 'Set Field [ Items::gLimit ; 8 ]\nRefresh Object [ Object Name: "foundValue" ]',
    FindRefresh: 'Enter Find Mode\nSet Field [ Items::Id ; 2 ]\nPerform Find\nRefresh Window',
    SortRefresh: 'Sort Records by Field [ Descending ; Items::Id ]\nRefresh Window',
    OmitRefresh: 'Omit Record\nRefresh Window',
    FindViewer: 'Enter Find Mode\nSet Field [ Items::Id ; 2 ]\nPerform Find\nSet Web Viewer [ Object Name: "viewer" ; Reload ]',
    Child: 'Set Field [ Items::gLimit ; 4 ]\nRefresh Object [ Object Name: "child" ]',
    Repetition: 'Set Field [ Items::Repeated ; "new one" ]\nSet Field [ Items::Repeated[2] ; "new two" ]\nSet Field [ Items::Repeated[3] ; "new three" ]\nRefresh Object [ Object Name: "repeated" ; Repetition: 2 ]',
    Window: 'Set Field [ Items::gLimit ; 5 ]\nRefresh Window [ Flush cached join results ; Flush cached external data ]',
    Back: 'Set Web Viewer [ Object Name: "viewer" ; Go Back ]',
    Forward: 'Set Web Viewer [ Object Name: "viewer" ; Go Forward ]',
    Reload: 'Set Web Viewer [ Object Name: "viewer" ; Reload ]',
    Reset: 'Set Web Viewer [ Object Name: "viewer" ; Reset ]',
    URL: `Set Web Viewer [ Object Name: "viewer" ; URL: ${JSON.stringify(inlinePage('B'))} ]`,
    Ordered: `Perform JavaScript in Web Viewer [ Object Name: "viewer" ; Function Name: "mark" ; Parameters: "before" ]\nSet Web Viewer [ Object Name: "viewer" ; URL: ${JSON.stringify(inlinePage('B'))} ]\nPerform JavaScript in Web Viewer [ Object Name: "viewer" ; Function Name: "mark" ; Parameters: "after" ]`,
    Navigate: 'Refresh Object [ Object Name: "value" ]\nGo to Layout [ “Rows” ]',
    Dialog: 'Refresh Object [ Object Name: "value" ]\nShow Custom Dialog [ "Check" ; "Continue" ; Button 1: "OK" ]\nSet Web Viewer [ Object Name: "viewer" ; Reload ]',
    Freeze: 'Freeze Window\nSet Field [ Items::gLimit ; 7 ]\nRefresh Object [ Object Name: "value" ]\nRefresh Window',
    Found: 'Refresh Portal [ Object Name: "found" ]',
    PortalViewers: `Set Web Viewer [ Object Name: "rowViewer" ; URL: ${JSON.stringify(inlinePage('B'))} ]`,
  };
  for (const [name, text] of Object.entries(scripts)) store.applyDesign([{ op: 'createScript', name, text }]);
  const design = store.design('Items')!;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const base = (id: number, name: string, left: number, top: number, width = 180, height = 28): LayoutObject => ({ id, name, kind: 'text', type: 2,
    anchors, style: {}, bounds: { left, top, right: left + width, bottom: top + height } });
  const field = (id: number, name: string, to: string, column: string, left: number, top: number, repetitions = 1): LayoutObject => {
    const occurrence = store.schema.tableOccurrences.find((o) => o.name === to)!;
    const f = store.schema.tables.find((t) => t.name === to)!.fields.find((f) => f.name === column)!;
    return { ...base(id, name, left, top, 170, repetitions * 28), style, kind: 'field', type: 1,
      field: { tableOccurrenceId: occurrence.id, tableOccurrence: to, fieldId: f.id, field: column, display: 'edit', repetitions } };
  };
  const rows = store.schema.tableOccurrences.find((o) => o.name === 'Rows')!;
  const rank = store.schema.tables.find((t) => t.name === 'Rows')!.fields.find((f) => f.name === 'Rank')!;
  const viewer = { ...base(20, 'viewer', 20, 140, 250, 100), kind: 'web-viewer', type: 15, webUrl: JSON.stringify(inlinePage('A')) } as LayoutObject;
  const childViewer = { ...base(33, 'rowViewer', 765, 22, 140, 78), kind: 'web-viewer', type: 15, webUrl: JSON.stringify(inlinePage('A')) } as LayoutObject;
  const portal = { ...base(30, 'rows', 360, 20, 560, 300), kind: 'portal', type: 9,
    portal: { tableOccurrenceId: rows.id, tableOccurrence: 'Rows', rows: 3, initialRow: 1, scrolling: true, filter: 'Rows::Rank <= Items::gLimit',
      sort: [{ field: { tableOccurrenceId: rows.id, tableOccurrence: 'Rows', fieldId: rank.id, field: 'Rank' }, descending: true }] },
    children: [field(31, 'child', 'Rows', 'Value', 362, 22), field(32, 'rowRepeated', 'Rows', 'Repeated', 550, 22, 3), childViewer] } as LayoutObject;
  const objects: LayoutObject[] = [{ ...field(10, 'value', 'Items', 'Value', 20, 20), conditions: [{ formula: 'Items::gLimit = 2', rules: [{ part: 1, state: 1, css: { color: 'rgb(160, 0, 0)' } }] }] }, field(11, 'sibling', 'Items', 'Value', 20, 55),
    { ...base(12, 'hidden', 20, 90), text: 'Now visible', hide: { formula: 'Items::gLimit < 2', inFind: false } },
    field(13, 'repeated', 'Items', 'Repeated', 20, 265, 3), field(14, 'draft', 'Items', 'Draft', 20, 365), viewer, portal];
  const own = store.schema.tableOccurrences.find((o) => o.name === 'Items')!;
  objects.push({ ...base(40, 'found', 360, 350, 250, 85), kind: 'portal', type: 9,
    portal: { tableOccurrence: 'Items', tableOccurrenceId: own.id, rows: 2, initialRow: 1, scrolling: true }, children: [field(41, 'foundName', 'Items', 'Name', 362, 352), field(42, 'foundValue', 'Items', 'Value', 485, 352)] } as LayoutObject);
  for (const [i, name] of Object.keys(scripts).entries()) {
    const script = store.schema.scripts.find((s) => s.name === name)!;
    objects.push({ ...base(100 + i, name, 20 + i % 6 * 145, 465 + Math.floor(i / 6) * 40, 135), kind: 'button', type: 6, text: name,
      action: { stepId: 1, step: 'Perform Script', scriptId: script.id, script: name } });
  }
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { parts: [{ kind: 'body', kindId: 4, top: 0, height: 720, style: {} }], width: 960, objects } }]);
  store.setGlobalField('Items::gLimit', 1);
  store.setGlobalField('Items::Repeated', JSON.stringify(['one', 'two', 'three']));
  store.create('Items', { Id: 1, Name: 'first', Draft: 'draft' });
  store.create('Items', { Id: 2, Name: 'second', Draft: 'draft' });
  for (let rank = 1; rank <= 3; rank++) {
    const row = store.create('Rows', { Parent: 1, Name: `row ${rank}`, Rank: rank });
    store.update('Rows', row.recordId, { 'Repeated(1)': 'one', 'Repeated(2)': 'two', 'Repeated(3)': 'three' });
  }
}
