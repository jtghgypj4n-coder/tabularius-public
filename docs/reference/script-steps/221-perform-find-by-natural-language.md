---
id: script-step-221
title: "Perform Find by Natural Language"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Perform Find by Natural Language

Perform Find by Natural Language is a ai and models script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 221

## What the engine does

The engine handles this step with the limits described in the support notes.
Get: Found Set, Found Set as JSON (a Data API find response, the found set unchanged) and Find Request as JSON (the generated query and sort, no find) all run. The model sees the current layout's field names only.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Get:`, `Account Name:`, `Model:`, `Prompt:`, `Prompt Template Name:`, `Parameters:`, `Response Target:`, `Target:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Perform Find by Natural Language
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
