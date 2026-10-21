---
id: script-step-82
title: "New File"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# New File

New File is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** error 3
- **Registry ID:** 82

## What the engine does

This step is unavailable in this engine and returns error 3.
No dispatch handlers; each reaches the error 3 fallback.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `3`. Other failures can arise from calculations or targets used by the step.

## Replacement

Create a local solution with the command-line tool before running a script.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
New File
```

**Expected end state:** On an offline synthetic file, the step returns error `3` and changes no records.
