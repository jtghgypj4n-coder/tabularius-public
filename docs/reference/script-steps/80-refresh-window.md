---
id: script-step-80
title: "Refresh Window"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Refresh Window

Refresh Window is a layouts and windows script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 80

## What the engine does

The engine handles this step with the limits described in the support notes.
In the web client, after Freeze Window a Show Custom Dialog, Insert from Index or Insert from Device opens over the screen as it was, until Refresh Window or a Pause shows what the script has done; the freeze ends with the script. The Sort dialog repaints first (it lists the layout's fields). Refresh Window's options (flushing cached join results) do nothing, and runs with no browser do nothing with either.

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
Refresh Window
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
