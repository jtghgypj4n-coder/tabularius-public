---
id: script-step-18
title: "Check Selection"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# Check Selection

Check Selection is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** error 3
- **Registry ID:** 18

## What the engine does

This step is unavailable in this engine and returns error 3.
No dispatch handlers; each reaches the error 3 fallback.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Script text accepts `Select`; where the step runs, this selects the whole target. `Select: Off` preserves the current selection where supported.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `3`. Other failures can arise from calculations or targets used by the step.

## Replacement

There is no direct offline replacement for this step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Check Selection
```

**Expected end state:** On an offline synthetic file, the step returns error `3` and changes no records.
