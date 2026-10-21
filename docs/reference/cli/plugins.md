# tabularius plugins

This command's usage comes from `tabularius help plugins`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius plugins <folder> [list]         Plug-ins in <folder>/plugins/ and the files each is on for
  tabularius plugins <folder> enable|disable <database> <plugin-id>
  tabularius plugins <folder> secret <plugin-id> <NAME> [--clear]   Set a plug-in's secret from standard input
  tabularius plugins <folder> install <package.ohplugin> [--trust <fingerprint>] [--allow-unsigned] [--replace]
  tabularius plugins <folder> uninstall <plugin-id>
  tabularius plugins <folder> script-install on|off|status   whether the Install Plug-In File script step works (off unless turned on)
  tabularius plugins <folder> keygen <key.pem>                    A publisher's signing key (keep the file secret)
  tabularius plugins <folder> pack <plug-in folder> [--key key.pem] [-o file.ohplugin]
                                             Turn a plug-in on or off for one hosted file; the
                                             server applies it when it next starts
```

## Options

`--allow-unsigned`, `--clear`, `--key`, `--replace`, `--trust`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius plugins --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
