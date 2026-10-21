---
id: script-step-157
title: "Install Plug-In File"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Install Plug-In File

Install Plug-In File is a files and output script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 157

## What the engine does

The engine handles this step with the limits described in the support notes.
Off (error 3) until an administrator runs `tabularius plugins <folder> script-install on`. Then it installs a `.ohplugin` package from the server's documents folder (file name only, as Insert File), if the script has full access and the package is signed by a publisher already trusted (`plugins/trusted-publishers.json`): an unsigned package, an untrusted publisher, or a plug-in another publisher signed is refused with error 3 and the reason, and a script without full access gets error 9. Installing does not turn the plug-in on for any file: that stays `enabled.json`. Each install and each refusal is in the file's security log ("Plug-ins"). The stored-file option is read as Insert File's is, not yet seen in a .fmp12.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Full access to the file, or a script configured to run with full access.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `9`, `800`, `802`, `809`, `850`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $state ; Value: "offline" ]
Exit Script [ Text Result: $state ]
```

**Expected end state:** The script result is `offline`; no external action is attempted. The named step needs the capability described above.
