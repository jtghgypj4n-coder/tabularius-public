---
id: script-step-48
title: "Paste"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Paste

Paste is a fields and values script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 48

## What the engine does

The engine handles this step with the limits described in the support notes.
With Select entire contents they replace (or copy, cut, clear) the whole field. Without it they work as Claris documents: Insert Text, Insert Calculated Result and Paste replace the selected text in the active field, or go in at its insertion point (the end of the field unless Set Selection moved it); into a field that isn't active, a container field or a calculated repetition they replace the whole value; into a `$variable` Insert Text and Insert Calculated Result add to the end. Cut, Copy and Clear take only the selected text, or the whole field when nothing is selected in it. In the web client, Paste with nothing copied or cut in the script pastes the text on the person's own clipboard; the browser may ask them first, and when it won't let the page read the clipboard they paste into a box. A run with no one to ask (a schedule, the Data API) pastes only what it copied. The decoder doesn't read the Select entire contents flag from a converted .fmp12 yet, so those steps act as with Select; it is read from script text and pasted XML.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Script text accepts `Select`; where the step runs, this selects the whole target. `Select: Off` preserves the current selection where supported.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `102`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Paste
```

**Expected end state:** The step returns error `102`; the original record remains. No external action is attempted.
