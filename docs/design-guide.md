# Tabularius design guide

How Tabularius's own web pages look: the admin console (`/admin`), the web client's
chrome around a FileMaker layout (`/app`), and any page added later. The layouts
inside a FileMaker file keep their own look; this guide is for everything around them.

The tokens live in `packages/web/tokens.css`: link it before a page's own stylesheet
(every page under `/app` does). The admin console carries the same block inline, because
its content security policy allows no stylesheets; `packages/server/test/design-pages.test.ts`
fails if the two drift apart. Pages the server builds itself (error pages, the
certificate trust page) take the tokens from `pageCss()` in `packages/server/src/pages.ts`.

The rules follow the "Operate" mode of [Impeccable](https://github.com/pbakaus/impeccable)
(Apache 2.0), a design skill for AI coding agents: these are tools people work in, so
scanability, consistency and familiar controls come before expression. Nothing from
Impeccable is copied into the repository.

## Principles

- **Better than FileMaker Server's console, not a copy of it.** Group by what the person
  is doing (activity, files, scripts, security), keep everything one click away, and say
  what a control does in plain words.
- **Zero dependencies.** No UI framework, web font, icon font or CDN. System fonts,
  plain CSS custom properties, and small inline SVG icons drawn for the purpose.
- **One vocabulary.** A button, field, table or notice looks the same on every page.
  If two "Save" buttons look different, one is wrong.
- **Light and dark from the system setting** (`prefers-color-scheme`), with
  `color-scheme: light dark` so native controls follow.

## Logo

The mark is **Lifted stack** (the maintainer's pick): three record slabs, the top one lifted
open in the brand teal, meaning a database you can open up, move and host anywhere.
Files are in `docs/brand/`:

- `tabularius-mark.svg`: ink slabs (the middle one at 72% opacity) and a teal top slab,
  for light backgrounds.
- `tabularius-mark-one-colour.svg`: all black, for print, stamps and one-colour use
  (set `fill` to white on dark).
- `favicon.svg`: switches to the dark palette when the browser is in dark mode.

In a page, inline the mark's SVG (viewBox `0 0 32 32`) with the lower slabs in
`currentColor` and the lifted slab in `var(--accent)`, and use the favicon as a `data:` URI
`<link rel="icon">`, which needs `img-src data:` in that page's content security policy.
The wordmark is "Tabularius", always lowercase, in the system sans at weight 650 with
-0.02em tracking; give the mark at least a quarter of its width as clear space. The
mark must stay at least 16px, and it is never redrawn to look like FileMaker's
folder or the Claris mark.

The product name and mark are kept in a few named places so a new name or logo is a
small change: `PRODUCT_NAME` and `markSvg()` in `packages/web/src/brand.ts` (the web
client's sign-in and design mode's top bar), the same pair in
`packages/server/src/pages.ts` (error pages), the admin header and favicon in
`packages/server/admin/index.html`, each web page's `<link rel="icon">`, and the files
in `docs/brand/`.

## Pages

- **Sign-in screens** (`/app`, the admin console): one centred panel, the lockup above a
  heading that names the task ("Open a file"), 38px fields and buttons.
- **Error pages:** a browser asking for a page gets a designed page for 404, 401, 500 and
  503 (the server starting, which retries by itself); an app or script gets the bare
  status as before. Each says what happened and where to go next.
- **Solution documentation** ("Document this solution", `docs.ts`): a downloaded file, so
  it carries the tokens inline and works offline. One reading panel, wide tables in a
  focusable scroll region labelled by their heading, a skip link, and a print style that
  drops the chrome.

## Tokens

Defined on `:root` in the admin page; dark values override them in the media query.

| Token | Use |
|---|---|
| `--bg` | page background |
| `--panel` | sections (the only cards) and buttons |
| `--sunken` | control rows, code, drop zones, row hover, count pills |
| `--field` | text fields and pop-up menus |
| `--text`, `--muted`, `--faint` | body text; secondary text; group labels and placeholders |
| `--line`, `--line-strong` | row rules; field and button borders, table header rule |
| `--brand`, `--brand-hover`, `--brand-text`, `--brand-soft` | the brand teal. `--accent*` point at them by default; a page may set its own `--accent` (the web client's chrome still does) while `--brand` stays teal |
| `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft` | primary buttons, links, focus, current navigation item. Never decoration |
| `--ok` / `--bad` / `--warn` and their `-soft` backgrounds | status text and notices |
| `--focus` | the focus ring: a 2px gap in `--panel`, then 2px of accent, so it is at least 3:1 against what is around it in both themes |
| `--shadow`, `--shadow-raised` | sections and buttons; the sign-in card |
| `--radius` 10px, `--radius-sm` 6px | sections; buttons, fields, notices |

Neutrals are tinted slightly toward the teal accent, never pure grey. Text contrast is at
least 4.5:1 in both themes, `--muted` and `--faint` included, on every surface they sit on.

**Spacing:** `--s1`…`--s7` = 4, 8, 12, 16, 24, 32, 48px. Tight inside a group, wider
between groups, more space above a heading than below it.

**Type:** one system sans (`--sans`), mono (`--mono`) only for code, paths and log
lines. Scale `--t-xs`…`--t-2xl` = 12, 13, 14 (body), 16, 18 (section headings), 22px.
Headings weigh 650 with -0.01em tracking; numbers in tables use tabular figures.
Prose stays under 75 characters a line.

## Components

- **Page shell:** a sticky top bar (product mark, name, server details, live
  "Updated" dot, Sign out) and a sticky side navigation grouped by task. Below 900px the
  navigation becomes a scrolling row of chips under the top bar.
- **Section:** the one card type. Heading, a count pill when it has one, a line of
  explanation in `--muted`, then content. Never put a card inside a card.
- **Tables:** small muted column headings over a stronger rule, 1px row rules, a
  soft row hover, numbers right-aligned, the first column medium weight. Wide
  tables scroll inside their section.
- **Buttons:** 30px high, `--radius-sm`, panel background with a hairline shadow.
  `primary` (accent) for the one main action of a section. Actions that end something
  (disconnect, revoke, sign out a session) use `--bad` text so they can't be mistaken for
  the safe button beside them. Every button has hover, active, focus and disabled states.
- **Fields:** 30px high, `--field` background, accent border plus focus ring when
  focused; checkboxes and radios take `accent-color`. File inputs style
  `::file-selector-button` like a button.
- **Control rows** (filters above a table): a `--sunken` band holding labelled
  controls in one wrapping row.
- **Notices:** a tinted background with a hairline border of the same hue: warning
  (`--warn-soft`), error (`--bad-soft`), or neutral inside a section. No coloured
  side stripes.
- **Disclosures:** `<details>` with an accent `summary`, separated from the content
  above by a rule.
- **Empty states** say what will appear and how to get it ("No scripts are scheduled"
  next to "Add a schedule"), never just "nothing here".

## Motion and accessibility

- Transitions are 120–150ms ease-out on colour, border and shadow only; nothing
  animates on page load. `prefers-reduced-motion` turns transitions and smooth
  scrolling off.
- Keyboard focus is always visible (`:focus-visible` ring); text selection, caret and
  scrollbars take the palette. A control that redraws itself (a toolbar, a table on a
  timer) puts focus back on the same control afterwards, and a list on a timer is only
  redrawn when it changed.
- Menus open from the keyboard (Enter, Space or Down on a title) and follow the WAI-ARIA
  menu keys: arrows, Home and End, Right and Left for submenus and the menus beside,
  Escape back to the title.
- `hidden` means hidden: `tokens.css` makes it win over a component's own `display`, so a
  hidden control can't be reached with the keyboard.
- Every control has a visible label or `aria-label`; icons are `aria-hidden`. A row
  action that says only "Disconnect" or "Revoke" gets a `aria-label` naming whom or
  what it acts on, and a table column of actions gets a heading screen readers can
  hear (a `.sr-only` "Actions").
- Pages with navigation start with a "Skip to content" link, visible when focused (the
  web client's is "Skip to layout", past the menus and toolbar to the layout, its `<main>`);
  the current navigation item carries `aria-current`.
- Inputs hidden for a custom look (a file drop zone) stay focusable (`.sr-only`, never
  `hidden`), and their visible wrapper shows the focus ring with `:focus-within`.
- Messages that appear on their own (errors, results) use `role="alert"` or
  `role="status"`; things that refresh on a timer stay quiet, and so does text that
  streams in (the assistant says its finished answer once). A progress percentage goes
  in the page; only a change of step is announced.
- Colour is never the only signal: a severity dot carries its word for screen readers,
  and a reason shown on hover (`title`) is in the text too.
- Windows high-contrast (`forced-colors: active`) gets a real outline, since box-shadow
  focus rings vanish there.
- Every page declares `<meta name="color-scheme" content="light dark">` and follows the
  system's light or dark setting; dark is designed, not inverted, and passes the same
  contrast checks.
- More contrast (`prefers-contrast: more`) darkens the muted text, borders and status colours
  and thickens the focus ring; on paper (`@media print`) every page takes the light palette in
  black ink, whatever the screen's scheme. Both are in the token blocks, so a new page gets them
  by using the tokens; a control that sets its own `box-shadow` must set its focus ring too.
  `packages/web/e2e/media-features.e2e.ts` checks each (docs/accessibility.md says how).
- Check each change at 1440px, 390px (phone) and in both themes before shipping.
  `npm run a11y:web` does this for the admin console and the web client (axe-core's WCAG
  2.2 AA rules, a Tab walk, menu keys, reduced motion); `docs/accessibility.md` lists what
  it covers and what is still open.
