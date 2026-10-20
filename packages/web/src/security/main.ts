// Manage Security: accounts, privilege sets and API tokens in the browser.
// Like FileMaker's Manage Security, but its own area; it reuses the design
// pages' small DOM helpers and styles. Full access only (the server enforces
// it); log in through the web client first.

import { SecurityClient, SecurityError, type Change, type Security } from './client.ts';
import { h, button, toast } from '../design/dom.ts';
import { AssistantPanel, assistantInfo, type AssistantContext } from '../assistant.ts';
import { accountsTab } from './accounts.ts';
import { privilegeSetsTab } from './privilege-sets.ts';
import { extendedPrivilegesTab } from './extended-privileges.ts';
import { tokensTab } from './tokens.ts';
import { signinTab } from './signin.ts';
import { plainMessage } from '../http-problem.ts';

export interface Sec {
  client: SecurityClient;
  security: Security;
  /** Apply a batch of changes; true when they were made. Errors are shown. */
  apply(changes: Change[], done?: string): Promise<boolean>;
  /** Replace the loaded security after a call that already returned it. */
  set(security: Security): void;
  /** Selection within a tab (an account, a set), kept across re-renders. */
  selected: Record<string, string | undefined>;
  render(): void;
  /** Asks the AI assistant a question in its panel (when the server has one). */
  ask?: (question: string) => void;
}

/** An "Explain with AI" button, when the assistant is on. */
export function explain(sec: Sec, question: string): HTMLElement[] {
  return sec.ask ? [button('Explain with AI', () => sec.ask!(question), { title: 'Ask the assistant what this allows' })] : [];
}

type TabId = 'accounts' | 'sets' | 'extended' | 'tokens' | 'signin';
const TABS: [TabId, string, (s: Sec) => HTMLElement][] = [
  ['accounts', 'Accounts', accountsTab],
  ['sets', 'Privilege sets', privilegeSetsTab],
  ['extended', 'Extended privileges', extendedPrivilegesTab],
  ['tokens', 'API tokens', tokensTab],
  ['signin', 'My sign-in', signinTab],
];

const app = document.getElementById('app')!;

export function errorText(e: unknown): string {
  if (e instanceof SecurityError) return `${e.message} (error ${e.code})`;
  return plainMessage(e);
}

function session(): { db: string; token: string } | undefined {
  try {
    const saved = sessionStorage.getItem('tabularius.session');
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

async function start(): Promise<void> {
  const s = session();
  if (!s) {
    app.replaceChildren(h('div', { class: 'd-empty' }, h('p', {}, 'Log in to a file first, then open Manage Security.'), h('a', { href: './' }, 'Log in')));
    return;
  }
  const client = new SecurityClient(s.db, s.token);
  let security: Security;
  try {
    security = await client.security();
  } catch (e) {
    const msg = e instanceof SecurityError && e.code === 952 ? 'Your session ended. Log in again, then open Manage Security.'
      : e instanceof SecurityError && e.code === 9 ? 'Manage Security needs an account with full access.'
      : errorText(e);
    app.replaceChildren(h('div', { class: 'd-empty' }, h('p', {}, msg), h('a', { href: './' }, 'Back to the file')));
    return;
  }

  let tab: TabId = (/^#(\w+)/.exec(location.hash)?.[1] as TabId) ?? 'accounts';
  if (!TABS.some(([id]) => id === tab)) tab = 'accounts';
  const nav = h('nav', { class: 'd-tabs', role: 'tablist' });
  const body = h('main', { class: 'd-body' });
  const title = h('h1', { class: 'd-title' });

  const sec: Sec = {
    client,
    security,
    selected: {},
    async apply(changes, done) {
      try {
        sec.security = await client.change(changes);
        if (done) toast(done, 'info');
        sec.render();
        return true;
      } catch (e) {
        toast(errorText(e));
        return false;
      }
    },
    set(next) {
      sec.security = next;
      sec.render();
    },
    render() {
      title.textContent = sec.security.database;
      document.title = `${sec.security.database} · Security`;
      nav.replaceChildren(...TABS.map(([id, label]) =>
        button(label, () => {
          tab = id;
          history.replaceState(null, '', `#${id}`);
          sec.render();
        }, { role: 'tab', 'aria-selected': String(id === tab) })));
      const make = TABS.find(([id]) => id === tab)![2];
      try {
        body.replaceChildren(make(sec));
      } catch (e) {
        body.replaceChildren(h('p', { class: 'd-empty' }, errorText(e)));
      }
    },
  };

  const header = h('header', { class: 'd-header' },
    h('span', { class: 'd-mode' }, 'Security'), title, nav,
    h('span', { class: 'd-spacer' }),
    h('a', { class: 'd-back', href: './' }, 'Back to browse'),
  );
  const shell = h('div', { class: 'd-shell' }, header, body);
  app.replaceChildren(shell);
  sec.render();

  // The AI assistant: reviews and explains accounts and privilege sets (it can't change them).
  const info = await assistantInfo(s.db, s.token);
  if (info.available) {
    const context = (): AssistantContext => {
      // What the tab shows: the picked item, else the first one.
      const account = sec.selected.account ?? sec.security.accounts[0]?.name;
      const set = sec.selected.set ?? sec.security.privilegeSets[0]?.name;
      const selection = tab === 'accounts' && account ? [{ kind: 'account' as const, name: account }]
        : tab === 'sets' && set ? [{ kind: 'privilege set' as const, name: set }] : [];
      return { mode: 'security', security: { tab: TABS.find(([id]) => id === tab)![1], selection } };
    };
    const panel = new AssistantPanel(s.db, s.token, context);
    header.insertBefore(button('Ask AI', () => panel.toggle(), { class: 'd-ai' }), header.lastElementChild);
    shell.classList.add('with-ai');
    shell.append(panel.element);
    sec.ask = (question) => panel.askAbout(question);
    sec.render();
  }
}

start().catch((e) => app.replaceChildren(h('p', { class: 'd-empty' }, `Couldn't start: ${errorText(e)}`)));
