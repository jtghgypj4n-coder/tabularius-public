// Calendar feeds and .ics import: File > Manage > Calendar Feeds… (Full Access, as Manage Security is) and
// File > Import Calendar (.ics)…. A feed is a link a calendar app subscribes to; its address is shown once, as an API
// token is, and the list afterwards says only that it exists. The server decides who may do either; the menu only
// leaves the entries out for an account that would be refused.

import type { Api, CalendarFeed } from './api.ts';
import type { FieldMeta, LayoutMeta } from './types.ts';
import { h, button } from './design/dom.ts';
import { toast } from './toast.ts';
import { plainMessage } from './http-problem.ts';

/** Fields of the layout's own table that can place an event (a date or timestamp), then the ones that can fill its text. */
export function calendarFields(meta: LayoutMeta): { dates: FieldMeta[]; text: FieldMeta[] } {
  const own = (meta.fields[meta.layout.occurrence] ?? []).filter((f) => !f.summary && !f.name.includes('::'));
  return {
    dates: own.filter((f) => f.type === 'date' || f.type === 'timestamp'),
    text: own.filter((f) => f.type !== 'container'),
  };
}

/** The body of a make-a-feed request from the form: what is left blank is left out. */
export function feedRequest(form: { layout: string; start: string; end: string; title: string; description: string; location: string; zone: string; label: string; expiresDays: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { layout: form.layout, start: form.start };
  for (const k of ['end', 'title', 'description', 'location', 'zone', 'label'] as const) if (form[k].trim()) out[k] = form[k].trim();
  const days = Number(form.expiresDays);
  // Blank leaves the address its default lifetime (a year); every address expires.
  if (form.expiresDays.trim() && days > 0) out.expiresDays = days;
  return out;
}

/** What the import said, in a sentence. */
export function importSummary(r: { imported: number; skipped: number; notes: string[] }): string {
  return `Imported ${r.imported} event${r.imported === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}.${r.notes.length ? ` ${r.notes.join(' ')}` : ''}`;
}

/** Feed metadata is an instant; show the zone so a repeated local hour is unambiguous. */
export const calendarWhen = (iso?: string, locale?: string) => (iso ? new Date(iso).toLocaleString(locale, { timeZoneName: 'short' }) : '');

export async function calendarDialog(api: Api, mode: 'feeds' | 'import', current?: string): Promise<void> {
  if (document.querySelector('dialog.calendar-dialog')) return;
  const title = mode === 'feeds' ? 'Calendar Feeds' : 'Import Calendar';
  const dialog = h('dialog', { class: 'replace-dialog export-dialog calendar-dialog', 'aria-labelledby': 'calendar-dialog-title' }) as HTMLDialogElement;
  const status = h('p', { class: 'calendar-status', role: 'status', 'aria-live': 'polite' });
  const list = h('div', { class: 'calendar-list' });
  const result = h('div', { class: 'calendar-result' });
  const form = h('div', { class: 'calendar-form' });

  let layouts: string[] = [];
  try {
    layouts = (await api.menu()).layouts.filter((l) => l.kind === 'item').map((l) => l.name);
  } catch (e) {
    toast(plainMessage(e));
    return;
  }
  if (!layouts.length) {
    toast('This file has no layouts to make a calendar from.');
    return;
  }
  const layoutPick = h('select', { id: 'calendar-layout' }, ...layouts.map((n) => h('option', { value: n }, n))) as HTMLSelectElement;
  layoutPick.value = current && layouts.includes(current) ? current : layouts[0];
  const picks: Record<string, HTMLSelectElement> = {};
  const row = (id: string, label: string, control: HTMLElement) => h('div', { class: 'calendar-row' }, h('label', { for: id }, label), control);
  const fieldPick = (key: string, label: string, required: boolean) => {
    const sel = h('select', { id: `calendar-${key}` }) as HTMLSelectElement;
    picks[key] = sel;
    return row(`calendar-${key}`, required ? `${label} (required)` : label, sel);
  };
  const fill = (meta: LayoutMeta) => {
    const { dates, text } = calendarFields(meta);
    const set = (key: string, fields: FieldMeta[], required: boolean) => {
      const sel = picks[key];
      sel.replaceChildren(...(required ? [] : [h('option', { value: '' }, '(none)')]), ...fields.map((f) => h('option', { value: f.name }, f.name)));
      if (required && !fields.length) sel.append(h('option', { value: '' }, '(no date field on this layout)'));
    };
    set('start', dates, true);
    set('end', dates, false);
    for (const k of ['title', 'description', 'location']) set(k, text, false);
  };
  const load = async () => {
    status.textContent = '';
    try {
      fill(await api.layout(layoutPick.value));
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  };
  layoutPick.addEventListener('change', () => void load());

  const zone = h('input', { id: 'calendar-zone', type: 'text', placeholder: 'UTC or Europe/London (blank: floating times)', autocomplete: 'off' }) as HTMLInputElement;
  const fields = h('div', { class: 'calendar-fields' },
    row('calendar-layout', 'Layout', layoutPick),
    fieldPick('start', 'Starts at', true), fieldPick('end', 'Ends at', false),
    fieldPick('title', 'Title', false), fieldPick('description', 'Description', false), fieldPick('location', 'Location', false),
    row('calendar-zone', 'Time zone', zone));
  const values = () => Object.fromEntries(Object.entries(picks).map(([k, sel]) => [k, sel.value]));

  const close = button('Done', () => dialog.close(), { class: 'primary' });

  if (mode === 'feeds') {
    const label = h('input', { id: 'calendar-label', type: 'text', maxlength: '60', placeholder: 'Team calendar', autocomplete: 'off' }) as HTMLInputElement;
    const days = h('input', { id: 'calendar-days', type: 'number', min: '1', max: '3650', placeholder: 'days (blank: 365)', inputmode: 'numeric' }) as HTMLInputElement;
    const draw = (feeds: CalendarFeed[]) => {
      list.replaceChildren(feeds.length
        ? h('table', { class: 'calendar-feeds' },
          h('thead', {}, h('tr', {}, ...['Name', 'Layout', 'Shows records as', 'Made', 'Last opened', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, ...feeds.map((f) => h('tr', {},
            h('td', {}, f.label || '(no name)'), h('td', {}, f.layout), h('td', {}, f.account), h('td', {}, calendarWhen(f.created)), h('td', {}, f.lastUsed ? calendarWhen(f.lastUsed) : 'never'),
            h('td', {}, button('Revoke', () => void revoke(f), { 'aria-label': `Revoke ${f.label || 'feed'} on ${f.layout}` }))))))
        : h('p', { class: 'calendar-none' }, 'No calendar feeds yet.'));
    };
    const reload = async () => {
      try {
        draw(await api.calendarFeeds());
      } catch (e) {
        list.replaceChildren(h('p', { role: 'alert' }, (e as Error).message));
      }
    };
    const revoke = async (f: CalendarFeed) => {
      if (!confirm(`Revoke the feed ${f.label ? `"${f.label}" ` : ''}on ${f.layout}? Calendars subscribed to it stop updating.`)) return;
      try {
        await api.revokeCalendarFeed(f.id);
        status.textContent = 'Feed revoked.';
        await reload();
      } catch (e) {
        status.textContent = (e as Error).message;
      }
    };
    const make = button('Make link', () => void run(), { class: 'primary' });
    const run = async () => {
      if (!picks.start.value) {
        status.textContent = 'Choose the date or timestamp field that says when each event starts.';
        picks.start.focus();
        return;
      }
      make.disabled = true;
      status.textContent = 'Making the link…';
      try {
        const made = await api.makeCalendarFeed(feedRequest({ layout: layoutPick.value, ...(values() as Record<'start' | 'end' | 'title' | 'description' | 'location', string>), zone: zone.value, label: label.value, expiresDays: days.value }));
        const address = h('input', { id: 'calendar-address', type: 'text', readonly: '', value: made.url, 'aria-label': 'Calendar feed address', class: 'calendar-address' }) as HTMLInputElement;
        result.replaceChildren(
          h('p', { role: 'status' }, 'Copy this address into your calendar app (Subscribe to calendar). It is shown only now: anyone who has it can read this feed, and Revoke ends it.'),
          h('div', { class: 'calendar-row' }, address, button('Copy', () => void copy(address))));
        address.focus();
        address.select();
        status.textContent = '';
        label.value = '';
        await reload();
      } catch (e) {
        status.textContent = (e as Error).message;
      } finally {
        make.disabled = false;
      }
    };
    const copy = async (input: HTMLInputElement) => {
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Address copied.');
      } catch {
        input.focus();
        input.select();
        toast('Press Ctrl+C (or ⌘C) to copy the selected address.');
      }
    };
    form.append(h('h3', {}, 'Make a feed'), fields, row('calendar-label', 'Name', label), row('calendar-days', 'Expires after (days)', days), h('div', { class: 'calendar-row' }, make), result);
    dialog.append(h('h2', { id: 'calendar-dialog-title' }, title),
      h('p', { class: 'calendar-intro' }, 'A feed is a link a calendar app subscribes to. It shows the records of one layout the way you see them: no one sees more through it than you do. The link itself is the key, though: whoever has it can also read every record and field of that layout you can see, not only the ones the calendar shows. Share it as you would a password, and revoke it when it is no longer needed.'),
      h('h3', {}, 'Feeds'), list, form, h('div', { class: 'actions' }, status, h('span', { class: 'spacer' }), close));
    await Promise.all([load(), reload()]);
  } else {
    const file = h('input', { id: 'calendar-file', type: 'file', accept: '.ics,text/calendar' }) as HTMLInputElement;
    const go = button('Import', () => void run(), { class: 'primary' });
    const run = async () => {
      const chosen = file.files?.[0];
      if (!chosen) {
        status.textContent = 'Choose an .ics file.';
        file.focus();
        return;
      }
      if (!picks.start.value) {
        status.textContent = 'Choose the date or timestamp field that gets each event\'s start.';
        picks.start.focus();
        return;
      }
      if (chosen.size > 8 * 1024 * 1024) {
        status.textContent = `${chosen.name} is more than the 8 MB one import takes.`;
        return;
      }
      go.disabled = true;
      status.textContent = 'Importing…';
      try {
        const done = await api.importCalendar(layoutPick.value, { ...(values() as Record<string, string>), zone: zone.value.trim() }, await chosen.text());
        status.textContent = importSummary(done);
      } catch (e) {
        status.textContent = (e as Error).message;
      } finally {
        go.disabled = false;
      }
    };
    dialog.append(h('h2', { id: 'calendar-dialog-title' }, title),
      h('p', { class: 'calendar-intro' }, 'Reads an .ics file into the layout\'s table: one new record for each event, all of them or none. Repeating events make one record for each occurrence.'),
      fields, row('calendar-file', 'File', file), h('div', { class: 'actions' }, status, h('span', { class: 'spacer' }), button('Cancel', () => dialog.close()), go));
    await load();
  }
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    // Not while an address is showing: it is shown once, and a stray click would lose it.
    if (e.target === dialog && !dialog.querySelector('#calendar-address')) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  layoutPick.focus();
}
