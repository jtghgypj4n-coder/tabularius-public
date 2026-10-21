# tabularius totp

This command's usage comes from `tabularius help totp`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.

## Usage

```text
Usage:
  tabularius totp <folder> <database> enroll <account>
                                             Turn on two-factor sign-in: prints a secret and an
                                             otpauth:// URI for an authenticator app
      ... confirm <account> <code>           Confirm the first 6-digit code to switch it on
      ... status                             Accounts that have two-factor sign-in
      ... disable <account>                  Turn it off for an account
```

## Options

No command options are listed.

## Exit codes

0 on success; 1 on error.

## Tested CLI example

```sh
tabularius totp --help
```

This example is executed by the CLI reference test.

[All commands](index.md)
