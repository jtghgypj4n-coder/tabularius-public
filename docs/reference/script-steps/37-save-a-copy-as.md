---
id: script-step-37
title: "Save a Copy as"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Save a Copy as

Save a Copy as is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 37

## What the engine does

The engine handles this step with the limits described in the support notes.
Needs full access. Always writes a Tabularius SQLite store named `<name>.openhbam.sqlite`; a `.fmp12` suffix in the requested name is changed. Clone keeps the design and accounts but empties the records. Compacted and self-contained copies are the same as a plain copy. An existing target gives error 300 (`ERROR.fileInUse`).

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `Create folders:`.

## Privileges

Full access to the file, or a script configured to run with full access.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `9`, `100`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Save a Copy as
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
