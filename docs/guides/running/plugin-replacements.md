# Replace a plug-in dependency

Use this guide when a solution relies on a FileMaker plug-in function that is unavailable or behaves differently in Tabularius. Inventory calls first, then replace one dependency at a time and compare results with representative inputs.

## 1. Find plug-in calls

Search calculations and scripts for the vendor's function names. Run the solution check and inspect script-step findings. Keep a list of every call site and the expected result, including empty values and errors.

## 2. Check the compatibility table

Open [Plug-in compatibility](../../plugin-compatibility.md). It distinguishes implemented functions from unknown or unsupported calls. An unknown call may return `?`; do not assume that a similarly named function has the same argument or return contract.

<!-- docs-example: run -->
```sh
tabularius new ~/plugin-review Invoices --starter invoicing
tabularius check-solution ~/plugin-review Invoices --json
```

Use the help for the installed version to confirm the available read-only checks, then check the solution before and after each replacement.

## 3. Replace with a supported path

Prefer a built-in calculation, a script step, or a small application-side service with an explicit input and output contract. Keep network access disabled unless the replacement needs it, and limit any allowed hosts. Test success, missing input, and failure paths.

## Check afterwards

- No required call site is left pointing to an unsupported function.
- The replacement returns the intended values for normal, empty, and invalid inputs.
- The [known differences](../../known-differences.md) page records any remaining compatibility gap.

## References and differences

- [Plug-in compatibility](../../plugin-compatibility.md) · [Writing a plug-in](../../writing-a-plugin.md) · [Script-step support](../../script-steps-support.md)
- A Tabularius replacement is not evidence of FileMaker plug-in parity. Compatibility claims remain **inferred** unless the vendor contract is documented and the same cases are checked in FileMaker. <!-- known-difference: Vendor plug-ins ;; A Tabularius replacement is not evidence of FileMaker plug-in parity; compatibility is inferred unless the vendor contract is documented and the cases are checked ;; A replacement function may answer differently from the plug-in ;; The vendor contract and a FileMaker run of the same cases -->
