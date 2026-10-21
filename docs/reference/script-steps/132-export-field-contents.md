---
id: script-step-132
title: "Export Field Contents"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Export Field Contents

Export Field Contents is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 132

## What the engine does

The engine handles this step with the limits described in the support notes.
In the web client the file goes to the person as a download named after the path's last part. On runs with no one to download to (schedules, the Data API, the command line) it is written to the documents folder, as Export Records is; it never writes outside that folder.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Create folders:`.

## Privileges

Export privilege for the target file.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `9`, `102`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Export Field Contents
```

**Expected end state:** The step returns error `102`; the original record remains. No external action is attempted.
