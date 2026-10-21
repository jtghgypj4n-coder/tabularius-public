---
id: script-step-137
title: "Enable Account"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Enable Account

Enable Account is a accounts and security script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 137

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Full access to the file, or a script configured to run with full access.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `9`, `213`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Enable Account
```

**Expected end state:** The step returns error `213`; the original record remains. No external action is attempted.
