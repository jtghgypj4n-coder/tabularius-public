---
id: script-step-131
title: "Insert File"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Insert File

Insert File is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 131

## What the engine does

The engine handles this step with the limits described in the support notes.
The picture, PDF, and audio/video variants share the Insert File handler. The file's contents are always stored in the container, whatever the “store only a reference” option says: the web client has no way to keep a reference to a file on the person's computer, and Claris says FileMaker Go uses Insert here too. Claris lists the step as not supported on FileMaker Server and the Data API, and WebDirect without the dialog and source-file options.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `800`, `802`, `809`, `850`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Insert File
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
