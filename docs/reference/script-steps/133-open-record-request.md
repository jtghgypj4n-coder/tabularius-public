---
id: script-step-133
title: "Open Record/Request"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Open Record/Request

Open Record/Request is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 133

## What the engine does

The engine handles this step with the limits described in the support notes.
Checks the record can be edited (error 200) and locks it until the script commits or reverts, as Set Field and the other field edits do; a record someone else is editing is error 301. Runs with no session or schedule behind them (the command line) check for others' locks but take none. In this engine, opening a record without editing it leaves Get ( RecordOpenState ) at 0. A Set Field to a related record is written immediately, so Revert Record does not undo it and it does not raise RecordOpenState. Whether FileMaker behaves the same way is unverified; matching behavior is not claimed.

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
Open Record/Request
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
