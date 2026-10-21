# tabularius doctor

This command's usage comes from `tabularius help doctor`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius doctor [<folder>] [--full] [--port 8080] [--url https://...] [--ai-embed-url ollama|lmstudio|URL [--ai-embed-model M]]
                                             Check the usual reasons a server won't start or can't
                                             be reached (Node version, folder, disk, port, certificate,
                                             backups, service, address), with one fix for each. Changes
                                             nothing; exits 1 if there is a problem
```

## Options

`--ai-embed-model`, `--ai-embed-url`, `--full`, `--port`, `--url`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius doctor --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
