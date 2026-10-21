---
id: script-step-76
title: "Set Field"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Set Field

Set Field is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 76

## What the engine does

Evaluates the value calculation and writes it to the named field of the current record.
## Options

Choose a field and a calculation for its new value.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `101`, `201`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
New Record/Request
Set Field [ Examples::Name ; "Mira" ]
Commit Records/Requests [ With dialog: Off ]
Exit Script [ Text Result: Examples::Name ]
```

**Expected end state:** One local Examples record has `Name = Mira`; the script result is `Mira`.
