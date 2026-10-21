---
id: script-step-217
title: "Set AI Call Logging"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Set AI Call Logging

Set AI Call Logging is a ai and models script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 217

## What the engine does

The engine handles this step with the limits described in the support notes.
Account API key/endpoint are ignored; Set AI Call Logging performs no operation; templates are retained for Perform Find by Natural Language and Perform SQL Query by Natural Language (the SQL prompt's :schema: and :question:, and the natural-language prompt's :question:, :sql_query: and :sql_results:, are filled in).

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
Set AI Call Logging
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
