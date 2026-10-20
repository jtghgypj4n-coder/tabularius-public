# DynaPDF stage 2: bounded offline import slice

This builds on stage 1's script-session document handles. All input PDFs come from container bytes. Import performs no file, URL, credential, or network lookup; the script engine's existing offline and AI-run network policy is unchanged. No external PDF references are resolved or retained.

## Public behaviour and supported calls

| Call and public documentation | Implemented | Deferred or refused |
| --- | --- | --- |
| [OpenPDFFromContainer](https://www.mbsplugins.eu/DynaPDFOpenPDFFromContainer.shtml) | Opens a validated, unencrypted container as the current import source; returns a nonnegative number. A successful open replaces the previous source. It does not add working pages. Omitted password type, 0, and 1 with an empty password are accepted. | Encryption, nonempty passwords, repair flags, malformed/unsupported PDFs, containers without bytes, paths and URLs. |
| [GetImportPageCount](https://www.mbsplugins.eu/DynaPDFGetImportPageCount.shtml) | Counts source pages separately from working pages. | No open import source. |
| [CloseImportFile](https://www.mbsplugins.eu/DynaPDFCloseImportFile.shtml) | Returns OK and releases the current import source; imported working pages remain usable. | Invalid document handles return `?`. |
| [ImportPDFFile](https://www.mbsplugins.eu/DynaPDFImportPDFFile.shtml) | Imports every source page at working page count + 1, closing the current page on success; returns the last destination page number. The documented default destination, 1, works for an empty document. Omitted or explicit unit scales are accepted. | Overlapping destinations, gaps, and non-unit scaling. Overlap is not implemented as insertion: the [public manual](https://www.monkeybreadsoftware.com/DynaPDF-Manual/ImportPDFFile.shtml) describes overlaying existing pages. |
| [ImportPDFPage](https://www.mbsplugins.eu/DynaPDFImportPDFPage.shtml) | Appends the specified 1-based source page, closes the current page on success, and returns OK. Repeated selections and selections from successive sources are supported. | Missing/out-of-range indices and non-unit scaling. The public function page does not specify the omitted index's default, so this slice does not invent one. |
| [SetImportFlags](https://www.mbsplugins.eu/DynaPDFSetImportFlags.shtml) | Accepts the documented MBS default, `ImportAll ImportAsPage`, as whitespace/return-separated names or unsigned numeric value 2415919102. Returns OK. | Other combinations, including content-only, template conversion, AllPageObjects and PrepareForPDFA. Unsupported requests leave the accepted configuration intact. |
| [AppendPage](https://www.mbsplugins.eu/DynaPDFAppendPage.shtml) | Appends a blank page and returns OK, retaining current dimensions and the previous crop box. Accepts the optional 0/1 DontSetFont argument within stage 1's standard-font implementation. | Unsupported arguments; the existing stage 1 page-limit error remains in use. |
| [EditPage](https://www.mbsplugins.eu/DynaPDFEditPage.shtml) | Opens an existing working page, including imported pages, for stage 1 drawing; appends blank pages when the requested index exceeds the current count. Returns OK; EndPage closes it. Imported contents remain intact and added drawing uses a Form XObject with separate resources. | Invalid indices, cap overruns, editing while another page is open, general content repair, tagging and complete imported graphics-state reconstruction. |

The public pages describe errors but do not publish exact error text for all malformed, encrypted, unsupported, or out-of-range cases. Those cases return the existing plug-in-missing result, `[MBS] ERROR: DynaPDF.<Function> is not available in Tabularius`; they do not fabricate vendor-specific error wording or negative error codes. Invalid/released document handles retain stage 1's `?`. Errors inside parsing or copying never escape through the MBS boundary as raw exceptions.

## PDF copying and limits

The shared page-tree reader carries inherited MediaBox, CropBox, Resources and Rotate down the tree. Both `pdf()` and `appendPdf()` can write imported pages. References are remapped structurally; resource names, PDF strings and stream bytes are not rewritten with regular expressions. Content-stream arrays keep their order, and repeated references to fonts and images in one source remain shared. Independent sources have separate reference maps. Added pages explicitly override destination-tree inheritance.

The format rules follow the [Adobe PDF Reference](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.5_v6.pdf), particularly page objects, inheritance, resource dictionaries and streams.

Supported input is the static PDF subset with classic cross-reference tables, including bounded incremental revisions; direct or indirect stream lengths; unfiltered, FlateDecode or DCTDecode streams. Flate streams are validated with bounded inflation. Catalogs carrying interactive/document-level features are refused rather than silently losing those features under ImportAll. The import reader is stricter than the existing best-effort text extractor.

Local limits, not claims about vendor limits:

- 32 live document handles and 500 working/import pages per document.
- 16 MiB input and retained source bytes per document; 64 MiB retained source bytes per script session.
- 10,000 input cross-reference entries (plus the free entry), a conservative 10,000-object/drawing budget for retained sources and working pages, and 10,000 copied output objects.
- 8 MiB per raw/decoded stream, less than 16 MiB total decoded Flate bytes, 200,000 parsed object tokens, nesting depth 64 and 32 cross-reference revisions.
- A conservative 16 MiB output budget enforced while constructing objects, before an import commits working pages.

Source replacement, page imports and page expansion validate limits before committing. A failed import preserves the old source, page list and current drawing page. Failed drawing-count reservations roll back. Releasing a document drops its import state with its working pages.

## Follow-up

Compressed cross-reference and object streams; additional stream filters; encrypted input/decryption and repair; nonzero object generations; PDF 2.x; scaling and overlapping imports; remaining import flags; annotations, forms, outlines, tagging and other catalog features; full graphics-state reconstruction during EditPage. Unsupported paths keep returning the missing result until their public behaviour and bounded implementation are covered.

## Verification

Generated stage 1 PDFs cover the handle lifecycle, script-calculation dispatch, import/edit/save round trips, inherited attributes, shared and colliding references, binary stream preservation, indirect lengths, incremental files, cap rollback, encrypted/malformed/external inputs and deterministic truncation/mutation fuzzing. Fuzz assertions allow 10 seconds with a 15-second test timeout; ordinary runs take well under one second. No test reads a corpus or contacts a real server.

Final validation on Node 22: `npm run typecheck` passed; 47 targeted tests passed, 0 failed (41 import/reader/script/server tests plus 6 generated-input PDF writer tests). Every test command used `--test-concurrency=2`. The 41-test run took 3.87 seconds; the writer run took 0.94 seconds. The fuzz case took 73 ms against its 10-second assertion. Fixture-dependent PDF writer cases were excluded by the `^PDF:` name filter.
