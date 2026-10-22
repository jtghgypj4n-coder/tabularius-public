# Give each person an account and privilege set

Use this guide when people or integrations need different access to one hosted solution. Create a separate account for each identity, then grant only the access its work needs.

## 1. Start from the access the task needs

Write down which layouts, tables, fields, and scripts the person must use. A human who edits invoices and an integration that reads invoice status should not share an account: separate accounts make access review and revocation clearer.

## 2. Create a privilege set

In the web client, open **File → Manage → Security**, create a privilege set, and choose the permitted records, layouts, fields, and scripts. Start restrictive, then add the one permission needed when a task fails. Use the [security defaults](../../security-defaults.md) and [AI-visible policy](../../ai-visible-policy.md) to understand separate controls.

Privilege names in a converted file may be used by scripts, layouts, or accounts. Check references before renaming or removing a set. The read-only [solution check](../../check-solution.md) reports some missing or unusable privilege definitions.

## 3. Add an account and assign the set

Create a local account with a unique name and strong password, then assign the new privilege set. For an API client, issue a dedicated API token after signing in as that account; scope it to the intended file and revoke it when the integration is retired.

<!-- docs-example: run -->
```sh
tabularius new ~/access-review Invoices --starter invoicing
tabularius privileges ~/access-review Invoices
```

The command help lists the account operations available in this version. For a complete guided API example, see [Add a Data API client](../../tutorials/data-api-client.md).

## 4. Test with the account itself

Sign out of Full Access and sign in as the new account. Try the normal task, then try one action that should be denied. Confirm both outcomes in the web client or with the account's own API token. A successful administrator check does not prove that the restricted account can do its job.

## Check afterwards

- The account has its own identity and the intended privilege set.
- Required operations succeed; an out-of-scope read or write is refused.
- Removing the account or revoking its token ends access without changing another user's credentials.

## References and differences

- [Security defaults](../../security-defaults.md) · [Data API compatibility](../../data-api-compatibility.md) · [Known differences](../../known-differences.md)
- Tabularius permission checks are described here from this repository's implementation. FileMaker privilege semantics beyond statements documented by Claris are **inferred** and need a FileMaker comparison. <!-- known-difference: Privileges and security ;; FileMaker privilege semantics beyond what Claris documents are inferred, not verified ;; A privilege check may differ from FileMaker's in a case Claris does not document ;; A FileMaker comparison run of the privilege case -->
