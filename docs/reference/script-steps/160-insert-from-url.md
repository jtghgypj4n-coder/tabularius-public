---
id: script-step-160
title: "Insert from URL"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Insert from URL

Insert from URL is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 160

## What the engine does

The engine handles this step with the limits described in the support notes.
Explicitly throws error 3 unless the run has network access or a fetch function.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Choose a URL calculation, a field or variable target, and optional cURL options. Network access is required.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `1626`, `1630`, `1631`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $state ; Value: "offline" ]
Exit Script [ Text Result: $state ]
```

**Expected end state:** The script result is `offline`; no external action is attempted. The named step needs the capability described above.
