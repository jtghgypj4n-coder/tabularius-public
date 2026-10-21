---
id: script-step-164
title: "Perform Script on Server"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Perform Script on Server

Perform Script on Server is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 164

## What the engine does

Starts the named script on the server and optionally waits for its result.
## Options

Choose a script, an optional parameter and whether to wait for completion.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `104`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Perform Script on Server
```

**Expected end state:** The step returns error `104`; the original record remains. No external action is attempted.
