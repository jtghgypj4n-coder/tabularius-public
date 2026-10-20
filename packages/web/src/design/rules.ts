// "Suggest rules from the data" under a table: validations, value lists, serial numbers and defaults its
// records already follow (the server's rule-suggestions.ts), each accepted on its own as one design change, or
// dismissed for this visit.

import { h, button } from './dom.ts';
import { errorText, type Studio } from './main.ts';

/** Suggestions dismissed this visit, by table, field and kind. */
const dismissed = new Set<string>();

export function rulesPanel(studio: Studio, table: string): HTMLElement {
  const body = h('div', { class: 'd-stack' });
  const box = h('details', { class: 'd-report d-rules' }, h('summary', {}, 'Suggest rules from the data'), body);
  const load = async () => {
    body.replaceChildren(h('p', { class: 'd-muted' }, 'Reading the records…'));
    try {
      const r = await studio.client.suggestRules(table);
      const left = r.suggestions.filter((x) => !dismissed.has(`${x.table}\n${x.field}\n${x.kind}`));
      const more = r.alsoAlwaysFilled.find((x) => x.table === table)?.fields ?? [];
      body.replaceChildren(
        ...(left.length ? [h('ul', {}, ...left.map((x) => {
          const key = `${x.table}\n${x.field}\n${x.kind}`;
          const accept = button('Accept', async () => {
            accept.disabled = true;
            if (!(await studio.apply(x.changes, `Rule added to ${x.field}`))) accept.disabled = false;
          }, { class: 'primary', title: 'Adds this rule to the field now' });
          return h('li', {},
            h('p', {}, x.title),
            h('p', { class: 'd-muted' }, x.evidence),
            h('div', { class: 'd-actions' }, accept, button('Dismiss', () => {
              dismissed.add(key);
              void load();
            }, { class: 'quiet' })));
        }))] : [h('p', { class: 'd-muted' }, 'No rules to suggest: the fields already check what the records show, or there are fewer than 20 records.')]),
        ...(more.length ? [h('p', { class: 'd-muted' }, `Also filled in on every record: ${more.join(', ')}.`)] : []),
        ...(studio.ask ? [h('div', { class: 'd-actions' }, button('Ask AI which rules are worth having', () => void studio.ask!(`Which validation rules, value lists and auto-enter options should the table "${table}" have? ` +
          'Call suggest_rules for it, say which are worth adding and why (and which to skip), and propose each as its own change.'), { class: 'quiet' }))] : []));
    } catch (e) {
      body.replaceChildren(h('p', { class: 'd-muted' }, errorText(e)));
    }
  };
  box.addEventListener('toggle', () => {
    if (box.open && !body.childElementCount) void load();
  });
  return box;
}
