// The script steps this build gives error 3 ("command is unavailable"), as docs/script-steps-support.md lists them
// under "Not supported (error 3)". check-solution reads them from here; a test keeps this list and that table the same.

/** Steps that always give error 3 here: nothing in the step's options changes that. */
export const ERROR_3_STEPS: ReadonlySet<string> = new Set([
  'New File', 'Convert File', 'Recover File', 'Save a Copy as Add-on Package',
  'Trigger Claris Connect Flow',
  'AVPlayer Play', 'AVPlayer Set Playback State', 'AVPlayer Set Options',
  'Configure Region Monitor Script', 'Configure Local Notification', 'Configure NFC Reading',
  'Check Selection', 'Check Record', 'Check Found Set', 'Correct Word', 'Spelling Options', 'Select Dictionaries',
  'Fine-Tune Model', 'Configure Regression Model',
  'Send DDE Execute', 'Speak', 'Insert Image Caption', 'Insert Image Captions in Found Set',
  'Execute SQL', 'Perform AppleScript', 'Get Folder Path', 'Send Event', 'Configure Machine Learning Model',
  'Print Setup', 'Open Settings', 'Open Sharing', 'Open File Options', 'Open Hosts', 'Open Upload to Host', 'Open Favorites',
]);

/**
 * Steps that give error 3 unless the server is set up for them (mail sending, script network access, the embedding
 * model), or unless a person is there to answer (Show Custom Dialog).
 */
export const ERROR_3_UNLESS_CONFIGURED: ReadonlySet<string> = new Set([
  'Send Mail', 'Insert from URL', 'Configure RAG Account', 'Perform RAG Action', 'Show Custom Dialog',
]);
