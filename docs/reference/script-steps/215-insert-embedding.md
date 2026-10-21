---
id: script-step-215
title: "Insert Embedding"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Insert Embedding

Insert Embedding is a ai and models script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 215

## What the engine does

The engine handles this step with the limits described in the support notes.
Need an embedding model on the server (`--ai-embed-url` and `--ai-embed-model`, any OpenAI-compatible endpoint; `--ai-embed-url ollama` or `lmstudio` runs one on the same computer with no key, see [local-embeddings.md](../../local-embeddings.md)); without one they stop with error 3. Embedding input is text-only; Insert Embedding in Found Set sends Parameters' MaxRecPerCall records per call (default 20) and honours Replace target contents and Continue on error when written in the script editor; a step read from a file always replaces, since those options aren't decoded yet. Query by Image sends the picture in Text to the server's image embedding model (`--ai-image-embed voyage`, see [local-embeddings.md](../../local-embeddings.md#searching-by-image)); without one it is error 3.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $state ; Value: "offline" ]
Exit Script [ Text Result: $state ]
```

**Expected end state:** The script result is `offline`; no external action is attempted. The named step needs the capability described above.
