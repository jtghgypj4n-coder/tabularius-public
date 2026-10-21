---
id: script-step-81
title: "Scroll Window"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Scroll Window

Scroll Window is a layouts and windows script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 81

## What the engine does

The engine handles this step with the limits described in the support notes.
Home, End, Page Up, Page Down and To Selection scroll the person's window in the web client, in the order the steps ran, once the window shows what the script left; runs with no window (schedules, the Data API) do nothing. Page Up and Page Down move by the window's height less a line. In a script read from an .fmp12 file the option is taken as the dialog lists it (1 Home to 5 To Selection), inferred because no sample file has the step; script text and the Script Workspace carry it by name.

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
Scroll Window
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
