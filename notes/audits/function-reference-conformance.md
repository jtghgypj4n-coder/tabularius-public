# Claris function reference conformance

The inventory contains 368 function entries across 19 Claris families. Each entry stores only a function name, category, and Claris topic URL in [function-inventory.data.ts](../../packages/calc/test/function-inventory.data.ts). The category links below cite the source listings. No Claris page prose is copied into the inventory.

The engine currently implements 211 catalog entries, does not implement 157, and has 169 engine-map keys absent from the Claris catalog.

| Claris family | Catalog | Implemented | Not implemented | Verified cited examples | Known, unverified |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Text](https://help.claris.com/en/pro-help/content/text-functions.html) | 39 | 39 | 0 | 31 | 0 |
| [Text formatting](https://help.claris.com/en/pro-help/content/text-formatting-functions.html) | 10 | 10 | 0 | 1 | 0 |
| [Number](https://help.claris.com/en/pro-help/content/number-functions.html) | 18 | 18 | 0 | 20 | 0 |
| [Date](https://help.claris.com/en/pro-help/content/date-functions.html) | 10 | 10 | 0 | 6 | 0 |
| [Time](https://help.claris.com/en/pro-help/content/time-functions.html) | 4 | 4 | 0 | 1 | 0 |
| [Timestamp](https://help.claris.com/en/pro-help/content/timestamp-functions.html) | 1 | 1 | 0 | 1 | 0 |
| [Container](https://help.claris.com/en/pro-help/content/container-functions.html) | 24 | 21 | 3 | 1 | 0 |
| [Japanese](https://help.claris.com/en/pro-help/content/japanese-functions.html) | 12 | 10 | 2 | 1 | 0 |
| [JSON](https://help.claris.com/en/pro-help/content/json-functions-category.html) | 10 | 10 | 0 | 1 | 0 |
| [Aggregate](https://help.claris.com/en/pro-help/content/aggregate-functions.html) | 10 | 10 | 0 | 1 | 0 |
| [Repeating](https://help.claris.com/en/pro-help/content/repeating-functions.html) | 3 | 3 | 0 | 0 | 1 |
| [Financial](https://help.claris.com/en/pro-help/content/financial-functions.html) | 4 | 4 | 0 | 1 | 0 |
| [Trigonometric](https://help.claris.com/en/pro-help/content/trigonometric-functions.html) | 9 | 8 | 1 | 1 | 0 |
| [Logical](https://help.claris.com/en/pro-help/content/logical-functions.html) | 20 | 19 | 1 | 3 | 0 |
| [Artificial intelligence](https://help.claris.com/en/pro-help/content/artificial-intelligence-functions.html) | 14 | 11 | 3 | 0 | 1 |
| [Miscellaneous](https://help.claris.com/en/pro-help/content/miscellaneous-functions.html) | 11 | 8 | 3 | 1 | 0 |
| [Get](https://help.claris.com/en/pro-help/content/get-functions.html) | 138 | 0 | 138 | 0 | 1 |
| [Design](https://help.claris.com/en/pro-help/content/design-functions.html) | 26 | 23 | 3 | 0 | 0 |
| [Mobile](https://help.claris.com/en/pro-help/content/mobile-functions.html) | 5 | 2 | 3 | 0 | 1 |
| **Total** | **368** | **211** | **157** | **70** | **4** |

The 70 expressions with explicit results are in [claris-examples.data.ts](../../packages/calc/test/claris-examples.data.ts) and run in the calc test suite. 4 additional documented examples are explicitly marked unverified because their results depend on account privileges, repeating field state, model-specific embedding vectors, or a FileMaker Go device. Representative verified or unverified examples cover 18 of 19 families. Design has no example row in this sample. This is not a page-by-page census of which of all 368 function topics publish result-bearing examples.

## Implemented catalog names

### Text

`Char`, `Code`, `Exact`, `Filter`, `FilterValues`, `GetAsCSS`, `GetAsDate`, `GetAsNumber`, `GetAsSVG`, `GetAsText`, `GetAsTime`, `GetAsTimestamp`, `GetAsURLEncoded`, `GetValue`, `Left`, `LeftValues`, `LeftWords`, `Length`, `Lower`, `Middle`, `MiddleValues`, `MiddleWords`, `PatternCount`, `Position`, `Proper`, `Quote`, `Replace`, `Right`, `RightValues`, `RightWords`, `SerialIncrement`, `SortValues`, `Substitute`, `Trim`, `TrimAll`, `UniqueValues`, `Upper`, `ValueCount`, `WordCount`

### Text formatting

`RGB`, `TextColor`, `TextColorRemove`, `TextFont`, `TextFontRemove`, `TextFormatRemove`, `TextSize`, `TextSizeRemove`, `TextStyleAdd`, `TextStyleRemove`

### Number

`Abs`, `Ceiling`, `Combination`, `Div`, `Exp`, `Factorial`, `Floor`, `Int`, `Lg`, `Ln`, `Log`, `Mod`, `Random`, `Round`, `SetPrecision`, `Sign`, `Sqrt`, `Truncate`

### Date

`Date`, `Day`, `DayName`, `DayOfWeek`, `DayOfYear`, `Month`, `MonthName`, `WeekOfYear`, `WeekOfYearFiscal`, `Year`

### Time

`Hour`, `Minute`, `Seconds`, `Time`

### Timestamp

`Timestamp`

### Container

`Base64Decode`, `Base64Encode`, `Base64EncodeRFC`, `CryptAuthCode`, `CryptDecrypt`, `CryptDecryptBase64`, `CryptDigest`, `CryptEncrypt`, `CryptEncryptBase64`, `CryptGenerateSignature`, `CryptVerifySignature`, `GetContainerAttribute`, `GetHeight`, `GetTextFromPDF`, `GetThumbnail`, `GetWidth`, `HexDecode`, `HexEncode`, `TextDecode`, `TextEncode`, `VerifyContainer`

### Japanese

`DayNameJ`, `Hiragana`, `KanaHankaku`, `KanaZenkaku`, `KanjiNumeral`, `Katakana`, `MonthNameJ`, `NumToJText`, `RomanHankaku`, `RomanZenkaku`

### JSON

`JSONDeleteElement`, `JSONFormatElements`, `JSONGetElement`, `JSONGetElementType`, `JSONListKeys`, `JSONListValues`, `JSONMakeArray`, `JSONParse`, `JSONParsedState`, `JSONSetElement`

### Aggregate

`Average`, `Count`, `List`, `Max`, `Min`, `StDev`, `StDevP`, `Sum`, `Variance`, `VarianceP`

### Repeating

`Extend`, `GetRepetition`, `Last`

### Financial

`FV`, `NPV`, `PMT`, `PV`

### Trigonometric

`Acos`, `Asin`, `Atan`, `Cos`, `Degrees`, `Radians`, `Sin`, `Tan`

### Logical

`Case`, `Choose`, `Evaluate`, `EvaluationError`, `ExecuteSQL`, `ExecuteSQLe`, `GetAsBoolean`, `GetField`, `GetNthRecord`, `GetSummary`, `If`, `IsEmpty`, `IsValid`, `IsValidExpression`, `Lookup`, `LookupNext`, `Self`, `SetRecursion`, `While`

### Artificial intelligence

`AddEmbeddings`, `CosineSimilarity`, `GetEmbedding`, `GetEmbeddingAsFile`, `GetEmbeddingAsText`, `GetFieldsOnLayout`, `GetRAGSpaceInfo`, `GetTableDDL`, `GetTokenCount`, `NormalizeEmbedding`, `SubtractEmbeddings`

### Miscellaneous

`ConvertFromFileMakerPath`, `ConvertToFileMakerPath`, `GetBaseTableName`, `GetFieldName`, `GetLayoutObjectAttribute`, `GetPersistentData`, `GetRecordIDsFromFoundSet`, `ListPersistentDataIDs`

### Design

`BaseTableIDs`, `BaseTableNames`, `DatabaseNames`, `FieldBounds`, `FieldComment`, `FieldIDs`, `FieldNames`, `FieldRepetitions`, `FieldStyle`, `FieldType`, `GetNextSerialValue`, `LayoutIDs`, `LayoutNames`, `LayoutObjectNames`, `RelationInfo`, `ScriptIDs`, `ScriptNames`, `TableIDs`, `TableNames`, `ValueListIDs`, `ValueListItems`, `ValueListNames`, `WindowNames`

### Mobile

`Location`, `LocationValues`

## Not implemented catalog names

### Container

`GetLiveText`, `GetLiveTextAsJSON`, `ReadQRCode`

### Japanese

`Furigana`, `YearName`

### Trigonometric

`Pi`

### Logical

`Let`

### Artificial intelligence

`ComputeModel`, `GetModelAttributes`, `PredictFromModel`

### Miscellaneous

`GetAddonInfo`, `GetLayoutObjectOwnerInfo`, `LayoutObjectUUID`

### Get

`Get(AccountExtendedPrivileges)`, `Get(AccountGroupName)`, `Get(AccountName)`, `Get(AccountPasswordDaysRemaining)`, `Get(AccountPrivilegeSetName)`, `Get(AccountType)`, `Get(ActiveFieldContents)`, `Get(ActiveFieldName)`, `Get(ActiveFieldTableName)`, `Get(ActiveLayoutObjectName)`, `Get(ActiveModifierKeys)`, `Get(ActivePortalRowNumber)`, `Get(ActiveRecordNumber)`, `Get(ActiveRepetitionNumber)`, `Get(ActiveSelectionSize)`, `Get(ActiveSelectionStart)`, `Get(AllowAbortState)`, `Get(AllowFormattingBarState)`, `Get(ApplicationArchitecture)`, `Get(ApplicationLanguage)`, `Get(ApplicationVersion)`, `Get(CacheFileName)`, `Get(CacheFilePath)`, `Get(CalculationRepetitionNumber)`, `Get(ConnectionAttributes)`, `Get(ConnectionState)`, `Get(CurrentDate)`, `Get(CurrentExtendedPrivileges)`, `Get(CurrentHostTimestamp)`, `Get(CurrentPrivilegeSetName)`, `Get(CurrentTime)`, `Get(CurrentTimestamp)`, `Get(CurrentTimeUTCMicroseconds)`, `Get(CurrentTimeUTCMilliseconds)`, `Get(CustomMenuSetName)`, `Get(DesktopPath)`, `Get(Device)`, `Get(DocumentsPath)`, `Get(DocumentsPathListing)`, `Get(EncryptionState)`, `Get(ErrorCaptureState)`, `Get(FileLocaleElements)`, `Get(FileMakerPath)`, `Get(FileName)`, `Get(FilePath)`, `Get(FileSize)`, `Get(FoundCount)`, `Get(GuidedAccessState)`, `Get(HighContrastState)`, `Get(HostApplicationVersion)`, `Get(HostIPAddress)`, `Get(HostName)`, `Get(InstalledFMPlugins)`, `Get(InstalledFMPluginsAsJSON)`, `Get(LastError)`, `Get(LastErrorDetail)`, `Get(LastErrorLocation)`, `Get(LastMessageChoice)`, `Get(LastStepTokensUsed)`, `Get(LayoutAccess)`, `Get(LayoutCount)`, `Get(LayoutName)`, `Get(LayoutNumber)`, `Get(LayoutTableName)`, `Get(LayoutViewState)`, `Get(MenubarState)`, `Get(ModifiedFields)`, `Get(MultiUserState)`, `Get(NetworkProtocol)`, `Get(NetworkType)`, `Get(OpenDataFileInfo)`, `Get(PageCount)`, `Get(PageNumber)`, `Get(PersistentID)`, `Get(PreferencesPath)`, `Get(PrinterName)`, `Get(QuickFindText)`, `Get(RecordAccess)`, `Get(RecordID)`, `Get(RecordModificationCount)`, `Get(RecordNumber)`, `Get(RecordOpenCount)`, `Get(RecordOpenState)`, `Get(RegionMonitorEvents)`, `Get(RequestCount)`, `Get(RequestOmitState)`, `Get(RevertTransactionOnErrorState)`, `Get(ScreenDepth)`, `Get(ScreenHeight)`, `Get(ScreenScaleFactor)`, `Get(ScreenWidth)`, `Get(ScriptAnimationState)`, `Get(ScriptName)`, `Get(ScriptParameter)`, `Get(ScriptResult)`, `Get(SessionIdentifier)`, `Get(SortState)`, `Get(StatusAreaState)`, `Get(SystemAppearance)`, `Get(SystemDrive)`, `Get(SystemIPAddress)`, `Get(SystemLanguage)`, `Get(SystemLocaleElements)`, `Get(SystemNICAddress)`, `Get(SystemPlatform)`, `Get(SystemStorageAvailable)`, `Get(SystemVersion)`, `Get(TemporaryPath)`, `Get(TextRulerVisible)`, `Get(TotalRecordCount)`, `Get(TouchKeyboardState)`, `Get(TransactionOpenState)`, `Get(TriggerCurrentPanel)`, `Get(TriggerExternalEvent)`, `Get(TriggerGestureInfo)`, `Get(TriggerKeystroke)`, `Get(TriggerModifierKeys)`, `Get(TriggerTargetPanel)`, `Get(UserCount)`, `Get(UserName)`, `Get(UseSystemFormatsState)`, `Get(UUID)`, `Get(UUIDNumber)`, `Get(WindowContentHeight)`, `Get(WindowContentWidth)`, `Get(WindowDesktopHeight)`, `Get(WindowDesktopWidth)`, `Get(WindowHeight)`, `Get(WindowLeft)`, `Get(WindowMode)`, `Get(WindowName)`, `Get(WindowOrientation)`, `Get(WindowStyle)`, `Get(WindowTop)`, `Get(WindowUUID)`, `Get(WindowVisible)`, `Get(WindowWidth)`, `Get(WindowZoomLevel)`

### Design

`BaseTableComment`, `FieldAnnotation`, `FieldDisplayNames`

### Mobile

`GetAVPlayerAttribute`, `GetSensor`, `RangeBeacons`

## Engine-only names

These are FUNCTIONS map keys outside the Claris inventory. They include engine/plugin extensions and non-catalog helper entries.

`get`, `[]`, `plain`, `bold`, `italic`, `underline`, `highlightyellow`, `condense`, `strikethrough`, `smallcaps`, `superscript`, `subscript`, `uppercase`, `lowercase`, `titlecase`, `wordunderline`, `doubleunderline`, `allstyles`, `jsonraw`, `jsonstring`, `jsonnumber`, `jsonobject`, `jsonarray`, `jsonboolean`, `jsonnull`, `be_pdfpagecount`, `be_pdfgetpages`, `scriptstepnames`, `posixpath`, `winpath`, `urlpath`, `mbs`, `be_version`, `be_versionautoupdate`, `be_versionpro`, `be_getmachinename`, `be_getsystemdrive`, `be_json_error_description`, `be_jsonpath`, `be_json_encode`, `be_filemakersql`, `be_getlasterror`, `be_getlastddlerror`, `be_fileexists`, `be_filesize`, `be_filereadtext`, `be_filewritetext`, `be_foldercreate`, `be_filedelete`, `be_filemove`, `be_filecopy`, `be_filelistfolder`, `be_filemodificationtimestamp`, `be_filepatterncount`, `be_zip`, `be_unzip`, `be_unzip_deprecated`, `be_regularexpression`, `be_filereplacetext`, `be_stackpush`, `be_stackpop`, `be_stackcount`, `be_stackdelete`, `be_http_get`, `be_http_getfile`, `be_http_post`, `be_http_putfile`, `be_http_putdata`, `be_http_patch`, `be_http_delete`, `be_http_get_file`, `be_saveurltofile`, `be_http_put_file`, `be_http_put_data`, `be_smtpserver`, `be_smtpaddattachment`, `be_smtpsend`, `be_smtp_server`, `be_smtp_addattachment`, `be_smtp_send`, `be_http_setcustomheader`, `be_http_setproxy`, `be_smtpsetheader`, `be_http_responsecode`, `be_http_responseheaders`, `be_clipboardformats`, `be_clipboardgettext`, `be_clipboardsettext`, `be_selectfolder`, `be_selectfile`, `be_executesystemcommand`, `be_folderselectdialog`, `be_fileselectdialog`, `be_fileopen`, `be_openurl`, `be_openfile`, `be_ftp_upload`, `be_ftp_uploadfile`, `be_ftp_delete`, `be_buttonok`, `be_buttoncancel`, `be_buttonalternate`, `be_messagedigestalgorithmmd5`, `be_messagedigestalgorithmsha256`, `be_messagedigestalgorithmmdc2`, `be_messagedigestalgorithmsha`, `be_messagedigestalgorithmsha1`, `be_messagedigestalgorithmsha224`, `be_messagedigestalgorithmsha384`, `be_messagedigestalgorithmsha512`, `be_filetypeall`, `be_filetypefile`, `be_filetypefolder`, `be_encodinghex`, `be_encodingbase64`, `be_scriptcontrolhalt`, `be_scriptcontrolexit`, `be_scriptcontrolresume`, `be_scriptcontrolpause`, `be_valuesunique`, `be_valuesfilterout`, `be_valuescontainsduplicates`, `be_valuessort`, `be_valuestimesduplicated`, `be_valuestrim`, `be_timecurrentmilliseconds`, `be_timeutcmilliseconds`, `be_timezoneoffset`, `be_messagedigest`, `be_xor`, `be_vectordotproduct`, `be_vectoreuclideandistance`, `be_vector_euclideandistance`, `be_variableset`, `be_variableget`, `be_arraysetfromvaluelist`, `be_arraygetsize`, `be_arraygetvalue`, `be_arraydelete`, `be_arrayfind`, `be_arraychangevalue`, `be_textextractwords`, `be_json_arraysize`, `be_containercompress`, `be_containeruncompress`, `be_containeriscompressed`, `be_createkeypair`, `be_getpublickey`, `be_encryptwithkey`, `be_decryptwithkey`, `be_signaturegeneratersa`, `be_signatureverifyrsa`, `be_json_jq`, `be_gzip`, `be_ungzip`, `be_encryptaes`, `be_decryptaes`, `be_cipherencrypt`, `be_cipherdecrypt`, `be_xpath`, `be_xpathall`, `be_xslt_applyinmemory`, `be_xslt_apply`, `be_xmlparse`, `be_xmlcanonical`, `be_xmltidy`, `be_xmlstripinvalidcharacters`, `be_xmlstripnodes`, `be_evaluatejavascript`

## Drift check

[function-inventory.test.ts](../../packages/calc/test/function-inventory.test.ts) compares the documented implemented/unimplemented snapshot and engine-only keys with FUNCTIONS. Adding or removing an engine key, or changing support for a catalog entry, fails unless the conformance data is updated.
