---
id: script-step-6
title: "Go to Layout"
area: script-steps
since: unknown
status: works
verified: f200448e0
---

# Go to Layout

Go to Layout is a layouts and windows script step. This page describes how the offline Tabularius engine handles it.

- **Support:** works
- **Registry ID:** 6

## What the engine does

Changes the current window’s layout after resolving the named or calculated destination.
## Options

Choose a named layout, the original layout, or a layout name calculated at runtime. Accepted script-text labels: `Layout Name:`, `Layout Number:`.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `105`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Go to Layout [ “Examples” ]
Exit Script [ Text Result: Get ( LayoutName ) ]
```

**Expected end state:** The current layout is `Examples`; the script result is `Examples`.
