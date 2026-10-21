# tabularius audit

This command's usage comes from `tabularius help audit`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius audit <folder> <database> [--table T] [--record N] [--account A] [--since ISO] [--limit N]
                                             Who created, changed and deleted which records
  tabularius audit verify <folder> <database> [--chain security|records] [--sign-key FILE [--check ANCHOR.json]]
                                             Check history read-only; prints JSON. security (the
                                             default) is sign-ins and privilege changes, records
                                             is record changes. Exits 0 consistent, 1 broken,
                                             2 unprotected. Consistent means internal consistency,
                                             not authenticity or completeness. Recomputed history,
                                             a rewritten head or an older valid backup can pass.
                                             Stronger guarantees need independently protected
                                             checkpoints: with --sign-key (a secret of 16+ bytes
                                             you keep) the output carries an "anchor", the newest
                                             hash signed; store it somewhere the server can't
                                             reach. Later, --check ANCHOR.json with the same key
                                             fails (exit 1) if the log no longer holds that hash
                                             at that position. Access uses filesystem permissions,
                                             not console authentication.
```

## Options

`--account`, `--chain`, `--check`, `--limit`, `--record`, `--sign-key`, `--since`, `--table`

## Exit codes

0 on success; 1 on error; 2 when unprotected.

## Tested CLI example

```sh
tabularius audit --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
