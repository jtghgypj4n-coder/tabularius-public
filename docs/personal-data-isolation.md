# Keep personal data away from AI

Personal data isolation is a switch for each hosted file. When it is on, AI models never see the names, email addresses, phone numbers, addresses, id numbers or notes in that file. They see stand-ins such as `<PERSON_3>` or `<EMAIL_12>` instead. People still see the real values everywhere.

It covers every way the file's data reaches an AI model:

- the AI assistant in the web client, including Find with AI, Agent mode plans, digests' summaries, Replace Field Contents with AI, AI import matching and AI test cases;
- AI apps connected over MCP, including Claude Desktop, Claude Code and the claude.ai connector;
- the AI-written parts of the admin console, such as the handover memo and the conversion guide's overview.

## Turn it on

In the admin console, go to **Hosted files**. In the **Personal data** column, click **Settings** next to the file, then **Turn on**.

On the server's command line it is:

```
tabularius ai <folder> <database> pii on
```

Use `pii off` to turn it off and `pii status` to check. Turning it on or off is recorded in the file's security log.

If a file shows data from another hosted file that has isolation on, isolation applies to it too. The Personal data column says which file it comes from.

## What the AI sees

With isolation on, a client's record looks like this to an AI model:

```json
{ "Full Name": "<PERSON_3>", "Email": "<EMAIL_4>", "Status": "Active", "Score": 7 }
```

- **The same value gets the same stand-in every time.** The model can still say "<PERSON_3> has two open invoices", or find that client again by `<PERSON_3>`. The assistant's answer shows "Ann Lee has two open invoices".
- **Stand-ins work both ways, where that can't get a value out.** The model can find a record by a whole stand-in (`==<PERSON_3>`) and write a whole stand-in into a personal field; the real value is used. A stand-in written into a field that isn't personal, or glued to other text, is refused, so a value can't be copied somewhere it would come back in plain text.
- **Personal fields can't be searched letter by letter.** On a personal field the model can only find a stand-in it was given, `=` (empty) or `*` (any value). Wildcards, ranges and typed guesses such as `Smith` are refused.
- **Stand-ins belong to an account.** An account can only turn back stand-ins it was given, and a limited API token (read-only, or some layouts only) has its own.
- **The stand-ins are stored in the file**, out of reach of SQL and of every API. Turning isolation off deletes them.

**Settings** shows how each field is treated and why. It also shows a few records of a layout exactly as an AI model would get them.

## Which fields count as personal

Tabularius works each field out once, from its name, its type and a sample of its values:

- **Personal:**
  - fields whose names say they hold names, emails, phones, addresses, ids, card or bank numbers, dates of birth, notes or comments;
  - fields that record who made or changed a record;
  - container fields;
  - summary fields of every result type;
  - text fields whose values look like emails, phone numbers, card numbers or social security numbers.
- **Personal, whatever its name or result type:** calculated fields, auto-enter calculations and looked-up values. This conservative rule includes custom functions and dynamic field/SQL reads: a number, boolean encoded as a number, or code can reveal personal data too. A human can explicitly mark a safe derived field as Not personal.
- **Secret-named fields:** credentials such as passwords and PINs are personal even when numeric, so typed finds and ranges cannot probe their values. Existing secret-value output redaction still applies. Marking such a field **Not personal** lifts this protection (its value still shows as hidden, but a range find can narrow it down), so leave the mark off.
- **Generated keys:** a field whose only formula is `Get ( UUID )` as an auto-enter calculation is not personal, so lookups and joins by a primary key keep working (the same value copied into a child table's key field is judged by its own values). Any other calculation, lookup or summary is personal, including one on a key or restricted to a value list: the calculation rule comes first.
- **Not personal:**
  - ordinary stored numbers, dates and times whose names say nothing personal;
  - number keys and serial numbers (Customer ID, kf_ContactID);
  - text fields named as codes or keys whose values are all codes (INV-0042); a text "Sort Key" holding names is personal;
  - fields restricted to a value list;
  - text fields that hold only a few repeated values, like a status or a category.
- **Anything else counts as personal, to be safe.** That includes free text and empty text fields.

Click **Personal** or **Not personal** next to a field to override this, and **Reset** to go back. Overrides are recorded in the security log.

Text that isn't in a field is checked too: emails, phone numbers, card numbers (when the check digit is right) and social security numbers become stand-ins wherever they appear. This covers your own questions, script steps and formulas.

## What AI can't do while it is on

Some tools return results that can't be checked field by field, so they are refused while isolation is on. AI apps get a message saying so. The assistant simply isn't offered them.

- SQL queries, free formulas (evaluate, explain a value) and running or debugging scripts;
- word search across the file, record summaries, charts and dashboards;
- record history and the audit log;
- data checks and fixes, imports and stale calculations;
- container contents;
- trying automations, and listing automations (their run messages can hold values);
- changing the design or security (a new calculation or a renamed field could show a personal value under a name that says nothing personal). The assistant can still propose design changes for a person to apply.

Also:

- **describe_layout** gives field names and types but no values from the data.
- **Checking a draft calculation** doesn't evaluate it on records.
- **Dry runs of drafted scripts** are shown to the person, but not described to the model.
- **Scripts can't use AI steps** (Generate Response from Model, Perform Find by Natural Language), because a script's prompt is whatever text it puts together.
- **Pictures can't be sent** to the assistant.
- **A refused record change** (a failed validation, a missing privilege) reaches the model only as "the file refused this change", because a validation message can quote the record.
- **AI import matching** sees headers that match existing target field names; other headers become column positions because they may be a mistaken first data row. Samples become stand-ins (`<EMAIL_4>`). Short numbers and yes/no values are kept only when the header does not identify personal data or a secret.

## The security log

Every exchange that kept personal data from a model goes in the file's security log under **AI access**. It records how many values of each kind were swapped (for example "4 person, 2 email"), never the values. Refused tools are logged there too.

## Limits

This is a strong guard, not a guarantee. These are the gaps we know of:

- **What people type.** A name you type in a question goes to the model as you typed it, unless the model was already given a stand-in for it in a field. Emails, phone numbers, card numbers and social security numbers are always caught.
- **Personal data in the design.** A name typed into a value list, a script comment, a layout label or a field comment is not swapped, unless it looks like an email, phone or card number. Field and table names are sent as they are. So are account names, which design and security tools list (and which are often people's names).
- **Sorting and counting.** The model can sort records by a personal field and count records, so it can learn, for example, which of two stand-ins comes first alphabetically. It never sees the values.
- **Values kept for stand-ins.** Every personal value an account's AI is shown is kept in the file, for that account, until isolation is turned off. Deleting a record (or emptying its table) deletes the whole values it held from there, for every account: its stored fields' values as they were shown (a date in either format, each repetition of a repeating field on its own). A saved copy as a clone starts with an empty vault. Values found inside longer text, worked out by an unstored calculation, or kept in another file's vault are not matched and stay, and neither are the records taken away by reverting a create, a reconversion, or dropping a table or field; a value another record holds too is given a new stand-in the next time it is shown. A file that shows another file's fields keeps those values too. Deleting an account, or removing it through SCIM, deletes its stand-ins here and in the files it uses. When a refusal quotes data owned by an account of another file (a script run with its own privileges), the stand-ins for that quote are kept under that other account, not under the person who asked, and go when that account is deleted. (When the administrator is the one asking, they are kept under the administrator instead, and go only when isolation is turned off.) Removing the stand-ins in a file that is busy or closed at that moment is skipped, and they stay until the next deletion or until isolation is turned off.
- **Renamed fields.** An administrator's mark is kept by the field's name, so renaming a field drops its mark and Tabularius works it out again. The reverse also holds: delete a marked field and create another with the same name, and the new field inherits the mark. Review marks after redesigning a table.
- **Spreadsheet headers.** A header matching an existing target field name is treated as schema and sent using that field's spelling. Other headers are withheld; matching may need more human input when those names carried useful meaning.
- **Unusual identifiers.** National id formats other than US social security numbers, IBANs, licence plates and similar values are only caught when the field's name says what it holds, or when the field is free text (which counts as personal anyway). Mark such fields as Personal if their names don't say so.
- **Fields worked out from a sample.** A field is judged from up to 200 of its values and re-checked every ten minutes. A text field that held only a few repeated values in that sample counts as not personal. Check **Settings** after importing new kinds of data.

See the [indirect-channel audit and residual-signal table](../notes/audits/r25-02-redaction-oracles.md) for the distinction between isolation stand-ins and the separate AI-visible policy's pre-execution refusal.
