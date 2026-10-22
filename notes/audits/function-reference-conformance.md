# Claris function reference conformance

The inventory contains 368 function entries across 19 Claris families. Each entry stores only a function name, category, and Claris topic URL in [function-inventory.data.ts](../../packages/calc/test/function-inventory.data.ts). The category links below cite the source listings. No Claris page prose is copied into the inventory.

The engine currently implements 351 catalog entries, does not implement 17, and has 169 engine-map keys absent from the Claris catalog. Of the 351, 211 are keys of the function table, Pi and Let are language forms the parser reads, and 138 are the parameters of Get ( ... ), which is one function: see the Get parameters section.

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
| [Trigonometric](https://help.claris.com/en/pro-help/content/trigonometric-functions.html) | 9 | 9 | 0 | 1 | 0 |
| [Logical](https://help.claris.com/en/pro-help/content/logical-functions.html) | 20 | 20 | 0 | 3 | 0 |
| [Artificial intelligence](https://help.claris.com/en/pro-help/content/artificial-intelligence-functions.html) | 14 | 11 | 3 | 0 | 1 |
| [Miscellaneous](https://help.claris.com/en/pro-help/content/miscellaneous-functions.html) | 11 | 8 | 3 | 1 | 0 |
| [Get](https://help.claris.com/en/pro-help/content/get-functions.html) | 138 | 138 | 0 | 0 | 1 |
| [Design](https://help.claris.com/en/pro-help/content/design-functions.html) | 26 | 23 | 3 | 0 | 0 |
| [Mobile](https://help.claris.com/en/pro-help/content/mobile-functions.html) | 5 | 2 | 3 | 0 | 1 |
| **Total** | **368** | **351** | **17** | **70** | **4** |

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

`Acos`, `Asin`, `Atan`, `Cos`, `Degrees`, `Pi`, `Radians`, `Sin`, `Tan`

### Logical

`Case`, `Choose`, `Evaluate`, `EvaluationError`, `ExecuteSQL`, `ExecuteSQLe`, `GetAsBoolean`, `GetField`, `GetNthRecord`, `GetSummary`, `If`, `IsEmpty`, `IsValid`, `IsValidExpression`, `Let`, `Lookup`, `LookupNext`, `Self`, `SetRecursion`, `While`

### Artificial intelligence

`AddEmbeddings`, `CosineSimilarity`, `GetEmbedding`, `GetEmbeddingAsFile`, `GetEmbeddingAsText`, `GetFieldsOnLayout`, `GetRAGSpaceInfo`, `GetTableDDL`, `GetTokenCount`, `NormalizeEmbedding`, `SubtractEmbeddings`

### Miscellaneous

`ConvertFromFileMakerPath`, `ConvertToFileMakerPath`, `GetBaseTableName`, `GetFieldName`, `GetLayoutObjectAttribute`, `GetPersistentData`, `GetRecordIDsFromFoundSet`, `ListPersistentDataIDs`

### Design

`BaseTableIDs`, `BaseTableNames`, `DatabaseNames`, `FieldBounds`, `FieldComment`, `FieldIDs`, `FieldNames`, `FieldRepetitions`, `FieldStyle`, `FieldType`, `GetNextSerialValue`, `LayoutIDs`, `LayoutNames`, `LayoutObjectNames`, `RelationInfo`, `ScriptIDs`, `ScriptNames`, `TableIDs`, `TableNames`, `ValueListIDs`, `ValueListItems`, `ValueListNames`, `WindowNames`

### Mobile

`Location`, `LocationValues`

## Not implemented catalog names

Each is left out for a reason the inventory data records (NOT_IMPLEMENTED_REASON): a camera, sensor or Core ML model on a device, a vendor service, or nothing in the store to answer from (no table comment, field annotation, display names or stable layout object ids). YearName is left out because Claris shows its result only as an image of Japanese text.

### Container

`GetLiveText`, `GetLiveTextAsJSON`, `ReadQRCode`

### Japanese

`Furigana`, `YearName`

### Artificial intelligence

`ComputeModel`, `GetModelAttributes`, `PredictFromModel`

### Miscellaneous

`GetAddonInfo`, `GetLayoutObjectOwnerInfo`, `LayoutObjectUUID`

### Design

`BaseTableComment`, `FieldAnnotation`, `FieldDisplayNames`

### Mobile

`GetAVPlayerAttribute`, `GetSensor`, `RangeBeacons`

## Get parameters

Get is one function with a parameter. All 138 parameters on Claris's [Get functions](https://help.claris.com/en/pro-help/content/get-functions.html) page are known to the engine, and [function-inventory.data.ts](../../packages/calc/test/function-inventory.data.ts) classifies each one (a test keeps the lists in step with the code):

- **Answered from the run** (91): the script engine's or the stored calculation's own Get switch reads the state: the account and its privilege set, the layout, the window, the found set and record, the script and its parameter, the last error, the file, and so on.
- **Server default** (47): a fixed answer for a server with no screen, window, printer or device (a state flag of 0, an empty text where Claris says so), or a value from the clock or the host machine. A host that knows better can supply it; Get ( UserCount ) and Get ( SystemLanguage ) are two answers a person should not rely on yet.

## Engine-only names

These are FUNCTIONS map keys outside the Claris inventory. They include engine/plugin extensions and non-catalog helper entries.

`get`, `[]`, `plain`, `bold`, `italic`, `underline`, `highlightyellow`, `condense`, `strikethrough`, `smallcaps`, `superscript`, `subscript`, `uppercase`, `lowercase`, `titlecase`, `wordunderline`, `doubleunderline`, `allstyles`, `jsonraw`, `jsonstring`, `jsonnumber`, `jsonobject`, `jsonarray`, `jsonboolean`, `jsonnull`, `be_pdfpagecount`, `be_pdfgetpages`, `scriptstepnames`, `posixpath`, `winpath`, `urlpath`, `mbs`, `be_version`, `be_versionautoupdate`, `be_versionpro`, `be_getmachinename`, `be_getsystemdrive`, `be_json_error_description`, `be_jsonpath`, `be_json_encode`, `be_filemakersql`, `be_getlasterror`, `be_getlastddlerror`, `be_fileexists`, `be_filesize`, `be_filereadtext`, `be_filewritetext`, `be_foldercreate`, `be_filedelete`, `be_filemove`, `be_filecopy`, `be_filelistfolder`, `be_filemodificationtimestamp`, `be_filepatterncount`, `be_zip`, `be_unzip`, `be_unzip_deprecated`, `be_regularexpression`, `be_filereplacetext`, `be_stackpush`, `be_stackpop`, `be_stackcount`, `be_stackdelete`, `be_http_get`, `be_http_getfile`, `be_http_post`, `be_http_putfile`, `be_http_putdata`, `be_http_patch`, `be_http_delete`, `be_http_get_file`, `be_saveurltofile`, `be_http_put_file`, `be_http_put_data`, `be_smtpserver`, `be_smtpaddattachment`, `be_smtpsend`, `be_smtp_server`, `be_smtp_addattachment`, `be_smtp_send`, `be_http_setcustomheader`, `be_http_setproxy`, `be_smtpsetheader`, `be_http_responsecode`, `be_http_responseheaders`, `be_clipboardformats`, `be_clipboardgettext`, `be_clipboardsettext`, `be_selectfolder`, `be_selectfile`, `be_executesystemcommand`, `be_folderselectdialog`, `be_fileselectdialog`, `be_fileopen`, `be_openurl`, `be_openfile`, `be_ftp_upload`, `be_ftp_uploadfile`, `be_ftp_delete`, `be_buttonok`, `be_buttoncancel`, `be_buttonalternate`, `be_messagedigestalgorithmmd5`, `be_messagedigestalgorithmsha256`, `be_messagedigestalgorithmmdc2`, `be_messagedigestalgorithmsha`, `be_messagedigestalgorithmsha1`, `be_messagedigestalgorithmsha224`, `be_messagedigestalgorithmsha384`, `be_messagedigestalgorithmsha512`, `be_filetypeall`, `be_filetypefile`, `be_filetypefolder`, `be_encodinghex`, `be_encodingbase64`, `be_scriptcontrolhalt`, `be_scriptcontrolexit`, `be_scriptcontrolresume`, `be_scriptcontrolpause`, `be_valuesunique`, `be_valuesfilterout`, `be_valuescontainsduplicates`, `be_valuessort`, `be_valuestimesduplicated`, `be_valuestrim`, `be_timecurrentmilliseconds`, `be_timeutcmilliseconds`, `be_timezoneoffset`, `be_messagedigest`, `be_xor`, `be_vectordotproduct`, `be_vectoreuclideandistance`, `be_vector_euclideandistance`, `be_variableset`, `be_variableget`, `be_arraysetfromvaluelist`, `be_arraygetsize`, `be_arraygetvalue`, `be_arraydelete`, `be_arrayfind`, `be_arraychangevalue`, `be_textextractwords`, `be_json_arraysize`, `be_containercompress`, `be_containeruncompress`, `be_containeriscompressed`, `be_createkeypair`, `be_getpublickey`, `be_encryptwithkey`, `be_decryptwithkey`, `be_signaturegeneratersa`, `be_signatureverifyrsa`, `be_json_jq`, `be_gzip`, `be_ungzip`, `be_encryptaes`, `be_decryptaes`, `be_cipherencrypt`, `be_cipherdecrypt`, `be_xpath`, `be_xpathall`, `be_xslt_applyinmemory`, `be_xslt_apply`, `be_xmlparse`, `be_xmlcanonical`, `be_xmltidy`, `be_xmlstripinvalidcharacters`, `be_xmlstripnodes`, `be_evaluatejavascript`

## Drift check

[function-inventory.test.ts](../../packages/calc/test/function-inventory.test.ts) compares the documented implemented/unimplemented snapshot and engine-only keys with FUNCTIONS. Adding or removing an engine key, or changing support for a catalog entry, fails unless the conformance data is updated.
