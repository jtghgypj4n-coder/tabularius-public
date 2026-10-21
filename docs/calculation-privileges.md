# Calculation reads and field privileges

Security review follow-up to #1184, checked 2026-10-16.

## Claris documentation and evidence limits

No page in the official help specifies the rules below. The pages consulted were:

- [About accounts, privilege sets, and extended privileges](https://help.claris.com/en/pro-help/content/accounts-privilege-sets-privileges.html): privileges restrict fields, records and tables; an external table uses its owning file's privileges.
- [Editing record access privileges](https://help.claris.com/en/pro-help/content/record-access-privileges.html): a prohibited field displays `<No Access>`; related fields require view access; displayed summaries and calculations over multiple records exclude records the viewer cannot see. Field-based value lists and `ValueListItems` also respect restricted access.
- [Working with shared files as a client](https://help.claris.com/en/pro-help/content/shared-files-as-client.html): inaccessible fields display `<No Access>`.
- [Editing value list privileges](https://help.claris.com/en/pro-help/content/value-list-privileges.html): restricting a value list prevents seeing its items.
- [Defining field validation](https://help.claris.com/en/pro-help/content/field-validation.html): membership validation checks the specified value list; membership is checked at record commit.

These pages do **not explicitly specify** whether an unstored calculation in
the same record can evaluate a prohibited source field, or whether membership
validation filters hidden source records. No native FileMaker experiment was
performed. The broader statements above are not proof of either edge case.

## Unstored calculations and summaries returned to a viewer

A user read treats both `none` and `masked` source fields as empty, including
references to its own record. For example, with `Secret = "TOPSECRET"`,
`Public = "|visible"`, and unstored `UCalc = Secret & Public`, a restricted
reader gets `|visible`; a reader allowed to see Secret gets
`TOPSECRET|visible`. This extends the existing masked-field behavior and
ensures that selecting `none` cannot disclose more through this calculation.
It is an explicit display/read security policy, not a claim that Claris
documents this exact calculation result.

The shared calculation context applies the check before reading normal,
global, repeating or calculated fields. Aggregate references also check
before their global-field shortcut. This covers scripts, Store evaluation,
Data API, OData, MCP, web records, and web layout formulas. Full Access
continues to evaluate the real values. MCP additionally redacts credential-like
fields and their copies independently of account privileges.

Summary collectors and the current record's own contribution use the same
field-access check: both `none` and `masked` inputs are empty. This covers
whole-table, found-set, related-record and grouped summaries, direct formula
references, `GetSummary`, and unstored calculations that read those summaries.
For example, `SumS = List of Secret` and `Leak2 = GetSummary ( SumS ; Public )`
return no secret text to the restricted reader; a find on Leak2 cannot match
the hidden secret. Record and grouped-summary output also suppress summaries
over inaccessible sources. Counts exclude the empty inputs; formula totals
of empty inputs remain zero. Readable sources and Full Access retain their
real results.

Summary cache keys include the privilege fingerprint whenever an account
cannot read everything, including summaries over stored columns. Local,
found-set and shared results cannot reuse an Admin's summary for a restricted
reader, or a restricted reader's empty summary for Admin. The shared-result
version also changes so results calculated under the earlier rules expire.

## Stored calculations and auto-enter: retained stored-value behavior

Stored calculations and auto-enter calculations still evaluate with full data
and save their results. Those readable result fields can expose hidden source
values **by design**, matching FileMaker's stored-value behavior: reading a
saved value does not recalculate it under the reader's source-field privileges.
Protect the result field too. The existing `leakyStoredCalcs()` review helps
identify stored calculations of this kind. This change neither recomputes nor
redacts persisted derived values, including a readable stored result used as
a summary input.

Validation calculations and record-access rules also retain their internal
full-data evaluation.

## Formulas that read another file

A formula that reads a table of another hosted file follows the account's
privileges in **that** file, for whoever writes, tests or explains it. The
account has to exist there: with no account in the other file, nothing in it
resolves.

- **Typing and testing a formula** (Specify Calculation's check, the formula
  preview, Evaluate in the Data Viewer, the assistant's drafts, the MCP tools
  `check_formula`, `check_calculation` and `evaluate_calculation`): a field of
  another file the account cannot see (hidden or masked, in a table it cannot
  view, or in a file where it has no account) is reported as missing, with the
  same message as a field that does not exist, so naming it says nothing about
  the file. Records the account's row rules do not allow are left out of what
  the formula reads.
- **Saving a stored formula** (a stored calculation, an auto-enter calculation, a
  validation calculation or its message, a lookup) through the design route,
  the staged-change apply route or MCP `change_design`: a stored value is worked
  out with full data and kept for everyone, so it is refused when it reads a
  field the account cannot see in the other file (again the same answer as for a
  field that is not there), when it reads a table of which the account sees only
  some records (use an unstored calculation, which is worked out for each
  reader), or when it reads by name or query (`GetField`, `Evaluate`,
  `ExecuteSQL`, `ExecuteSQLe`, `BE_FileMakerSQL`) and the account cannot read all
  of the other file. A relationship made on another file's field the account
  cannot read is refused the same way. Accounts with Full Access in the other
  file, and changes made without an account (the operator's, the owner's own
  tools), are not restricted.
- **What counts as reading**: the formula as the calculation engine parses it, so
  a comment, spacing or the case of a name cannot hide a call, and a name that is
  only inside a comment or a string is not a read. Custom functions are followed
  into their bodies (and the ones those call), and an unstored calculation the
  formula reads is followed into its own formula, however long the chain, because
  a stored value reads it with full data; a summary field is read through its
  source field and break field. When there is too much to follow, the save is
  refused, not let through. The optimization fix that stores a calculation is
  checked as the account that asks for it.
- **Changes that reach formulas already saved**: changing, renaming or deleting
  a custom function, changing an unstored calculation, a table occurrence, or the
  file a data source points at, checks every stored formula that reaches what
  changed, as the account making the change, and refuses the change if one of
  them would now read what the account cannot see. A formula that reads by name
  or query is looked at again when a file the account cannot read in full comes
  into reach.
- **Explain This Value and `explain_value`**: what the formula reads in the
  other file is read as the account may, so the result and the steps over it
  hold nothing it cannot see; a field of the other file it cannot see is not
  listed, not even as "hidden".

Not covered: a stored formula or relationship already in the file keeps what
its author was allowed to write (it is looked at again only when a change
reaches it, as above), record-access rules are still worked out with full data,
a relationship the owner built on a field an account cannot see still lets that
account's own key values probe it, and the portal filters of layouts are not
looked at here. `ValueListItems` is treated as a read by name when a value list
takes its values from a file the account cannot read in full.

## Value-list membership validation: retained compatibility behavior

The LOW finding is retained as the existing file-level integrity policy:
validation uses the complete specified list, while displaying that list uses
the viewer's privileges. An editor can still distinguish a hidden member
(success) from a nonmember (error 506). This is an acknowledged membership
oracle, not something the unstored-calculation fix closes.

The compatibility rationale is that validation constrains data written to the
file; making validity depend on what an editor may view could reject existing
valid choices. Claris documents membership in the specified list, but does not
explicitly settle hidden-record membership in the pages above. Accordingly,
**FileMaker parity for this finding remains unverified**. Retaining the behavior <!-- known-difference: Privileges and security ;; Whether FileMaker lets a validation by value list see records the editor may not view is not confirmed, and the behaviour is kept as it was ;; A field validated against a list backed by confidential data can accept a value the editor could not see listed ;; A native FileMaker test with a restricted account -->
is a conservative compatibility decision pending native confirmation, not a
confirmed FileMaker exemption. Do not use a list backed by confidential data
as a membership validator on a field an untrusted account can edit.

The regression suite records the retained success/506 distinction and verifies
that the same editor cannot display the hidden list. Related-only lists retain
their existing validation exclusion.
