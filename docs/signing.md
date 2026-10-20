# Signing the release programs

Without signing, macOS says the program "can't be checked for malicious software" and Windows SmartScreen warns
before running it. `node scripts/sign-release.ts dist/tabularius-*` does the signing when the secrets below are in its
environment, and does nothing, saying so, when they aren't. Nothing is bought or set up today.

To switch it on, add this step to `.github/workflows/release.yml` between "Build" and "Check it" (a change that needs
a token with the `workflow` scope, so it is made by hand), and set the secrets below as repository secrets:

```yaml
      - name: Sign it
        shell: bash
        env:
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_CERTIFICATE_P12_BASE64: ${{ secrets.APPLE_CERTIFICATE_P12_BASE64 }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_APP_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
          WINDOWS_CERT_PFX_BASE64: ${{ secrets.WINDOWS_CERT_PFX_BASE64 }}
          WINDOWS_CERT_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
        run: node scripts/sign-release.ts dist/tabularius-*
```

## macOS: signing and notarizing

What to buy: an **Apple Developer Program** membership (US$99 a year). In it, create a **Developer ID Application**
certificate (Certificates, Identifiers & Profiles), export it with its private key from Keychain Access as a `.p12`
file with a password, and make an **app-specific password** for the Apple ID at appleid.apple.com.

| Secret | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | The certificate's name, like `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_CERTIFICATE_P12_BASE64` | The `.p12` file, as base64 (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` file's password |
| `APPLE_ID` | The Apple ID's email address |
| `APPLE_TEAM_ID` | The ten-character team id |
| `APPLE_APP_PASSWORD` | The app-specific password |

The first three alone sign the program (hardened runtime, with the entitlements in `packaging/entitlements.plist`
that Node needs to run JavaScript). With the last three too it is notarized, which is what stops the Gatekeeper
warning. Setting only some of the last three stops the build.

## Windows: Authenticode

What to buy: a **code-signing certificate** from a certificate authority (about US$200 to US$500 a year). Since 2023
the private key must live on a hardware token or in a cloud signing service for certificates that earn SmartScreen
reputation immediately (an EV certificate does); a plain `.pfx` file, as this step uses, is for certificates the
authority lets you export. If yours is token or cloud based, say so and this step gets a signing-service variant.

| Secret | Value |
| --- | --- |
| `WINDOWS_CERT_PFX_BASE64` | The `.pfx` file, as base64 |
| `WINDOWS_CERT_PASSWORD` | Its password |
| `WINDOWS_TIMESTAMP_URL` | Optional; defaults to `http://timestamp.digicert.com` |

Both secrets are needed together. `signtool` must be on the runner's PATH (it ships with the Windows SDK).

## Notes

- A signing step that fails fails the build: a release meant to be signed never goes out unsigned.
- The certificates are written to a temporary folder for the length of the step and removed after it.
- This has been tested only with the certificates absent and with the steps it would run (`scripts/sign-release.ts`'s
  tests); the first real signing needs a look at the log. If the signed macOS program won't start, the hardened
  runtime's entitlements are the first thing to check.
- Linux programs aren't signed. The package files from `scripts/packaging.ts` carry SHA-256 checksums instead.
