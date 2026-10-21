---
id: script-step-152
title: "Save Records as Snapshot Link"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Save Records as Snapshot Link

Save Records as Snapshot Link is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 152

## What the engine does

The engine handles this step with the limits described in the support notes.
Writes the found set's record IDs, or only the current record's with Current record; the view is the one the window shows (form, list or table, as View As left it) and the toolbar is always shown.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `With dialog:`, `Create folders:`.

## Privileges

Export privilege for the target file.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `9`, `100`, `800`, `802`, `809`, `850`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Save Records as Snapshot Link
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
