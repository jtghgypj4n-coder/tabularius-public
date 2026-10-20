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
