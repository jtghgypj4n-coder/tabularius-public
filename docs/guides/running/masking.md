# Mask sensitive fields

Use this guide when a user or integration needs to identify a record without seeing every field. Masking controls how a value is displayed; it is not a replacement for removing read permission.

## 1. Identify fields that should not be shown

List credentials, personal identifiers, and other values that do not belong on the screen or in an export for the intended audience. Check calculations and related fields too: a second field can expose a copy or transformation of the original value.

## 2. Set field access and masking

Open **File → Manage → Security**, edit the intended privilege set, and set the field's access and mask. Keep the field unavailable when the user does not need it at all. Use a mask only when the user needs to recognise that a value exists while its contents remain hidden.

The [security defaults](../../security-defaults.md) and [personal-data isolation](../../personal-data-isolation.md) pages describe the implemented controls. For AI requests, read [Per-file AI-visible policy](../../ai-visible-policy.md): AI visibility is a distinct policy and does not grant ordinary field access.

## 3. Check every way the value can leave the screen

Sign in as the intended account and inspect the web client, a Data API response, a report/export, and any script or calculation used for the task. Test a derived field as well as the source field. A masked screen alone is not evidence that an API or calculated value is safe.

<!-- docs-example: run -->
```sh
tabularius new ~/mask-review Invoices --starter invoicing
tabularius privileges ~/mask-review Invoices show "Read only"
```

Use the command's built-in help to see the current privilege inspection options; test the actual account through the same surface it will use.

## Check afterwards

- The user can complete the intended task without seeing the protected value.
- The underlying value is not returned by the account's API, export, or derived fields.
- Changing the privilege set does not make the field visible to other accounts.

## References and differences

- [Security defaults](../../security-defaults.md) · [AI-visible policy](../../ai-visible-policy.md) · [Data API compatibility](../../data-api-compatibility.md)
- Masking details differ among FileMaker versions and access surfaces. This guide describes Tabularius behavior; any claim about matching FileMaker is **inferred** pending a Claris citation or a direct comparison. <!-- known-difference: Privileges and security ;; Masking details differ among FileMaker versions and access surfaces, and matching FileMaker is inferred ;; A masked value may show differently from FileMaker's ;; A Claris citation or a direct FileMaker comparison -->
