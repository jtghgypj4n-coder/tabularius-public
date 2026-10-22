# Build a dashboard with charts

Use this guide to turn a few operational questions into a dashboard for a team. It applies to a solution with a tested found set and fields that the dashboard account may read.

## 1. Pick questions before visuals

Write down the decisions the dashboard should support, such as open invoices by status or calls due this week. Give each chart one question, one source layout, and a named time range. Avoid putting personal or secret fields on a shared dashboard.

## 2. Prepare the data

Make sure the source table has the category and numeric or date fields needed by the chart. Use a summary field for totals where appropriate. Test the underlying find and sort first; a chart cannot correct a wrong found set or a field the account cannot access.

## 3. Create a dashboard, then add a chart where it belongs

For a generated dashboard, open **Design → Layouts → New layout** and choose **Modern dashboard**. It uses the table's field names and types to propose figures; review each selected field and date range against your question. For a chart on a regular layout, enter Layout mode, add a chart object, select its data source, and map the category and value fields. Give it a clear title and labels. Add a text summary for the same measure so a reader can check the number without relying on color alone.

<!-- docs-example: run -->
```sh
tabularius help design
```

Use the current design help for supported import and editing operations. Visual chart editing is done in the web client.

## Check afterwards

- The chart's total agrees with a direct find or summary-field check.
- The dashboard account sees only the intended records and fields.
- Labels communicate the series and units without color alone.
- Narrow and empty found sets remain understandable.

## References and differences

- [Web client](../../web-client.md) · [Design mode](../../design-mode.md) · [Known differences](../../known-differences.md)
- Dashboard layout and chart parity with FileMaker is **inferred** unless a specific behavior is documented by Claris or checked in FileMaker. Confirm chart types and summary behavior against the linked known-differences page before migration. <!-- known-difference: Web client ;; Dashboard layout and chart parity with FileMaker is inferred unless Claris documents it or it was checked in FileMaker ;; A chart type or summary may look or add up differently ;; A FileMaker run of the chart or summary in question -->
