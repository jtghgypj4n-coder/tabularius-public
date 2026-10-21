// API tokens: long-lived, revocable bearer credentials for integrations.

import { h, button, select, field, check, toast } from '../design/dom.ts';
import { errorText, type Sec } from './main.ts';

// The last token minted, shown once (only its hash is kept on the server).
let justMinted: { id: string; token: string } | undefined;
let tokenCreationPending = false;

function when(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function tokensTab(sec: Sec): HTMLElement {
  const { apiTokens, accounts, layouts } = sec.security;
  const accountNames = accounts.filter((a) => !a.external).map((a) => a.name);

  const scopeCell = (t: typeof apiTokens[number]): Node | string => {
    if (!t.layouts || !t.layouts.length) return h('span', { class: 'd-muted' }, 'all layouts');
    const shown = t.layouts.slice(0, 2).join(', ');
    return t.layouts.length > 2 ? `${shown} +${t.layouts.length - 2}` : shown;
  };

  const rows = apiTokens.map((t) => h('tr', {},
    h('td', {}, t.label ?? h('span', { class: 'd-muted' }, 'no label')),
    h('td', {}, t.account),
    h('td', {}, t.readOnly ? h('span', { class: 'sec-badge' }, 'read-only') : 'read/write'),
    h('td', {}, t.surfaces && t.surfaces.length ? t.surfaces.join(', ') : h('span', { class: 'd-muted' }, 'all')),
    h('td', { title: t.layouts && t.layouts.length ? t.layouts.join(', ') : undefined }, scopeCell(t)),
    h('td', {}, when(t.created)),
    h('td', {}, t.expires ? when(t.expires) : h('span', { class: 'd-muted' }, 'never')),
    h('td', {}, t.lastUsed ? when(t.lastUsed) : h('span', { class: 'd-muted' }, 'never')),
    h('td', {}, button('Revoke', () => {
      if (confirm(`Revoke this token? Any integration using it stops working.`)) void sec.apply([{ op: 'revokeApiToken', id: t.id }], 'Token revoked');
    }, { class: 'danger' })),
  ));

  const table = apiTokens.length
    ? h('table', { class: 'sec-table' },
        h('thead', {}, h('tr', {}, ...['Label', 'Account', 'Access', 'Surfaces', 'Layouts', 'Created', 'Expires', 'Last used', ''].map((c) => h('th', {}, c)))),
        h('tbody', {}, ...rows))
    : h('p', { class: 'd-muted' }, 'No API tokens yet.');

  // Create.
  const account = select(accountNames.length ? accountNames : [''], accountNames[0] ?? '', { 'aria-label': 'Account' });
  const label = h('input', { placeholder: 'Label (e.g. Reporting)', 'aria-label': 'Label' });
  const readOnly = check('Read-only', true);
  const expires = h('input', { type: 'number', min: '1', placeholder: 'Expires in days (optional)', 'aria-label': 'Expires in days' });
  // Leave all unchecked to reach every surface the account's privileges allow.
  const surfaceChecks = [['fmrest', 'Data API'], ['fmodata', 'OData'], ['fmxdbc', 'SQL']].map(([key, name]) => ({ key, ...check(name, false) }));
  const surfaces = h('fieldset', { class: 'sec-surfaces' }, h('legend', {}, 'Surfaces (none = all)'), ...surfaceChecks.map((c) => c.el));

  // Layout scope: an optional whitelist of Data API layouts. Collapsed by
  // default, and filterable, since a file can have hundreds of layouts. When
  // any are chosen the token works only through those layouts, and only on the
  // Data API (OData and SQL go through no layout, so they refuse it).
  const layoutChecks = layouts.map((name) => ({ name, ...check(name, false) }));
  const layoutList = h('div', { class: 'sec-layout-list' }, ...layoutChecks.map((c) => c.el));
  const layoutFilter = h('input', { type: 'search', placeholder: 'Filter layouts…', 'aria-label': 'Filter layouts' });
  const layoutCount = h('span', { class: 'd-muted' }, 'all layouts');
  const refreshCount = () => {
    const n = layoutChecks.filter((c) => c.input.checked).length;
    layoutCount.textContent = n ? `${n} layout${n === 1 ? '' : 's'}` : 'all layouts';
  };
  for (const c of layoutChecks) c.input.addEventListener('change', refreshCount);
  layoutFilter.addEventListener('input', () => {
    const q = layoutFilter.value.trim().toLowerCase();
    for (const c of layoutChecks) c.el.style.display = !q || c.name.toLowerCase().includes(q) ? '' : 'none';
  });
  const layoutScope = layouts.length
    ? h('details', { class: 'sec-layout-scope' },
        h('summary', {}, 'Limit to Data API layouts (', layoutCount, ')'),
        h('p', { class: 'd-hint' }, 'Chosen layouts only, and only on the Data API — OData and SQL refuse a layout-scoped token.'),
        layoutFilter, layoutList)
    : undefined;

  const form = h('form', { class: 'd-inline-form sec-create' }, field('Account', account), label, readOnly.el, expires, surfaces, layoutScope);
  const createButton = button('Create token', () => form.requestSubmit(), { class: 'primary token-create' });
  createButton.disabled = tokenCreationPending;
  form.append(createButton);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (tokenCreationPending) return;
    if (!account.value) { toast('Add an account first.'); return; }
    tokenCreationPending = true;
    createButton.disabled = true;
    try {
      const chosen = surfaceChecks.filter((c) => c.input.checked).map((c) => c.key);
      const chosenLayouts = layoutChecks.filter((c) => c.input.checked).map((c) => c.name);
      const r = await sec.client.createToken(account.value, {
        label: label.value.trim() || undefined,
        readOnly: readOnly.input.checked,
        expiresDays: expires.value ? Number(expires.value) : undefined,
        surfaces: chosen.length ? chosen : undefined,
        layouts: chosenLayouts.length ? chosenLayouts : undefined,
      });
      justMinted = { id: r.token.split('.')[0], token: r.token };
      sec.set(r.security);
    } catch (err) {
      toast(errorText(err));
    } finally {
      tokenCreationPending = false;
      for (const control of document.querySelectorAll<HTMLButtonElement>('.token-create')) control.disabled = false;
    }
  });

  const minted = justMinted
    ? h('div', { class: 'd-group sec-minted' },
        h('div', { class: 'd-label' }, 'New token — copy it now, it won’t be shown again'),
        h('div', { class: 'd-code sec-secret' }, justMinted.token),
        h('div', { class: 'd-row' },
          button('Copy', () => { void navigator.clipboard?.writeText(justMinted!.token).then(() => toast('Copied', 'info'), () => {}); }),
          button('Done', () => { justMinted = undefined; sec.render(); })))
    : undefined;

  return h('div', { class: 'd-stack sec-tokens' },
    h('p', { class: 'd-hint' }, 'A token signs in as its account and carries that account’s privileges. Use it as a Bearer token on the Data API, OData and SQL endpoints; scope it to a subset of those surfaces so it can’t be replayed elsewhere, and revoke it here without touching the password.'),
    minted,
    table,
    h('h2', {}, 'New token'),
    form,
  );
}
