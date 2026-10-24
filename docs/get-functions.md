# Get ( ) answers in Tabularius

Get ( ) returns a value supplied by the host when one is available. The script engine supplies window, record and account values for a running script. An unknown name answers empty and records one notice per name and calculation context. Reader placeholders such as `⟨get:73⟩` still answer `?` with their own notice.

Get ( ApplicationVersion ) gives 'Tabularius Server 0.1', not a FileMaker version string; a script that reads a version number from it gets 0.1. The format FileMaker uses is not verified here. Get ( HostApplicationVersion ) gives the same string. <!-- known-difference: SQL and calculations ;; Get ( ApplicationVersion ) gives 'Tabularius Server 0.1', not a FileMaker version string; a script that reads a version number from it gets 0.1. The format FileMaker uses is not verified here. ;; A version parser sees 0.1 in both version options ;; A FileMaker run that records both version answers -->

For scripts started through the web client, schedules or Data API, Get ( UserCount ) gives the number of open sessions for that hosted file in this server process. It can be 0 for a schedule with no signed-in session. Other script runs and calculations without a session registry default to 1.

The server maps the first two letters of `LC_ALL`, then `LC_MESSAGES`, then `LANG` to a known language name for Get ( SystemLanguage ) and Get ( ApplicationLanguage ). This mapping is inferred; its parity with FileMaker is unverified. Unknown or absent locales answer `English`. <!-- known-difference: SQL and calculations ;; The server's Get ( SystemLanguage ) and Get ( ApplicationLanguage ) mapping from locale variables is inferred and unverified against FileMaker ;; Scripts may see a language name different from FileMaker on the same machine ;; A FileMaker run on hosts with the same locales -->

## Get ( ) answers that are fixed here

| Parameter | Answer |
| --- | --- |
| LastStepTokensUsed | `0` |
| EncryptionState | `0` |
| WindowZoomLevel | `100` |
| ScreenDepth | `0` |

These fixed answers can differ from values in a FileMaker session; parity for each is unverified. <!-- known-difference: SQL and calculations ;; LastStepTokensUsed, EncryptionState, WindowZoomLevel and ScreenDepth use fixed server answers ;; Scripts see 0, 0, 100 and 0 respectively ;; A FileMaker run with matching script and window conditions -->
