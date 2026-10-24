---
id: script-step-227
title: "Configure RAG Account"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Configure RAG Account

Configure RAG Account is a ai and models script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 227

## What the engine does

The engine handles this step with the limits described in the support notes.
Work on the server's own RAG spaces, which need the embedding model (`--ai-embed-url`, `--ai-embed-model`); without it, or offline, error 3. Configure RAG Account only names the account: its endpoint and key are never read. A space belongs to the file whose script made it, and the file's AI switch, personal data isolation and the account's AI privilege apply. **Add Data** takes text (From Text) or a PDF or text container (From Container; the async variants run the same way); From File reads a PDF or text file from the server's documents folder only (up to 50 MB; a path outside it is error 100). A file link inside Documents is refused with an 'is a link' error. Tokens per Text Chunk accepts 75 to 512, uses the server default when omitted or 0, and returns error 887 outside that range (Claris). **Send Prompt** embeds the prompt and takes the closest chunks. Claris documents `similarity_threshold` as -1 to 1 and `num_top_ranked_results` as 1 to 100, with 0 explicitly meaning no RAG context; values outside the engine's -1..1 and 0..100 ranges are clamped, not refused, and this behavior is unverified against the compatible product. The default result count is 5 and default threshold 0. The engine also supports `keyword_weight` (0 to 1, default 0), which blends how many of the question's words a chunk holds into its score; this parameter and chunk overlap aren't documented by Claris. A missing RAG space or model's error behavior is also undocumented, so the engine keeps its current behavior. Prompt-template `:question:` and `:context:` are filled in. **Remove Data** drops documents by `id`, or the whole space. There is no ANN index: a search compares every chunk, but a searched space's vectors are kept in memory (up to 256 MB per server process; changes by any process are picked up), so at 768 dimensions a search of a full space takes about 70 ms (about 0.7 s when the space is too big for the memory and is read from disk each time). A space holds at most 50,000 chunks. **GetRAGSpaceInfo ( ragAccountName {; spaceID} )** gives the file's spaces as `{"rag_space_list":[{"space_id","model"}]}`, or one space as `{"rag_space_id","model","entries","values":[{"id","filename"} or {"id","text"}]}`; a space that isn't there answers `[RAG Space] error. Reason: RAG space {id} not found`, and an account that wasn't set up answers `?` (a space's model is empty when the data was added before the server kept it). Send Prompt's options and the From Text / From File data keys are inferred, not read from a sample, so a step read from a .fmp12 may need its prompt set again in the step.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Use the Script Workspace or script text to supply the target and any positional options the step requires.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `877`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $state ; Value: "offline" ]
Exit Script [ Text Result: $state ]
```

**Expected end state:** The script result is `offline`; no external action is attempted. The named step needs the capability described above.
