---
id: script-step-36
title: "Export Records"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Export Records

Export Records is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 36

## What the engine does

Writes the chosen local records and fields in a supported format to the documents folder.
Supports CSV, tab-separated, merge, XLSX, FileMaker XML (FMPXMLRESULT, chosen by a .xml name) and HTML table (.htm/.html). “Specify XML and XSL Options” work from script text: `Grammar: FMPXMLRESULT` (the default) or `FMPDSORESULT` (an element per field named as Claris describes, a DATA per repetition of a repeating field; a field name that is not an XML name, such as one that starts with a digit, is error 954) and `XSLT: “file.xsl”` (a style sheet in the documents folder run over the grammar, writing its XML, HTML or text under whatever file name the step gives; a failed transform is error 719). A repeating field exports every repetition (group-separated in comma-, tab-separated and merge text, one DATA each in XML), or only the one the field order names; Excel and HTML give its first. Excel writes dates, times and timestamps as real date cells (formatted yyyy-mm-dd, hh:mm:ss, yyyy-mm-dd hh:mm:ss), which is Tabularius's choice: what Claris writes is not known. Other formats explicitly fail; the chosen text encoding is UTF-8 or UTF-16 (UTF-16 text starts with a byte order mark so it reads back through Import Records).

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Choose a destination, output format and field order. Accepted script-text labels: `With dialog:`, `Create folders:`, `Fields:`, `Grammar:`, `XSLT:`.

## Privileges

Export privilege for the target file.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `9`, `100`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Export Records
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
