---
id: script-step-87
title: "Show Custom Dialog"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Show Custom Dialog

Show Custom Dialog is a layouts and windows script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 87

## What the engine does

The engine handles this step with the limits described in the support notes.
Error 3, with the message "Show Custom Dialog is not supported in scripts run without a person"; no button is pressed, no input is filled, Get ( LastMessageChoice ) keeps its value, and the run's warnings name the script once. In the web client, where a person can answer, the dialog opens as before. Claris's [Show Custom Dialog page](https://help.claris.com/en/pro-help/content/show-custom-dialog.html) marks the step unsupported in FileMaker Server and the Data API but does not say which error or Get ( LastMessageChoice ) value a script gets there; error 3 follows how this engine treats other unsupported steps, so it is inferred.

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
Show Custom Dialog
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
