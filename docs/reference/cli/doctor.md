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
  tabularius doctor --exposure [--url https://...] [--port 8080] [--sql-port N]
                                             What a running server is open to, with what to change:
                                             the addresses it listens on, plain HTTP, HSTS and browser
                                             headers, the public URL, the admin console, the AI (MCP)
                                             connector, the SQL port and trusted proxies. Asks the
                                             server without a password and signs nothing in; reads the
                                             installed service's options. Changes nothing; exits 1 if
                                             there is a problem
```

## Options

`--ai-embed-model`, `--ai-embed-url`, `--exposure`, `--full`, `--port`, `--sql-port`, `--url`

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius doctor --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
