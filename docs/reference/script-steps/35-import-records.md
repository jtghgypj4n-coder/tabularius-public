---
id: script-step-35
title: "Import Records"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Import Records

Import Records is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 35

## What the engine does

Reads a local supported source and adds, updates or replaces records using the supplied mapping.
Add, Update matching, and Replace work with text or structured parameters; authored steps keep implicit Add. Binary steps with an undecoded mode return error 3 before source access or record changes, including binary Add imports. Binary action/match/add-remaining/auto-enter options are not decoded; clipboard import does not establish a mode. Explicitly author the mode and review these other options before running binary imports. Reads comma- and tab-separated text, merge, Excel, FileMaker XML and hosted FileMaker files (text saved as UTF-8, UTF-16 with its byte order mark, or Windows-1252, which is what is read when the bytes are not valid UTF-8; a .csv is read by the separator its first line uses, so a semicolon or pipe file comes in as columns, and a .txt is tab-separated unless every one of its first lines has the same number of semicolons or pipes; the step's own format wins over the file name; a quote that is never closed reads the rest of the file as one value, and a script has no place to say so, though the web client's import does; an Excel workbook is read from its first sheet, or from `Worksheet: “name”` in script text, error 715 when the workbook has no such sheet, and a workbook that counts days from 1904 is read as the same dates; FileMaker XML dates, times and timestamps are read by the file's DATEFORMAT and TIMEFORMAT; a leading apostrophe that a text export put before a minus sign or `=` is taken off for a number, date, time or timestamp field only), and a folder of files in the documents folder (script text only: `Folder: “name”`, `File type: Text files` or `Picture and movie files`, `Include enclosed folders: On`; up to 100 levels, files in path order, hidden files and aliases that leave the folder or lead to folders skipped; columns are Text Content, File Name, File Path, or Image (into a container), File Name, File Path, Image Thumbnail (always empty); File Path is relative to the documents folder; no “import only a reference” option); “Specify XML and XSL Options” (script text only: `XSLT: “file.xsl”`, a style sheet in the documents folder, applied to the XML source before the import reads it; the result must be FMPXMLRESULT, else error 954; a document or style sheet that does not parse is error 718, a failed transform 719; an HTTP request or calculation as the XML or style sheet source is not supported); repeating sources and targets are supported, but a mapping cannot name a repetition or use a repeating match field.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Choose a source, import mode and field mapping. Binary import modes with undecoded options return error 3. Accepted script-text labels: `With dialog:`, `Table:`, `Source:`, `Folder:`, `File type:`, `Include enclosed folders:`, `Fields:`, `XSLT:`, `Worksheet:`, `Match fields:`, `Add remaining data as new records:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `100`, `700`, `715`, `718`, `719`, `731`, `954`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Import Records
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
