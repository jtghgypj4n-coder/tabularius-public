---
id: script-step-180
title: "Refresh Portal"
area: script-steps
since: unknown
status: not-yet
verified: f200448e0
---

# Refresh Portal

Refresh Portal is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** does nothing
- **Registry ID:** 180

## What the engine does

The engine accepts this step but does not perform its named action.
Returns successfully without an action.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `116`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Refresh Portal
```

**Expected end state:** With no target supplied, the step returns `116` and leaves the synthetic file’s records unchanged.
