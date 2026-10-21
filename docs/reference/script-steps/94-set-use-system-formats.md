---
id: script-step-94
title: "Set Use System Formats"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Set Use System Formats

Set Use System Formats is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 94

## What the engine does

The engine handles this step with the limits described in the support notes.
Changes the flag Get ( UseSystemFormatsState ) reports; formatting keeps using the formats saved with the file. Claris supports the step in FileMaker Pro and Go only, not in WebDirect, Server or the Data API, so this matches what those do.

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
Set Use System Formats
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
