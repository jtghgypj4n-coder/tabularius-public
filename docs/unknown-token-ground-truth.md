# Unknown token evidence (r17e-07)

No ID in this item has been assigned a guessed name. In particular, claims in
`function-ids-from-scan.md` are not decoder-table evidence.

## Behavior and public documentation

| Unresolved input | Behavior in Tabularius | Documentation and limits |
| --- | --- | --- |
| Calculation tokens `0x39`, `0x89`, `0xa2`, `0xfb0a`, `0xfd01`, `0xc8` | Preserve `⟨fn:…⟩`; parse as a call node, including bare tokens; return text `?` without evaluating arguments or dispatching to a plug-in/custom function. | [Claris functions reference](https://help.claris.com/en/pro-help/content/functions-reference.html) describes named functions, not these binary IDs. Their identities/behavior remain unverified; `?` is the requested conservative fallback, not a claim about a particular FileMaker function. | <!-- known-difference: SQL and calculations ;; What FileMaker's own binary function, design-function, Get-option and step IDs that the reader cannot yet name do is unverified; Tabularius gives ? (or error 3 for a step) and names none of them ;; A calculation using one of these returns ? where FileMaker computes a value ;; A clipboard XML of the same calculations paired with the file by tabularius pair-tokens, or a FileMaker run -->
| Design functions `FMDR:2`, `FMDR:6`, `FMDR:13` | Preserve the owner/index marker and use the same `?` fallback. | [Claris design functions](https://help.claris.com/en/pro-help/content/design-functions.html) documents names/signatures, but does not establish these owner/index mappings. |
| Get options `0x22`, `0x36`, `0x4d`, `0x5d`, `0x6a`, `0x73`, `0x79` | Preserve `⟨get:…⟩`; return `?` before calling host Get callbacks. | [Claris Get list](https://help.claris.com/en/pro-help/content/get-functions.html) documents named options, not numeric mappings. No elimination-based mapping is used. |
| Step IDs `0`, `513` (and any other uncatalogued ID) | `Unknown step N`; do not evaluate parameters; log a warning, set error 3, and continue. | [Claris server-side script behavior](https://help.claris.com/en/pro-help/content/running-scripts-on-server.html#Handling_unsupported_script_steps) documents skipping unsupported steps with error 3. [Error codes](https://help.claris.com/en/pro-help/content/error-codes.html) defines 3 as command unavailable. Neither page names these binary step IDs. |

Execution notices contain IDs, never arguments. Script results expose them in
`warnings`; standalone calculation hosts may receive them through
`CalcContext.notice`. An unexecuted branch generates no notice. Existing missing
field/function and misspelled-function errors retain their behavior. MBS dispatch
and its existing error text are unchanged; this item adds no MBS function behavior.
Scripts remain offline by default and AI-run scripts remain offline; no network
permission switches are changed.

The conversion report includes `unknownTokens` with kind, ID, placeholder name,
use count, file count and up to five structural shapes. Each per-database report
has `files: 1` per ID, even when it occurs several times. Shapes contain only AST
kinds/arity, never literal values or user-defined names. Duplicate copies of a
step formula in `calculations[]` and `params` count once. Disabled steps are
excluded, following the existing report convention. Existing undecoded-function
and unsupported-step sections remain available; the text summary also lists the
new information, including unknown Get options.

## Read-only pairing command

<!-- docs-example: illustrative -->
```sh
tabularius pair-tokens path/to/file.fmp12 path/to/clipboard.xml
```

The existing importer in `packages/store/src/snippet.ts` reads clipboard
`fmxmlsnippet` XML with direct text/CDATA inside `Calculation` elements. This
command reuses that XML reader without importing or applying design changes.
UTF-8 and BOM-marked UTF-16 LE/BE are accepted. Save a Copy as XML is explicitly
rejected: the repo currently serializes that format and reads its UUIDs, but does
not import its calculation definitions. A DDR document is also not clipboard XML.

The command reads calculation token streams from schema and layout definitions;
it never reads record values, uses solution credentials, executes a calculation,
runs a script, converts a file, or creates sidecars. Binary handles are closed on
success and failure. Errors are fixed messages that do not echo input content or
paths. Tests construct binary files and clipboard XML in temporary directories.

Pairing compares parsed tree shape, known function names/operators, and leaf
values/references. Checking the leaves makes matching deliberately conservative:
renamed references and changed literals do not pair. Complete-tree alignment must
succeed before any evidence is retained. Ambiguous matching trees all contribute;
a conflicting name prevents promotion. Names are observations from the supplied
XML, not documentation of function behavior or permission to change a decoder.

Output is JSON containing token IDs, counts, observed identifiers, candidates when
eligible, and numeric skipped-parse counts. Function names are printed only when
listed in `FUNCTIONS`, `FILEMAKER_FUNCTIONS` or `PLUGIN_FUNCTIONS`; Get-option names
must be in `GET_NAMES` or the decoder's Get table. Other XML-side identifiers,
including custom functions and unknown Get arguments, appear as `name#` followed
by the first eight hexadecimal digits of SHA-256 of the lowercase identifier.
These anonymous IDs are stable across runs and case changes and are used in both
`tokens[].names[].name` and `candidate`. No calculation text, file names, object
names, literal values or formula fingerprints are printed. Malformed calculations
count as skipped, never as evidence. Function identifiers outside the conservative
ASCII identifier syntax are not proposed.

- `agreements`: distinct matching decoded/XML expression pairs supporting that
  name. Multiple positions for the same ID/name in one pair count once.
- `independent`: maximum number of supporting pairs that do not reuse either
  normalized decoded expression or normalized XML expression. Repeated imports,
  repeated XML nodes, comments, whitespace and function-name case cannot inflate
  this count.
- `candidate`: emitted only for a single unanimously observed name with at least
  three independent pairs. An unknown ID with no complete alignment has an empty
  names list. Nothing updates decoder tables automatically.

The first slice handles ordinary calls, nested expressions and Get options. Bare
unknowns evaluate safely, but pairing them with named bare constants/functions,
functions with special parsing such as Let, non-ASCII function identifiers,
renamed contexts, and Save a Copy as XML/DDR adapters are follow-ups. Step-name
pairing needs script-definition evidence rather than calculation-text alignment.
No plug-in handle API is introduced by this item; the file-handle lifecycle is
covered in the command tests.

## Public Get names missing from GET_PARAMS

Compared on 2026-10-16 against the [public Get list](https://help.claris.com/en/pro-help/content/get-functions.html)
and `packages/fmp12/src/calc.ts`: 138 documented names, 90 present and **48 absent**.
The table also has the legacy `LastODBCError` name, which is not in the current
public list (91 table entries total). This is a decoder-name comparison, not a
claim about runtime Get support or which FileMaker release supplied any gap.

The owner can request generated binary/text pairs for these names. Collect at
least three distinct expressions per option, with matching text from the same
file. The numeric gaps `0x22`, `0x36`, `0x4d`, `0x5d`, `0x6a`, `0x73`,
`0x79` remain unknown; the list below is deliberately not mapped to those gaps.

- `AccountGroupName`
- `AccountPasswordDaysRemaining`
- `AccountType`
- `ActiveRecordNumber`
- `ApplicationArchitecture`
- `CacheFileName`
- `CacheFilePath`
- `ConnectionAttributes`
- `CurrentExtendedPrivileges`
- `CurrentPrivilegeSetName`
- `CurrentTimeUTCMicroseconds`
- `DocumentsPathListing`
- `EncryptionState`
- `FileLocaleElements`
- `FileMakerPath`
- `GuidedAccessState`
- `HighContrastState`
- `InstalledFMPluginsAsJSON`
- `LastErrorDetail`
- `LastErrorLocation`
- `LastStepTokensUsed`
- `LayoutCount`
- `MenubarState`
- `NetworkType`
- `OpenDataFileInfo`
- `PageCount`
- `PreferencesPath`
- `PrinterName`
- `RegionMonitorEvents`
- `RequestCount`
- `RequestOmitState`
- `RevertTransactionOnErrorState`
- `ScreenDepth`
- `ScreenScaleFactor`
- `ScriptAnimationState`
- `SessionIdentifier`
- `SystemLanguage`
- `SystemLocaleElements`
- `SystemNICAddress`
- `SystemStorageAvailable`
- `TouchKeyboardState`
- `TransactionOpenState`
- `TriggerCurrentPanel`
- `TriggerExternalEvent`
- `TriggerGestureInfo`
- `UseSystemFormatsState`
- `WindowOrientation`
- `WindowUUID`
