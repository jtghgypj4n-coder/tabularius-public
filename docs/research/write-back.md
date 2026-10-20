# Write-back study: getting design changes back into a .fmp12

Tier 3 of the way-back-to-FileMaker plan. Tier 1 (`fmexport`, records as
FMPXMLRESULT) carries data out; tier 2 (`sync plan`, a client of FileMaker
Server's Data API, conflicts flagged for review) keeps data in step with a
live server. Neither touches structure. This study asks: when someone has
changed a solution in Tabularius (new tables and fields, edited scripts,
layouts, value lists), how do those changes get into a FileMaker file, and
which way should we build?

Status: research only, nothing here is built. Sources were checked on
2026-10-14; Claris pages are linked inline. Claims from third-party write-ups
are marked as such.

## Answer

Do not write the .fmp12 binary ourselves. Since FileMaker 2026 (version 26),
Claris ships a supported way to do both halves of the job from the command
line, and it takes the XML we already emit:

1. **New file from our XML**: `FMUpgradeTool --generateDBFile` builds a fresh
   .fmp12 from an FMSaveAsXML file. Records then go in with tier 1's
   FMPXMLRESULT export or tier 2's sync.
2. **Changes to an existing file**: `FMUpgradeTool --update` applies an
   `FMUpgradeToolPatch` XML file (Add, Replace and Delete actions in
   FMSaveAsXML's own element shapes) to a closed copy of the file.

Both are Claris tools that run on the user's machine with their own FileMaker
Server or command-line tools install, so we generate XML and drive the tool;
FileMaker does the writing. The clipboard snippets we already produce stay as
the no-install, by-hand path.

This corrects the handoff note (2026-10-13) that Claris documents no way to
rebuild a .fmp12 from Save as XML. That was true up to FileMaker 2025; the
FileMaker 2026 Upgrade Tool guide lists `--generateDBFile` for exactly that.
The README that `fmexport` writes, and the header of `store/src/fmexport.ts`,
still say there is no way back; they should be updated when tier 3 is built
(see follow-ups).

## Options compared

| Route | What it can write | Needs | Risk | Verdict |
|---|---|---|---|---|
| A. Write the .fmp12 binary directly | In principle everything | Full knowledge of the block store, indexes, free lists, checksums, encryption | Silent corruption of someone's only copy | **No** for now |
| B. `FMUpgradeTool --generateDBFile` from our FMSaveAsXML | Tables, fields, relationships, scripts, value lists (layouts reported broken, below) | FileMaker 26 Upgrade Tool on the user's machine | Low: writes a new file, never touches the original | **Yes**, first build |
| C. `FMUpgradeTool --update` with a patch | Add/replace/delete of most catalog objects in an existing file | Same tool; the target file closed; original object UUIDs | Medium: the tool can report success when it changed nothing | **Yes**, second build |
| D. Clipboard (`fmxmlsnippet`) | Tables, fields, scripts, steps, custom functions, value lists, layout objects | FileMaker Pro open, a person pasting | Low; by hand, one paste at a time | **Already built**; keep as the fallback |
| E. OData schema endpoints on a hosted file | Create/delete tables, add/delete fields, indexes | FileMaker Server, OData on, a privileged account | Low, but narrow | Not worth building now |
| F. SQL DDL over ODBC/JDBC | `CREATE TABLE`, `ALTER TABLE`, and in 26 `FOREIGN KEY` | ODBC/JDBC driver and sharing on | Low, narrow | No |

### A. Writing the binary ourselves

Our reader (`packages/fmp12`, see [fmp12-format.md](fmp12-format.md)) knows
enough to read every sample we have, which is much less than writing one
needs. A writer would have to keep FileMaker's B-tree of 4 KB blocks
consistent (index blocks, sibling pointers, the free list), update whatever
FileMaker's own consistency check and Recover look at, rebuild field indexes,
leave the account tamper checksum intact (see David Hamann's write-up in
[prior-work.md](prior-work.md)), and handle Encryption at Rest. None of that
has ground truth from Claris, and a file that opens today can fail its next
consistency check. The only other project aiming to write fmp12
(romein/go-fmp, work in progress) is unread because its host blocks our tools.

The cost is a long reverse-engineering project, and the failure mode is
damaging someone's solution. Routes B and C reach the same goal with Claris's
own writer, so A stays closed unless both fail in practice.

### B. A new file from FMSaveAsXML (`--generateDBFile`)

The [command-line parameters page](https://help.claris.com/en/app-upgrade-tool-guide/content/command-line-parameters.html)
of the current (FileMaker 2026) Upgrade Tool guide lists `--generateDBFile`:
"Creates a .fmp12 file from an FMSaveAsXML file", with `-src_path` (the XML)
and an optional `-plugin_folder`; the new file is written next to the XML,
with " Copy" appended if the name is taken. The
[FileMaker 2025 guide](https://help.claris.com/archive/fm22/en/app-upgrade-tool-guide/content/index.html)
has no such command, so this needs version 26 or later.

What it handles, from Codence's hands-on report
([FileMaker 26 for AI development](https://codence.com/resources/blog/technology/filemaker-26-ai-development),
third party): tables, fields, relationships, scripts and value lists "come
through cleanly"; layouts do not, since a field placed on a layout "comes out
empty", and a Save as XML read-back does not show the failure. Codence builds
the starting file by hand and patches it for that reason.

Fit with what we have: `store/src/saveAsXml` already writes base tables,
occurrences, fields, custom functions, value lists, relationships, field
calculations (as a ModifyAction pass) and security stubs. Scripts and steps,
layouts and themes, external data sources and custom menus are not emitted
yet. Two details matter for this route:

- **Envelope version.** We write `version="2.2.0.0"` (FileMaker 2025's
  format). FileMaker 26 overhauled Save as XML (UTF-8 output, catalog-level
  and multi-file exports, per Codence), so the tool may expect a newer
  version. Test against the 26 tool before relying on it.
- **Accounts.** We write accounts with no credentials (secrets rule). A file
  built from that XML needs a password set before anyone can open it with
  full access; the tool and the result should say so.

Records are not part of FMSaveAsXML. After the file is built, data goes in
with FileMaker's Import Records from tier 1's FMPXMLRESULT files, or by
pointing tier 2's sync at the new file once it is hosted.

### C. Patching an existing file (`--update`)

This is the route for "I tried Tabularius, changed some things, and want
those changes in the FileMaker file I still run". Facts from Claris's
[Upgrade Tool guide](https://help.claris.com/en/app-upgrade-tool-guide/content/index.html):

- The tool ships with FileMaker Server (Windows, macOS, Linux), or alone via
  the command-line tools installer. It "does not support migrating, adding,
  modifying, or deleting record data".
- `--update -src_path -patch_path [-dest_path] [-src_key] [-src_account
  -src_pwd] [-plugin_folder]`. The account needs full access or the
  `fmupgrade` extended privilege. Without `-inplace` it writes a copy; an
  existing destination fails unless `-force`.
- `--validatePatch` checks a patch against a file without writing anything.
- The source file must be closed.
- [The patch file](https://help.claris.com/en/app-upgrade-tool-guide/content/patch-file.html)
  has root `<FMUpgradeToolPatch version>` (the version must equal the
  FMSaveAsXML version of the file), a `Structure` element holding
  `AddAction`, `ReplaceAction` and `DeleteAction`, and a `Metadata` element
  for some File Options (21.1.1 and later). Add uses FMSaveAsXML's element
  shapes. Delete and Replace target objects by UUID: "All references must
  have UUIDs; otherwise, the action isn't performed."
- Not supported: saved finds; adding sub-objects to an existing container
  except fields to a table and steps to a script; changing a layout object's
  type or moving it to another layout; deleting the accounts or field
  catalogs or built-in privilege sets. A Replace whose container includes an
  `ObjectList` is "undefined behavior". Replace on layout objects covers only
  some object types.
- The [workflow](https://help.claris.com/en/app-upgrade-tool-guide/content/workflow.html)
  starts with `--generateGUIDs` on the original so every object has a GUID
  a patch can reference.

From third-party reports ([Soliant](https://www.soliantconsulting.com/blog/fmupgradetool-patch-filemaker-apps/),
[Codence: the patch method](https://codence.com/resources/blog/technology/filemaker-ai-foundations-the-patch-method)):

- The tool can report that a patch applied when it changed nothing, and a
  reused placeholder UUID "will silently misfile" objects. Every patch has to
  be checked by reading the result back with Save as XML (FMDeveloperTool's
  `saveAsXML` needs no in-file script) and comparing.
- Replace cannot edit script steps; the workaround is delete, then add the
  whole script again with its original UUID. Custom functions are the same.
- Parents must come before anything that references them, and a step that
  references a layout or field needs that object to exist (by UUID) in the
  target or earlier in the patch.

**The gap on our side is UUIDs.** Our reader does not surface FileMaker's
object UUIDs yet, and `saveAsXml` makes deterministic stand-in GUIDs from our
ids. They are fine for a new file (route B) but cannot target objects in the
user's real file. Two ways to close it:

1. Decode the UUIDs from the .fmp12 (they are in the file, because Save as
   XML prints them). This is a reader task with ground truth available: any
   file plus its own Save as XML gives the answer.
2. Ask for the user's own Save as XML of the target file and match objects by
   kind and FileMaker id (our ids are FileMaker's ids), taking UUIDs from it.

Option 2 works without new reverse engineering and doubles as the check that
the target is the file we imported from. Option 1 is better long term.

**Where the changes come from.** Every design change in Tabularius is
already a JSON op logged in `_fm_design_log` (`packages/store/src/design.ts`):
`createTable`, `createField`, `updateScript`, `deleteLayout` and so on. A
patch generator would replay the ops made since import, collapse them to a
net change per object (create then delete = nothing; several updates = one
Replace), and write one action per object in dependency order. Ops with no
patch equivalent (saved finds, moving a layout object between layouts,
anything on accounts) are listed for the user instead of being dropped.

**Conflicts.** If someone also changed the FileMaker file since the import,
a Replace would overwrite their change. Following the decision made for
tier 2 (flag, never overwrite), the generator compares the user's current
Save as XML with the one at import time (or our own export of the imported
schema) and holds back any object changed on both sides, listing it for
review with both versions.

### D. Clipboard snippets (already built)

`store/src/snippet-xml.ts` and `layout-snippet.ts` already write
`<fmxmlsnippet>` for tables, fields, scripts, steps, custom functions, value
lists and layout objects, and `snippet.ts` reads them back. A person pastes
them into FileMaker Pro. Codence reports this mechanism is unchanged in 26,
except that some AI script steps' XML names were corrected, so steps copied
from FileMaker 2025 with the old spellings fail to paste into 26. Paste
cannot create relationships (Codence). It needs no Server or extra tools, so
it remains the route for Pro-only users and for single objects.
`tabularius write-back` (ADMIN.md) builds a whole set from what changed since
import: numbered paste files in dependency order, and a list of what a paste
can't do (renames, deletions, edits in place, the relationships graph,
layouts).

### E. OData schema endpoints

FileMaker Server's OData API can
[create and delete tables and indexes](https://help.claris.com/en/odata-guide/content/modify-schema.html)
and [add fields to a table](https://help.claris.com/en/odata-guide/content/add-fields-into-table.html)
with SQL-style types (`varchar(25)`). It cannot touch calculations,
relationships, scripts or layouts. The user chose the Data API, not OData,
for tier 2, and this covers only the simplest part of write-back, so it is
not worth a second client.

### F. SQL DDL

FileMaker's ODBC/JDBC SQL accepts `CREATE TABLE` and `ALTER TABLE`, and 26
adds `FOREIGN KEY` (Codence). `ExecuteSQL` inside FileMaker only reads. Same
reach as E, with a driver to install; no.

## Proposed build order

Each step is its own PR. Nothing here writes to a FileMaker file the user
did not name, and nothing runs against a hosted file.

1. **Check the tool against our XML.** Blocked for now: the maintainer has no
   FileMaker Server install (2026-10-14), only FileMaker Pro 22 and 20. It needs the FileMaker 26 command-line tools,
   which Claris also ships as a tools-only installer. Once they are on a
   machine, run `--generateDBFile` on copies only, on `saveAsXml` output for
   the cleared fixtures (Charts, Beezwax), read the result back with
   FMDeveloperTool's `saveAsXML`, and record what survives. This settles the
   envelope version and what the tool rejects.
2. **`tabularius export --fmp12` (route B).** Emit scripts and steps in
   `saveAsXml`, then a command that writes the XML, runs
   `FMUpgradeTool --generateDBFile` if it finds it, verifies by read-back,
   and writes a report of what did not carry over (layouts first, until
   Claris fixes them). Without the tool it leaves the XML and tells the user
   the one command to run.
3. **Original UUIDs.** Take them from the user's Save as XML (option 2
   above): done, `uuidsFromSaveAsXml` reads them and `saveAsXml`'s `uuids`
   option writes them in place of the stand-ins. Decoding them from the
   .fmp12 stays a reader research item; none of our fixtures has a Save as
   XML to check against (the Flicks DDR carries no UUIDs).
4. **`tabularius patch` (route C), dry run first.** Like `sync plan`: build the
   patch from the design log, show the actions and the held-back conflicts,
   and run `--validatePatch`. Writing only on an explicit flag, always to
   `-dest_path` (never `-inplace`), followed by the read-back check, and the
   original left untouched.

Off limits throughout: any file that belongs to someone else, and any
hosted file. A hosted file must be closed for the tool to touch it; closing
it is the user's call, not ours.

## Parked until FileMaker's command-line tools are available

Steps 1, 2 (the `generateDBFile` run) and 4 need FMUpgradeTool on some
machine, and none of ours has it today. Until then the build continues on
what needs no Claris software: XML generation with real UUIDs (step 3), and
the clipboard path (route D), which a person applies by pasting in FileMaker
Pro. Layouts are better served by that path anyway while `generateDBFile`
drops fields placed on layouts.

## Follow-ups outside this study

- `store/src/fmexport.ts` (header and the README it writes) still says there
  is no way back from FMSaveAsXML. The accurate line, now in
  `save-as-xml.ts`: FileMaker 26's Upgrade Tool can build a new file from it;
  FileMaker Pro itself cannot import it.
