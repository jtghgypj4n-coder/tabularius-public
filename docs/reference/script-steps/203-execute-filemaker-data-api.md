---
id: script-step-203
title: "Execute FileMaker Data API"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Execute FileMaker Data API

Execute FileMaker Data API is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 203

## What the engine does

The engine handles this step with the limits described in the support notes.
`options.prohibitmode: "script"` may write fields that prohibit modification; `entrymode: "script"` skips validation set to "only during data entry" (fields validated "Always" are still checked). An update's `fieldData.deleteRelated` removes portal rows.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Script text accepts `Select`; where the step runs, this selects the whole target. `Select: Off` preserves the current selection where supported. Accepted script-text labels: `Target:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `800`, `802`, `809`, `850`, `1708`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Execute FileMaker Data API
```

**Expected end state:** The step returns error `1708`; the original record remains. No external action is attempted.
