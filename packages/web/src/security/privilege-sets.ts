// Privilege sets: what each set may do with records (per table, with
// record-level calcs), fields, layouts, value lists, scripts and extended
// privileges. [Full Access] can only change its extended privileges.

import { h, button, select, field, check } from '../design/dom.ts';
import { explain, type Sec } from './main.ts';
import type { FieldLevel, FieldMask, Level, PrivilegeSet, Rule, TablePrivileges } from './client.ts';

const LEVELS: [string, string][] = [['modifiable', 'Modifiable'], ['viewOnly', 'View only'], ['none', 'None']];

const FIELD_LEVELS: [string, string][] = [...LEVELS.slice(0, 2), ['masked', 'Masked'], LEVELS[2]];
const MASK_KINDS: [string, string][] = [['last4', 'Show last 4 characters'], ['placeholder', 'Show fixed text']];

function clone(p: PrivilegeSet): PrivilegeSet {
  return JSON.parse(JSON.stringify(p));
}

function isFull(p: PrivilegeSet): boolean {
  return p.id === 1 || p.name === '[Full Access]';
}

/** A yes / no / limited(calc) control for a record rule (view, edit, delete). */
type RuleControl = HTMLElement & { setRule(rule: Rule): void };

function ruleControl(label: string, value: Rule, onChange: (r: Rule) => void): RuleControl {
  const kind = select([['true', 'Yes'], ['false', 'No'], ['limited', 'Limited…']], typeof value === 'string' ? 'limited' : String(value), { 'aria-label': label });
  const calc = h('input', { class: 'sec-calc', placeholder: 'Calculation, e.g. Owner = Get(AccountName)', 'aria-label': `${label} calculation`, value: typeof value === 'string' ? value : '' });
  calc.style.display = typeof value === 'string' ? '' : 'none';
  const emit = () => {
    if (kind.value === 'limited') { calc.style.display = ''; onChange(calc.value); }
    else { calc.style.display = 'none'; onChange(kind.value === 'true'); }
  };
  kind.addEventListener('change', emit);
  calc.addEventListener('input', emit);
  const control = h('div', { class: 'sec-rule' }, h('span', { class: 'sec-rule-label' }, label), kind, calc) as unknown as RuleControl;
  control.setRule = (rule) => {
    kind.value = typeof rule === 'string' ? 'limited' : String(rule);
    calc.value = typeof rule === 'string' ? rule : '';
    calc.style.display = typeof rule === 'string' ? '' : 'none';
    onChange(rule);
  };
  return control;
}

function levelSelect(value: Level | undefined, onChange: (l: Level) => void, label: string): HTMLSelectElement {
  const s = select(LEVELS, value ?? 'modifiable', { 'aria-label': label });
  s.addEventListener('change', () => onChange(s.value as Level));
  return s;
}

/** The view/edit/create/delete + per-field controls for one table's privileges. */
export function tableEditor(t: TablePrivileges, fields: string[], ctx?: { table: string; sec: Sec }): HTMLElement {
  const fieldRows = fields.map((f) => {
    // Masked: the account sees a stand-in, never the value, and can't change, search or export the field.
    const maskKind = select(MASK_KINDS, t.masks?.[f]?.kind ?? 'last4', { 'aria-label': `How ${f} is masked` });
    const maskText = h('input', { type: 'text', maxlength: '16', placeholder: 'Text to show (optional)', 'aria-label': `Text shown for ${f}`, value: t.masks?.[f]?.text ?? '' }) as HTMLInputElement;
    const saveMask = () => {
      const text = maskText.value.trim();
      const m: FieldMask = { kind: maskKind.value as FieldMask['kind'], ...(text ? { text } : {}) };
      (t.masks ??= {})[f] = m;
    };
    const showMask = (masked: boolean) => {
      maskKind.style.display = masked ? '' : 'none';
      maskText.style.display = masked && maskKind.value === 'placeholder' ? '' : 'none';
    };
    const sel = select(FIELD_LEVELS, t.fields?.[f] ?? 'modifiable', { 'aria-label': `Field ${f}` });
    sel.addEventListener('change', () => {
      const l = sel.value as FieldLevel;
      t.fields ??= {};
      if (l === 'modifiable') delete t.fields[f];
      else t.fields[f] = l;
      if (t.fields && !Object.keys(t.fields).length) delete t.fields;
      // A mask belongs only to a masked field.
      if (l === 'masked') saveMask();
      else if (t.masks) { delete t.masks[f]; if (!Object.keys(t.masks).length) delete t.masks; }
      showMask(l === 'masked');
    });
    maskKind.addEventListener('change', () => { saveMask(); showMask(true); });
    maskText.addEventListener('input', saveMask);
    showMask(sel.value === 'masked');
    return h('div', { class: 'sec-field-row' }, h('span', {}, f), sel, maskKind, maskText);
  });
  const createBox = check('Create', t.create === true);
  createBox.input.addEventListener('change', () => { t.create = createBox.input.checked; });
  const viewControl = ruleControl('View', t.view, (r) => { t.view = r; });
  return h('div', { class: 'sec-table-priv' },
    viewControl,
    ruleControl('Edit', t.edit, (r) => { t.edit = r; }),
    h('div', { class: 'sec-rule' }, createBox.el),
    ruleControl('Delete', t.delete, (r) => { t.delete = r; }),
    fields.length ? h('details', { class: 'sec-fields' }, h('summary', {}, 'Field access'), ...fieldRows) : h('span', {}),
    ctx ? rulePreview(t, ctx.table, ctx.sec, (rule) => viewControl.setRule(rule)) : h('span', {}),
  );
}

/**
 * "Describe & preview" for a table's record rules: say in plain English who
 * should see what (the AI assistant drafts the calculation, when it's on),
 * then check the rule against a few real records before saving it — "allows N
 * of M", with each sample shown as allowed or not. Nothing is stored until the
 * rule is saved with the rest of the set.
 */
function rulePreview(t: TablePrivileges, table: string, sec: Sec, setViewRule: (rule: Rule) => void): HTMLElement {
  const english = h('input', { type: 'text', class: 'sec-english', placeholder: 'e.g. sales reps see only their own customers', 'aria-label': `Describe who may view ${table}` }) as HTMLInputElement;
  const calc = h('input', { type: 'text', class: 'sec-calc', placeholder: 'Calculation, e.g. Rep = Get(AccountName)', 'aria-label': `${table} view rule`, value: typeof t.view === 'string' ? t.view : '' }) as HTMLInputElement;
  const asWho = h('input', { type: 'text', class: 'sec-as', placeholder: 'preview as account (optional)', 'aria-label': 'Preview as account' }) as HTMLInputElement;
  const out = h('div', { class: 'sec-preview-out' });

  const draftBtn = sec.ask
    ? button('Draft with AI', () => sec.ask!(`Write a FileMaker record-level access calculation for the table "${table}" so that: ${english.value || '(describe the rule above)'}. ` +
        'It must return true for a record the account may see and false otherwise. Reply with just the calculation.'),
        { title: 'Ask the assistant to turn the description into a calculation' })
    : h('span', { class: 'd-hint' }, 'Turn on the AI assistant to draft from a description; you can still type the calculation.');

  const preview = button('Preview', async () => {
    const rule = calc.value.trim();
    if (!rule) { out.replaceChildren(h('p', { class: 'd-hint' }, 'Enter a calculation to preview.')); return; }
    out.replaceChildren(h('p', { class: 'd-hint' }, 'Checking…'));
    try {
      const r = await sec.client.previewRecordRule(table, rule, asWho.value.trim() ? { account: asWho.value.trim() } : {});
      if (!r.valid) { out.replaceChildren(h('p', { class: 'sec-bad' }, `That calculation didn't work: ${r.error ?? 'invalid'}`)); return; }
      const rows = r.samples.map((s) => h('li', { class: s.error ? 'sec-bad' : s.allowed ? 'sec-ok' : '' },
        `#${s.recordId}${s.label ? ` ${s.label}` : ''} — ${s.error ? `error: ${s.error}` : s.allowed ? 'allowed' : 'hidden'}`));
      out.replaceChildren(
        h('p', {}, `Allows ${r.allowed} of ${r.total} record${r.total === 1 ? '' : 's'}${r.account ? ` as "${r.account}"` : ''}. Sample:`),
        h('ul', { class: 'sec-preview-list' }, ...rows),
        button('Use as the View rule', () => { setViewRule(rule); calc.value = rule; }, { title: 'Set this table’s View rule to this calculation' }),
      );
    } catch (e) {
      out.replaceChildren(h('p', { class: 'sec-bad' }, `Couldn't preview: ${(e as Error).message}`));
    }
  });

  return h('details', { class: 'sec-describe' }, h('summary', {}, 'Describe & preview a view rule'),
    h('div', { class: 'sec-describe-body' },
      h('label', {}, 'In plain English', english), draftBtn,
      h('label', {}, 'Calculation', calc),
      h('div', { class: 'sec-preview-controls' }, asWho, preview),
      out));
}

export function privilegeSetsTab(sec: Sec): HTMLElement {
  const { privilegeSets } = sec.security;
  const current = privilegeSets.find((p) => p.name === sec.selected.set) ?? privilegeSets[0];

  const list = h('ul', { class: 'd-list' });
  for (const p of privilegeSets) {
    const li = h('li', { class: p === current ? 'selected' : '' },
      h('button', { type: 'button' }, h('span', {}, p.name), h('span', { class: 'd-count' }, isFull(p) ? 'full access' : '')));
    li.querySelector('button')!.addEventListener('click', () => { sec.selected.set = p.name; sec.render(); });
    list.append(li);
  }

  // Create a set (seeded as no access, so you grant from a safe default).
  const newName = h('input', { placeholder: 'New set name', 'aria-label': 'New set name' });
  const create = h('form', { class: 'd-inline-form' }, newName, button('Create', () => create.requestSubmit(), { class: 'primary' }));
  create.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = newName.value.trim();
    if (!n) return;
    const set: PrivilegeSet = { name: n, records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] };
    if (await sec.apply([{ op: 'createPrivilegeSet', set }], `Created "${n}"`)) { sec.selected.set = n; sec.render(); }
  });

  return h('div', { class: 'd-split' },
    h('aside', { class: 'd-side' }, h('h2', {}, 'Privilege sets'), list, create),
    h('section', { class: 'd-main' }, current ? editor(sec, clone(current)) : h('p', { class: 'd-muted' }, 'No privilege sets yet.')),
  );
}

function editor(sec: Sec, working: PrivilegeSet): HTMLElement {
  const { tables, layouts, valueLists, scripts, extendedPrivileges } = sec.security;
  const full = isFull(working);

  const head = h('div', { class: 'd-heading' },
    h('span', { class: 'd-title-input' }, working.name),
    full ? h('span', { class: 'sec-badge' }, 'full access') : h('span', {}),
    h('span', { class: 'd-spacer' }),
    ...explain(sec, `Explain the privilege set "${working.name}": what its accounts can see, change, create and delete, which ways in ` +
      'it allows, and anything that looks too open or too tight.'),
    full ? h('span', {}) : button('Delete set…', () => {
      if (confirm(`Delete privilege set "${working.name}"?`)) { sec.selected.set = undefined; void sec.apply([{ op: 'deletePrivilegeSet', name: working.name }], 'Set deleted'); }
    }, { class: 'danger' }));

  const sections: HTMLElement[] = [head];

  if (full) {
    sections.push(h('p', { class: 'd-hint' }, '[Full Access] always has every data privilege. Its AI-visible exceptions and ways in (extended privileges) can change.'));
  } else {
    // Default record access (tables without their own entry).
    sections.push(h('div', { class: 'd-group' }, h('h3', {}, 'Records (default)'),
      ruleControl('View', working.records.view, (r) => { working.records.view = r; }),
      ruleControl('Edit', working.records.edit, (r) => { working.records.edit = r; }),
      labelledCheck('Create', working.records.create, (v) => { working.records.create = v; }),
      ruleControl('Delete', working.records.delete, (r) => { working.records.delete = r; })));

    // Per-table custom privileges.
    const tableBlocks = tables.map((t) => {
      const has = !!working.tables?.[t.name];
      const toggle = check('Custom privileges for this table', has);
      const holder = h('div', {});
      const build = () => {
        if (working.tables?.[t.name]) holder.replaceChildren(tableEditor(working.tables[t.name], t.fields, { table: t.name, sec }));
        else holder.replaceChildren();
      };
      toggle.input.addEventListener('change', () => {
        working.tables ??= {};
        if (toggle.input.checked) working.tables[t.name] = { ...working.records, fields: {} };
        else { delete working.tables[t.name]; if (!Object.keys(working.tables).length) delete working.tables; }
        build();
      });
      build();
      return h('details', { class: 'sec-tbl' }, h('summary', {}, t.name), toggle.el, holder);
    });
    sections.push(h('div', { class: 'd-group' }, h('h3', {}, 'Tables'),
      h('p', { class: 'd-hint' }, 'Tables without custom privileges use the default above.'), ...tableBlocks));

    // Layouts: a default level and per-layout overrides for both the layout
    // itself and record access through it, as in FileMaker's Edit Privilege Set.
    sections.push(layoutsSection(working, layouts));
    sections.push(accessSection('Value lists', working.valueLists, (l) => { working.valueLists = l; }, valueLists,
      (name) => working.valueListAccess?.[name] ?? working.valueLists,
      (name, lvl) => { working.valueListAccess ??= {}; working.valueListAccess[name] = lvl; }));
    sections.push(accessSection('Scripts', working.scripts, (l) => { working.scripts = l; }, scripts,
      (name) => working.scriptAccess?.[name] ?? working.scripts,
      (name, lvl) => { working.scriptAccess ??= {}; working.scriptAccess[name] = lvl; }));

    // Available menu commands (a guard on what the UI offers, as in FileMaker).
    const menu = select([['all', 'All'], ['editing', 'Editing only'], ['minimum', 'Minimum']], working.menuCommands ?? 'all', { 'aria-label': 'Available menu commands' });
    menu.addEventListener('change', () => {
      if (menu.value === 'all') delete working.menuCommands;
      else working.menuCommands = menu.value as 'editing' | 'minimum';
    });
    sections.push(h('div', { class: 'd-group' }, h('h3', {}, 'Available menu commands'),
      field('Menu commands', menu),
      h('p', { class: 'd-hint' }, 'Editing only offers commands that change record data; Minimum offers navigating and viewing only. Record, field and script access are always enforced regardless.')));
  }

  // AI exceptions are separate from ordinary data privileges, including for Full Access.
  sections.push(h('div', { class: 'd-group' }, h('h3', {}, 'AI-visible fields'),
    h('p', { class: 'd-hint' }, 'When the file AI policy is on, secret-named fields block AI reads unless marked here. These marks do not grant record or field access.'),
    ...tables.map((table) => {
      const policyKey = Object.keys(working.aiVisible ?? {}).find((n) => n.toLowerCase() === table.name.toLowerCase()) ?? table.name;
      const current = working.aiVisible?.[policyKey];
      const all = check('All fields AI-visible', current === true);
      const holder = h('div', {});
      const build = () => holder.replaceChildren(...table.fields.map((name) => {
        const visible = working.aiVisible?.[policyKey];
        const box = check(`${name} AI-visible`, visible === true || (Array.isArray(visible) && visible.some((f) => f.toLowerCase() === name.toLowerCase())));
        box.input.disabled = visible === true;
        box.input.addEventListener('change', () => {
          working.aiVisible ??= {};
          const previous = working.aiVisible[policyKey];
          const fields = Array.isArray(previous) ? previous.filter((f) => f.toLowerCase() !== name.toLowerCase()) : [];
          working.aiVisible[policyKey] = box.input.checked ? [...fields, name] : fields;
        });
        return box.el;
      }));
      all.input.addEventListener('change', () => { (working.aiVisible ??= {})[policyKey] = all.input.checked ? true : []; build(); });
      build();
      return h('details', {}, h('summary', {}, table.name), all.el, holder);
    })));

  // Extended privileges (for every set, including [Full Access]).
  const extBoxes = extendedPrivileges.map((k) => {
    const c = check(k, working.extendedPrivileges.includes(k));
    c.input.addEventListener('change', () => {
      const has = working.extendedPrivileges.includes(k);
      if (c.input.checked && !has) working.extendedPrivileges.push(k);
      else if (!c.input.checked && has) working.extendedPrivileges = working.extendedPrivileges.filter((e) => e !== k);
    });
    return c.el;
  });
  sections.push(h('div', { class: 'd-group' }, h('h3', {}, 'Extended privileges'), h('div', { class: 'sec-ext' }, ...extBoxes)));

  sections.push(h('div', { class: 'd-actions' },
    button('Save', () => void sec.apply([{ op: 'savePrivilegeSet', set: working }], 'Privilege set saved'), { class: 'primary' })));
  return h('div', { class: 'd-stack' }, ...sections);
}

function labelledCheck(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const c = check(label, value);
  c.input.addEventListener('change', () => onChange(c.input.checked));
  return c.el;
}

/** Layouts: a default level, and per-layout overrides for the layout and for record access through it. */
function layoutsSection(working: PrivilegeSet, items: string[]): HTMLElement {
  const rows = items.map((name) => {
    const entry = () => working.layoutAccess?.[name];
    const layoutSel = levelSelect(entry()?.layout ?? working.layouts, (l) => {
      working.layoutAccess ??= {};
      working.layoutAccess[name] = { layout: l, records: entry()?.records ?? 'modifiable' };
    }, `Layout ${name}`);
    const recordsSel = levelSelect(entry()?.records ?? 'modifiable', (l) => {
      working.layoutAccess ??= {};
      working.layoutAccess[name] = { layout: entry()?.layout ?? working.layouts, records: l };
    }, `Records through ${name}`);
    return h('div', { class: 'sec-field-row' }, h('span', {}, name), layoutSel, h('span', { class: 'sec-sub' }, 'records'), recordsSel);
  });
  return h('div', { class: 'd-group' }, h('h3', {}, 'Layouts'),
    field('All layouts', levelSelect(working.layouts, (l) => { working.layouts = l; }, 'Layouts default')),
    items.length ? h('details', { class: 'sec-fields' }, h('summary', {}, 'Per-layout access'), ...rows) : h('span', {}));
}

/** A default level plus a collapsible per-item override list. For layouts the item's own level drives record access alongside. */
function accessSection(title: string, def: Level, setDef: (l: Level) => void, items: string[],
  get: (name: string) => Level, set: (name: string, l: Level) => void): HTMLElement {
  const rows = items.map((name) => h('div', { class: 'sec-field-row' }, h('span', {}, name), levelSelect(get(name), (l) => set(name, l), `${title} ${name}`)));
  return h('div', { class: 'd-group' }, h('h3', {}, title),
    field('All ' + title.toLowerCase(), levelSelect(def, setDef, title + ' default')),
    items.length ? h('details', { class: 'sec-fields' }, h('summary', {}, `Per-${title.toLowerCase().replace(/s$/, '')} access`), ...rows) : h('span', {}));
}
