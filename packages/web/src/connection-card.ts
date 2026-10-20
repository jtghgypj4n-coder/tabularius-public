// The card under an assistant answer that drafted a connection to an outside service (S3, a web API, mail). The
// assistant made a draft and nothing else: here the person checks the settings, types the keys into the boxes,
// presses Test and approves it, the same steps as the admin console's Connections page. A key goes from its box
// straight to the server's sealed store: it is not kept in the page, the conversation or this card after it is set.
// A server that leaves connections to the console (started without --allow-app-connections) shows the draft to read
// and says where to finish it.

import { h } from './design/dom.ts';
import { httpProblem } from './http-problem.ts';

interface ConnectionView {
  name: string;
  type: string;
  status: 'draft' | 'active' | 'disabled';
  note?: string;
  settings: { label: string; value: string }[];
  /** Everywhere the keys can be sent, with scheme and port. */
  reaches?: string[];
  secrets: { name: string; label: string; required: boolean; set: boolean }[];
  ready: boolean;
  lastTest?: { ok: boolean; message: string };
}

const enc = encodeURIComponent;

export function connectionCard(ref: { name: string }, db: string, token: string): HTMLElement {
  const base = `/tabularius/assistant/v1/databases/${enc(db)}/connections/${enc(ref.name)}`;
  const call = async (method: string, path = '', body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json as { allowed: boolean; connection?: ConnectionView; result?: { ok: boolean; message: string } };
  };
  const card = h('div', { class: 'ai-proposal connection' });
  const status = h('span', { class: 'ai-note', 'aria-live': 'polite' });
  let allowed = false;

  const draw = (c: ConnectionView | undefined, gone = false) => {
    if (gone || !c) {
      card.replaceChildren(h('div', { class: 'ai-proposal-title' }, `Connection: ${ref.name}`), h('p', { class: 'ai-note' }, gone ? 'Discarded.' : 'This draft is no longer there.'));
      return;
    }
    const kids: (Node | string)[] = [
      h('div', { class: 'ai-proposal-title' }, `Connection: ${c.name} (${c.type})`),
      ...(c.note ? [h('p', {}, `Note written by the AI: ${c.note}`)] : []),
      h('ul', { class: 'ai-preview' }, ...c.settings.map((s) => h('li', {}, `${s.label}: ${s.value}`))),
    ];
    if (c.status !== 'draft') {
      kids.push(h('p', { class: 'ai-note' }, c.status === 'active' ? 'Approved and on. Scripts for this file can use it by name.' : 'Approved, and turned off in the admin console.'));
      card.replaceChildren(...kids);
      return;
    }
    if (!allowed) {
      kids.push(h('p', { class: 'ai-note' }, 'This is a draft and does nothing yet. This server leaves connections to the admin console: someone with its password types the keys into the Connections page (under Scripts), tests it and approves it.'));
      card.replaceChildren(...kids);
      return;
    }
    // The settings above were chosen by the AI: the keys you type go to exactly these places (a token address can be another host than the API).
    if (c.reaches?.length) kids.push(h('p', { class: 'ai-connection-reach' }, `Your keys will be sent to ${c.reaches.join(' and ')}. Check that is where they belong before you type them or press Test.`));
    for (const s of c.secrets) {
      const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: s.set ? 'Set (type to replace)' : s.required ? 'Required' : 'Optional', 'aria-label': s.label }) as HTMLInputElement;
      const save = h('button', { type: 'button' }, 'Set');
      save.addEventListener('click', async () => {
        if (!input.value) return;
        save.disabled = true;
        try {
          const r = await call('PUT', `/secrets/${enc(s.name)}`, { value: input.value });
          input.value = '';
          status.textContent = '';
          draw(r.connection);
        } catch (e) {
          status.textContent = (e as Error).message;
          save.disabled = false;
        }
      });
      kids.push(h('label', { class: 'ai-secret' }, `${s.label}${s.required ? '' : ' (optional)'} `, input, save, h('span', { class: 'ai-note' }, s.set ? ' set' : '')));
    }
    if (c.lastTest) kids.push(h('p', { class: c.lastTest.ok ? 'ai-note' : 'ai-dry-run-bad' }, `Test: ${c.lastTest.message}`));
    const test = h('button', { type: 'button' }, 'Test');
    const approve = h('button', { type: 'button', class: 'primary' }, 'Approve');
    const discard = h('button', { type: 'button' }, 'Discard');
    approve.toggleAttribute('disabled', !c.ready);
    test.toggleAttribute('disabled', !c.ready);
    const run = (button: HTMLElement, f: () => Promise<void>) => button.addEventListener('click', async () => {
      button.setAttribute('disabled', '');
      try {
        await f();
      } catch (e) {
        status.textContent = (e as Error).message;
        button.removeAttribute('disabled');
      }
    });
    run(test, async () => {
      status.textContent = 'Testing…';
      const r = await call('POST', '/test');
      draw(r.connection);
      status.textContent = r.result?.ok ? 'Test passed.' : 'Test failed.';
    });
    run(approve, async () => {
      draw((await call('POST', '/approve')).connection);
    });
    run(discard, async () => {
      await call('DELETE');
      draw(undefined, true);
    });
    kids.push(h('div', { class: 'ai-actions' }, test, approve, discard, status));
    card.replaceChildren(...kids);
  };

  card.append(h('div', { class: 'ai-proposal-title' }, `Connection: ${ref.name}`), h('p', { class: 'ai-note' }, 'Loading…'));
  call('GET').then((r) => {
    allowed = r.allowed;
    draw(r.connection);
  }, (e) => {
    card.replaceChildren(h('div', { class: 'ai-proposal-title' }, `Connection: ${ref.name}`), h('p', { class: 'ai-note' }, (e as Error).message));
  });
  return card;
}
