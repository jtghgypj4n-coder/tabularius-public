---
id: script-step-144
title: "Save Records as PDF"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Save Records as PDF

Save Records as PDF is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 144

## What the engine does

Renders the selected records to a PDF in the documents folder.
Writes a PDF. Append adds the pages after those of the PDF already at that path (or writes a new one when there is none), as an incremental update that leaves the existing bytes as they were. It works on PDFs with a classic cross-reference table, as Tabularius makes, and on PDF 1.5 files with compressed cross-reference and object streams (Flate, with or without the PNG predictors), as many other writers make; an encrypted PDF, one compressed some other way, a damaged one, or one over 256 MB gives error 800 and is left unchanged. Append and Create folders are read from converted .fmp12 files too. Tabularius embeds TrueType subsets with ToUnicode maps for WinAnsi, simple Hebrew runs, and selected single-codepoint emoji. Unsupported characters remain extractable through ActualText but appear as replacement glyphs. Complex-script shaping, full bidirectional layout, emoji sequences, and colour management are unsupported.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Choose a destination, records and append or create options.

## Privileges

Print privilege for the target file.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `9`, `100`, `800`, `802`, `809`, `850`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Save Records as PDF
```

**Expected end state:** The step returns error `100`; the original record remains. No external action is attempted.
