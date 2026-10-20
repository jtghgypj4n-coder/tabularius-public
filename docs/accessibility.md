# Accessibility

How Tabularius's own pages, the admin console (`/admin/`) and the web client (`/app/`, with
the pages it opens), measure against **WCAG 2.2 level AA**. It covers what was checked,
what was fixed, and what is still open. The rules new work follows are in
[design-guide.md](design-guide.md) under "Motion and accessibility".

A FileMaker layout is drawn as its file defines it: its colours, sizes and tab order
belong to the file. Tabularius is responsible for everything around the layout, and for
making the layout's fields, buttons and panels reachable and named.

## How it was checked

`npm run a11y:web` (`scripts/a11y-web.ts`) runs the audit. Like `npm run smoke:web` it is
opt-in and makes no network calls. It hosts a small database it builds in memory, so it
needs no fixtures. It drives the preinstalled Chromium with the `playwright-core` and
`axe-core` dev dependencies (it never downloads a browser). It runs in light and dark
mode, at 1440px and at 390px, with reduced motion on. On each page it does the following:

- **axe-core** runs with the WCAG 2.0, 2.1 and 2.2 A and AA rules. These cover names,
  labels, contrast, ARIA, landmarks and target size.
- **A Tab walk** goes from the top of the page to the end. It fails any stop that has
  no visible focus indicator, no accessible name or no size, or that sits in hidden
  content or under a sticky bar (2.4.11).
- **A reduced-motion check** fails any transition, animation or smooth scrolling that is
  still running.
- **Keyboard paths in the web client:**
  - Enter on a menu title moves focus into the menu.
  - Down moves to the next item.
  - Escape closes the menu and puts focus back on its title.
  - Pressing List from the keyboard keeps focus on List.
  - The first Tab stop is a skip link that moves focus to the layout.

The pages it checks:

- the admin console, signed out and signed in;
- the web client's sign-in screen;
- a layout in Form, List and Table view;
- Design, Security, Dashboards, Automations, Clean Up Data, Data Viewer and Script
  Debugger.

Two read-throughs of the code covered what a scan of a page at rest can't see: menus,
dialogs, popovers, toasts, live regions, content redrawn on a timer, and states shown by
colour alone.

Exit code 0 means nothing new was found. Findings listed under "Known" below are printed,
but they don't fail the run.

## Fixed

### Web client announcements

The web client keeps one polite, atomic live region for concise state changes. Its
announcer collapses a burst inside 180 ms to the latest message, which avoids reading
every intermediate record while someone holds a navigation key. It announces record
position, found-count changes, applied sorts, successful and failed saves, Browse, Find,
Layout and Preview mode, portal row creation and deletion, and offline-sync progress and
outcome. E2e tests inspect Chromium's accessibility tree for the spoken status after each
kind of action.

Announcements use counts and generic state only. They never include field values, field
names, sort criteria or portal contents, including values from hidden fields. Detailed
errors remain available through the existing error UI.

### Both pages

- **Focus ring.** The ring was a 3px accent at 35% opacity, about 1.7:1 against the
  panel. It is now a 2px panel gap and then 2px of accent, at least 3:1 in both themes
  (1.4.11, 2.4.7).
- **Windows high contrast.** Box-shadow rings disappear in forced-colors mode, so every
  focused control there now gets a real outline. This includes the admin's text fields,
  where a more specific rule had been removing it.

### Colour schemes, forced colours, more contrast, reduced motion and paper

`packages/web/e2e/media-features.e2e.ts` opens the admin console, the web client and its stand-alone pages (design, security, debugger, data viewer) in Chromium with each setting emulated and reads the styles the browser resolved. It checks text against its real background (4.5:1, 3:1 for large text, from the colours the browser computed, not from the tokens), a visible indicator on the first 40 Tab stops (an outline in forced colours, where shadows are dropped; an outline or ring otherwise), and for reduced motion that no element declares a transition or animation longer than 0.01 ms, nothing is running and scrolling is not smooth. It also checks that the test can fail: without the preference the pages do declare transitions and the pull-to-refresh spinner does turn. The layout canvas is the file's own and is left out of the contrast reads.

What it found, and the fix (CSS only):

- **Toolbar and status-bar buttons showed no focus ring.** `.toolbar button.tb` and the status bar's zoom, "Status Toolbar" and Find/Layout/Preview buttons set `box-shadow: none` with a more specific selector than the focus rule, so a keyboard user saw no ring in any scheme. Each now has its own `:focus-visible` rule. (axe-core does not catch this, so the Tab walk in `npm run a11y:web` looked only at some of them.)
- **Printing from a dark screen gave light text on white.** The pages take the dark palette from `prefers-color-scheme`, which still applies on paper, so a printed page, the handover memo and the documentation export among them, came out pale grey on white. A print block in `tokens.css`, the admin console's inline copy and `app.css` puts the light palette back, in black ink with no shadows.
- **The admin console printed its top bar, section list and every button.** On paper it now prints only the sections, as a flowing document with the table text wrapping and table headings repeating.
- **No support for more contrast.** `prefers-contrast: more` darkens the muted and faint text, the borders and the status colours (and lightens them in the dark palette), and makes the focus ring 3px of accent instead of 2px. The other settings were already in place and still pass the new test: dark mode, forced colours (real outlines; the pages do not switch off forced-colour adjustment outside the layout canvas), and reduced motion.
- **Generated dashboards and the landing page lost their headings in forced colours.** Their headings and numbers are gradient text (`color: transparent` clipped to a background), and forced colours removes the background, leaving transparent text. Forced colours now sets them to the system text colour.

There is no theme switch in any of the pages, so there is nothing for a choice to override: the system setting is the only control.

### Admin console

- **Lists on a timer.** Connected clients, records in use, hosted files, schedules,
  backups, uploads, the profiler, slow finds, AI use, digests and the outbox refresh
  every 5–30 s. Each refresh rebuilt the list and dropped keyboard focus to the page. A
  list is now redrawn only when it has changed, and focus goes back to the same control
  (2.4.3, 2.2.2).
- **Row actions.** Row buttons now name what they act on, for example "Revoke the token
  for Ada", "Run Nightly now" or "Sign out Ada on iPhone". Runs and Read expose
  `aria-expanded`.
- **Results and errors.** These are now announced:
  - the result lines for restore, account health, View as, access, compare and least
    privilege use `role="status"`;
  - load errors in the dependency map and the security and audit logs use
    `role="alert"`.
- **The welcome upload.** It used to read its percentage aloud twice a second. Now only a
  change of step is announced (Uploading, Converting, Hosted, Couldn't host).
- **The conversion guide.** It used to be read out whole as it arrived. Now focus moves to
  the start of the guide, and Close returns focus to the file's Guide button.
- **Severity dots and Yes/No badges.** Severity was shown by colour alone, and the reasons
  only on hover. Screen readers now hear the severity word and the reason (1.4.1, 1.3.1).
- **Smaller fixes:**
  - The log filters (Log, Type, Contains) have visible labels.
  - Column headers that said "Actions" now say "Step text" or "Select".
  - The passphrase dialog reads its help text.
  - Smooth scrolling is off with reduced motion.
  - Focus moves to the console after signing in.

### Web client

- **Design canvas keyboard (2.1.1).** Tab / Shift+Tab selects the next / previous
  object, following the layout's tab order first, then top-to-bottom, left-to-right
  reading order for the remaining objects. Traversal includes locked objects and
  visible portal, button bar, panel and popover contents; groups are selected as a
  unit. At either end, Tab leaves the canvas instead of trapping focus.
  Arrow keys move the selection by 1 point; Alt+Arrow resizes from the right or
  bottom edge by 1 point (Shift makes either operation 10 points). Locked objects
  stay unchanged, sizes have a 4-point minimum, and resizing supports Undo/Redo.
  A persistent polite live region announces each selected object's kind, name,
  position and size, including changes from movement and resizing. The canvas
  has a focus ring and an accessible description of its keys; painted fields
  stay out of the editing Tab path. `packages/web/e2e/layout-keyboard.e2e.ts`
  checks traversal, resizing and announcements with browser key events.
- **Menus.** Menu items could only be used with a mouse. Menus now follow the WAI-ARIA
  menu-button and menu keys:
  - Enter, Space or Down on a title opens its menu;
  - the arrow keys, Home and End move between items;
  - Right opens a submenu and Left closes it;
  - Left and Right at the top level move to the menu beside;
  - Escape and Tab close the menu.

  Titles and submenus expose `aria-expanded`. Disabled items use `aria-disabled`, and
  ticked items are `menuitemcheckbox` with `aria-checked` (2.1.1, 4.1.2).
- **The toolbar.** Pressing Form, List, Table, ‹ › or zoom rebuilt the toolbar and lost
  focus. Focus now stays on the same control.
- **Skip link and landmark.** A "Skip to layout" link now comes first, and the layout is
  the page's `<main>` (2.4.1).
- **Layout fields.** Fields now carry their field name as their accessible name.
  Repetitions are numbered. A set of check boxes or radio buttons is a named group, and a
  lone check box drawn without its value is named by that value. Table view cells are
  named by column and record number, and sorted columns carry `aria-sort`.
- **Layout objects set up as buttons.** Text and pictures with a button action can now be
  reached with Tab, have the button role, and run on Enter or Space. Icon-only buttons are
  named by their label, tooltip or action, and their icons are hidden from screen readers.
- **Tabs, slides and button bars.** These say which panel or segment is in front
  (`aria-pressed`). Slide dots are named "Slide 2 of 4", or by the panel's name.
- **Popovers.** Focus moves into a popover when it opens and goes back to its button when
  it closes. A popover is a dialog named by its title.
- **The assistant.**
  - The conversation used to be re-read on every streamed step. Now the finished answer is
    announced once.
  - Closing the panel puts focus back on Ask AI, which exposes `aria-expanded`.
  - While it works, the status region says each step ("Looking at layout "Orders"…"); the
    finished answer is then said once (cut at about 1,200 characters, the rest is in the
    conversation). A failure is said at once through an alert region, with what kind it is
    (blocked by policy, budget used up, provider not answering, no connection, session ended).
  - Stop is the button and Escape in the question box. Ticking, opening a step or pressing
    a button never moves the focus. A modal dialog (Escape cancels, the safe choice has the
    focus) asks before deleting design objects or running a plan step that changes records.
- **Toasts.**
  - Toasts are added to a live region that is in the page from the start. A region added
    already holding its text is often not read out.
  - Errors use `role="alert"`.
  - A toast no longer goes away while the pointer or keyboard focus is on it.
- **Administrator messages.** A message from the administrator now takes focus, and
  Dismiss returns focus to where it was.
- **Layout canvas in dark mode.** A layout part with no fill showed the dark page behind
  FileMaker's dark text, at a contrast of 1.07:1. The layout area is now white, as in
  FileMaker.
- **`hidden` means hidden.** Some components' own `display` rules made hidden controls
  visible and reachable with the keyboard, such as Edit and Delete on Dashboards with no
  dashboard open. Hidden content is now hidden on every page.
- **Dashboards.**
  - The "Updated" time no longer announces itself every 15 s.
  - The page doesn't refresh while the keyboard is inside it.
  - Charts without a title are named by what they show.
  - The × button that removes a request is named.
- **Smaller fixes:**
  - Every page declares `color-scheme`.
  - The view buttons (Form, List, Table) and the field focus rings are visible.
  - Header cells that had no text have screen-reader text.
  - Insert File and Show Custom Dialog are named.
  - The sort order and zoom buttons say what they do.
- **Table view headings from the keyboard.** A column heading takes focus. Enter or Space
  sorts by it, ⌥← / ⌥→ (Alt with the arrows) move the column, and ⇧← / ⇧→ make it
  narrower or wider, as dragging does.
- **Slide controls with hidden dots.** The dots are still there for the keyboard and
  screen readers, and show while one has the focus, so the slides can be changed
  without swiping.
- **Pausing and undoing.**
  - The admin console has a Pause updates switch in its header (2.2.2). While it is on,
    the lists aren't refreshed, so a screen reader's place in one stays put. Resuming
    refreshes at once.
  - Edit > Undo and ⌘Z / Ctrl+Z outside a field run the Undo of the toast that is showing,
    such as a deleted record's (2.2.1). In a field, they undo the typing as before.
- **Fields named by their labels.** A field is named by the text label drawn just left of
  it on its row (within 60 points) or just above it (within 24 points), in the same part,
  group or panel, without a trailing colon. A field with no such label is named by its
  field name. Only plain one-line text counts as a label.
- **Names and landmarks.**
  - A field in a portal row is named with its row ("Item, row 2"; "Item, new row" in the
    empty row for a new related record), since every row repeats the same fields.
  - A popover button has `aria-haspopup="dialog"` and an `aria-expanded` that follows
    the popover.
  - Clean Up Data's merge boxes name their records ("Merge record 7 into record 3").
  - The admin's Backup button's progress and result are announced by a status line.
  - Design, Security, Data Viewer and Script Debugger have their title as an `<h1>`, and
    Data Viewer and Script Debugger have a `<main>`.
  - "Write it again" in the conversion guide keeps the focus on its button while it
    rewrites, then moves it to the new guide.
  - Menu shortcut hints (⌘S and the like) are 80% opaque, not 60%, so they keep 4.5:1
    against the menu. axe found it with a menu open; the page-load audit never opens one.
  - `packages/web/e2e/a11y-states.e2e.ts` runs axe on states the page-load audit doesn't
    reach: Find mode, List and Table view, open menus, the Sort and Keyboard Shortcuts
    dialogs, the three Manage screens, and the phone layout with its Menu open. It also
    checks that a dialog takes keyboard focus, keeps Tab inside, and closes on Escape.
  - The pages Modernize interfaces generates (list, record form, list with the form beside it,
    cards view) had white text on the accent colour in dark mode and an accent that was too
    light for its tinted background in light mode, for most table names (the colour comes from
    the name). The accent is darker in light mode, lighter in dark, and the primary button's
    text follows it. `packages/web/e2e/generated-pages-a11y.e2e.ts` runs axe on those pages
    (with made-up records), the dashboards and the landing page, in light and dark, on a phone
    width, and for table names whose colours are the hardest for contrast. It checks
    contrast, names and structure, not how a screen reader reads the page.

## Still open

These were found but not fixed here, ordered roughly by impact.

1. **Desktop layouts that are scaled, not stacked (2.5.8 Target Size).** Windows narrower
   than 640 points (the server's setting in the admin console) stack a layout in one column
   unless the layout sets its own breakpoint, so a desktop layout no longer shrinks to fit a
   phone. A layout that sets 0 for "never stack", or an administrator who sets the server's
   width to 0, still gets the scaled layout: its fields shrink to about 10px high at 390px.
   Each field then takes taps in invisible strips above and below it, up to 24px in all, but
   only into the empty space around it: fields packed closer than that, and buttons, stay
   small. The real fix belongs in the file: a phone layout, which Design mode can make from
   the desktop one. The audit lists this under "Known".
2. **Layout contrast is the file's (1.4.3).** Tabularius draws a layout's own colours, so a
   file with low-contrast text fails. A field whose label is placed anywhere other than
   just left of it or just above it is named by its field name (2.5.3).
3. **Design mode's remaining pointer operations.** Object traversal, movement and
   resizing now work from the keyboard. Dragging part boundaries, reparenting by
   dragging and the Set Tab Order pointer workflow still need a keyboard review.
4. **Paper is checked in Chromium's print emulation only.** The test sets the print media type and makes a PDF; it does not look at page breaks in a long table or at what another browser's print preview does. The web client's layout print path (the Preview sheets) is unchanged and is the file's own look. The stand-alone design, security, debugger and data viewer pages are tools, not reports: they print in black on white, but with their toolbars.
5. **Generated pages are a fixed dark design.** The dashboards and the landing page the layout templates write do not follow `prefers-color-scheme` (their gradients and colours are one dark palette); forced colours and print are covered, more contrast is not, and the chart bars keep their gradient fill in forced colours.
6. **Not tested with assistive technology yet.** No one has used the pages with
   NVDA/JAWS, VoiceOver or TalkBack, or with Windows high contrast turned on. The checks
   above are automated or read from the code. Find and Preview modes, the import dialog
   and the field context menu were reviewed in code only.
