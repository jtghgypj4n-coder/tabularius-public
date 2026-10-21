---
id: script-step-11
title: "Insert from Index"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Insert from Index

Insert from Index is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 11

## What the engine does

The engine handles this step with the limits described in the support notes.
In the web client the person picks a value from the field's View Index (up to 2,000 values, only from records the script's privileges can see). With an explicit target the field is set to the value; without one it goes in at the active field's insertion point, or over it all with Select. Cancel is error 1. With no one to ask (a server-side run, the Data API) it is error 3, as on FileMaker Server.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Script text accepts `Select`; where the step runs, this selects the whole target. `Select: Off` preserves the current selection where supported. Accepted script-text labels: `Target:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Insert from Index
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
