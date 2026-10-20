// The Steps pane's groups, as FileMaker Pro's Script Workspace lists them (Control, Navigation, Editing...).
// A step not named here (an old one, or one FileMaker added later) shows under Miscellaneous.

export const STEP_GROUPS: [group: string, steps: string[]][] = [
  ['Control', ['Perform Script', 'Perform Script on Server', 'Perform Script on Server with Callback', 'Pause/Resume Script', 'Exit Script', 'Halt Script',
    'If', 'Else If', 'Else', 'End If', 'Loop', 'Exit Loop If', 'End Loop', 'Allow User Abort', 'Set Error Capture', 'Set Error Logging', 'Set Variable',
    'Set Layout Object Animation', 'Install OnTimer Script', 'Set Session Identifier', 'Open Transaction', 'Commit Transaction', 'Revert Transaction',
    'Set Revert Transaction on Error', 'Configure Region Monitor Script', 'Configure Local Notification', 'Configure NFC Reading', 'Trigger Claris Connect Flow']],
  ['Navigation', ['Go to Layout', 'Go to Record/Request/Page', 'Go to Related Record', 'Go to List of Records', 'Go to Portal Row', 'Go to Object', 'Go to Field',
    'Go to Next Field', 'Go to Previous Field', 'Close Popover', 'Enter Browse Mode', 'Enter Find Mode', 'Enter Preview Mode']],
  ['Editing', ['Undo/Redo', 'Cut', 'Copy', 'Paste', 'Clear', 'Set Selection', 'Select All', 'Perform Find/Replace']],
  ['Fields', ['Set Field', 'Set Field By Name', 'Set Next Serial Value', 'Insert Text', 'Insert Calculated Result', 'Insert from Device', 'Insert from Index',
    'Insert from Last Visited', 'Insert from URL', 'Insert Current Date', 'Insert Current Time', 'Insert Current User Name', 'Insert Picture', 'Insert Audio/Video',
    'Insert PDF', 'Insert File', 'Replace Field Contents', 'Relookup Field Contents', 'Export Field Contents']],
  ['Records', ['New Record/Request', 'Duplicate Record/Request', 'Delete Record/Request', 'Delete Portal Row', 'Delete All Records', 'Truncate Table',
    'Open Record/Request', 'Revert Record/Request', 'Commit Records/Requests', 'Copy Record/Request', 'Copy All Records/Requests', 'Import Records',
    'Export Records', 'Save Records as Excel', 'Save Records as PDF', 'Save Records as JSONL', 'Save Records as Snapshot Link', 'Execute FileMaker Data API']],
  ['Found Sets', ['Show All Records', 'Show Omitted Only', 'Omit Record', 'Omit Multiple Records', 'Perform Quick Find', 'Perform Find', 'Constrain Found Set',
    'Extend Found Set', 'Modify Last Find', 'Sort Records', 'Sort Records by Field', 'Unsort Records', 'Find Matching Records']],
  ['Windows', ['New Window', 'Select Window', 'Close Window', 'Move/Resize Window', 'Adjust Window', 'Arrange All Windows', 'Freeze Window', 'Refresh Window',
    'Refresh Portal', 'Refresh Object', 'Scroll Window', 'Show/Hide Menubar', 'Show/Hide Toolbars', 'Show/Hide Text Ruler', 'Set Window Title', 'Set Zoom Level',
    'View As']],
  ['Files', ['New File', 'Open File', 'Close File', 'Convert File', 'Set Multi-User', 'Set Use System Formats', 'Save a Copy as', 'Save a Copy as XML',
    'Save a Copy as Add-on Package', 'Recover File', 'Print Setup', 'Print', 'Get File Exists', 'Get File Size', 'Create Data File', 'Open Data File',
    'Write to Data File', 'Read from Data File', 'Get Data File Position', 'Set Data File Position', 'Close Data File', 'Delete File', 'Rename File',
    'Create PDF', 'Open PDF', 'Append PDF', 'Print PDF', 'Close PDF', 'Cancel PDF']],
  ['Accounts', ['Add Account', 'Delete Account', 'Reset Account Password', 'Change Password', 'Enable Account', 'Re-Login']],
  ['Spelling', ['Check Selection', 'Check Record', 'Check Found Set', 'Correct Word', 'Spelling Options', 'Select Dictionaries', 'Edit User Dictionary', 'Set Dictionary']],
  ['Open Menu Item', ['Open Settings', 'Open Favorites', 'Open File Options', 'Open Edit Saved Finds', 'Open Find/Replace', 'Open Help', 'Open Hosts',
    'Open Manage Containers', 'Open Manage Data Sources', 'Open Manage Database', 'Open Manage Layouts', 'Open Manage Themes', 'Open Manage Value Lists',
    'Open Script Workspace', 'Open Sharing', 'Open Upload to Host']],
  ['Artificial Intelligence', ['Configure AI Account', 'Configure Prompt Template', 'Configure RAG Account', 'Configure Machine Learning Model',
    'Configure Regression Model', 'Generate Response from Model', 'Perform Find by Natural Language', 'Perform SQL Query by Natural Language',
    'Perform Semantic Find', 'Perform RAG Action', 'Insert Embedding', 'Insert Embedding in Found Set', 'Insert Image Caption',
    'Insert Image Captions in Found Set', 'Fine-Tune Model', 'Set AI Call Logging']],
  ['Miscellaneous', ['Show Custom Dialog', 'Allow Formatting Bar', 'Beep', 'Speak', 'Dial Phone', 'Install Plug-In File', 'Install Menu Set', 'Set Web Viewer',
    'Perform JavaScript in Web Viewer', 'Flush Web Viewer Cookies', 'Open URL', 'Send Mail', 'Send DDE Execute', 'Send Event', 'Perform AppleScript',
    'Execute SQL', 'Get Folder Path', 'Configure Persistent Data', 'AVPlayer Play', 'AVPlayer Set Playback State', 'AVPlayer Set Options', 'Enable Touch Keyboard',
    'Flush Cache to Disk', 'Exit Application', '# (comment)']],
];

/** The steps the server knows, in FileMaker's groups (each group's steps in FileMaker's order; the rest under Miscellaneous). */
export function groupSteps(names: string[]): [group: string, steps: string[]][] {
  const known = new Set(names);
  const placed = new Set<string>();
  const out = STEP_GROUPS.map(([g, steps]): [string, string[]] => [g, steps.filter((s) => known.has(s) && !placed.has(s) && placed.add(s))]);
  const rest = names.filter((n) => !placed.has(n));
  const misc = out.find(([g]) => g === 'Miscellaneous')!;
  misc[1].push(...rest.sort((a, b) => a.localeCompare(b)));
  return out.filter(([, s]) => s.length);
}
