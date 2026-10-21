---
id: script-step-214
title: "Perform SQL Query by Natural Language"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Perform SQL Query by Natural Language

Perform SQL Query by Natural Language is a ai and models script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 214

## What the engine does

The engine handles this step with the limits described in the support notes.
The model sees the chosen tables as DDL, with only the tables and fields the account can see and no record data. Its SELECT runs as ExecuteSQL does, with the account's privileges, and a query that fails goes back to the model with its error, up to three tries in all; if none runs, the step returns error 1200 (a guess, since Claris doesn't document it). Get DDL never asks the model. Query sends the result (up to 500 records) back to the model for an answer in words. Query for Data Only returns the rows as ExecuteSQL does (commas and returns). Get SQL returns every query the model wrote, one per line. Get First SQL Only returns the first query without running it. When the model finds nothing relevant, its reason is the response and the error is 0. The options are read from script text only, because no .fmp12 sample has the step, and the script-text labels for the tables (Tables, Table Names, DDL) are guesses. Options by JSON data, Stream, Parameters and Perform JavaScript in Web Viewer are kept but not used.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `1200`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`. The example uses no mail, network or plug-ins.

```script
Perform SQL Query by Natural Language
```

**Expected end state:** The step returns error `3`; the original record remains. No external action is attempted.
