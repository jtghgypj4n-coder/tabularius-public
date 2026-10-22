# Design mode

Build and change a solution without FileMaker Pro: tables, fields,
relationships, value lists, custom functions, layouts and scripts. It works on
the converted store (`<name>.openhbam.sqlite`); the `.fmp12` is never written.

Three ways in, all doing the same changes:

- **Web client**: File > Manage > Database… or Manage > Layouts…, Open Quickly "Design", or Layout mode in the layout bar (or `/app/design.html`).
- **REST**: `GET /tabularius/design/v1/databases/{db}` for the whole design,
  `POST` the same URL with `{"changes": [...]}`, `GET .../history`,
  `GET .../layouts/{id}` for a layout's stored design, `POST .../check` with
  `{"formula", "occurrence"?, "table"?, "customFunction"?, "parameters"?}` to check a
  formula, `POST .../evaluate` with `{"formula"}` to run one on no record, and
  `GET .../used?name=&kind=` for where something is used. Data API session tokens.
- **MCP**: `get_design`, `get_layout_design`, `lint_layout`, `fix_layout`, `review_graph`, `arrange_graph`, `restyle_layout`, `restyle_file`, `speed_up_layout`, `change_design`, `check_formula`,
  `design_history`, `create_database`.
- **CLI**: `tabularius new <folder> <name>` starts an empty database;
  `tabularius design <folder> <db> changes.json` applies changes.

In the web client, the relationship graph works like FileMaker's: each
occurrence lists its match fields (or all its fields, with the arrow in its
header), and dragging a field onto a field of another occurrence relates them.
The New table occurrence form also lists the tables of other hosted files
that an external data source points at (when your account can design that
file too), so an occurrence into another file is made and related the same
way; the design response lists them as `tables` on each such data source.
FileMaker leaves the rest to you; here, **Tidy up** arranges the boxes (each
group from its anchor, the occurrence its layouts are based on, with buoys in
columns to the right; one change, with Undo), and **About this graph** says in
plain English how the graph hangs together (whether it follows anchor-buoy,
what each group reaches) and lists what's worth a look: occurrences nothing
uses, two relationships in one group that match the same tables the same way,
match fields that can't be indexed (globals, unstored calculations, summaries,
containers) or have indexing off, and missing tables or fields. Clicking one
outlines its boxes; **Explain with AI** hands it all to the assistant.
`GET .../graph` returns the same (`summary`, `groups`, `issues`, and `arrange`,
the changes that tidy it); MCP has `review_graph` and `arrange_graph`.
The layout editor adds fields, text, shapes (rectangle, rounded rectangle,
oval, line), buttons, button bars, popovers, portals, tab controls, slide
controls and web viewers (the address is a formula).

A button runs a script, or does one script step, written as the step's line in
the Script Workspace (`Go to Layout [ original layout ]`, `Set Field [ T::F ; 1 ]`);
the server stores it as that step with its parameters, and the web client runs
it. A field's **Data** section has FileMaker's Inspector Data tab: control
options (calendar icon, drop-down arrow, auto-complete, an "Other..." item,
concealed edit box, vertical scroll bar), repetitions shown, field entry in
Browse and Find mode, select on entry, the keys that go to the next object
(Tab, Return, Enter), Include in Quick Find, number, date and time formats, and
the container format (crop, reduce, enlarge, or reduce or enlarge to fit).
The concealed edit box, scroll bar and Return/Enter settings are read from
.fmp12 files by inference from private sample files (FieldObj flag bits 21, 8, 6
and 7), not yet checked against a FileMaker Design Report. "Hide object when" <!-- known-difference: Reading .fmp12 files ;; The concealed edit box, scroll bar and Return/Enter settings are read from private sample files by inference (FieldObj flag bits 21, 8, 6 and 7), not checked against a FileMaker Design Report ;; A converted field can show these options differently from FileMaker ;; A Design Report of a file that uses those options -->
has its "Apply in Find mode" option, popovers a title bar and title, slide
controls their dots and swipe, and buttons, popovers, portals and web viewers
take OnObjectEnter and OnObjectExit triggers. The layout inspector sets the view
a layout opens in and its Table View columns (fields, order and widths).

Button icons and pictures come from the file's image library (the images read
from the .fmp12, plus any uploaded: PNG, JPEG, GIF, WebP or SVG). A button's
**Icon** section picks one, its size and where it sits beside the label;
**Picture** on the toolbar places one. `GET /images` lists the library with
signed URLs and `POST /images` (`{filename, mime, data}` in base64) adds one;
SVGs are served with a policy that keeps them from running scripts.

**Chart** places a column chart of the found set. Chart Setup sets the type
(column, bar, stacked, line, area, pie, scatter, bubble), where the data comes
from (the found set, summarized or not; the current record's delimited lists;
related records), the titles, the value axis's bounds, and each series' values,
name, x values and bubble sizes. Every text is a formula. Its Appearance sets the
background gradient and each text's size and color (title, legend, axis labels
and titles), as read from .fmp12 files.
**Fields…** is FileMaker's Field Picker: tick several fields of one occurrence
(they go on in the order ticked), stacked down or across, with labels to the
left, on top, or none.
With a portal selected, Add field puts the field in the portal's first row;
dragging any object into a portal's first row or onto a tab control puts it
there, and dragging it out takes it back out. A popover opens while its button or
anything in it is selected; new objects go into the open popover. The first
click on a button bar selects the bar, the next selects a segment (to set its
script). Button Bar Setup sets the orientation, each segment's label (text or a
calculation) and the active segment (one segment, or a calculation returning a
segment's object name). A portal's inspector sets its sort order and a
filter formula (rows show only when it's true; the portal's own fields mean
that row's), and Portal Setup's options: allow deleting rows, vertical
scrolling, a scroll bar only while scrolling, and the alternate and active row
states. A web viewer's inspector has Web Viewer Setup's options (interaction,
content in Find mode, progress bar, status messages, URL encoding, JavaScript
bridge); they're read from .fmp12 files. In the web client "Display content in
Find mode" decides whether the page shows in Find mode (off, the viewer is
blank there), and the progress bar and status line under the content area show
while a page loads. Conditional formatting is set in the inspector:
a formula, or "Value is" (equal to, between, containing, empty, ...; kept as the
same formula on `Self`), with the text color, fill, bold, italic, underline,
strikethrough and size to use when it's true. Tab Control Setup sets the tabs'
justification, width (fixed, or each as wide as its label) and height.

Arranging, as in FileMaker's Arrange menu and Inspector:

- **Align** left, centre, right, top, middle or bottom; **distribute** three or
  more objects evenly across or down; make them the same width or height.
- **Group** (⌘R) and **ungroup** (⇧⌘R). A group moves and resizes as one, and
  what's in it scales with it.
- **Lock** (⌘L) and **unlock** (⌥⌘L). A locked object can be selected and
  copied but not moved, resized or deleted. Locks are read from .fmp12 files.
- **Bring to front** (⇧⌘]), **forward** (⌘]), **backward** (⌘[) and **send to back** (⇧⌘[), for one object or several.
- **Cut** (⌘X), **copy** (⌘C) and **duplicate** (⌘D).  Right-click an object for the same commands (plus Bring to Front, Send to Back, Group, Lock and Delete); right-click empty canvas to Paste. Cut copies the objects as FileMaker XML and removes them; locked ones stay. Undo brings them back.
- **Grid**: show it, snap to it, and pick its spacing. Alt moves freely.
- **Dynamic guides**: a dragged object snaps to other objects' edges and centres,
  with a line showing which.
- **Equal spacing** (not in FileMaker): with no edge to line up with, a dragged
  object snaps to the gap two of its row's or column's neighbours already have,
  and markers show both gaps.
- **Undo history** (not in FileMaker): the menu beside undo and redo lists
  every step since the layout opened, named by what it changed ("Moved 4
  objects", "Changed appearance of Customers::Name"). Pick a step to go back or
  forward to it; each step stays undoable.
- **Versions** (not in FileMaker): every save of the layout in Tabularius, from
  the design log however long ago (`GET .../layouts/{id}/history`; the
  file's History tab shows only the latest changes), with what each save changed and how it differs from
  what's open. **Open this version** brings one back as unsaved edits (Save
  keeps it, Undo drops it). Changes before the layout's first full save here
  aren't listed. Each save comes with a picture of the layout before and
  after it, with what it added (green), removed (red) and changed (amber)
  outlined.
- **Responsive layouts** (not in FileMaker): Layout Setup's **Stack in one
  column below** takes a window width; left empty, the layout follows the
  server's setting (640 points unless the administrator changes it in the
  console under Connected, beside the session timeouts, or sets it to 0), and 0 on the layout never stacks it
  (a phone layout made from a desktop one has 0, as it is one column already).
  In narrower windows the web client
  puts each part's objects one under another in reading order (rows top to
  bottom, each left to right) instead of shrinking the layout. Fields,
  buttons, web viewers and charts fill the width; text, portals, tab and slide
  controls and groups keep their size (up to the window's) with what's inside
  them; shapes drawn behind other objects are left out. Each object's
  **Hide in windows narrower than** hides it on small screens, with or without
  stacking. Preview mode and printing use the layout as designed. In
  `updateLayout` they are `responsive: {stackBelow}` on the design (`{}`
  clears it, so the layout follows the server's setting again; `stackBelow: 0` never stacks it) and `responsive: {hideBelow}` on an object.
  The toolbar's width menu (**Phone · 390**, **Tablet · 768**,
  **Desktop · 1280**) previews the layout as a window that wide shows it,
  with editing paused until you pick **Edit** again; Layout Setup changes
  show in the preview as you make them. At phone width a stacked layout
  offers **Make a phone layout** (also on each layout in the Layouts list):
  a new layout, "<name> (phone)", stacked in one column with fields and
  buttons at least 44 points tall so they're easy to tap. It follows the
  desktop layout: change that and the phone layout is rebuilt in the same
  step, until the phone layout is edited by hand. The Layouts list says
  which it is doing, with **Rebuild from "<name>"** to start following again.
  **Phone** in the toolbar shows the phone version beside the layout as you
  edit it: the phone layout made from it (as it will be after Save, or as it
  was edited by hand, with **Rebuild from this layout**), or what one would
  show, with **Make phone layout**. `POST .../layouts/{id}/phone` with
  `{"design"?}` returns the same (`phone`, and `existing` with `following`).
  Ops: `createLayout {name, phoneOf, width?}` and `updateLayout {layout, rebuildPhone: true}`.
- **Layouts with AI** (not in FileMaker): describe a layout under the
  Layouts list ("a list layout of unpaid invoices with customer and total")
  and **Design with AI**, or use **Change with AI** in the layout editor. The
  assistant builds it from the file's real tables and fields and proposes it
  in its panel with a picture of the layout as it would be (before and after,
  with what changes marked, when it changes one), drawn as the editor draws
  it. Check runs on the proposed layout first, and the assistant hears what
  it found so it can tidy its own draft; serious findings still left show
  under the picture. **Apply** makes it (one step in the design history,
  which **Undo** takes back), **Open in layout editor** then opens it to
  adjust by hand, and **Discard** puts the proposal away. Nothing changes
  until Apply. A new layout on one table ("a list layout of open invoices
  with totals") is drafted to match the file: the theme most of its layouts
  use (or another layout's, when asked), fields, labels, the title and parts
  styled as they most often are on those layouts, and the components the
  file keeps in its headers and footers placed where they usually sit.
  Totals go in a grand summary under their columns (a summary field is added
  for a number field that has none), and since a layout keeps no find, a
  find and sort come as a "Show <layout>" script that goes to the layout and
  finds those records. A form can have portals of related records ("invoice
  entry with a line items portal and totals"): columns under headings, and a
  total under a column (a `Sum ( Lines::Amount )` calculation is added for
  it). Check's mechanical fixes are applied to the draft before it's shown.
  **From a picture** (not in FileMaker): **Add picture** in the assistant
  (or paste one into the question box) sends a screenshot of another app or
  a photo of a sketch with the question. The assistant places the file's real
  fields where the picture shows them, styled like the file's layouts, and
  says what had no field. Positions snap to a 2-point grid and stay inside
  the layout. It comes back the same way: a picture, Check, **Apply** as one
  step and **Undo**. Pictures are PNG, JPEG, GIF or WebP up to about 3.7 MB, sent by accounts that can change the design, go only
  with the question they were added to, and aren't kept. Files with AI turned
  off never send them.
  MCP clients get the same as `draft_layout` (with `arrangement` for a picture).
- **Restyle with AI** (not in FileMaker): ask the assistant (or type it in
  **Change with AI**) to "make Invoices look like Customers", "use the Cool
  Blue theme" or "apply the theme consistently". Each kind of object takes the
  most common look that kind has on the other layout, part by part (a title in
  the header takes the title's look, labels in the body the labels'), parts
  and the background follow, and the theme comes along; "consistently" drops
  local formatting so everything shows its theme style. Only looks change:
  nothing moves. It comes back as a before-and-after with Check's findings,
  **Apply** and **Undo**, like a layout the assistant designs. MCP has
  `restyle_layout` (preview by default; returns `undo` when saved).
- **Modernize interfaces** (not in FileMaker): ready-made layouts for every
  table, made from templates with **no AI and no tokens**, beside the layouts
  the file already has (which are never changed; a layout of the same name is
  left alone, so asking again only adds what is missing). Each table gets a
  **modern list** (search, sortable columns, paging; a row opens its record in
  a side panel; **Cards** shows the same records as cards, sorted from a menu), a **modern detail** (one record with Previous and Next, and
  its related records under it), a **modern list and detail** (the list with
  the form beside it), and a **classic list** and **classic form** drafted the
  way the file's own layouts look. The modern ones are pages in HTML, CSS and
  JavaScript (a web viewer filling the window), so FileMaker Pro opens them
  too; they read and save records as the signed-in account, so privileges and
  validation apply. Controls and columns come from the fields: a text field
  that holds a name leads the list, a field with a custom value list is a pop-up
  menu, dates, times and timestamps get their own pickers, and keys,
  stamps and serial numbers sit under "System fields", read-only. Calculations
  are shown read-only; a container field shows as a picture on the cards and in
  the form (a file that is not a picture says it has one) and is never written
  back by Save; global and repeating fields are left out. A table of only
  keys (a join table) gets nothing. The new layouts go in a "Modernized
  interfaces" folder of the Layouts list as one change that **Undo** takes back.
  In the web client it is **Manage → Layouts → Modernize interfaces…**: tick the
  kinds of layout and the tables, **Preview** lists what would be made, and open
  any layout to see it (a modern page runs on made-up records, so you can try
  searching, editing and adding without touching the file), then **Make** them.
  Two more kinds are offered, unticked, for tables that have what they need:
  a **modern board** (cards in a column for each value of a status or stage
  field, from its value list if it has one, else the values the records hold;
  drag a card to another column, or use the menu on it, and the change is saved)
  and a **modern calendar** (a month at a time, records on the day of a date
  field, with Previous, Next and Today, a + on each day to add a record dated
  that day, and the record panel as in the list). A table with no such field is
  left out of that kind, and the dialog says why. An invoice template is not
  offered: it needs a header and lines relationship that the table's fields
  alone cannot show.
  Tick **Also one for each of your own layouts** to get a modern list and
  detail made from each layout the file already has ("Customer card - Modern"):
  its columns and form follow the fields that layout shows, top to bottom and
  left to right, instead of a ranking from the table.
  The page also follows how that layout draws the fields: the label drawn beside
  each field (not the field's name), a field the layout makes view only (View Only,
  Select Only or Set by Calculation in Browse mode) is shown but not editable, and a
  field drawn as a checkbox set or radio buttons over a value list is a set of choices
  (read from the file's value list when the page draws, as the pop-ups are).
  A portal on that layout becomes a list of the related records under the form,
  with the columns the portal showed, read through the related table's modern list
  (or, if that is not being made, a layout the file already has on that table).
  A button on that layout that performs a script is kept as a button above the form
  of a saved record, when its parameter is no parameter or a fixed text or number;
  one whose parameter is a formula is left out, and the dialog says so. The script
  runs in the window as it is, so on the record the window shows, which in a page
  that lists records may not be the one open in the form.
  When the AI assistant is on, the dialog then offers **Polish with AI**, never
  automatically: pick the modern pages you want reworked and say what you want,
  and it shows a rough token count and cost for the assistant's model first
  (a guess from the usual page size; the assistant's usage line has the real
  figure). Nothing is sent until you press **Ask the assistant**, and what it
  writes is shown in the assistant's panel to apply or leave like any other
  change it proposes.
  `POST .../modernize` (`tables`, `styles`, `folder`, `fromLayouts`) returns the layouts, the
  tables skipped and the changes, and saves nothing; MCP has
  `modernize_interfaces` (preview by default).
- **Restyle every layout** (not in FileMaker, which changes themes a layout at
  a time): **Themes → Restyle every layout…** puts every layout in the file
  on one theme. Pick an accent colour, text and surface colours, a font, a
  text size and a corner radius (Tabularius's own look to start with) and a
  new theme is made from them, or pick an existing theme. **Start from**
  fills those choices from one of the file's own FileMaker themes (its
  button, field, text and layout colours, font, size and corners, read from
  the theme's normal state), and says which it doesn't set, so a converted
  file keeps its look in Tabularius's cleaner theme; an outlined button's
  colour becomes the accent. The themes in `GET .../design` carry the same
  `tokens` and `unmapped`. **Preview** lists
  each layout that changes; open one to see it before and after, untick any
  to leave alone, and **Apply** saves it all as one change with one **Undo**.
  Phone layouts that follow their desktop layout keep following. Over HTTP
  it is `POST .../restyle` (a preview; nothing is saved), and MCP has
  `restyle_file`.
- **Working together** (not in FileMaker): nothing is locked. The header
  shows the initials of everyone else in design mode on the same file (hover
  for the layout they're on), and on a layout you see what others have
  selected, outlined in their colour with their name. When someone saves a
  layout you have open, it appears at once if you have nothing unsaved;
  otherwise their save is merged into your edits, setting by setting and
  object by object. Where you both changed the same thing, your version is
  kept for now: those objects are outlined on the layout and listed above it
  (settings by their Layout Setup names), each with **Keep mine** or **Take
  theirs** (and both for all at once), one undoable step each. A save that
  brings in such a clash stops there so you can look; saving again keeps
  what you picked. Saving always merges in the latest saved version first,
  so nobody's save is lost. Scripts work the same way: the
  Scripts list and the script editor show who else has a script open (and the
  line they're on), and when they save a script you're editing, their lines
  are merged into yours, line by line, with yours kept where you both changed
  the same line; your own save merges theirs in first. In Tables & fields the
  tables and fields others are on carry their initials, and their changes
  redraw the table you're looking at as they land (unless you're typing).
  Saves to other parts of the design show a message offering to show them.
  Presence is `GET`/`POST {"layout" | "script" | "table", "selection"}`/`DELETE`
  on `/tabularius/live/v1/databases/{db}/design` (`GET` lists each designer's
  `layout`, `script` and `table`); saves arrive on the live events stream as
  `design` changes, on `_design` with the layouts in `ids`, then on
  `_design/scripts` and `_design/tables` with the scripts and tables the save
  touched, and selections as `designer` changes on the same tables. Only
  accounts that can change the design see either.
- **Layout census** (not in FileMaker): `tabularius layout-census <folder>
  [database] [--json]` counts, per kind of layout object, how many a file has
  and how many Tabularius can't draw or work out: fields, value lists, pictures,
  icons or popovers that are gone, chart setups not read, steps buttons run
  that Tabularius lacks, merge fields that name nothing, and layout formulas
  (hide, tooltips, conditional formatting, charts, calculated text...) that
  don't check. It prints counts only, never values or formulas, and changes
  nothing, so it can run on files whose contents mustn't be shown.
- **Style census** (not in FileMaker): `tabularius style-census <file.fmp12>
  [--json]` lists the FileMaker style properties Tabularius reads but doesn't
  draw yet, by property id, with how often each is in the file's themes and
  in objects' own styles, and the theme rules for parts or states (such as
  placeholder text) the web client has no place for. Counts and ids only,
  read-only.
- **Check** (not in FileMaker) lists what will look or behave wrong in
  Browse mode, most serious first: fields that show `<Field Missing>`, fields
  that show nothing because their occurrence isn't related to the layout's
  (globals are fine), objects outside the layout or running past its edge,
  clickable objects (fields, buttons, portals, web viewers, charts) on top of
  each other, labels, fields and buttons almost lined up (edges a point or two
  apart, unless their centres or far edges line up instead), buttons with no
  action, enterable fields the tab order skips,
  fields a privilege set sees as `<No Access>`, and, under **Accessibility**:
  text whose contrast with what's behind it is under WCAG's minimum (4.5:1,
  or 3:1 for large text, measured on the drawn layout), enterable fields with
  no label beside or above them (a list layout's column heading in the header
  counts) and no placeholder or tooltip, buttons with no text, name or
  tooltip (icon-only buttons), charts with no title, name or tooltip, web
  viewers with no name or tooltip, conditional formatting that only changes
  colour (WCAG 1.4.1; a see-through colour that hides the object doesn't
  count), and on phone layouts (480 wide or narrower,
  or ones that stack) buttons and fields smaller than 24 pt to tap
  (WCAG 2.2's minimum). Under **Speed** it lists what makes the layout slow
  to draw, slowest first, each with an estimate of the work in record reads
  per draw. The estimate counts the file's records now: related records are
  taken as the related table's records shared out evenly, and a list shows a
  screenful (40 rows). The findings are:
  - unstored calculations that total related records, read summaries or run
    ExecuteSQL, on every row of a list or portal,
  - summary fields in a list's body (the same total on every row),
  - summaries of related records,
  - portal filters, worked out for every related record,
  - hide, tooltip and conditional formatting formulas that do the same,
  - portals sorted on a field that has no index (an unstored calculation, a
    global or summary, or a field with indexing off).

  Without many records the findings are advice; from 1,000 reads they show,
  and from 10,000 they are warnings. **Make it faster…** (not in FileMaker)
  proposes a redesign for each slow part of the saved layout, with the
  estimated reads before and after: a summary field on every row moves into a
  trailing grand summary, and an unstored calculation or related summary on
  every row is shown from a new stored calculation (worked out when its own
  record changes; it can fall behind the related records, as the move says,
  and **Stale stored values** in the admin console brings it up to date).
  Each applies on its own as one design change, with **Undo**. For portal
  filters and formulas, **Ideas from AI for the rest** asks the assistant
  for a redesign (a relationship that matches the records instead of a
  filter, say) from the layout's design only, never its records; each idea
  is checked against the file and can only add fields, occurrences and
  relationships and edit this layout. It isn't offered for a file with AI
  turned off or an account without AI access. Over HTTP it is
  `POST .../layouts/{id}/speed {"ai"?}` (nothing saved), and MCP has
  `speed_up_layout`. Click an issue to select its objects; the list
  stays open while you fix them, and **Check again** reruns it on what's open.
  The mechanical ones have **Fix** (and **Fix all**). A summary field in a
  list's body moves, with the label just left of it, into the trailing grand
  summary (made below the body when there is none). Nearly lined-up edges go
  to the edge most of them share, an object on top of another moves just below
  it (and past anything else clickable it would land on), an object running
  past the layout's edge moves back inside when it fits, and the tab order
  gains the fields it skips, in reading order, and drops objects that are
  gone. Accessibility findings have Fix too: hard-to-read text takes
  near-black or white, whichever reads best on what's behind it; a field
  with no label gets one with its name (styled as the layout's labels, beside
  it or above it); an icon-only button gets a tooltip naming its script or
  step; a chart with no title gets its value axis title (or first series
  name) as its tooltip; colour-only conditional formatting also makes the
  text bold when it marks one state (two colour states, an icon-only change
  or an icon-only button are left for a person); and on phone layouts
  a field or button too small to tap grows to
  44 pt, moving off anything it grows onto. A label goes only where it
  covers nothing, stays in the field's part and on its tab or slide panel;
  objects inside a group (a component copy), button bar or portal are left
  to a person. A portal sorted on a field with
  indexing off gets automatic indexing back. Each Fix is one undoable step,
  saved only with Save (a field's indexing is a change to the field, saved
  at once and taken back from History). The rest need
  judgment (a deleted field, a button with no action, who should see a field):
  **Ask AI** has the assistant explain the issue and propose a change.
  Without contrast, the same check is `GET .../layouts/{id}/lint` (or `POST`
  with `{"design"}` for unsaved edits) and the `lint_layout` MCP tool, which
  the Ask AI panel uses too; `POST .../layouts/{id}/fix` with `{"design"?,
  "only"?: [{rule, objectIds}]}` returns the mended design without saving it,
  and the `fix_layout` MCP tool mends and saves (or previews).
- **Objects** in the toolbar lists every object front to back, with what's
  inside portals, panels, groups and popovers indented. Click one to select it
  (shift-click for several), search by name, or lock it from its padlock.
- **Tab order** numbers the fields, buttons and controls. Click them in the
  order Tab should take; click a numbered one to take it out. **Default order**
  goes top to bottom and left to right. Browse mode follows the order.
- The Position inspector sets anchors (autosizing), **Sliding** (up, left, and
  shrinking the part) and **Hide when printing**. Sliding is read from and kept
  for FileMaker, and copies in and out. Preview mode and printing slide objects
  as it says: a sliding field or text shrinks to its content, and what is below
  or to the right moves up or left to fill the gap.
- **Rotation** (fields, text, graphics, lines, shapes and buttons) turns an object
  clockwise by 0, 90, 180 or 270 degrees, and copies in and out with the
  snippet's `rotation` attribute. Left, Top, Width and Height are the box the
  object fills once turned. Two assumptions are pinned by tests, so each is a
  one-line change if a copied sample shows otherwise: the snippet counts degrees
  clockwise (`SNIPPET_ROTATION_SIGN` in `layout-snippet.ts`), and the bounds are
  the on-screen box. Other angles paste in upright, with a note.

With nothing selected, the inspector lists the layout's parts: add one (sub-summaries
above or below the records, as many as you need, each "when sorted by" a field),
set a part's fill, or remove it. Drag a part's bottom edge to change its height,
or type it. Changing a part's type (Part Definition) moves it, with its objects,
to where that kind of part goes; the arrows reorder sub-summaries of the same
kind, which decides which groups hold which. Each part's Printing options start
a new page before each occurrence or after every N, and start page numbers
again after each; Preview mode and printing follow them. These options aren't
read from .fmp12 files yet.

Script triggers are set in the layout inspector: with nothing selected for the
layout (OnLayoutEnter, OnLayoutExit, OnRecordLoad, OnRecordCommit, OnModeEnter,
OnModeExit), with a field selected for it (OnObjectEnter, OnObjectModify,
OnObjectExit), and with a tab or slide control selected (OnPanelSwitch), each
with a script, an optional parameter formula, and whether it also runs in Find
mode. The web client runs them on the server like a button's script.
OnObjectModify runs after the field's new value is saved (FileMaker runs it on
each keystroke). OnLayoutExit, OnRecordCommit, OnModeExit and OnPanelSwitch run
before their event and cancel it when the script exits with False: the person
stays on the layout, record, mode or panel. Since the web client saves each
field as it is left, a cancelled OnRecordCommit keeps the person on the record
but its fields are already saved. An OnPanelSwitch script reads
Get ( TriggerCurrentPanel ) and Get ( TriggerTargetPanel ) ("number;object name").
The keystroke triggers, OnObjectSave, OnObjectValidate and OnRecordRevert run as well (Home, End, Page Up and Page Down don't fire a keystroke trigger; see
[web-client.md](web-client.md)). Changes a script makes don't set off
triggers, so a trigger's script can't start itself again. They're stored as
`triggers: [{event, scriptId, parameter}]` on the layout design and its objects;
the triggers of a layout and its objects are read from .fmp12 files.

Formula boxes (calculation fields, auto-enter and validation calculations,
custom functions) have Check syntax, like FileMaker's Specify Calculation
dialog: it reports the first problem (a syntax error, a field, table
occurrence or function that doesn't exist, the wrong number of parameters)
and selects it. Saving a changed formula checks it first and asks before
saving one with an error. Fields of tables in other files that aren't hosted
can't be checked, so any name passes there.

The field editor covers FileMaker's auto-enter and validation options,
including looked-up values (copied from the first related record when the
match fields change, with what to do when nothing matches), prohibit
modification (Data API and web client edits get error 201; scripts can still
set the field), strict data types, existing values and membership of a value
list (static or from a field).

A custom function's page has Try (run the formula as it is in the box, with a
value for each parameter, before saving) and Used in (every field, script,
layout and function that calls it).

Custom menus has FileMaker's Manage Custom Menus: menus whose items run a
command or a script (with a parameter), open a submenu, or separate groups,
each with an optional title formula, install-when formula and shortcut; menu
sets that put menus in a menu bar order; and the set the file opens with.
A layout can name its own menu set (the layout inspector's Menu set, as in
FileMaker's Layout Setup): the web client installs it when the layout opens,
and goes back to the file's default on a layout set to [File Default]. A set
an Install Menu Set step put in place stays until another is installed. Each
menu set lists the layouts that use it. Layouts read from .fmp12 files keep
the menu set their Layout Setup names.
Menus read from .fmp12 files keep the item bits Tabularius doesn't decode yet.

The layout inspector also has Layout Setup's other options, all on by default
as in FileMaker:
- **Views allowed** (form, list, table): the web client offers only these, in
  the toolbar and the View menu, and a layout that opens in a view must allow
  it.
- **Save record changes automatically**: unchecked, leaving a changed record
  (another record, layout or mode, a find, a sort) asks "Save changes to this
  record?" with Save, Don't Save (reverts it) and Cancel (stays). Enter, a
  Commit Records button and a button's script save without asking.
- **Show field frames when record is active**: while a field has the cursor,
  the record's other fields show a dotted frame.
- **Show current record indicator in List view**: the bar beside the current
  row.

In `updateLayout`'s `design` they are `viewsAllowed` (a list), and
`saveRecordChanges`, `fieldFrames` and `recordIndicator` (true or false; true
or all three views clears one). The views allowed are read from .fmp12 files;
the other three aren't yet, so layouts from FileMaker files start with them on, and the Design Report
writes Layout Setup's `<Options>` only for a layout that sets one.

Changing the design needs full access: an account with `[Full Access]`.

## Changes

A change is a JSON object with a `op`. Things are named by name or id. A list
of changes applies as one unit: if any fails, none are made.

```json
[
  { "op": "createTable", "name": "Products", "fields": [{ "name": "Name" }, { "name": "Price", "type": "number" }] },
  { "op": "createField", "table": "Products", "name": "With tax", "kind": "calculation", "type": "number", "calculation": "Price * 1.2" },
  { "op": "createRelationship", "left": "Products", "right": "Order Lines", "predicates": [{ "left": "Id", "right": "ProductId" }] }
]
```

| Ops | Notes |
|---|---|
| `createTable`, `renameTable`, `deleteTable` | A new table gets a table occurrence and a form layout named after it (`withLayout: false` to skip). Deleting removes its occurrences and their relationships. |
| `createField`, `updateField`, `deleteField` | `type`, `kind` (normal, calculation, summary), `calculation`, `calculationContext`, `comment`, `options` (global, unstored, repetitions, index, noAutoIndex, indexLanguage, evaluateWhenEmpty, externalStorage, autoEnter, validation; `null` removes one; see Field options), `summary`. |
| `createOccurrence`, `updateOccurrence`, `deleteOccurrence` | `table`, or `file` (a data source) with `externalTable` (the table's id in that file) for a table in another hosted file, `color`, `graph` (position on the relationship graph). |
| `createRelationship`, `updateRelationship`, `deleteRelationship` | `predicates: [{left, operator, right}]`; operators `= ≠ < ≤ > ≥ ×`. Per side: `leftCreate` / `rightCreate` (allow creating records there through the relationship, as a portal's last row does; on by default for new relationships) and `leftDelete` / `rightDelete` (delete those related records when a record on the other side is deleted). |
| `createValueList`, `updateValueList`, `deleteValueList` | `values`, or `field: {occurrence, field, second, showSecondOnly, sortBySecond, related}` to take them from a field (of a table in another hosted file too): every value, or with `related` (an occurrence) only those related to the current record. `second` shows another field with each value (the first field's value is what's entered). `external: {file, valueList}` is the list of that id in another hosted file (`file` is a data source). |
| `createCustomFunction`, `updateCustomFunction`, `deleteCustomFunction` | `parameters`, `formula`. |
| `createDataSource`, `updateDataSource`, `deleteDataSource` | Manage External Data Sources. `paths`: for a FileMaker file, one or more of `file:Name`, `fmnet:/host/Name`, `filemac:/...`, `filewin:/...` (tried in order); for ODBC, one `odbc:DSN`. Renaming follows Open File, Close File and Perform Script steps. Deleting is refused while occurrences or scripts use it. |
| `createContainerDirectory`, `updateContainerDirectory`, `deleteContainerDirectory` | Manage Containers base directories: `path` relative to the database's folder (`Files/Attachments/`). `directory` is an id; 0 is the default, `Files/[database name]/`, and can't be deleted. Deleting is refused while fields store there. |
| `setFileOptions` | File Options: `openLayout` (the layout the file opens on), `onFirstWindowOpen`, `onLastWindowClose`, `onWindowOpen` and `onWindowClose` (scripts); `null` clears one. OnWindowOpen and OnWindowClose are kept in the file's own format only: Tabularius does not read them from a FileMaker file (not decoded yet) or write them into one. In the web client, under File Options on the Layouts tab (where **Duplicate** copies a layout's whole design to "<name> Copy"). |
| `createLayout`, `updateLayout`, `deleteLayout` | `occurrence`; `design` (parts, objects, ...) replaces the stored design. Without one, a form is generated. `includeInMenu: false` leaves it out of the layout menus (Layout Setup's "Include in layout menus"). |
| `createScript`, `updateScript`, `deleteScript` | `text`: the script as FileMaker's workspace shows it, one step per line (see below); or `steps: [{name or stepId, params, enabled}]`. `includeInMenu: false` leaves it out of the Scripts menu. |
| `setOrder` | `list`: `layouts` or `scripts`; `order`: a tree of `{item}`, `{folder, children}` and `{separator: true}`, as Manage Layouts and Manage Scripts show it. Items left out go at the end. A `{item}` or `{folder}` can set `includeInMenu`; otherwise moving an entry keeps its setting. In the web client, drag entries in the list (onto a folder's name to put them inside). |

### Reviewing staged changes

Changes can wait for a look before they are applied. `POST …/databases/<db>/pending` with `{"changes": [...]}` stages
them (nothing changes); the **Review changes** tab in design mode lists them, and `GET …/pending` returns the same review:

- **Grouped by what they change** (a script, a field, a table), each with who staged it and when.
- **What it does**, in the words the change preview uses, and for a calculation, custom function or script the text
  before and after as a line diff (long diffs show the changed lines with a few around them, and the rest on request).
- **What a rename or delete would break**, from the same check as `GET …/impact`.
- **Whether it would apply**: each change is checked in order against the ones before it (a field made by an earlier
  change is there for a later one). One the design would refuse says why.
- **Conflicts**: another change to the same thing (or to its table) in the design history since the change was staged
  is named, with who made it and when. A change in conflict is left alone unless it is chosen anyway.

`POST …/pending/apply` with `{"ids": [...], "overrideConflicts": [...]}` (no `ids` applies all) applies the ones asked for,
in order, as one unit, and answers with what was applied, what could not be (and why), what was left because of a
conflict, and how many are still waiting. `POST …/pending/discard` with `{"ids": [...]}` drops staged changes.
Applying needs Full Access, like any design change, and the history records the person who applied. The list is kept in
memory: a server restart clears it, and at most 100 changes wait at once. In the web client every control works from
the keyboard, and ticking a box does not move the focus.

## Field options

Every option in Manage Database's field Options dialog, what the reader takes
from the `.fmp12`, and whether design mode edits it and the engine applies it.
"Checked" means it matched FileMaker's own Design Report for every field of the
Flicks sample.

| FileMaker option | Read from .fmp12 | Edited | Applied by the engine |
|---|---|---|---|
| Auto-enter creation/modification values (date, time, timestamp, name, account name) | yes, checked | yes | yes |
| Serial number (next value, increment) | yes, checked | yes | yes |
| Serial "generate on commit" | not yet (no sample has it) | yes | yes: a script's New Record leaves the field empty and its first commit gives the serial (a reverted record uses none). Records the Data API, the web client or an import create are committed at once, so they get it then | <!-- known-difference: Reading .fmp12 files ;; Serial 'generate on commit' is not read from .fmp12 files: no sample has it (design mode and the engine support it) ;; A converted serial field comes across without the option ;; A sample file with the option set -->
| Value from last visited record | not yet (no sample has it) | yes | yes: New Record in the web client and in scripts copies the field from the record the window was on | <!-- known-difference: Reading .fmp12 files ;; 'Value from last visited record' is not read from .fmp12 files: no sample has it (design mode and the engine support it) ;; A converted field comes across without the option ;; A sample file with the option set -->
| Data | yes, checked | yes | yes |
| Calculated value, replace existing value | yes, checked | yes | yes |
| Do not evaluate if all referenced fields are empty | yes, checked (calculation fields too) | yes | yes |
| Looked-up value: occurrence, field, copy empty | yes, checked | yes | yes |
| Looked-up value when nothing matches: keep, empty, constant | yes | yes | yes |
| Looked-up value: copy next lower / next higher | yes | yes | yes, for a single `=` relationship |
| Prohibit modification | yes, checked | yes | yes |
| Validate always / only during data entry, allow override | yes, checked | override yes; always is kept | yes |
| Strict data type, not empty, unique, existing, member of value list, in range, maximum characters | yes, checked | yes | yes |
| Validated by calculation | yes, checked | yes | yes |
| "Validate only if field has been modified" (for the calculation) | read as on (no sample has it off) | yes | yes |
| Display custom message | yes, checked | yes | yes |
| Custom message is a calculation | yes | yes | yes, worked out for the record |
| Storage: global, repetitions | yes, checked | yes | yes |
| Storage: do not store calculation results | yes, checked | yes | yes |
| Indexing None / Minimal / All, automatically create indexes | yes, checked | yes | kept for FileMaker; Tabularius's own word index covers finds |
| Default language | yes for English and Japanese (the only ones in the samples); others keep their number | yes, any language Claris lists | sorts, ranges, SQL and groups follow it ([Languages for sorting](sort-languages.md)) |
| Furigana | not yet | no | no | <!-- known-difference: Reading .fmp12 files ;; Furigana is not read, edited or applied ;; Fields carry no Furigana setting ;; An owner decision on whether to support it, and a sample file that uses it -->
| Container: store externally, secure/open, path, base directory | base directories only (see Containers) | yes | open external storage is honoured for new files (`RC_Data_FMS/<file>/…`); secure storage keeps them in the database |

## External data sources

The **Data sources** tab is FileMaker's Manage External Data Sources: the
FileMaker file references and ODBC entries that tables from other files come
through. Tabularius never connects out to any of them:

- A file reference finds the **hosted database with the same file name**,
  whichever of its paths names it (`file:Invoices`, `fmnet:/server/Invoices`,
  `filemac:/Volumes/.../Invoices.fmp12`). The tab says which hosted database
  each one finds, or that none does yet.
- ODBC entries keep their DSN, for FileMaker. Tabularius doesn't connect to them
  and keeps no user name or password; the Design Report lists them without one.

## Containers

The **Containers** tab is FileMaker's Manage Containers: the base directories
FileMaker stores container data in, and which fields store there. A container
field's options set "Store container data externally": secure storage (with
fewer folders, or not) or open storage under a path calculation, in one of the
base directories (`externalStorage: {directory, secure, fewerFolders, path}`).

Tabularius follows the field's setting for files it receives. A field set to
open external storage gets new files in its folder under the file's container
folder (`RC_Data_FMS/<file>/<base>/<path>`, as FileMaker Server keeps them),
and the path calculation is worked out per record; a field set to secure
storage, or not set to store externally, keeps its files in the database. The
settings are also carried by the Design Report and copied fields (`<Remote>` and
`<BaseDirectoryCatalog>`, as FileMaker writes them). The reader takes the base directories from the `.fmp12` (Flicks matches
its Design Report), but not yet whether a field stores externally: no sample <!-- known-difference: Reading .fmp12 files ;; Whether a field stores its container externally is not read from .fmp12 files: no sample does, and container fields carry a directory and path even when they do not ;; A converted container field keeps its data in the database ;; A sample file with an externally stored container field, and its Design Report -->
does, and container fields carry a directory and path even when they don't.
Thumbnails are made by the server when a picture or PDF is shown.

## Themes and styles

The **Themes** tab is FileMaker's Manage Themes plus the Styles inspector:

- A theme gives each kind of object (its element: edit box, button, body part,
  layout background...) a default look, and holds named styles for one element
  each.
- A look is CSS, kept as rules per part (the object, its text, its icon) and
  state (normal, hover, pressed, focus). The editor has controls for fill,
  text color, font, size, bold, italic, underline, alignment, borders, corner
  radius and padding, plus a box for any other CSS.
- Themes can be copied (a new theme starts as a copy, or blank), renamed, and
  deleted when no layout uses them.
- **Export theme** saves a theme as a JSON file; **Import a theme** in another
  database adds it from that file (a name already in use gets a number).

In the layout editor, each object's **Appearance** section picks its style
from the layout's theme and edits its own formatting.
- **New style…** saves the object's look as a style.
- **Update style** puts its own formatting into its style, for every object
  that uses it.
- **Clear formatting** drops its own formatting.
- **Copy format** and **Paste format** are the Format Painter: the copied style
  and formatting go on the selected objects (objects of another kind get only
  the formatting).

Ops: `createTheme {name, from?}` or `{name, content: {defaults, styles, contextual?}}` (an import), `updateTheme {theme, name?, defaults?: {element: rules | null}}`,
`deleteTheme`, `createStyle {theme, name, element, rules?}`, `updateStyle {theme, style, element?, name?, rules?}`
(renaming updates objects using it) and `deleteStyle` (objects using it get their element's default look).
`GET /tabularius/design/v1/databases/{db}/themes/{id}` returns a theme in full; MCP has `get_theme`.

## Layout components

FileMaker has no way to share a piece of layout between layouts. A component
is a group of objects (a header, a nav bar, an address block) saved once and
placed on any number of layouts; editing it updates every copy.

- In the layout editor, select objects and click **Save as component…** in the
  inspector. They become a copy of the new component, in the same place.
- **Component…** in the toolbar places a copy of any component on the layout.
- Selecting a copy shows which component it is and how many other layouts use
  it. **Edit component** opens it in place; **Save component** updates every
  copy, and **Cancel** puts it back. **Detach** turns one copy into a plain
  group that no longer follows the component.
- Each layout a component change touches gets its own entry in the layout's
  version history, so a copy's change can be compared and restored like any
  other edit.

A copy is a group object with `component: {id}`. Its children are kept in step
with the component (they keep their ids, so scripts and Check still find them).
Deleting a component turns its copies into plain groups.

Ops: `createComponent {name, objects}` (bounds from the component's top-left) or
`{name, layout, objectIds}` (turns those top-level objects into a copy),
`updateComponent {component, name?, objects?}` and `deleteComponent {component}`.
Components can't contain copies of other components. The design (REST and MCP
`get_design`) lists `components` with the ids of the layouts that place each one.

### The component library (shared across files)

The **component library** shares components between every file on the server.

- Select a placed copy and click **Save to library**. Anyone with [Full
  Access] to a file on this server can then see the component and place it,
  so Tabularius asks first.
- In another file, **Component… › From the library…** lists the shared
  components. **Place** copies one into the file and places it. Its fields,
  value lists, scripts and layouts are matched to that file's own by name,
  ignoring case. Anything the file lacks is listed before placing, and is left
  the way FileMaker leaves a deleted reference: the field shows
  `<Field Missing>`, a button runs nothing. Pictures and icons come with it.
- Each file keeps its own copy, linked to the library by id and version. So
  nothing changes in a file until someone there takes the update.
  - **Save to library** on a linked copy saves the next version. Only the
    file that first saved the component can do this, and only from a copy of
    the latest version, so nobody's changes are overwritten.
  - **Newer version?** shows each layout that would change, before and after,
    and **Take it** applies the update.
  - **Update other files…** lists the other files that use the component.
    Sign in to each one with that file's own account (it needs full access
    there) to see its before and after, then update or skip it. The session
    signs out again afterwards.
- **Take out** removes a component from the library. Only the file that first
  saved it can do this, and every file keeps its own copy.

The library is a file in the hosted folder (`.openhbam-component-library.json`,
readable by the server only), so every worker shares it. It holds at most
500 components, each with up to 2,000 objects and 8 MB of pictures, and
96 MB in all. A damaged library file is set aside (renamed `.damaged-…`) and
the library starts empty.

REST: `GET /tabularius/design/v1/databases/{db}/library` returns the library,
with this file's copy of each component (`here`). `POST …/library
{"component"}` saves a component. `POST …/library/{id}` places a component or
takes its latest version; with `{"preview": true}` it returns `missing` and
each layout's `before`/`after` and saves nothing. `DELETE …/library/{id}`
removes a component. A file's component carries `library: {id, version}`;
`createComponent` and `updateComponent` take it too (`null` unlinks).

## What happens to data and references

- Field and table changes alter the SQL tables: columns are added, renamed and
  dropped; a renamed table keeps its records.
- Changing a field's type reinterprets what is stored (text "10/11/2026" becomes
  a date), as FileMaker does.
- Adding or changing a stored calculation computes it for every record.
- Renaming a field or table occurrence rewrites every formula that uses it
  (field definitions, validation, custom functions, layout hide conditions,
  tooltips, conditional formatting, merge fields, script steps). Deleting one
  leaves `<Field Missing>` / `<Table Missing>`, as FileMaker shows.
- Unlike FileMaker, deleting a table or field can be undone. Its data is kept
  aside, and it is listed under **Recently deleted** in Tables & fields (and as
  `deleted` in the design). `{"op": "restoreDeleted", "deleted": id}` brings it
  back with the same id and its data. It also puts back what the delete
  changed: formulas, script steps, layout fields, relationships and
  occurrences. Places changed again since the delete are left as they are.
  - Records created while it was deleted get an empty value.
  - A newer table or field with the same name has to be renamed first.
  - Deleted ids are never given to new tables or fields.
  - **Delete for good**, or `DELETE /tabularius/design/v1/databases/{db}/deleted/{id}`
    (no id: all of them), lets the data go.
- Before deleting, design mode lists where the field or table is used.
- Layouts and scripts renamed are renamed where steps and buttons name them.
- Every change is logged (who and when). When a newer reader re-reads a file's
  layouts from its `.fmp12`, the logged changes are applied again on top, so
  edits survive upgrades.

## Scripts as text

The script editor and `text` in `createScript` / `updateScript` read the lines
FileMaker's script workspace shows: `Step name [ option ; option ]`, one step
per line, indented freely. `“Quotes”` name layouts and scripts, `Table::Field`
names fields, `// ` disables a step and `#` starts a comment; a blank line is an
empty comment. A step can run over several lines while its `[` is open.

Lines that are unchanged keep the step they came from with every decoded
option, so editing one line of an imported script loses nothing elsewhere.
Every script in the sample files reads back from its own text as exactly the
same steps. Errors name the line: `Line 4: No layout named "Invoices"`.

## Pasting from FileMaker Pro

What a developer copies in FileMaker Pro (tables or fields in Manage Database,
scripts or steps in the Script Workspace, custom functions, value lists) goes
on the clipboard as `<fmxmlsnippet type="FMObjectList">` XML. Paste it on the
design page (Cmd/Ctrl+V outside a text box, or **Paste from FileMaker** and
paste the XML into the box) and Tabularius makes the same objects:

- **Tables** come with their fields, an occurrence and a layout, as FileMaker's
  Tables tab paste does.
- **Fields** go into the table selected on the Tables tab.
- **Scripts** are created whole. Bare **steps** go at the end of the script
  shown on the Scripts tab, or into a new "Pasted Steps" script.
- **Custom functions** and **value lists** are created too.

As in FileMaker, references resolve by name in this file (the ids in the XML
are the other file's), and a name already in use gets a " 2" suffix. Pasted
formulas follow the renamed copies. Anything that doesn't carry over (a layout
or script this file doesn't have, a summary option Tabularius doesn't keep, a
step it doesn't know) is listed after the paste.

`POST /tabularius/design/v1/databases/{db}/snippet {"xml", "table"?, "script"?, "at"?}`
returns the changes without applying them, with a summary and those notes.

### Layout objects

Objects copied in FileMaker's Layout mode (`<fmxmlsnippet type="LayoutObjectList">`)
paste into the layout open in the layout editor. They keep their positions, or
move 10 points down and right when they would land exactly on objects already
there. They come in selected and stay unsaved until **Save**.

- Fields, text (merge fields too), buttons and their one-step actions, shapes,
  portals with their sort, filter and rows, tab and slide controls with what's
  on their panels, button bars, popovers, groups and web viewers all come in.
- So do anchoring, locks, sliding, conditional formatting, hide conditions, Hide when printing, tooltips, script
  triggers, placeholder text, Field Behavior, local styles (`LocalCSS`) and
  theme styles.
- Fields, table occurrences, value lists and scripts bind by name. A named
  style binds only when the layout's theme has it.
- Charts and pictures carry binary data the XML doesn't hold, so they're left
  out. That, and anything else that doesn't carry over, is listed after the paste.

**Copy for FileMaker** in the layout inspector, or Cmd/Ctrl+C in the editor,
puts the selected objects on the clipboard as the same XML. Pasted back into a
layout (in this file or another), it gives the same objects.

The API has two calls:

- `POST .../snippet {"xml", "layout"}` returns `{objects, summary, notes}`
  without placing them.
- `POST .../snippet/copy {"objects", "layout"}` returns the XML.

On the clipboard, objects in a portal, on a tab or slide panel and button bar
segments are positioned relative to their container. Popovers and grouped
objects keep layout positions.

Some styling isn't written, and copying says so:

- gradients
- the few object parts and states Tabularius has no FileMaker CSS name for
- button icons, which are pictures

Grouped objects without an action are written as `Group`; that form isn't
confirmed in FileMaker's own clipboard yet.

For Flicks, the objects read from FileMaker's Save as XML match the objects
decoded from the .fmp12 file: every layout object's type, position, field,
text, action, tooltip, hide condition, conditional formatting, portal, style
and local CSS. Every layout in the sample files copies out and pastes back
the same.

**Copy for FileMaker** (on a table, field, script, custom function or value
list) puts the same XML on the clipboard, and
`POST /tabularius/design/v1/databases/{db}/snippet/copy` with lists of ids
(`tables`, `fields: {table, ids}`, `scripts`, `steps: {script, indexes}` or
`steps: {script, lines: [first, last]}`, `customFunctions`, `valueLists`)
returns it. In the script editor, **Copy steps** copies the steps on the
selected lines. It pastes as it is into another
Tabularius file. FileMaker Pro reads its clipboard as its own types rather than
text, so pasting there goes through a clipboard tool that converts XML text to
FileMaker's format. Every script in the sample files, written out and read
back, gives the same steps, except the window and web viewer steps whose
options Tabularius keeps as unnamed formulas; copying those lists a note.

The XML grammar follows FileMaker's own Database Design Report and Andrew
Kear's round-trip tested specifications
([FileMaker-XML-field-definitions](https://github.com/andykear/FileMaker-XML-field-definitions),
[FileMaker-XMLsnippet-Claude-Skill](https://github.com/andykear/FileMaker-XMLsnippet-Claude-Skill),
[FileMaker-XMLsnippet-Layout-Claude-Skill](https://github.com/andykear/FileMaker-XMLsnippet-Layout-Claude-Skill), CC BY 4.0).
Every Flicks step read from its Design Report matches the step decoded from
the .fmp12 file.

## Database Design Report

The Report tab's **Download Design Report (XML)**, `GET /tabularius/design/v1/databases/{db}/ddr`
and `tabularius ddr <file.fmp12>` write the whole design as FileMaker's Database
Design Report XML (`<FMPReport>`), the format tools that analyze FileMaker
solutions read. It covers base tables and fields, table occurrences and
relationships, layouts and their objects, value lists, scripts (in folders,
each step with its line), accounts, privilege sets, extended privileges,
custom functions, file references, custom menus and themes.

For Flicks it lists the same tables, fields, occurrences, relationships,
layouts and layout objects, value lists, accounts and privilege sets as the
report FileMaker 26 wrote. Object formatting and theme CSS are left out. No
password, password verifier or data source login is ever written.

## The design in git

`tabularius design-text <folder> <database> <out-dir>` (a hosted file, with the
changes made here) and `tabularius design-text <file.fmp12> <out-dir>` write the
design as a folder of small text files, one per object, so it can be kept in
git and every change reads as a diff:

```
tables/Invoices.txt              fields, types, formulas and options
relationships.txt                table occurrences and relationships
scripts/<folder>/<Script>.txt    script steps as text, indented as in the workspace
layouts/<Layout>.json            the layout's parts and objects
value-lists/<List>.txt
custom-functions/<Function>.txt
privilege-sets/<Set>.json
accounts.txt                     account, privilege set, how it signs in
file.json                        data sources, file options, custom menus
```

The same design always gives the same text: objects are named files, JSON
keys are sorted, FileMaker's default field options are left out, and a serial
number's next value (which moves with every new record) is not written. Run it
again to update the folder: changed files are rewritten, files for objects
since deleted or renamed are removed, and anything else in the folder (a
README, the `.git` folder) is left alone. The list of files it wrote is kept
in `.openhbam-design`.

No record data, no password or password verifier, and no themes are written.

### Reviewing a design change

`tabularius design-diff <old> <new>` says what differs between two designs in the
terms a reviewer uses. Each side is a folder `design-text` wrote (say, two
checkouts of a branch), a `.fmp12` file, or a hosted `.openhbam.sqlite` file;
nothing is changed.

```
$ tabularius design-diff main-design branch-design
Scripts
  ~ Send reminder  (scripts/Send reminder.txt)
      -  12  Set Variable [ $days ; 7 ]
      +  12  Set Variable [ $days ; 14 ]
Tables
  ~ Invoices  (tables/Invoices.txt)
      + field Reviewer note (text, normal)
      field Total  ~ formula: Qty * Price → Qty * Price * (1 + Tax)
Layouts
  ~ Invoice list  (layouts/Invoice list.json)
      ~ objects#4 "Total".bounds.left: 640 → 660

3 objects differ
```

Objects are matched by the id in their file, so a rename reads as a rename
(`~ Old → New`). A script is compared step by step, a table field by field (type,
comment, formula, summary, options), a layout object by object (a moved object
is not a change), and relationships and occurrences by name. A long list of
changes in one object stops after 40 lines. `--exit-code` exits 1 when the
designs differ, so a check can fail on any design change.

### Reading the folder back

Edit the files (or merge a branch) and `tabularius design-apply <folder>
<database> <in-dir>` lists what would change in the hosted file. Nothing is
changed until you add `--apply`.

```
$ tabularius design-apply ~/Databases Invoices ~/invoices-design
Change script "Send reminder" (scripts/Send reminder.txt)
Add custom function "Twice" (custom-functions/Twice.txt)
skipped: accounts.txt: changed, but accounts.txt aren't read back from text yet
2 changes; nothing was changed. Run again with --apply to make them
```

How it reads the folder:

- It compares each file with what the hosted file would write for that object.
  A file that reads the same is nothing to do, so a folder just written by
  `design-text` always plans no changes, and after `--apply` writing the folder
  again gives the files you edited.
- Scripts, custom functions, value lists and layouts are read back. A file
  names its object by the id on its first line (scripts and value lists) or in
  its JSON (layouts), so renaming the object in the file renames it in the
  database. A custom function has no id in its file: it is matched by the file's
  place in the folder, so renaming one is a new function plus, with `--remove`,
  the removal of the old.
- Tables are read back for a new table file, a renamed table (its id is on the
  first line), and the fields in it: a field name not in the table adds the
  field; a changed Type, Comment, Formula, Summary or Options line changes it. Options is the
  field's JSON object (global, unstored, repetitions, index, autoEnter, validation and
  so on); one that is not valid JSON, or names an option that does not exist, is
  refused with the field's name. Taking an option out of the line clears it, and a
  serial number keeps its next value. Fields
  have no id in the file, so a renamed field reads as a new one; and a field
  or table missing from its file is never deleted (not even with `--remove`,
  since that would delete its data), only noted. A new
  table gets an occurrence and a layout named after it, as in Manage Database,
  so a layout file for it in the same folder would clash by name.
- relationships.txt is read back: a table occurrence line `Name → Table` that
  is new adds the occurrence (or points an existing one at another table); a
  relationship, found by its `Left ↔ Right` heading, is added when new and
  changed when its match lines or its `create in` / `delete in` options
  differ. Nothing is deleted from it unless you give `--remove`, and then only
  relationships; an occurrence is never deleted, and a renamed one reads as a
  new one. `sorted` and occurrences of tables in other files are set in
  Manage Database. Accounts and privilege sets are not read back: they hold
  passwords and access, so they stay changes made in Manage Security.
- A file with no matching object adds one. A missing file removes nothing
  unless you ask with `--remove`, so a half-checked-out branch can't delete
  work.
- A script's lines keep every decoded option of the steps you left alone, as in
  the script workspace; only the lines you changed are re-read.
- What the text can't carry is listed as `skipped`, never guessed at: a
  script's "full access" line, a value list taken from another file, and, for
  now, tables, fields, relationships, accounts, privilege sets and `file.json`.
- It writes through the same design changes as design mode, so the same checks
  apply: a bad script line, a formula that doesn't parse or a name in use stops
  the whole change with the reason, and nothing is half-applied.

Choices made: one file per object, sorted and diff-friendly, readable first
(FileMaker's script workspace text, formulas as written); a JSON file only where
the object is large and structured (layouts, privilege sets). The text is a
view of the design, not a second source of truth: the hosted file stays the
one place the design lives, and `design-apply` is how edits made as text get
back into it.
