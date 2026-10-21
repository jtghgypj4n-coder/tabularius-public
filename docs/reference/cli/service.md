# tabularius service

This command's usage comes from `tabularius help service`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius service install <folder> [--port 8080] [--host 127.0.0.1] [--system] [-- serve options]
                                             Run it as a service that starts at login, or with
                                             --system at boot (launchd, systemd or Windows Task
                                             Scheduler), on this computer only unless --host
                                             says more; 'service print' shows the file,
                                             'service uninstall' removes it (files stay). Refuses
                                             a port another program holds, naming a free one
```

## Options

`--host`, `--port`, `--system`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius service --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
