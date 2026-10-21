---
id: script-step-168
title: "Set Layout Object Animation"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# Set Layout Object Animation

Set Layout Object Animation is a layouts and windows script step. This page describes how the offline Tabularius engine handles it.

- **Support:** does nothing
- **Registry ID:** 168

## What the engine does

The engine accepts this step but does not perform its named action.
Shows nothing, but Get ( ScriptAnimationState ) gives 1 after On and 0 after Off, for every window until the script ends (off to begin with, as Claris says).

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
Set Layout Object Animation
```

**Expected end state:** With no target supplied, the step returns `0` and leaves the synthetic file’s records unchanged.
