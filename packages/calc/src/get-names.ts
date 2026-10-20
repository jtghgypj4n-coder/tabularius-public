// The parameter names Get ( ... ) takes, as the Claris "Get functions" page lists them (help.claris.com, Get functions,
// read 2026-10-16). The page does not say what a name outside the list gives, so only the formula check uses this:
// Get ( Something ) with a name that is not here is reported when a formula is checked, and evaluates as before.

const CLARIS = [
  'AccountExtendedPrivileges', 'AccountGroupName', 'AccountName', 'AccountPasswordDaysRemaining', 'AccountPrivilegeSetName', 'AccountType',
  'ActiveFieldContents', 'ActiveFieldName', 'ActiveFieldTableName', 'ActiveLayoutObjectName', 'ActiveModifierKeys', 'ActivePortalRowNumber',
  'ActiveRecordNumber', 'ActiveRepetitionNumber', 'ActiveSelectionSize', 'ActiveSelectionStart', 'AllowAbortState', 'AllowFormattingBarState',
  'ApplicationArchitecture', 'ApplicationLanguage', 'ApplicationVersion', 'CacheFileName', 'CacheFilePath', 'CalculationRepetitionNumber',
  'ConnectionAttributes', 'ConnectionState', 'CurrentDate', 'CurrentExtendedPrivileges', 'CurrentHostTimestamp', 'CurrentPrivilegeSetName',
  'CurrentTime', 'CurrentTimestamp', 'CurrentTimeUTCMicroseconds', 'CurrentTimeUTCMilliseconds', 'CustomMenuSetName', 'DesktopPath',
  'Device', 'DocumentsPath', 'DocumentsPathListing', 'EncryptionState', 'ErrorCaptureState', 'FileLocaleElements',
  'FileMakerPath', 'FileName', 'FilePath', 'FileSize', 'FoundCount', 'GuidedAccessState',
  'HighContrastState', 'HostApplicationVersion', 'HostIPAddress', 'HostName', 'InstalledFMPlugins', 'InstalledFMPluginsAsJSON',
  'LastError', 'LastErrorDetail', 'LastErrorLocation', 'LastMessageChoice', 'LastStepTokensUsed', 'LayoutAccess',
  'LayoutCount', 'LayoutName', 'LayoutNumber', 'LayoutTableName', 'LayoutViewState', 'MenubarState',
  'ModifiedFields', 'MultiUserState', 'NetworkProtocol', 'NetworkType', 'OpenDataFileInfo', 'PageCount',
  'PageNumber', 'PersistentID', 'PreferencesPath', 'PrinterName', 'QuickFindText', 'RecordAccess',
  'RecordID', 'RecordModificationCount', 'RecordNumber', 'RecordOpenCount', 'RecordOpenState', 'RegionMonitorEvents',
  'RequestCount', 'RequestOmitState', 'RevertTransactionOnErrorState', 'ScreenDepth', 'ScreenHeight', 'ScreenScaleFactor',
  'ScreenWidth', 'ScriptAnimationState', 'ScriptName', 'ScriptParameter', 'ScriptResult', 'SessionIdentifier',
  'SortState', 'StatusAreaState', 'SystemAppearance', 'SystemDrive', 'SystemIPAddress', 'SystemLanguage',
  'SystemLocaleElements', 'SystemNICAddress', 'SystemPlatform', 'SystemStorageAvailable', 'SystemVersion', 'TemporaryPath',
  'TextRulerVisible', 'TotalRecordCount', 'TouchKeyboardState', 'TransactionOpenState', 'TriggerCurrentPanel', 'TriggerExternalEvent',
  'TriggerGestureInfo', 'TriggerKeystroke', 'TriggerModifierKeys', 'TriggerTargetPanel', 'UserCount', 'UserName',
  'UseSystemFormatsState', 'UUID', 'UUIDNumber', 'WindowContentHeight', 'WindowContentWidth', 'WindowDesktopHeight',
  'WindowDesktopWidth', 'WindowHeight', 'WindowLeft', 'WindowMode', 'WindowName', 'WindowOrientation',
  'WindowStyle', 'WindowTop', 'WindowUUID', 'WindowVisible', 'WindowWidth', 'WindowZoomLevel'
];

/** Names Tabularius answers that the Claris page does not list: older names and ones it keeps for itself. */
const ALSO = ['PortalRowNumber', 'CurrentHostDate', 'CurrentHostTime', 'Trigger'];

/** Lower-case parameter names a Get function takes. */
export const GET_NAMES: ReadonlySet<string> = new Set([...CLARIS, ...ALSO].map((n) => n.toLowerCase()));
