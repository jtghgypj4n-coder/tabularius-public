---
id: script-step-67
title: "Perform AppleScript"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# Perform AppleScript

Perform AppleScript is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** error 3
- **Registry ID:** 67

## What the engine does

This step is unavailable in this engine and returns error 3.
Explicitly throws error 3.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `3`. Other failures can arise from calculations or targets used by the step.

## Replacement

Use server-side script steps or a local command outside the script engine.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Perform AppleScript
```

**Expected end state:** On an offline synthetic file, the step returns error `3` and changes no records.
