---
id: script-step-32
title: "Open Help"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Open Help

Open Help is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 32

## What the engine does

The engine has a handler for this step. Its effect depends on the named target and current script context.
## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Open Help
Exit Script [ Text Result: Get ( LastError ) ]
```

**Expected end state:** The script result is `0`; a web client opens the hosted guides at `/docs` after the script, and an offline run opens nothing.
