# tabularius import-tables

This command's usage comes from `tabularius help import-tables`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius import-tables <folder> <database> <file|folder>... [--preview] [--json] [--no-links] [--set Sheet.Column=kind]
                                             Come in from Airtable, Notion, Google Sheets or
                                             Excel: each CSV file, Excel sheet or Notion ZIP
                                             (CSV tables and Markdown pages) becomes tables;
                                             extracted Markdown folders also become a table; column
                                             types are worked out (text, number, date, time,
                                             timestamp, checkbox, select, multi) and a column of
                                             linked records becomes a join table with
                                             relationships and a portal. --preview shows the
                                             plan and writes nothing; --set overrides a kind
                                             (or link:Sheet, or skip). Data only; counts only
```

## Options

`--json`, `--no-links`, `--preview`, `--set`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius import-tables --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
