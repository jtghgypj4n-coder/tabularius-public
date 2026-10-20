# PDF font subsets

Tabularius embeds fixed TrueType subsets of Arimo, Tinos, Cousine, and monochrome Noto Emoji in server-generated PDFs. The font files here were generated with `scripts/subset-pdf-fonts.py` from the upstream files below. The script retains WinAnsi, selected Hebrew and combining-mark glyphs, and selected single-codepoint emoji with their composite components; it removes unused glyph outlines. `metrics.json` records PDF widths and descriptor metrics.

| Family | Upstream static files | License |
|---|---|---|
| Arimo | [Google Fonts Noto fonts snapshot](https://github.com/googlefonts/noto-fonts/tree/790fcd48bca4b240a8b4d768b5e6bade42ba339e/hinted/ttf/Arimo) | [Arimo OFL](arimo-OFL.txt) |
| Tinos | [Google Fonts Tinos](https://github.com/google/fonts/tree/main/ofl/tinos) | [Tinos OFL](tinos-OFL.txt) |
| Cousine | [Google Fonts Cousine](https://github.com/google/fonts/tree/main/ofl/cousine) | [Cousine OFL](cousine-OFL.txt) |
| Noto Emoji | [Google Fonts Noto Emoji](https://github.com/google/fonts/tree/main/ofl/notoemoji) | [Noto Emoji OFL](notoemoji-OFL.txt) |

The subsets retain the upstream copyright notices in their `name` tables. The PDF BaseFont names use a six-letter subset prefix. The same fixed subset is embedded once per used font style in a PDF; no system font or font package is needed at runtime.
