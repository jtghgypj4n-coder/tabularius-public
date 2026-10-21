---
id: script-step-71
title: "Loop"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Loop

Loop is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 71

## What the engine does

Repeats its body until an Exit Loop If condition or another exit stops it.
The Flush option changes nothing here: the web client keeps no record cache for it to flush, so every Flush setting behaves the same. Tabularius's own guard, which FileMaker doesn't have: a loop with a Go to Record/Request/Page step that is still on the record it started on after 10,000 passes is stopped, with the loop's line and the Go to Record step's line in the message.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use Exit Loop If with a Boolean calculation to stop repeating.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $n ; Value: 0 ]
Loop
  Set Variable [ $n ; Value: $n + 1 ]
  Exit Loop If [ $n = 2 ]
End Loop
Exit Script [ Text Result: $n ]
```

**Expected end state:** The script result is `2`; no record changes.
