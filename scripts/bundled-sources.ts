// Code in this repository that was written from, or ported from, someone else's project. NOTICE credits each one,
// the software bill of materials (scripts/sbom.ts) lists each one, and packages/cli/test/release-notices.test.ts fails
// when a source file names another project's repository that is not listed here.

export interface BundledSource {
  name: string;
  /** The project's home. */
  url: string;
  /** The licence as the source file states it: an SPDX identifier when it gives one. */
  licence: string;
  /** What was taken: code, or a specification the code follows. */
  kind: 'code' | 'specification';
  /** Where it is used, relative to the repository. */
  files: string[];
  /** The `owner/repo` the files name it by. */
  repo: string;
  /** What each listed file says to name it (any one of these), so the list cannot name a file that does not mention it. */
  mentions: string[];
}

export const BUNDLED_SOURCES: readonly BundledSource[] = [
  {
    name: 'FMP Tools', url: 'https://github.com/evanmiller/fmptools', repo: 'evanmiller/fmptools', licence: 'MIT', kind: 'code',
    files: ['packages/fmp12/src/chunks.ts', 'packages/fmp12/src/scsu.ts'], mentions: ['evanmiller/fmptools'],
  },
  {
    name: 'BaseElements plug-in', url: 'https://github.com/GoyaPtyLtd/BaseElements-Plugin', repo: 'GoyaPtyLtd/BaseElements-Plugin', licence: 'BSD', kind: 'code',
    files: ['packages/calc/src/functions.ts', 'packages/fmp12/src/calc.ts'], mentions: ['GoyaPtyLtd/BaseElements-Plugin'],
  },
  {
    name: 'agentic-fm', url: 'https://github.com/petrowsky/agentic-fm', repo: 'petrowsky/agentic-fm', licence: 'Apache-2.0', kind: 'specification',
    files: ['packages/fmp12/src/script-params.ts', 'packages/fmp12/src/calc.ts'], mentions: ['agentic-fm'],
  },
  {
    name: 'FileMaker XML snippet specifications', url: 'https://github.com/andykear/FileMaker-XMLsnippet-Layout-Claude-Skill', repo: 'andykear/FileMaker-XMLsnippet-Layout-Claude-Skill', licence: 'CC-BY-4.0', kind: 'specification',
    files: ['packages/store/src/layout-snippet.ts', 'packages/store/src/snippet.ts', 'packages/store/src/snippet-xml.ts', 'packages/fmp12/src/layouts.ts'], mentions: ['andykear', 'Kear'],
  },
];
