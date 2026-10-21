# tabularius privileges

This command's usage comes from `tabularius help privileges`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius privileges <folder> <database> policy [minLength [maxAgeDays]]
                                             Show or set the file's password policy
                                             (0 turns a limit off; a file with no minimum
                                             of its own takes 12, TABULARIUS_MIN_PASSWORD_LENGTH)
  tabularius privileges <folder> <database> must-change <account> [off]
                                             Require (or clear) a password change at
                                             the account's next sign-in
  tabularius privileges <folder> <database>  Accounts and privilege sets
      ... show <set>                         A privilege set as JSON
      ... save <set.json>                    Add or replace a privilege set
      ... account <account> <set>            Give an account a privilege set
      ... grant|revoke <set> <keyword>       Extended privileges: fmrest (Data API),
                                             fmapp / fmwebdirect (web client), fmmcp (AI),
                                             fmurlscript (run a script from a link),
                                             fmxdbc (SQL at /tabularius/sql/v1, like ODBC),
                                             fmodata (OData at /fmi/odata/v4: Excel, Power BI)
      ... external <group-or-email> <set>    An external account, for sign-in through
                                             the identity provider (serve --oidc-issuer)
```

## Options

`--oidc-issuer`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius privileges --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
