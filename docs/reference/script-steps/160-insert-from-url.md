---
id: script-step-160
title: "Insert from URL"
area: script-steps
since: unknown
status: partly
verified: f200448e0
---

# Insert from URL

Insert from URL is a other steps script step. This page describes how the offline Tabularius engine handles it.

- **Support:** partly
- **Registry ID:** 160

## What the engine does

The engine handles this step with the limits described in the support notes.
Off until the file's Script network switch is on (see the administrator settings). HTTP and HTTPS only. Binary responses are kept as container data (in a container field, or a variable when the response isn't text) and text is decoded by its charset; responses over 64 MB fail with error 1631; cURL options handled: -X, -H, -d/--data(-raw/-binary/-ascii), --data-urlencode, -G, -F/--form (a container variable as `name=@$var`), -I, -D, -f, -u, --oauth2-bearer, -A, -e, -b (cookie text), -m/--max-time, --no-compressed (asks for the body as it is), --connect-timeout (gives up if the server hasn't begun to answer in that time; fetch can't tell connecting from waiting for the first byte, so it is the time until the response's headers arrive), --max-filesize (a response over it fails with error 1631, by its stated length or as it arrives; the 64 MB limit still applies), --FM-return-container-variable (into a variable, a text response is stored as a container), `--aws-sigv4 provider1:provider2:region:service` with `-u id:secret` (signs a request with `--data` or no body, not a form upload; refused with a connection, which adds its own credentials); sign-in: `-u user:password` (Basic, sent with the first request, as `--basic` also says), `--digest` and `--anyauth` (the first request carries no credentials; on a 401 the Digest challenge of RFC 7616 is answered once with MD5, MD5-sess, SHA-256 or SHA-256-sess and qop auth, checked against the RFC's worked examples; `--anyauth` takes Basic when that is all the server offers; a challenge it cannot answer, such as qop auth-int only, leaves the 401 as the result); options that name files on disk (-T, -o, -F name=@file, a cookie file) and other flags are ignored; `--data-binary @$var` with a container in the variable sends the file as it is, with its own content type. An address like `connection://name/path` goes through a connection set up in the admin console (S3-compatible storage: GET, HEAD, PUT and DELETE on objects inside the connection's folder, `connection://name/?prefix=` to list it; a REST connection: any path under its base address, read-only unless it was given write access), which adds its credentials; the script never has them, and a capture-only file's scripts never get one.

FileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.

## Options

Choose a URL calculation, a field or variable target, and optional cURL options. Network access is required.

## Privileges

Permission to run the script; access to any named record, field, layout or file is checked at use.

## Error codes

Known codes from the engine and the [script error-code reference](../../error-codes.md): `0`, `3`, `1626`, `1630`, `1631`. Other failures can arise from calculations or targets used by the step.

## Offline script example

Use a synthetic local solution with an empty `Examples` table and a text field named `Name`. The example uses no mail, network or plug-ins.

```script
Set Variable [ $state ; Value: "offline" ]
Exit Script [ Text Result: $state ]
```

**Expected end state:** The script result is `offline`; no external action is attempted. The named step needs the capability described above.
