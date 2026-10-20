# The alternative client (/next/)

A second way into a hosted file, next to the classic client at `/app/` (which is unchanged). It doesn't
draw the file's layouts. Each table the account can open becomes a **collection**: a list, and a record
panel beside it. Every command goes through one bar (⌘K / Ctrl K).

- **Where the screens come from.** The client reads every layout in the layout menu, groups them by table,
  and reads each table through the layout that shows most of its fields (visible layouts first). Keys and
  ids are kept out of lists and shown under Details; a "name" or "title" field names each record; a
  container field gives it a picture; the layout's portals become related lists, and a related row opens
  its own record when its table is one of the collections. Where the relationship allows it, Add types a new
  related record in place under the list (Enter saves it, Escape drops it). Tables whose name says
  they're utility (`_`, `zz`, settings, globals) or whose layouts are all hidden go under More.
- **No modes.** Click a value to edit it; it saves when you leave it (Enter, or ⌘Enter in long text),
  Escape takes it back. A field the layout shows with a value list becomes a picker: a menu for pop-up
  menus and radio buttons, toggles for checkboxes, suggestions for drop-down lists. A value list of related
  values offers the open record's own related values. Typing in the search field narrows the list; `field: value` becomes a filter chip,
  with FileMaker's find syntax in the value (`total: >500`).
- **Board.** A collection with a field shown as a pop-up menu or radio buttons (up to 12 values) can be shown
  as a board instead of a list: a column per value, records as cards. Dragging a card to another column
  changes its value (or Shift and an arrow key, from the keyboard); a click opens it. List and Board sit quietly beside the title, and the command bar can
  group the board by any such field. A saved view remembers the board.
- **Saved views.** A list narrowed by a search, chips, a sort or an answer's chip shows Save view: it is
  named in place and listed under its collection in the sidebar (and in the command bar). Changing a saved
  view's list offers Update; the command bar deletes one. Saved views are kept in this browser, per file and
  account.
- **Several records at once.** Hovering a row shows a box to pick it (Shift picks a run; `X` picks the row
  the keyboard is on). While any are picked, a tray over the list says how many and offers Set a field (one
  value into every picked record), Delete (after asking) and Select all shown; Esc clears the picks.
- **Pictures and files.** The record's picture sits at the top of the panel: click it to pick a new one, or
  drop one on it. Other container fields show their file by name (with a thumbnail for pictures) and open it
  with a click; drop a file on the field, or use Replace, Add or Remove.
- **Asking.** When the server runs the assistant (`serve --ai`), anything typed in the command bar can be
  asked (Tab, or Enter when it reads as a question). The answer shows in the side panel with room for a
  follow-up; records it found show in the list as one chip that says what they are. It reads only.
- **Pages.** A layout that is one web viewer (a modern layout: a page in HTML, CSS and JavaScript, see
  [web-client.md](web-client.md)) is listed above the collections as a page, and fills the window under its
  name. With "Allow JavaScript to perform FileMaker scripts" on, it gets `window.tabularius` and
  `FileMaker.PerformScript`, answered as the signed-in account, exactly as in `/app/`. **Edit page** (or ⌘K,
  Edit this page…) opens its code beside a preview that follows the typing; Save keeps it in the layout, in the
  web viewer's address formula (`packages/web/src/page-source.ts`, shared with the classic client's page
  editor), so FileMaker Pro opens the same layout. ⌘K, **New page…** makes one on the open table that lists
  its records. Saving is a design change, so an account that may not design layouts is told so.
- **Keys.** ⌘K the command bar, `/` search, `N` new record, `J`/`K` next and previous, `X` pick, Esc closes.
- **Same rules as everywhere.** Records go through the Data API with the account's privileges. The sign-in
  is shared with `/app/` in the same browser tab.
- **The look.** Its own small system in `packages/web/next/next.css` (one system sans, tinted neutrals,
  one accent), following the Operate mode of Impeccable. Each file wears its own hue, picked from its name.

Not there yet: saved views shared between people or browsers.

Tests: `packages/web/test/next-client.test.ts` and `packages/web/e2e/next.e2e.ts`.
