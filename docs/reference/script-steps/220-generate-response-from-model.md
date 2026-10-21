---
id: script-step-220
title: "Generate Response from Model"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Generate Response from Model

Generate Response from Model is a ai and models script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 220

## What the engine does

The engine handles this step with the limits described in the support notes.
Agentic mode, tools, and streaming are not decoded. Message History Count retains that many previous question/answer pairs.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $state ; Value: "offline" ]
Exit Script [ Text Result: $state ]
```

**Expected end state:** The script result is `offline`; no external action is attempted. The named step needs the capability described above.
