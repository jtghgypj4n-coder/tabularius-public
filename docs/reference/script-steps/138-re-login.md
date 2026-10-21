---
id: script-step-138
title: "Re-Login"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Re-Login

Re-Login is a accounts and security script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 138

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Account Name:`, `New Password:`, `Password:`, `With dialog:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `1`, `3`, `212`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Re-Login
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
