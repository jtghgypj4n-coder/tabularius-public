---
id: script-step-172
title: "Open Upload to Host"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# Open Upload to Host

Open Upload to Host is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** error 3
- **Registry ID:** 172

## What the engine does

This step is unavailable in this engine and returns error 3.
Throws error 3 (command unavailable) in a server-side script. Reference-client behavior is unverified.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `3`. Other failures can arise from calculations or targets used by the step.

## Replacement

There is no direct offline replacement for this step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Open Upload to Host
```

**Expected end state:** On an offline synthetic file, the step returns error `3` and changes no records.
