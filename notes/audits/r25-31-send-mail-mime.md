# Send Mail MIME audit (r25-31)

<!-- known-difference-file: Send Mail ;; Claris documents Send Mail as plain text with no HTML body, inline image, custom header or transfer-encoding option; the extra MIME handling here is available only to internal callers, custom headers are refused, and the transport always chooses base64, so the exact bytes FileMaker sends are unverified ;; A message sent from a script can differ in headers, encoding and attachment typing from what FileMaker would send ;; A FileMaker Send Mail run captured at an SMTP server -->

## Scope and evidence

This audit covers the server's Send Mail via SMTP path and its test-mode Outbox behavior. Tests use generated messages and attachments; no real message is sent. Captured test messages are checked by a strict test-only MIME parser. The test report contains aggregate counts only.

Claris documents the script step as sending through an e-mail application, SMTP, or OAuth 2.0. The Send Mail reference describes the body as “plain text”, recipient lists separated by semicolons or returns, and server-side attachments in accessible folders. See [Claris FileMaker Pro Help: Send Mail](https://help.claris.com/en/pro-help/content/send-mail.html) and [Claris: Sending email messages](https://help.claris.com/en/pro-help/content/sending-email-message.html). The FileMaker step has no documented HTML body, inline-image, arbitrary-header, or transfer-encoding option; those are **unverified** as Claris Send Mail behavior.

## Matrix

| Area | Implemented and checked here | Claris documentation status |
| --- | --- | --- |
| To, Cc, Bcc | Semicolon, comma, and return-delimited lists; quoted display names; Unicode display names; address literals; IDN domains; Bcc stays in the SMTP envelope. | Recipient fields and semicolon/return lists are documented. Quoted display names, address literals, Unicode mailbox handling, and IDN behavior are **unverified**. |
| Subject and headers | RFC 2047 encoded words for Unicode; whitespace folding; auto Date, Message-ID, MIME-Version; Reply-To from the script's From address; CR/LF/NUL refused in caller-controlled header values. | Send Mail fields are documented. Encoded-word details, custom headers, folding rules, and generated header values are **unverified** in Claris behavior. |
| Body | Plain UTF-8 text, base64 transfer encoding; optional internal HTML and multipart/alternative serialization. | Plain text is documented. HTML and multipart/alternative from FileMaker Send Mail are **unverified**; the native step does not expose an HTML body parameter. |
| Attachments | Multiple files, generated document-folder files, extension-based media types, base64, Unicode/quoted names with RFC 2231 `filename*` continuations, optional inline CID parts, up to 100 files, and a 25 MiB content-plus-metadata cap. | Attach Files and server-accessible paths are documented. Direct container extraction, MIME inference, RFC 2231 filenames, inline images, the caps, and encoding are **unverified** Claris behavior. |
| SMTP | Operator-configured SMTP account only; PLAIN authentication; implicit TLS (`smtps:`); STARTTLS when advertised; external plaintext SMTP is refused; loopback permits local test SMTP. Timeouts and 4xx/5xx/disconnects fail the step. | Claris documents SMTP settings and SSL certificate verification. Exact authentication mechanisms, STARTTLS/implicit-TLS selection, timeout values, and reply handling are **unverified** Claris behavior. |
| Transfer encodings | Generated content uses base64 with 76-character lines; the validator recognizes 7bit, 8bit, quoted-printable, and base64. | The FileMaker Send Mail page does not specify transfer encodings; per-encoding Claris behavior is **unverified**. |
| Error codes and test mode | SMTP failures and invalid/missing/over-limit content map to error 1506; unavailable sending remains error 3. Test mode captures messages in the Outbox and does not invoke SMTP. | Claris documents failure stopping subsequent messages in a multiple-record send. Tabularius error codes and Outbox behavior are product behavior, not Claris behavior. |

The validator and serializer follow the relevant message syntax and transfer-encoding rules in [RFC 5322](https://www.rfc-editor.org/rfc/rfc5322), [RFC 2045](https://www.rfc-editor.org/rfc/rfc2045), [RFC 2046](https://www.rfc-editor.org/rfc/rfc2046), [RFC 2047](https://www.rfc-editor.org/rfc/rfc2047), [RFC 2183](https://www.rfc-editor.org/rfc/rfc2183), [RFC 2231](https://www.rfc-editor.org/rfc/rfc2231), [RFC 2392](https://www.rfc-editor.org/rfc/rfc2392), [RFC 6531](https://www.rfc-editor.org/rfc/rfc6531), [RFC 6532](https://www.rfc-editor.org/rfc/rfc6532), and [RFC 3461](https://www.rfc-editor.org/rfc/rfc3461). Inline Content-ID values use message-id syntax. SMTPUTF8 is required for non-ASCII local parts; the client refuses them when the server does not advertise SMTPUTF8. The SMTP DSN extension in RFC 3461 is not requested or emitted.

## Limits and known gaps

- Native FileMaker Send Mail remains plain text. Optional HTML and inline MIME support is only available to internal callers that explicitly provide it; there is no inferred HTML conversion.
- Caller-supplied custom headers are not accepted. Date, Message-ID, and MIME-Version are generated by the transport.
- Text and attachment contents are base64 encoded. The strict test validator accepts and checks 8bit, quoted-printable, and base64 forms, but the transport currently selects base64 only.
- SMTP SASL support is PLAIN only. SMTPUTF8 is negotiated for Unicode local parts; the domain is converted to IDNA ASCII.
- The existing configured recipient count and hourly message limits remain in force. A message with more than 25 MiB of decoded text and attachment content is rejected before an SMTP connection is made.

## Second-model review

An independent review found no header or SMTP command injection and no STARTTLS downgrade or credential leak. Recipient headers and the SMTP envelope come from the same parse, Bcc never reaches a header, and bodies and attachments are base64 so a lone `.` line cannot reach the wire. It reproduced two defects, fixed here with tests: a plain attachment name of 33 to 60 characters was cut to 32 characters and lost its extension (names now keep their full text, with `"` and `\` escaped, and a long name's fallback keeps its extension), and a STARTTLS handshake that stalled ignored the idle timeout until the 180 s conversation limit.

Behaviour and limits it surfaced, not changed:

- A From field that is not a single plain address now fails the step with error 1506, where an unusable Reply-To used to be dropped silently. For example `From: Doe, John <j@example.test>` without quotes is split at the comma.
- Attachments are read into memory before the 25 MiB and 100-file caps are applied, as before this change, so the caps are not a memory limit; a message near the cap uses roughly 150 MiB extra while it is built.
- A literal encoded word typed into an ASCII subject or display name is passed through, so a mail client may decode it; this is display only. A display name that looks like an address can mislead a reader about who sent the message.
- Folding collapses runs of whitespace in subjects and plain attachment names.
- The plug-in Send Mail path still strips display names.
