# tabularius test-scripts

This command's usage comes from `tabularius help test-scripts`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius test-scripts <folder> [database] [--script NAME]... [--skip NAME]... [--timeout 10] [--loop-limit N] [--loop-records N] [--global '$$NAME=VALUE']... [--json] [--verbose] [--explain] [--show [--function NAME]...] [--lint]
                [--test-outbound [--mail-redirect ADDRESS] [--mail-copies 20] [--allow-host h[,h]] [--capture-only F[,F]] [--capture-only-copies-to-redirect]]
                                             Run each script offline (no network, mail or
                                             plug-ins) from the layout of a button that runs
                                             it, first record current, selection globals set;
                                             each script's changes are undone. Lists the
                                             scripts that stall, crash or end with an error
                                             (a script using over half the memory is stopped
                                             and counted as stalled; --verbose names each
                                             script as it starts). --skip takes names with *
                                             anywhere ("*Upload*"), lists what it
                                             matched first, and stops if a pattern matches
                                             nothing. Scripts with credentials written into
                                             them (AWS keys, a password in a variable) are
                                             never run and are listed as skipped.
                                             --explain: for each script that ends with an
                                             error, why: it runs again on a copy, offline, and
                                             shows the failing step, the steps before it, the
                                             variables and field values there, and hints
                                             --test-outbound: as for serve, mail is captured
                                             in <folder>/Outbox instead of failing
                                             --show: print the --script scripts' steps instead
                                             of running them, with literals, addresses and
                                             keys masked (names stay), to share why one stalls;
                                             --function NAME also prints that custom
                                             function, comments masked too
                                             --global '$$UserName=tester': set a $$variable
                                             before each script, as a login script would
                                             (a field that fills in from an unset one is
                                             reported as test setup, not a script fault)
                                             --lint: run nothing; list loops that never end
                                             and guards that catch nothing, with a fix each
                                             (a stalled script lists these too)
```

## Options

`--allow-host`, `--capture-only`, `--capture-only-copies-to-redirect`, `--explain`, `--function`, `--global`, `--json`, `--lint`, `--loop-limit`, `--loop-records`, `--mail-copies`, `--mail-redirect`, `--script`, `--show`, `--skip`, `--test-outbound`, `--timeout`, `--verbose`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius test-scripts --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
