# Find records and build a report

Use this guide to find a set of records, check the result, and prepare a summary in Tabularius. It applies to a hosted solution whose table, fields, and layout already exist.

## 1. Check the solution before searching

Run the read-only solution check with the account you plan to use. It reports design issues and account-specific access findings; it does not run calculations on record data.

<!-- docs-example: run -->
```sh
tabularius new ~/find-report Invoices --starter invoicing
tabularius check-solution ~/find-report Invoices --json
```

Review errors first, then warnings. Resolve a missing field, layout, or script before relying on a report built from it. See [Check a solution](../../check-solution.md) for finding meanings and limits.

## 2. Define the question as criteria

In the web client, switch to Find mode, enter criteria in the fields that describe the set you want, then perform the find. Use a separate request when alternatives should match; values in one request narrow the same record. Confirm the found count before editing, exporting, or summarising.

For a repeatable API query, send criteria to the layout's `_find` endpoint. The [Data API tutorial](../../tutorials/data-api-client.md) has a runnable contacts example; its [compatibility page](../../data-api-compatibility.md) lists response differences.

## 3. Summarise the found set

Use a summary field for a total or count, and group the records with a sort when the report needs subtotals. Preview the report before exporting: check the found count, sort order, group breaks, and whether the account can see every field used in the result.

Tabularius's current report output follows the layout and summary definitions available to its web client. It does not promise the same printed pagination as a particular FileMaker layout.

## Check afterwards

- The found count matches the question you asked.
- A second, narrower criterion produces a subset; clearing the criteria restores the broader set.
- The report's sort and summary fields are present on the layout and visible to the account.

## References and differences

- [Web client](../../web-client.md) · [Data API reference](../../reference/rest.md)
- [Known differences](../../known-differences.md) records report and layout limits. FileMaker's exact find matching and printed report behavior are **inferred** here unless a linked Claris reference says otherwise; verify parity in FileMaker before relying on it. <!-- known-difference: Text comparison ;; FileMaker's exact find matching and printed report behaviour are inferred unless a Claris reference says otherwise ;; A find or printed report may match or lay out differently ;; A FileMaker run of the find or report -->
