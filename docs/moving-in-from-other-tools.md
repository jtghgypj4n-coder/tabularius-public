# Moving in from other tools

`tabularius import-tables` turns files exported from Airtable, Notion, Google
Sheets and Excel into new tables in a hosted file. It brings the data and the
links between records. It does not translate formulas.

<!-- docs-example: illustrative -->
```sh
tabularius import-tables <folder> Projects "Projects-Grid view.csv" "Tasks-Grid view.csv" --preview
tabularius import-tables <folder> Projects "Projects-Grid view.csv" "Tasks-Grid view.csv"
```

`--preview` prints the plan (each table, each column with the kind chosen for
it) and writes nothing. Without it the tables are made and the command prints
counts: tables, fields, rows, links, and what needed fixing. It needs no
account; it works on the folder as the operator. Importing as an account needs
Full Access, because it changes the file's design.

In the web client, an account with Full Access does the same in File > Import
Tables…: choose the files (including a Notion export ZIP) or a Notion export
folder, press Preview to read
the plan (each sheet's table, each column's field and type, and its first rows),
change any column's type from its pick box (or leave a column out, or make it a
link to another sheet), and press Import. The files are sent again for the
import, so a preview keeps nothing on the server. Imported tables appear in the
Layout menu straight away. The server route is `POST
/tabularius/design/v1/databases/{database}/import-tables`, in the
[REST reference](reference/rest.md).

## What each tool exports

| From | Export | What it becomes |
| --- | --- | --- |
| Airtable | CSV of a view (`Table-Grid view.csv`) | One table per file; the ` - Grid view` suffix is dropped from the name. Attachment cells contain a filename and URL; these are kept as text, not downloaded into a container field. |
| Notion | CSV of a database | One table per CSV; the page id Notion adds to the name is dropped. A relation column holds page titles, optionally with a link in brackets after each; both are read. |
| Notion | Markdown & CSV export ZIP, or a folder of extracted `.md` pages | CSV files become separate tables. Markdown pages in the archive become one table named after the ZIP; extracted folders become one table named after the folder. Each has `Title` from the first heading, `Property: value` lines as columns, and the remaining page text as `Body`. Other archive entries, including files and images, are ignored. |
| Google Sheets | `.xlsx` or CSV | As Excel and CSV below. Google Sheets offers downloadable copies in other formats, including Excel and CSV. |
| Excel | `.xlsx` | One table per sheet, named after the sheet. Cells are read as the workbook saved them. |
| Any | `.csv`, tab- or semicolon-separated text | One table. A byte order mark, quoted line breaks, rows shorter or longer than the header and repeated headers are handled. |

The first row holds the field names. Empty headers become `Column N`, repeated
ones get a number, `::` becomes `:`, and a name the file keeps for itself
(`ROWID`, names ending in `(n)`) gets ` field` added. Every table also gets an
`ID` field (a serial number; a column already called `ID` is renamed), which
links point at.

## Column kinds

Kinds are worked out from the whole column:

- **number**: plain numbers, with a sign, a currency sign or thousands
  separators. Codes with a leading zero (`01234`) and numbers of 16 or more
  digits stay text.
- **date** and **timestamp**: `2026-10-17`, `10/17/2026`, `October 17, 2026`,
  `17 Oct 2026`, with a time `14:30`, `2:30 PM`. When some value has a first
  part over 12 the dates are day first; when nothing shows the order they are
  read month first and the preview says so. A time zone on a timestamp (`Z`,
  `+02:00`) is dropped: the clock time as written is kept, and the report counts
  them.
- **time**: `14:30`, `2:30 PM`.
- **checkbox**: `checked`/`unchecked`, `yes`/`no`, `true`/`false`, as 0 and 1 in
  a number field.
- **select**: text with few different values (12 or fewer, over at least eight
  rows): a text field and a value list of the choices.
- **multi**: comma-separated choices from a small set: the choices on separate
  lines in one text field, and a value list.
- **link**: most of the column (90%) names rows in the first column of another
  file in the same import. See below.

Inference is a guess, so check the preview. `--set Sheet.Column=kind` overrides
it: a kind above (`text` is always safe), `skip` to leave the column out, or
`link:Sheet` to force a link. A value the chosen kind cannot hold is left empty
and counted. `--no-links` turns link detection off.

## Linked records

A linked-record column becomes a **join table** named after the table and the
column (`Tasks Project`), with the key of each side and the linked row's name
(copied, so a portal can show it), one row per link. Two relationships connect
it to the tables on either side, and the form layout of the table gets a portal
of the joined rows. The linked column itself is not kept as text.

Links are matched by the exact text of the other file's first column. A link
that names no row there is counted and left out; a name shared by several rows
links to the first, and is counted.

## What is not carried

- Formulas, rollups, lookups and automations: the export has their values,
  which arrive as plain data. The command says so every time.
- Attachments: Airtable's CSV puts a filename and URL in the cell, not the file.
  The importer keeps that cell as text and does not download it or create a
  container reference. Airtable says exported attachment URLs expire after a
  few hours.
- Views, filters, sorts, forms, permissions and comments.
- Row limits: at most 500,000 rows and 500 columns per sheet, and files up to
  256 MB.

## Not verified

The export formats above were written from how the tools' exports behave in
general and the examples they document; the importer has been tested with files
written to match them, not with exports from the products themselves. Formats
that differ by locale or by a tool's version may need `--set`.

Vendor export documentation: [Airtable grid view CSV exports](https://support.airtable.com/articles/5189551686-getting-started-with-airtable-views), [Notion Markdown & CSV ZIP exports](https://www.notion.com/help/export-your-content), [Google Sheets spreadsheet downloads](https://support.google.com/docs/answer/9330963), and [Excel workbook formats](https://support.microsoft.com/en-us/excel/save-a-workbook-in-another-file-format). These describe available exports; they do not guarantee every exported value shape is recognized by this importer.
