# Web client troubleshooting

This guide covers the Tabularius browser client at `/app/` and related screens. Start with the check for the message or symptom you see. Commands and click paths below are covered by the named repository test where possible; checks that depend on your browser, network, or server configuration are marked **Not verified automatically**.

## The page is blank or stays on “Loading…”

**Symptom:** `/app/`, Design, or another client page stays blank or on “Loading…”, or reports “This page did not start.”

**Cause:** JavaScript is disabled, a module or other required file failed to load, or startup threw an error. A browser extension, proxy, or incomplete deployment can block a module.

**Check:** Enable JavaScript and reload. If the page shows “This page did not start”, use its **Reload** link. In browser developer tools, check the Console and Network panels for a failed `src/` module request. The shell's no-script and failed-script messages are exercised by `packages/web/test/boot-guard.test.ts`.

**Fix:** Enable JavaScript for this site and reload. If a module request failed, confirm the server is running and that the deployed web files come from the same Tabularius build; ask the server operator to check proxy rules and server logs. **Not verified automatically:** browser-extension and proxy causes depend on the installation.

## Sign-in stays on the sign-in screen

**Symptom:** Pressing **Open** returns an error, or the client returns to sign-in instead of opening the file.

**Cause:** The account, password, or second factor may be wrong; the account may be locked; the server may be unreachable; or the session may have expired. The client intentionally gives the same response for an unknown file and a wrong password.

**Check:** Read the text below the sign-in form. For “The account name or password is wrong,” check the selected file and account with its administrator. For a lockout, wait until the displayed time or ask an administrator to unlock the account. For a connection error, open the server address in a new tab. `packages/web/test/sign-in-error.test.ts` covers the wrong-password and lockout wording; `packages/web/e2e/sign-in.e2e.ts` exercises the sign-in screen.

**Fix:** Correct the file, account, password, or authenticator code; wait for a lockout to expire or ask the administrator to unlock it; sign in again after a session ends. If the server address cannot be reached, ask the operator to check that the server is running and reachable from your network. **Not verified automatically:** network routing and account state on a particular server.

## The client looks like an old version after an update

**Symptom:** The server has been updated, but the browser still shows old behavior, or an action reports “The server has nothing at that address.”

**Cause:** The browser may still have an old page or cached client asset, or the server and web files may be from different builds.

**Check:** Reload the page. If it persists, open `/app/` in a private window. If the private window works, clear this site's cached files and reload. Check **Help > About** for the server version. The 404 recovery wording is covered by `packages/web/test/http-problem.test.ts`.

**Fix:** Reload `/app/`; if needed, clear cached files for this server's address and reload. If the mismatch remains in a private window, ask the operator to deploy a matching server and web client build. **Not verified automatically:** browser cache behavior differs by browser; this guide does not prescribe browser-specific cache menus.

## The offline banner appears

**Symptom:** A banner says “You're offline”, “Working from this browser's copy”, or “Reconnecting to the server”.

**Cause:** The browser is offline, requests cannot reach the server, or the live-update connection is reconnecting. Changes queued in an offline copy wait until the connection returns; an offline copy is local to this browser.

**Check:** Restore your network connection and wait for the banner to change. If it remains, open the server address in another tab. To see whether changes are queued, read the banner before signing out or removing an offline copy. `packages/web/test/offline.test.ts` covers offline reads, queued changes, and reconnection; `packages/web/e2e/offline.e2e.ts` exercises the browser banner and offline workflow.

**Fix:** Reconnect to the network and leave the client open until queued changes are saved. Use **Save Now** when it appears. If working from a browser copy, choose **Sign In** after the server is reachable. Do not remove the offline copy while it contains changes you still need.

## An import fails or its preview will not load

**Symptom:** Import Records reports an error, stays on “Importing…”, or cannot build its preview.

**Cause:** The server rejected the request, the connection was interrupted, the file is too large, or the selected format/content could not be read. Import is separate from attaching a file to a container field.

**Check:** Read the error shown at the bottom of the Import Records dialog. Confirm the file is CSV, Excel, or a supported Markdown export, and that it is within the 50 MB per-import limit. Retry once after checking the connection. `packages/web/test/import-size.test.ts`, `packages/web/test/import-tables-model.test.ts`, and `packages/web/e2e/import-records.e2e.ts` cover import limits, planning, and the browser import flow.

**Fix:** Choose a supported file under the limit, reduce or split a larger file, and retry. If the preview still fails, ask the server operator to check the server log and include the exact error text. **Not verified automatically:** file corruption and proxy request-size limits vary by deployment.

## A container file will not upload

**Symptom:** An image or document in a container field shows “Couldn't upload …”, or the upload progress stops.

**Cause:** The connection may have dropped, the server may have rejected the file, or the account may not be allowed to modify that field. Large files upload in pieces and can resume temporary connection failures.

**Check:** Confirm the record is editable and try a small file. For a stopped upload, keep the page open and retry; read the message in the upload notification. `packages/web/test/request-retry.test.ts` covers retry classification; `packages/web/e2e/containers.e2e.ts` and `packages/web/e2e/portal-container.e2e.ts` exercise container uploads in the browser.

**Fix:** Restore the connection, confirm the account can edit the field, then retry the upload. If it fails again, give the operator the error text and approximate file size. **Not verified automatically:** a particular proxy's upload limit and permissions in a hosted solution.

## A keyboard shortcut does nothing

**Symptom:** A shortcut shown in a menu does not run its command.

**Cause:** The browser or operating system may reserve the key, focus may be in a text field, or the current mode or account may not offer that command. In a browser tab, some browser-reserved shortcuts are displayed with Alt added.

**Check:** Open **Help > Keyboard Shortcuts** to see the keys for this window. Try the matching menu command; if it works, the browser or operating system intercepted the key. `packages/web/test/browser-tab-shortcuts.test.ts` covers the advertised browser-reserved keys and `packages/web/e2e/shortcuts.e2e.ts` exercises shortcuts in Chromium.

**Fix:** Use the menu command, focus the client rather than a text field, or use the displayed Alt variant in a browser tab. Some operating-system shortcuts cannot be captured by a web page. **Not verified automatically:** operating-system and browser-specific key reservations beyond the tested Chromium path.

## Preview or printing is blank, incomplete, or laid out incorrectly

**Symptom:** Preview has missing pages or records, or the browser print dialog produces an unexpected page size, orientation, or result.

**Cause:** Preview displays the found set up to the client limit; the layout's page setup, margins, parts, or object visibility rules affect printed pages. Browser and printer settings also affect the final output.

**Check:** In Browse mode, confirm the found set and then choose **Preview**. Check the layout's page setup and printing options in Design. `packages/web/test/preview.test.ts`, `packages/web/e2e/preview-columns.e2e.ts`, and `packages/web/e2e/preview-slide-page-number.e2e.ts` cover pagination and browser preview behavior.

**Fix:** Correct the found set or layout's page setup, then enter Preview again. In the print dialog, check the selected printer, paper, scale, and margins. If the found set exceeds the preview limit, use the offered **Save Records as PDF** route for the complete set. **Not verified automatically:** printer-driver output and browser-specific print dialogs.

## A passkey prompt is cancelled, missing, or does not sign in

**Symptom:** A passkey prompt is cancelled, no passkey is offered, or the browser returns to sign-in.

**Cause:** The prompt may have been dismissed, the selected authenticator may not hold a registered passkey, or this browser/context may not support WebAuthn for the current address. Passkey sign-in also requires the server-side account to have a passkey registered.

**Check:** Use the account name before choosing its passkey. If the prompt was dismissed, choose **Sign in with a passkey** again; for a file account, use its password and authenticator code if available. The passkey code paths are covered by `packages/server/test/passkey-signin.test.ts` and `packages/server/test/admin-passkey.test.ts` and `packages/web/e2e/sign-in.e2e.ts` exercises the sign-in screen.

**Fix:** Retry with the authenticator that holds the registered passkey, or use another enabled sign-in method. For the admin console, an administrator can check **Security health > Console passkeys** after signing in with the console password. **Not verified automatically:** the operating system's authenticator picker, physical key, and browser account configuration.
