---
id: script-step-246
title: "Open PDF"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Open PDF

Open PDF is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 246

## What the engine does

The engine handles this step with the limits described in the support notes.
Open PDF opens a PDF from the documents folder, or from a container field or variable, to add to and save with Close PDF; only one PDF is open at a time (error 833). Append PDF adds every page of another PDF to the end of the open one (error 829 when none is open); Save Records as PDF with Currently open PDF adds its pages after them. The original file is not touched unless Close PDF writes to the same path; an Open PDF closed with nothing added writes the same bytes. Errors: 830 the file is not found or is not a PDF, 831 an encrypted PDF without a password, 832 an encrypted PDF given a password (encrypted PDFs are not decrypted here). Pages are copied as they are; links between pages of the same file are kept, but outlines, form fields, named destinations and the document information of the sources are not carried over. Script text only (`From: File ; “a.pdf”` or `From: Source ; Source: $pdf`, `Password: calc`); the binary options of a converted file are undecoded, so those steps answer error 3.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Open PDF
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
