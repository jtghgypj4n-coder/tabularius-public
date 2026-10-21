---
id: script-step-75
title: "Commit Records/Requests"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Commit Records/Requests

Commit Records/Requests is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 75

## What the engine does

Saves pending edits to the current record, applying validation and record triggers.
Skip data entry validation (on either step; for Open Transaction, every write inside the transaction) skips fields validated “Only during data entry” and still checks those validated “Always”. Open Transaction's Skip auto-enter options runs no auto-enter for writes inside the transaction, Import Records included. Both are read from .fmp12 files and script text; Commit's is also read from pasted XML. Override ESS locking conflicts has nothing to override. With Skip auto-enter options off, auto-enter runs as each record is written rather than all at Commit Transaction.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires. Accepted script-text labels: `With dialog:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
New Record/Request
Set Field [ Examples::Name ; "Mira" ]
Commit Records/Requests [ With dialog: Off ]
Exit Script [ Text Result: Examples::Name ]
```

**Expected end state:** The edit is committed; one Examples record has `Name = Mira` and the script result is `Mira`.
