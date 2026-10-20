# r22-09 PDF output conformance audit

## Main inventory and scope

`main` already had a PDF 1.4 writer, append support for classic and selected PDF 1.5 cross references, layout printing, sub-summary pagination, portal rendering, image XObjects, Page Setup parsing, and generated tests for some script paths. This change did not rebuild those features or read fixture or corpus files.

## Verified here

- The generated structure checker follows every classic xref offset, checks the trailer, catalog, page tree, content stream lengths and balanced graphics/text/marked-content operators, embedded TrueType font subsets with ToUnicode maps, image XObjects, metadata, and absence of external references. An independent `pdffonts` read reported `emb yes`, `sub yes`, and `uni yes` for the generated sample.
- Generated multi-page lists cover sub-summary page breaks, portal rows, a container image, RTL text, a combining mark, and emoji. Extracted text follows print order. A Save Records as PDF script covers a three-record found set with a 1 MB text field and an empty found set.
- A 501-page layout-and-writer run with 500 distinct images and one repeated image checks structure and extraction, confirms no emitted chunk exceeds 128 KiB, checks heap growth stays below 64 MiB, and confirms completed layout pages are not retained. A wide layout test checks physical page size and margin origin from Page Setup. Ordinary Save Records as PDF writes an atomic replacement file while laying out and serializing one page at a time. Twelve Latin font styles and one monochrome emoji font have fixed OFL subsets reproducible with the checked-in standard-library script. A separate rendered sample showed simple Hebrew and a single-codepoint emoji visibly, while `pdffonts` confirmed their embedded CID subsets and ToUnicode maps.
- Generated tests invoke no child process. The script integration test places stubs for `launchctl`, `systemctl`, `sc`, `git`, `npm`, `curl`, and `sudo` on `PATH` and fails if a stub runs.

## Remaining conformance gaps

- **Memory beyond the tested 501-page path:** unverified. Streaming layout keeps one rendered page and generates ordinary print items lazily. Cross-reference offsets and page IDs scale with page count; found-set IDs and sub-summary break values scale with record count. Multi-column pagination still collects its print items, and append/open-PDF workflows still hold their pages.
- **Browser Print to PDF:** unverified. It uses the browser's print renderer rather than the server PDF writer; the generated checker does not receive its output.
- **Complex-script shaping, full bidirectional layout, emoji sequences, and colour management:** unsupported. Simple Hebrew runs, combining accents that normalize to a supported glyph, and selected single-codepoint emoji render; other unsupported glyphs remain extractable through ActualText but appear as replacement glyphs. Images use device colour spaces without ICC profiles.
- **Claris behaviour for overwide layouts and unsupported glyphs:** unverified. The physical PDF sheet now follows Page Setup, and content beyond the sheet is clipped.
