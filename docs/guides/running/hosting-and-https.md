# Host a solution over HTTPS

Use this guide to host a solution for people or integrations on a network. HTTPS protects credentials and session traffic in transit; a reachable server still needs accounts, permissions, and a controlled network boundary.

## 1. Prepare a hosted folder

Put the solution in a dedicated folder and set passwords for its accounts before making it reachable. Review [hosting for a team](../../../README.md#hosting-for-a-team) for storage, worker, and backup choices.

## 2. Start with a local HTTPS certificate

For a local trial, Tabularius can create a local certificate when serving with `--https local`. Browsers and clients will need to trust that certificate. A public deployment should use a certificate for its public host name and a reverse proxy or certificate setup appropriate to the deployment.

<!-- docs-example: run -->
```sh
tabularius help serve
```

Check the `serve` help for supported TLS options and bind-address defaults in the installed version. Do not copy an old command line without checking its options.

## 3. Test the external route

From a second machine, open the HTTPS address, sign in with a non-administrator account, and call only the API operations it needs. Confirm that the certificate name and chain validate. If a proxy terminates TLS, prevent direct public access to the unencrypted listener and review proxy logs for credentials or tokens.

## Check afterwards

- The certificate validates for the name users open.
- A non-administrator account can complete its task and cannot exceed its privilege set.
- The plain HTTP listener is not exposed outside the trusted host or proxy boundary.
- Logs and monitoring do not retain passwords, bearer tokens, or full credential-bearing URLs.

## References and differences

- [Security defaults](../../security-defaults.md) · [Environment variables](../../environment-variables.md) · [Runbook](../../runbook.md)
- The TLS flags and defaults described here are Tabularius behavior. Equivalence with FileMaker Server hosting or certificate setup is **inferred**; this guide makes no such compatibility claim. <!-- known-difference: Server operation ;; Equivalence of the TLS flags and defaults with FileMaker Server hosting and certificate setup is inferred ;; A TLS setting may behave differently from FileMaker Server's ;; A FileMaker Server run of the same certificate setup -->
