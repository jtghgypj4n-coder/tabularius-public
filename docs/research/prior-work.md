# Prior work and sources

## Reading FileMaker files

| Project | What it covers | Use to us |
|---|---|---|
| [evanmiller/fmptools](https://github.com/evanmiller/fmptools) (C, MIT) | Reads tables, fields and records from fp3/fp5/fp7/fmp12; exports to Excel, JSON, SQLite. Its `HACKING` file is the best public format description. | Our opcode table and SCSU decoder are ported from it (credited in NOTICE). We used its output to cross-check every record value. It does not decode layouts, scripts, relationships or security, and it misreads record ids above 16511. |
| [romein/go-fmp](https://codeberg.org/romein/go-fmp) (Go + Rust, MIT, 2025–26) | "Parser and writer" for fmp12, work in progress, based on fmptools, fmplib and fp5dump. | The only other project that aims to *write* fmp12. Its host blocks our tools, so we have not read it yet; worth a manual look before we build a writer. |
| [qwesda/fp5dump](https://github.com/qwesda/fp5dump) | The older fp5 format only. | Background. |
| [David Hamann: how FileMaker stores passwords](https://davidhamann.de/2024/06/17/how-does-filemaker-store-passwords/) (2024) | Account storage at path 23.1.5, PBKDF2-SHA1 verifier layout, tamper checksum. Found by debugging FMDataMigration. | Lets us keep existing logins working without knowing passwords. |
| [MBS: FileMaker script steps over time](https://www.mbsplugins.de/archive/2026-06-26/FileMaker_Script_Steps_over_ti) | Every script step with its numeric id. | Step names in our script decoder. |

Commercial tools (FMPerception, BaseElements, Inspector Pro) analyse
solutions through FileMaker's DDR or XML exports, not the binary file.

## FileMaker's own export paths

- **Save a Copy as XML** (FileMaker Pro 18+; menu, script step, and on
  Server): writes schema, layouts and scripts as XML, with formulas as text.
  Needs full access, and the format changes between versions. This is our
  ground truth for decoding calculations, layouts and scripts from the binary,
  and a fallback import path for files we can't yet parse.
  ([Claris help](https://help.claris.com/en/pro-help/content/save-a-copy-as-xml.html))
- **Database Design Report (DDR)**: older XML/HTML schema report.
- **FMDeveloperTool / FMDataMigration** (ships with FileMaker Server): command
  line tools that open fmp12 files. Useful for producing test files.
- **FMUpgradeTool** (ships with FileMaker Server, or the command-line tools
  installer): applies an `FMUpgradeToolPatch` XML file of Add/Replace/Delete
  actions to a closed .fmp12, and from FileMaker 26 builds a new .fmp12 from
  an FMSaveAsXML file (`--generateDBFile`). Our route for writing changes
  back; see [write-back.md](write-back.md).
  ([Claris help](https://help.claris.com/en/app-upgrade-tool-guide/content/index.html))

## Hosting and clients (for the next phase)

- FileMaker Pro and Go talk to FileMaker Server on TCP port 5003 with a
  proprietary protocol (encrypted with TLS in current versions; not verified
  by us). No public documentation or reverse-engineering of it turned up.
  Reimplementing it so that unmodified FileMaker Pro can connect would be the
  hardest and riskiest part of the project.
- FileMaker Server also exposes the **Data API** (REST/JSON) and **OData**.
  These are documented, so we can offer compatible endpoints: existing
  integrations, web apps and tools that speak the Data API would work
  against our server unchanged.

## Legal note (not legal advice)

Reverse engineering a file format for interoperability is generally
protected (US DMCA §1201(f), EU Software Directive art. 6), and file formats
themselves are not copyrightable. Claris's EULA prohibits reverse engineering
FileMaker software, so we work from files and public sources, not by
disassembling Claris binaries. We do not ship Claris code, and the name
"FileMaker" is a Claris trademark, so the project uses its own name.
Worth a real lawyer's look before the repo goes public.
