---
id: script-step-62
title: "Pause/Resume Script"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Pause/Resume Script

Pause/Resume Script is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 62

## What the engine does

The engine handles this step with the limits described in the support notes.
In this engine, an interactive indefinite pause commits or reverts each open record before waiting for the person. A pause without a responder and a duration-based pause leave edits pending. Whether FileMaker commits at an interactive pause is unverified; matching behavior is not claimed.

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
Pause/Resume Script
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
