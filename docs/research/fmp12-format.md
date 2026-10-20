# The .fmp12 file format

What we know about FileMaker's file format, how we know it, and what is still open.
Claris publishes no specification. Everything here comes from public
reverse-engineering work (credited inline) plus our own inspection of sample files.
Use `tabularius dump <file> --prefix <path> --text` to explore a file yourself.

Status legend: **verified** means checked against sample files and tested;
**inferred** means it fits every sample we have but needs more files to confirm.
<!-- known-difference-file: Reading .fmp12 files ;; Some bytes of a .fmp12 are read by inference: they fit every sample we have but no more files confirm them (privilege bits and option values, field type codes, table occurrence graph boxes, the layout view byte, object flags, text style attributes, chart data) ;; A converted file can differ from what FileMaker shows for an option that uses such a byte ;; More sample files that use the option, or a FileMaker Design Report of the same file -->
<!-- known-difference-file: Reading .fmp12 files ;; Rich-text formatting runs, externally stored containers, how global fields are stored and the user's custom layout display order are not decoded yet ;; A converted file does not carry them ;; Sample files that use them (for the display order, one where layouts were reordered) -->

## 1. Container

| Item | Value | Status |
|---|---|---|
| Magic (offset 0, 15 bytes) | `00 01 00 00 00 02 00 01 00 05 00 02 00 02 C0` | verified |
| Format tag (offset 15) | `HBAM7` = readable; `HBAMe` = Encryption at Rest (all blocks ciphertext) | verified / from fmptools |
| Version byte (offset 521) | `0x1E` = fmp12 (FileMaker 12+); otherwise fp7 | from fmptools |
| Build date (offset 531, 7 chars) | e.g. `25JAN11` | verified |
| Creator (offset 541) | Pascal string, e.g. `Pro 12.0` | verified |
| Block size | 4096 bytes; block *n* is at offset *n*×4096; block 0 is the header | verified |
| Block count | the "next" pointer of block 1; file size = (count+1)×4096 | verified |

Block header (20 bytes), then a 4076-byte payload:

| Offset | Size | Meaning |
|---|---|---|
| 0 | 1 | deleted flag |
| 4 | 4 | previous block id (big-endian) |
| 8 | 4 | next block id |
| 12 | 2 | B-tree level: 0 = leaf (data), 1 = index, 2 = root |
| 14 | 2 | unknown (maybe bytes used) |

Blocks form a B-tree. All data is in the leaves, which are chained through
next-pointers. Start at the leaf whose previous id is 0 (usually block 2).
Every leaf starts from an empty path. (fmptools; verified)

## 2. Payload byte code

Each payload is a stream of chunks that build a path ("directory") and put
values in it. Six kinds: path push, path pop, plain data, segmented data,
key-value with a small integer key, and key-value with a byte-string key. The
opcode table is in `packages/fmp12/src/chunks.ts`, taken from the fmptools
`HACKING` notes. Highlights:

- `0x20 n` push one byte, `0x28` push two bytes, `0x30` push three bytes, `0x38 len …` push bytes.
- `0x40` / `0x3D` pop. Any opcode with the top two bits set (`0xC0`–`0xFF`) is
  the same chunk as `op & 0x3F`, followed by a pop.
- `0x01`–`0x06` key-value with a one-byte key; `0x09`–`0x0E` with a two-byte path-int key.
- `0x07` / `0x0F` segment of a long value (index, 2-byte length, data).
- `0x16`/`0x17`/`0x1E`/`0x1F` key-value with a byte-string key (used by indexes).
  Exception: a `0x16`/`0x17` key starting `0xC0` is a segment whose index is a
  three-byte path integer. Long container data switches from `0x0F` to these
  after segment 16511 (verified on a 25 MB JPEG).
- `0x19`–`0x1D`: a byte-string key followed by a fixed-size value of 1, 2, 4,
  6 or 8 bytes. fmptools skips these values; script steps keep their stored
  find criteria in them (a `0x1D` key `00 [len][TO][len][field]` holds the
  criteria text), so we now decode them as key-value chunks.
- `0x80` no-op; `0x00 0x00` ends the payload.

All four sample files decode with **zero** unknown opcodes (verified, tested).

### Integers in paths

Path segments and two-byte keys are a prefix-length varint:

| Bytes | Range | Status |
|---|---|---|
| `0xxxxxxx` | 0–127 | verified |
| `10xxxxxx xxxxxxxx` | 128–16511 (value + 0x80) | verified |
| `1100xxxx xxxxxxxx xxxxxxxx` | 16512+ (value + 0x4080) | **verified (our finding)**: record ids in FMburgh run `…BF FF`, `C0 00 00`, … up to 18305 |
| `D0 xx xx` | a table-occurrence reference, 128 + n | inferred: layouts reference TOs this way |

fmptools treats every three-byte form as `0x80 + last two bytes`, which is
right for `D0` references but makes record ids above 16511 collide with lower
ones. Our reader fixes this.

### Text

Strings are XOR'd with `0x5A`, then encoded with SCSU (Unicode TR6), which is
Latin-1 compatible and switches to other Unicode windows with control bytes
(fmptools; verified). FileMaker uses CR as the paragraph separator; we
normalise to LF.

Built-in names can use Private Use characters: the Guest account's name
decodes to `[U+E002]`, presumably localised by the client. (inferred)

Not everything is XOR'd: in calculation byte code only the embedded strings
are, and the structure bytes are plain.

## 3. Path map

Object catalogs follow one pattern: `[catalog].1` holds indexes, counts and
display order; `[catalog].5.[id]` holds each object's definition; key 16 of an
object is its name (or child node 16 holds a long name).

| Path | Contents | Status |
|---|---|---|
| `2` | file info: version strings, creator app path, settings | partial |
| `3.16.5.[id]` | base tables (ids from 129); key 16 = name | verified |
| `3.17.5.[id]` | table occurrences; key 2 = `02 01 00 03 02 <base table path-int> <4 × float32 graph box>` | verified (base table), inferred (box) |
| `[table].3.5.[fid]` | field definitions (see §4) | verified |
| `[table].5.[recordId]` | records (see §5) | verified |
| `[table].7`, `[table].1` | indexes | not decoded |
| `4.5.[id]` | layouts; `.1.[TO ref]` = layout's table occurrence and its fields; `.3` = parts; `.5.[n]` = objects (key 1 = label text) | partial |
| `4.1.7.[id]` | layout catalog entries: key 240 kind, key 16 name | partial (see §6) |
| `6.5.[id]` | themes; key 10 display name, key 16 id like `com.filemaker.theme.classic` | verified |
| `16.5.[id]` | custom functions; key 16 name, key 33 parameters (`;`-separated), `.35` the formula | partial |
| `17.5.[id]` | scripts; key 4 = step list; `.5.[step instance]` = step parameters | partial (see §7) |
| `17.1.7.[id]` | script catalog entries (folders, separators) | partial |
| `23.1.5.[id]` | accounts; key 16 name, key 6 password verifier, key 11 privilege set id (a count byte, then the id) | verified (names, privilege sets in 5 files) |
| `23.2.5.[id]` | privilege sets; see §3.1 | verified (names, all-table/layout/script settings) |
| `23.3.5.[id]` | extended privileges (`fmapp`, `fmxml`, …); `.5` lists the privilege set ids that have it, one per data chunk | verified (Flicks DDR) |
| `25.5.[id]` | fonts used | verified |
| `31.5.[id]` | image library (PNG data for button icons etc.) | names only |
| `32.5.[id]` | external data sources; key 130 = path list (`file:Name`) | verified |
| `33.5.[id]` | value lists; key 3 = custom values, one per line | verified (custom values) |
| `38.5` | file paths (e.g. `Files/Standards/`) | unclear |
| `64.5.[id]` / `65.5.[id]` | custom menu sets / custom menus | names only |

### 3.1 Privilege sets

`23.2.5.[id]` (ids 1-3 are the built-in sets, 1 = [Full Access], whatever the
file's language names them; checked against the Flicks DDR and private samples):

| Key | Meaning | Status |
|---|---|---|
| 16 | name | verified |
| 3 | comment | verified |
| 2 | byte 0: records in all tables, bits 0x10 view and 0x01/0x04/0x40 create/edit/delete (0x55 = create, edit and delete; 0x10 = view only); byte 1 is 03 in every sample | verified for 0x55 and 0x10; which bit is delete is inferred |
| `.9` key 4 / 33 / 17 | layouts / value lists / scripts: bit 0 = modifiable (and allow creation), bit 1 = view only (scripts: executable only). Seen 0xdf, 0xd7 (modifiable), 0xde, 0xd6 (view only) | verified; "no access" (neither bit) inferred |
| 10 | other options as a number: 0x9fff [Full Access], 0x0304 [Data Entry Only] and [Read-Only Access], 0x0302 a custom set, 0x0001 a set with no printing, exporting or password changes, 0x7000 another; printing, exporting, menus and idle disconnect are in here but not yet separated | not decoded |

Custom record, field, layout, value list and script privileges ("Custom
privileges…" in FileMaker) are not decoded yet: none of the sample files has
one. Design Reports of private solutions show the shape (per table Create/View/Edit/Delete
plus field access; per layout LayoutAccess and DataAccess), so a file with a
custom set is all that's needed.

Script options are on each script, both at the catalog entry
`17.1.7.[id]` and at `17.5.[id]`:

| Key | Meaning | Status |
|---|---|---|
| 240 | a number: 8 = include in Scripts menu, 1 = folder (4 also set on some folders, likely expanded), 2 = separator or end of folder | 8/1/2 verified against names and the Flicks DDR's includeInMenu |
| 241 | 1 = "Run script with full access privileges"; absent otherwise | inferred: set only on session clean-up scripts (`Clean up Session Records`, `Session On Last Window Close`) in one private sample and on web-sync scripts in another, scripts a developer would run with full access; no DDR to confirm yet |

Accounts (`23.1.5.[id]`): key 2 = 01 for external (identity provider)
accounts; key 10 is 0x08 + 8 bytes or 0x0b + 11 bytes, seemingly a
timestamp; where the active/inactive flag lives is still open.

Passwords (from [David Hamann's write-up](https://davidhamann.de/2024/06/17/how-does-filemaker-store-passwords/)):
the account's key 6 is `01`, a 10-byte salt, then a 20-byte PBKDF2-HMAC-SHA1
derived key (1 iteration) over the password XOR'd with a 30-byte constant, plus
a checksum. Key 4 is an MD5 over the account record, so editing accounts
directly triggers FileMaker's tamper check. We do not need to crack anything:
the plan is to keep verifying passwords with the same scheme so existing
logins keep working after migration.

## 4. Field definitions

`[table].3.5.[fieldId]`:

| Key | Meaning | Status |
|---|---|---|
| 16 | name | verified |
| 3 | comment | verified |
| 2 | definition bytes: `[0]` kind (1 normal, 2 calculation, 3 summary), `[1]` type (1 text, 2 number, 3 date, 4 time, 5 timestamp, 6 container) | verified for 1/2/3/5 types, inferred for 4/6 |
| child 5 | calculation (auto-enter or calc field formula): key 5 = tokenised source, key 6 = compiled byte code | partial |
| 2, byte 3 | auto-enter value: 0–4 creation date, time, timestamp, name, account; 5–9 the same for modification | verified (Flicks DDR, private samples) |
| 2, byte 9 | bit 0: global storage | verified on all 205 globals in the samples |
| 2, byte 11 | auto-enter flags: 01 creation/modification value (byte 3), 02 serial number, 04 constant data (in key 13), 08 calculated value (child 5), 80 replace existing value | verified on samples |
| 2, last two bytes | maximum repetitions | verified |

## 5. Records

`[table].5.[recordId]` holds one record. Each key-value chunk is one field
value (key = field id), stored as **text**: numbers, dates and times are kept
the way the user typed them, in the file's locale (US files use `M/D/YYYY`).
Key 252 is per-record bookkeeping (probably a modification count). A record
with no stored values still exists (FMburgh's Comics_Entry record 1).

Long values (over ~250 bytes) move one level down to
`[table].5.[recordId].[fieldId]` as parts keyed 1, 2, … in order (key 0 is
rich-text formatting). Repeating fields use a two-byte key: field id, then
repetition number (from fmptools issue #20).

Our reader returns the same text as fmptools for every one of the ~219,000
values in the Charts and FMburgh samples. The one difference is deliberate:
we also return records that have no stored values.

Not yet decoded: rich-text formatting runs, externally stored containers,
and how global fields are stored.

### Container fields (embedded storage, verified)

The record value is only a reference: the blob id as two hex digits plus
U+E000 (`"01\uE000"`), with key 0 = `0000000500000003`. Blobs are per table:

| Path | Meaning |
|---|---|
| `[table].31.5.[blob]` k2 | stream directory: u16 count, then 4-char tag + u32 size per stream |
| `[table].31.5.[blob]` kvlong `FNAM` | u32 count, u8 len + kind (`image`, `file`), u16 len + file name (XOR text) |
| `[table].31.5.[blob].[tag]` | the stream's bytes in segments 1..n (1000 bytes each); main tag is the type: `JPEG`, `PNGf`, … |
| `[table].31.5.[blob]` k4 | 16-byte content hash (not MD5 of the bytes); `[table].31.1.8.[hash]` maps it to the blob id, so duplicates are stored once |
| `[table].31.1.7` | list of blob ids |

Other streams seen: `SIZE`, `DPI_`. Hex ids are inferred from samples with at
most six blobs; a file with more than nine would confirm hex versus decimal.

### File options (`2`, key 24)

File > File Options > Open is key 24 of node 2: four flag bytes, two bytes of
login settings (not decoded), then the OnFirstWindowOpen script, the
OnLastWindowClose script and the "Switch to layout" layout, each as
`[n+1][n][id]` or `00` when unset (`readFileOptions` in schema.ts). Matched
against the script names in 20 sample files ("Trigger: OnFirstWindowOpen",
"On Last Window Close", "onOpen" and so on). Whether "Switch to layout" is
ticked is not decoded: 0x40 in the fourth flag byte is set in a private sample,
DEMO_drawers and FMburgh, whose stored layouts are startup screens, but clear
in two other private samples, which store "Splash" too.

## 6. Layout and script catalogs

Key 240 of a catalog entry is 8 bytes; the last byte has bit 0 set for a
folder, the value 2 for "end of folder", and bit 3 seems to mean "show in
menu". Items named `-` are separators. Open question: entries are keyed by
object id, and we have not yet found where the user's custom display order is
stored. Needs a sample file where layouts were reordered.

## 7. Scripts

Key 4 of `17.5.[id]` (or segment 4, when long) is the step list: 28-byte
records, one per step, in execution order. A step's parameters live at
`17.5.[id].5.[instance]`. Decoder: `packages/fmp12/src/script-params.ts`.
Verified against the Flicks Database Design Report (585 steps in the 11
scripts that match the report, every target and option checked by
`packages/fmp12/test/scripts.test.ts`) and against the step text of the
private samples.

| Byte(s) | Meaning |
|---|---|
| 2–3 | step instance id (keys the parameter tree) |
| 6–10 | first reference `[size][len][path int]`: the layout, script or table occurrence the step points at |
| 12–15 | second reference, same shape: the field, after a table occurrence |
| 19 | field repetition |
| 20–21 | step type id, the same ids as FileMaker's XML clipboard format; negated (0x10000 − id) when disabled |
| 22–23 | a choice: Go to Record 1 first, 2 last, 3 previous, 4 next, 5 by calculation; Go to Layout 1 original, 3 by name, 4 by number, 5 named |
| 24 | bit 1: Restore (Sort Records, Perform Find) |
| 25 | bit 1: On (Set Error Capture, Allow User Abort) |
| 26 | bit 6: has a calculation; bit 5: Exit after last |
| 27 | bit 7: no dialog; bit 4: the script is in another file |

Parameters are slots numbered from 128. Each slot holds a calculation at
`.[slot].5` (tokenised source in key 5) or text at key 1. Comment text is
slot 128 key 1. Per step:

| Step | Slots |
|---|---|
| Set Variable | 128 key 1 = name, 129 = value, 130 = repetition |
| Set Field | 128 = value; target field in record bytes 6–15 |
| Set Field By Name | 129 = target name, 128 = value |
| Show Custom Dialog | 128 = title, 129 = message, 133–135 = buttons |
| Go to Layout | 133 = layout name by calculation |
| Insert from URL and other "target" steps | 160 key 1 = target variable |
| Perform Script | key 32 = `[len][data source id]` for a script in another file; 129 = parameter |
| Go to Related Record | 128 key 17 = table occurrence of the layout to show |

Stored find requests (Perform Find, Enter Find Mode, Constrain, Extend with
Restore) are at `.6.6.[n]`, one node per request. Each criterion is a `0x1D`
chunk whose key is `00 [len][TO][len][field]` and whose value is the criteria
text. Key 252 = `0101` marks an omit request (inferred).

Stored sort order (Sort Records with Restore) is key 10: a u32 count, then per
field a TO reference, a field reference, `00 01`, two more references (the
summary field when sorting by summary), `00 01 00`, the order (0 ascending,
1 descending, 2 custom value list) and four zero bytes.

Step names come from the [MBS step list](https://www.mbsplugins.de/archive/2026-06-26/FileMaker_Script_Steps_over_ti).

## 8. Calculations (token stream decoded)

A calculation node has key 4 (context table occurrence) and key 5, the token
stream of the formula as written (a long one moves to segment 5 or child 5).
Key 6 is the compiled form (prefix order, no whitespace). Key 5 keeps spacing
and comments, so decoding it gives the author's text. Verified: all 614
formulas in the Flicks sample that could be paired with FileMaker's Database
Design Report decode to exactly the report's text.

| Token | Meaning |
|---|---|
| `0C 13 n … 00` | whitespace; `0E` same for `//` comments, `0D` for `/* */` |
| `13 n … 00` | string literal; n is the length in characters (two bytes, top bit set, past 127); CR shows as ¶ |
| `10` + 19 bytes | number: sign?, u16 integer limbs, `00 10`, limbs of 9 decimal digits (integer, then two fraction limbs), `00 20` |
| `0B n name 00 00` | Let variable; `1A n name` for `$` / `$$` variables |
| `16 flags (tag len ref)… rep` | field: tag 04 = table occurrence, 02/03 = field; flags & 4 = written as `TO::field` |
| `1B 14 len n id` | custom function call |
| `1D 00 00 15 owner(4) u16` | external function; owner `FMDR` = design functions (LayoutIDs = 9) |
| `9B`, `9C n` | `Get`, and its parameter |
| `03 04 05 06 07` | `;` `(` `)` `[` `]` |
| `F8`–`FD` + byte | two-byte function ids (JSON functions, Self, While, ExecuteSQL …) |
| other byte | one-byte function or operator |

The function, operator and Get tables in `packages/fmp12/src/calc.ts` hold
what the samples showed (about 100 ids); unknown ids decode as `⟨fn:xx⟩`.
Across all samples 96% of formulas decode with no unknown ids. A file with
one formula per FileMaker function would complete the tables.

## 9. Relationships (`3.251`)

Key 2: `04 03 <left TO ref> 04 03 <right TO ref> …`, longer than 22 bytes when
the relationship sorts. Child `.3` holds one kv per predicate: an operator
byte (0..6 read as = ≠ < ≤ > ≥ ×; only = and × are confirmed) and two tagged
refs (tag, length, path integer; tag 02 = field, 04 = table occurrence). The
last byte of key 2 holds each side's options: 0x01 / 0x02 delete related
records in the right / left table, 0x10 / 0x20 allow creation in the right /
left table, 0x40 / 0x80 sort the right / left side. Flicks' Design Report
confirms 0x10; the rest fit how every relationship in the private samples is
used (subtype pairs carry 0x03, line items 0x11, sorted line items 0x51).

Table occurrences (`3.17`) key 2: `02 01 <data source id> 03 02 <base table>
<4 × float32 graph box> … <RGBA in the last 4 bytes>`. Data source 0 is this
file; others point at `32` (external files).

## 10. Layout designs (`4.5.[layout]`, protobuf)

Since FileMaker 12 a layout's design is stored as protocol buffer messages
(no `.proto` ships with FileMaker; field meanings below come from comparing
samples with the Database Design Report). Positions of all 120+ objects in the
Flicks sample match the report. Code: `packages/fmp12/src/layouts.ts`.

| Where | Meaning |
|---|---|
| kv 11 | theme id (length-prefixed) |
| kv 241 | 8 bytes; byte 6 holds the view the layout opens in: 0x02 List, 0x40 (with 0x02) Table, neither Form. Inferred from layout names and parts across ten sample files (a private sample's list layouts, FMburgh "Comics_Normalized" is a table); bit 0x08 and the other bytes are unknown |
| segment / child 2 | settings: 2 = table occurrence + 0x104000, 7 = layout style, 8 = width |
| `.3.[n]` k2 | part: 1 kind (0 title header, 1 header, 2 leading grand summary, 3/5 sub-summary, 4 body, 6 trailing grand summary, 7 footer, 8 title footer, 12/13 top/bottom navigation), 4 top, 5 height, 6 sub-summary break field (`08 [len] 00`, then the table occurrence and field as length-prefixed ids), 10 style |
| `.5.[obj]` k1, k16 | object text (labels, button captions, tab names) and object name |
| `.5.[obj]` 141, 6, 3 | object formulas as calc token streams: 141 hide condition, 6 placeholder text, 3 tooltip |
| `.5.[obj]` 17.128.5 | a Perform Script button's script parameter (calc token stream) |
| `.5.[obj]` 2 (buttons) | a button bar segment's label calculation (calc token stream); one private sample has 921 literal labels and 457 calculated ones |
| `.5.[obj]` k13 (fields) | data formatting, a fixed block whose fields follow the Design Report's NumFormat/DateFormat/TimeFormat grammar (flag values from the DDR grammar, offsets checked against a private sample and Charts). Number: 2 flags (u16: 0x0001 no formatting, 0x0002 thousands separator, 0x0004 notation, 0x0008 fixed decimals, 0x0010 percent, 0x0020 Boolean, 0x0100 general, 0x0400 notation outside negative, 0x0800 leading currency, 0x1000 negative color, 0x2000 blank if zero; 0x0200 and 0x4000 unknown), 4 character style, 5 negative style (0 -12, 1 12-, 2 (12), 3 <12>, 4 12 CR, 5 triangle), 6 currency symbol (UTF-16, 6 chars), 18 thousands separator, 20 decimal point, 22 negative color (r, g, b, 0), 26 decimal digits, 28 / 44 Boolean true / false text (8 chars). Date: 60 format (0 as entered, 1 custom, 2 numeric, 3 Dec 25, 2014, 4 December 25, 2014, 5 / 6 the same with the day name, 7 long numeric), 61 character style, 62 month and 63 day padding (0 none, 1 zero, 2 space), 64 separator (u16), 66 four custom elements (1 day, 2 short day name, 3 day name, 4 month, 5 short month name, 6 month name, 7 short year, 8 year, 9+ quarters and Asian eras), five separators around them at 70, 86, 102, 118, 134 (8 chars each). Time: 151 flags (0x01 hour, 0x02 minutes, 0x04 seconds, 0x08 as entered, 0x10 24-hour, 0x20 suffix before a 24-hour time, 0x40 AM/PM before the time, 0x80 separator), 152 character style, 153 hour and 154 minute/second padding, 156 separator, 158 AM, 174 PM and 190 24-hour suffix text (8 chars each); 213 bytes in all |
| `.5.[obj]` k10 (portals) | sort order: u32 count, then per field a length-prefixed occurrence and field (each itself length-prefixed), nine fixed bytes, `01 [order]` (0 ascending, 1 descending (inferred), 2 custom order) and, for a custom order, the value list as a length-prefixed id. a private sample's "primary first" portals use custom order by its Boolean list |
| `.5.[obj]` 37 (portals) | portal filter calculation (key 5 tokens, like 141) |
| `.5.[obj]` 138.[128+n] | conditional formatting, one child per condition in order: 5 the formula; k13 the format, a protobuf whose 1 is a mask of what applies (2 text color, 4 fill color, 128 icon color; inferred) and 2 a style (as object 5); bold is stored on (2) or off (1) |
| `.5.[obj]` 7 | the object: 1 type, 2 id, 3 flags (bit 0 hide condition also applies in Find mode, inferred; bits 28–31 anchor left/top/right/bottom), 4 bounds (top, left, bottom, right as doubles), 5 style, 6 child ids, 8 field, 10 graphic, 13 tab control, 15 portal, 16 button, 17 popover button |
| object 8 | field: 2.1 table occurrence + 0x104000, 2.2 field id, 3 repetitions, 5 control (0 edit, 1 pop-up, 2 drop-down, 3 checkbox, 4 radio, 6 calendar), 6 value list |
| object 16 | button: 3 the script step (1 step id, 4 parameters as [length][count][bytes]), 4 icon image, 5 icon size, 6 icon position (0 text only, 1 icon only, then the icon at 2 top, 3 bottom, 4 left, 5 right of the text: Button Setup's order and the DDR's ButtonObj displayType) |
| object 15 | portal: 2 table occurrence, 6 rows, 7 first row |
| object 13 | tab control: 3 tab height, 5 default front panel (1 and 2 unknown: 8/0 on Charts, 280/40 on a private sample's centered tabs) |
| object 14 | tab panel: 2 its tab's left offset in the strip, 3 its width (FileMaker works these out from the justification and tab width settings) |
| object 21 | button bar active segment: 1 the choice (0 a segment, 1 None, 2 Specify), 2 the segment's object id; Specify's calculation is in `.5.[obj]` 142 and returns the segment's object name (one private sample keeps "" in many; another's stage bar uses `"Status0" & Opportunity::…`). Matches Button Bar Setup's options in the Claris help |
| `.13` | Table View columns |

Object types: 1 field, 2 text, 3 graphic, 4 line, 5 rectangle, 6 rounded
rectangle, 7 oval, 8 group, 9 portal, 10 button, 11 tab control, 12 tab panel,
13 web viewer or chart (`CHRT`), 14 popover button, 15 popover, 16 slide
control, 17 slide panel, 18 button bar. Children of portals are positioned
relative to the portal, one pixel in.

Merge fields in text are `<<` + `01 02 0E` + hex field reference + `>>`.
Symbols in newer files are `{{1000 + n}}`, where n is the id of a Get ( )
function in the calc token table: `{{1007}}` Get ( FoundCount ), `{{1019}}`
Get ( TotalRecordCount ), `{{1020}}` Get ( RecordNumber ). Checked against
a private sample, whose "Showing {{1007}} of {{1019}} Records" object hides
with `Get ( FoundCount ) = Get ( TotalRecordCount )`. Field merges use the
`<<...>>` form above instead.

**Themes** (`6.5.[theme]`, child 22) are compiled style sheets: 1 = element
defaults (1 element id, repeated for contextual rules such as "text in a
header" = 32, 70; 2 rules), 2 = named styles (1 name, 2 rules, 3 element).
A rule is 1 part (1 the object, 2 its text, 4 its icon), 2 state (1 normal,
2 hover, 3 pressed, 4 focus, 7 checked, 18 placeholder) and 3 properties.
Property ids: 1 background image or gradient, 7 background color, 20–23 border
colors, 24–27 border styles, 28–31 border widths, 32–35 corner radii, 64 font
(font table `25.5.[128+n]`), 65 bold (2 on, 1 off), 67 italic (2 on, 1 off; a private sample's placeholders), 69 size, 70 color, 72 line spacing (unit 9 is "lines": one line is the font's own line height, about 1.2 times its size),
74 alignment, 101–104 padding, 122 shadow, 504 strikethrough and 505 underline (1 on, 0 off; underline inferred from link-like file name fields and button focus states in a private sample, strikethrough by elimination), 514 icon color, 611 vertical
alignment, 621 icon size. Units: 6 = points, 7 = em, 1 = percent. Elements
inherit: edit boxes and other field controls (61–68) from "field" (60), parts
from "part" (30).

**Image library** (`31.5.[id]`): pictures and button icons, stored like
container blobs. A pasted picture can hold a PDF with a JPEG or PNG preview.

**Charts** are object type 13 with external id `CHRT`. Child 139.138 is a
big-endian blob: u32 at 8 is the chart type (0 column, 1 bar, 2 line, 3 area,
4 pie, 6 stacked column, 7 stacked bar, 8 bubble, 9 scatter); u32s at 44 and 48
are the background gradient colors; u32 at 113 is 3 when found-set data is
summarized; u32 at 117 is the data source (1 current record, 2 found set,
3 related records, followed for related by a tagged table occurrence id: tag 4,
length, path value). Text styles are records `u32 13, u16 font, u16 style,
u16 flags, u16 size, rgba`; the second starts at 132 (later when the related
block is present), and from it +0, +40, +61, +101, +122 and +147 are the title,
x labels, x title, y labels, y title and legend. The series count is the u32 at
that record + 164. Formulas are object children k, read at `k.5`: 128 title,
129 x title, 130 y title, 131 categories, then 133+2i data and 134+2i name for
series i; scatter and bubble x values follow at 133+2n+2i, bubble sizes at
133+4n+2i. The value axis minimum and maximum are children 142+2k and 143+2k, used when the byte at the second font record + 260 + 25k has 0x10 (minimum) or 0x20 (maximum); the blob is 1110 + 25k bytes long, not counting a related table occurrence (inferred: the sample's random 1–10 charts fix 0–10, its 0–100 scores 0–100).

Not decoded yet: which views Layout Setup allows (settings field 3 is 0 on
most layouts but 1–30 on some), properties 66 and 68 (seen only in Charts, always 1), and web viewer URLs.

## Open questions to answer with more sample files

1. External container storage (secure/open) paths.
2. Confirming the join operators beyond = and ×.
3. Where custom layout and script order is stored.
4. Field options: validation, auto-enter serials, indexing, global storage.
5. Layout objects: positions, styles, portals, buttons, web viewers.
6. Encryption at Rest (`HBAMe`) files: needs the key from the user; algorithm unknown.

## A file saved by FileMaker 26 (Meetings sample, 2026-10-15)

Read from a small starter-solution file the owner re-saved in Pro 26.0.1. The file itself is not kept in the repo (the
solution is Claris's); only these byte-level facts are.

- **It opens and converts with no change to the reader.** The header is the same as in every older fixture: `HBAM7`,
  version 12, `25JAN11`, creator `Pro 12.0`. 130 blocks, 3 tables, 2 layouts, 3 scripts, 2 accounts, 3 privilege sets.
  The conversion report is clean, all 3 scripts run, and the layout census finds nothing wrong in 65 layout objects.
  The sample has no records, so a data round trip is untested on it.
- **Root key 2, keys 8 and 9** list the apps and builds that saved the file as XOR text: `Pro 19.0.1` then `Pro 26.0.1`
  (key 8), builds `209029999` and `260010051` (key 9; 26.0.1 build 51). Flicks and InterMediator_TestDB carry the same
  26.0.1 build number in their key 9.
- **Key 217 is new.** Every catalog object in the sample (base tables, fields, table occurrences, relationships, layouts,
  scripts, value lists, themes, the external-container directory list) has a 16-byte key 217 beside the key 216 UUID. No
  older fixture has it. Meaning unknown (a second identifier); the reader ignores it.
- **Key 218 on fields** is XOR text on the five fields every new table gets (`PrimaryKey`, `CreatedBy`, `ModifiedBy`,
  `CreationTimestamp`, `ModificationTimestamp`): `#_FMI_0` on four of them and `#^FMI* #_FMI_0` on `PrimaryKey`. Meaning
  unknown; the reader ignores it. (Key 218 in PortableCode39-2 is on layout objects, a different thing.)
- **Not in this sample: base-table comments, field annotations and field display names** (the 26.0 functions
  `BaseTableComment`, `FieldAnnotation`, `FieldDisplayNames`). A base table's node holds only its name and the
  216/217/251/252/31873-5 bookkeeping keys, and a field's node holds only the keys already read plus its comment
  (key 3) and key 218. No text such as `fm_common` or `fm_table_view` occurs anywhere in the file. So the file has none
  of them set, and how 26 stores them is still unknown. It needs a file with a table comment, a field annotation and
  display names set, plus a calculation field that calls the three functions (to learn their calculation function ids,
  which the reader writes as `FMDR:n`).
