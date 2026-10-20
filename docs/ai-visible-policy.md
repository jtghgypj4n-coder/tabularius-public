# Per-file AI-visible policy

New solutions, including `tabularius new` with or without `--native` and solutions created in the admin console, start with the policy **on**. Existing stores and converted `.fmp12` files have no setting and keep the policy **off**. Opening an old store does not opt it in.

An administrator can change the setting with:

<!-- docs-example: placeholders {"<folder>": "~/Databases", "<name>": "Invoices"} -->
```sh
tabularius ai-policy <folder> <name> on
tabularius ai-policy <folder> <name> off
tabularius info <folder> <name>
```

The admin console has an **AI policy** toggle for each file. Its authenticated API is `GET|POST /tabularius/admin/v1/ai-policy/{database}`; POST takes `{"on":true}` or `{"on":false}`. This setting is separate from the existing AI access switch: turning the policy off does not turn AI access on.

With the policy on, AI operations are refused before reading data or dispatching to a model if their source includes a secret-named field without an explicit exception. Detection uses the same case-insensitive, Unicode-aware `secretName` function as output redaction, covering common credential and sensitive-identifier names in English, Spanish, French, German, Dutch, Italian, Portuguese, Swedish, Danish, Norwegian, Finnish, Polish, Japanese, Chinese (simplified and traditional), Korean and Russian. Refusals deliberately name the operation, table, field and privilege set so administrators can identify and mark the right field. This discloses schema names, but never the secret's value.

Detection also checks Unicode compatibility forms, removes combining marks after NFKD decomposition, ignores invisible characters and spacing/punctuation/symbols between letters, and maps common Cyrillic/Greek look-alikes and digit/symbol substitutions. This covers names such as `Pass Word`, `Ｐａｓｓｗｏｒｄ`, zero-width-separated `Password`, `Passw0rd`, `раsswοrd`, `pass|word`, `pa$$word`, and `p@ssword`. Original language spellings and meaningful digits are checked too. Additional password terms are Turkish [şifre](https://support.google.com/accounts/answer/41078?hl=tr), Czech [heslo](https://support.google.com/accounts/answer/41078?hl=cs), Hungarian [jelszó](https://support.google.com/accounts/answer/41078?hl=hu), Greek [κωδικός πρόσβασης](https://support.google.com/accounts/answer/41078?hl=el), Hebrew [סיסמה](https://support.google.com/accounts/answer/41078?hl=iw), and Arabic [كلمة المرور](https://support.google.com/accounts/answer/41078?hl=ar), as used in Google's public password instructions. These are specific terms, not exhaustive coverage of each language.

Only a human through web Manage Security, the admin console or the CLI may set AI-visible exceptions. Manage Security → Privilege sets → **AI-visible fields** edits them using this property in the complete privilege definition:

```json
{
  "aiVisible": {
    "Customers": ["API Key"],
    "Integration Settings": true
  }
}
```

The same privilege definition works through the security API for a person signed in as Full Access. MCP `get_security` can read these exceptions, but AI security tools refuse submissions containing them, even when unchanged.

This property is added to the complete privilege-set definition, not submitted as a replacement for its other properties. A list marks particular fields; `true` explicitly marks every field in that table, including future fields. An absent entry grants no exception. Full Access also needs explicit exceptions. The local MCP administrator uses the file's saved Full Access policy. Marks never grant ordinary record, layout, field, export or script access. Existing output redaction remains in place. MCP `change_security` and `preview_privilege_set` refuse AI-visibility changes even for Full Access and policy-OFF files. AI design changes, the web assistant (including its internal MCP connection) and agent security writes share this restriction. Replacing or deleting a marked set, or assigning an account to a marked set through AI, is also refused; these operations must be performed by a human.

AI-visible entries follow field and table renames, including in Full Access, and are removed when those objects are deleted. Renaming an unmarked object cannot acquire a stale exception under its destination name. With the policy on, AI cannot rename secret-named or secret-derived fields, even with an explicit AI-visible exception. The design guard compares table and field IDs at every intermediate operation and refuses the whole batch before any write, so a rename cannot remove the field's secret classification or output redaction. A human can still rename fields; classification is recomputed from the resulting schema.

Live `restoreDeleted` operations require a recorded deleted entry and use only its saved patch. AI callers cannot supply `op.patch`, even with the policy off or a valid deleted ID. The shared guard also rejects patch paths naming AI visibility, privilege sets or security. Replaying persisted design history can still use its recorded restore patch after the deleted entry has been consumed.

The implementation deliberately overestimates read sets: it checks all tables in the file and its referenced files, including formulas and record-access calculations. This covers indirect reads, related data and portals without claiming to trace individual values. An unrelated secret-bearing table can therefore refuse an otherwise safe operation. An ON file's AI request treats every referenced file as ON for that request, transitively, even if those files' saved settings are OFF. The caller's privileges and human-set exceptions in each referenced file still apply. An OFF file asked about directly retains legacy behavior; a referenced ON file still enforces its own policy, including on its downstream sources. No saved setting is changed by this propagation. Unresolved sources reached under an ON policy are refused.

Calculation fields, auto-enter calculations and lookup copies inherit secret classification from direct references to secret-named or privilege-hidden/masked fields. References resolve through local and hosted-file table occurrences to the base field, and classification propagates through transitive chains and cycles. It is recomputed from the current schema on every policy check. A human's exception for the source alone does not exempt a derived field. AI creation or modification of a secret-derived calculation or lookup is refused before application or stored-value recomputation, even with a blanket table exception; design batches are checked at each intermediate schema. For example, `Encoded = Base64Encode ( Password )` and `Leak = ItemsRel::Password` are refused. Safe copies and policy-OFF changes retain their previous behavior.

This schema analysis covers direct field references and lookup sources; it does not persist value provenance, infer string-based `GetField` references, or trace dependencies through custom-function bodies. The conservative read-set checks below still apply to those constructs.

SQL is compiled and inspected without executing it. Virtual or unknown sources and user-defined SQL functions are refused. Calculation parsing rejects `Evaluate`, computed SQL and field names, unknown functions and global variables whose provenance crosses script runs. Scripts use an explicit set of understood steps and options; their calculations and script targets are checked before execution. All scripts are included when executing a script because triggers and nested calls can change the read set. Model dispatch also checks actual unsaved programs and completed subcalls. Explicit agent accounts are checked when using Data API tokens; ordinary human Data API access is unchanged. Arbitrary trial design changes and automation trials remain refused while the policy is on because this analyzer does not prove their new programs.

This is the interim conservative policy recommended by `docs/research/secret-taint-tracking.md`, **not persisted taint tracking**. It cannot reconstruct the provenance of old values copied into ordinary fields. It does not sanitize prompt text supplied directly by a user. It can refuse safe operations and should not be described as complete information-flow protection.

See the [implementation report and entry-point inventory](ai-visible-policy-report.md) for validation and source locations.
