---
id: script-step-16
title: "Go to Record/Request/Page"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Go to Record/Request/Page

Go to Record/Request/Page is a records and finds script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 16

## What the engine does

Moves the current record within the found set; a missing position reports error 101.
## Options

First, Last, Previous, Next or a calculated record number; Next and Previous can exit after the last record.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `101`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Go to Record/Request/Page
```

**Expected end state:** The step returns error `0`; the original record remains. No external action is attempted.
