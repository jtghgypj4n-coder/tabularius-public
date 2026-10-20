# Checking a whole solution

`tabularius check-solution` looks through a solution for what is wrong without running anything and without changing anything. It is the check the [starter solutions](starter-solutions.md) pass in their tests, and it is a good thing to run after converting a FileMaker file, after a large design change, and in a build script.

<!-- docs-example: placeholders {"~/tabularius": "~/Databases", "clerk": "Admin"} -->
```sh
tabularius check-solution ~/tabularius Invoices
tabularius check-solution ~/tabularius Invoices --json
tabularius check-solution ~/tabularius Invoices --account clerk
```

Each finding has a **severity**, **where** it is (the table, layout, script and line), what is wrong, and a one-line fix.

```
error   Script "New invoice", line 3: There is no script named "helper" (did you mean "Helper"?).
        fix: Point the step at a script that exists, or add the script.
warning Script "Mail it", line 2: Send Mail gives error 3 unless the server is set up for it.
        fix: Check the server options for it (docs/script-steps-support.md), or handle error 3 after the step.
Invoices: 1 error, 1 warning, 2 to tidy
```

| Severity | Meaning |
| --- | --- |
| `error` | It fails when used: a name that is not there, a calculation that does not parse. |
| `warning` | It runs, but does not do what it looks like, or this build cannot run it. |
| `info` | Tidying: something nothing uses. Never fails the check. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Nothing wrong (information does not count). |
| 2 | Problems were found: any error or warning. With `--fail-on error`, only errors. |
| 1 | The check could not run: no such folder or database, an unknown `--account`, a mistyped option. Nothing is printed on standard output. |

## What it looks for

| Finding | Severity | Meaning |
| --- | --- | --- |
| `formula-syntax` | error | A calculation (field, script step, layout object, menu item or trigger parameter) does not parse. |
| `formula-unreadable` | warning | The file reader could not read part of a calculation from a FileMaker file, so it is not checked or run correctly here. |
| `formula-problem` | error | A field's calculation names a field its table does not have, or gives a function the wrong number of parameters. |
| `unknown-function` | error | A calculation calls a function that is not built in, not one of the file's custom functions, and not a plug-in's. |
| `plugin-not-installed` | warning | A calculation calls a plug-in function with no version in this build; it gives `?` (see [plug-in compatibility](plugin-compatibility.md)). |
| `missing-table-occurrence`, `missing-field`, `missing-script`, `missing-layout`, `missing-value-list` | error | A script step, calculation, button, trigger, menu item, layout object or privilege names something that is not there. A layout object is also checked by the ids it stores, so a field deleted from a table is found even when the layout still shows its old name. |
| `layout-table-missing` | error | A layout shows a table occurrence that no longer exists. |
| `relationship-field-missing` | error | A relationship's match field is not a field of its table. |
| `relationship-no-match-fields` | warning | A relationship has no match fields (deleting a field takes its match with it), so every record on one side relates to every record on the other. |
| `value-list-source-missing` | error | A value list takes its values from a field, a table or a data source that is gone, or has no values at all. |
| `script-lint` | error / warning | The [script linter](design-mode.md)'s findings: loops that never end and guards that catch nothing. |
| `step-unavailable` | warning | A step that gives error 3 in this build (see [script step support](script-steps-support.md)); the script goes on to the next step. |
| `step-needs-setup` | info | A step that gives error 3 unless the server is set up for it (sending mail, network access, the embedding model). |
| `privilege-set-missing-object` | warning | A privilege set sets access for a layout, script, value list, table or field that was renamed or deleted. |
| `privilege-set-grants-nothing` | warning | A privilege set that lets no one view records in any table. |
| `account-no-privilege-set` | warning | A local account that has no privilege set, so it can do nothing. |
| `unused-script`, `unused-value-list`, `unused-custom-function` | info | Nothing in the design uses it. A script may still be run through the Data API, a schedule or by hand. |

Script steps that are switched off are not checked.

## For one account

`--account A` also asks what that account would meet:

| Finding | Severity | Meaning |
| --- | --- | --- |
| `account-cannot-run-script` | warning | A button on a layout the account can open runs a script its privilege set does not let it run. |
| `account-cannot-open-layout` | error | The file opens on a layout the account may not see. |

[Full Access] accounts have no such findings.

## From an AI app

The same check is the `check_solution` MCP tool (Full Access only, read-only): it gives the same `database`, `counts` and `findings` as `--json`, and takes an optional `account`. To check one script or one calculation use `check_script`, `lint_script` and `check_calculation`.

## What it does not do

- It reads the design, not the data: it does not run scripts or evaluate calculations on records. The one look at record data is a search of web viewer fields for the scripts they call (so that a script a web viewer runs is not reported as unused); no value from a record reaches the output.
- Names inside text it cannot parse (a calculation built at run time with `Evaluate`, a script name held in a variable) are not followed.
- A table in another file is checked only when that file is hosted next to this one.
- Unqualified field names in a script step's calculation are not checked, because the layout a script runs from is not known; qualified names (`Invoices::Total`) are.
