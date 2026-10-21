---
id: script-step-115
title: "Allow Formatting Bar"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# Allow Formatting Bar

Allow Formatting Bar is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** does nothing
- **Registry ID:** 115

## What the engine does

The engine accepts this step but does not perform its named action.
Show nothing, but keep the setting for the window the script is in (a new window starts with all three off), so Get ( TextRulerVisible ), Get ( AllowFormattingBarState ) and Get ( TouchKeyboardState ) give what the script set, for as long as the script runs. They are 0 until a script sets them, as Claris documents for a server or WebDirect. Only scripts written in the script editor set them; the same steps in an imported .fmp12 file or pasted FileMaker XML still do nothing, as their options aren't read yet.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Allow Formatting Bar
```

**Expected end state:** With no target supplied, the step returns `0` and leaves the synthetic file’s records unchanged.
