---
id: script-step-85
title: "Allow User Abort"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Allow User Abort

Allow User Abort is a script flow script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 85

## What the engine does

Controls whether a web-client user may stop the active script.
Allow User Abort decides whether the person can stop the script in the web client (the Stop note, Esc or ⌘-period); runs with no one to stop them aren't affected. With Set Error Capture off, a step that fails shows its error to the person in the web client, with Continue and Cancel (Cancel halts the script); runs with no one to answer carry on. No dialog for a person's own cancel (1), a step this server can't run (3), a trigger's cancel (20), running off the end with Go to Record or Go to Portal Row (101), or a menu command (which tells its own result); that these show none is inferred. FileMaker's own dialog text isn't copied: ours names the error and the step.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

On or Off.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Allow User Abort [ Off ]
Exit Script [ Text Result: "done" ]
```

**Expected end state:** The script result is `done`; no record changes.
