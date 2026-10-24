# Release builds: reproducing them, the bill of materials and checksums

A release program (`node scripts/build-release.ts`) is one file: a copy of Node.js with Tabularius's files packed
inside it. This page says how to check that a release is what its source makes, what is in it, and that a stored
copy has not changed.

## Rebuilding gives the same bytes

`npm run release:verify-repro` clones the repository twice into folders with different names, checks out one
commit in each, and builds in each under different conditions: another time zone, another language setting
(`tr_TR.UTF-8`, where case and sorting rules differ) and another umask (`022` against `077`). It then compares every
file the two builds wrote and fails on a single differing byte, naming the files inside the pack that differ.

```sh
npm run release:verify-repro                    # the pack, licence notices and bill of materials
npm run release:verify-repro -- --full          # the whole program too (a copy of Node: 200 MB, needs the network)
npm run release:verify-repro -- --commit v0.2.0 # a commit other than HEAD
```

Only committed files are built. The check needs the network for `npm ci`. Both builds run on one machine, so it cannot
see what differs between machines. For someone else to get the same bytes they need the same Node.js (the program
embeds the Node it was built with, and the notices carry the licence file that came with that Node, which differs
between the official download and a distribution's package), the same npm major version, and the same commit.
`.gitattributes` turns line-ending conversion off, so a Windows checkout packs the same bytes as a Linux one.

What the check found and the build now does about it:

- A file's mode in the pack followed the builder's umask (`644` against `600`), so the same commit packed
  differently. A mode is now only runnable (`755`) or not (`644`): the launcher looks at nothing else.
- The Node single-executable blob recorded the path of its main script, which was a random temporary folder. The blob
  is now made from relative paths inside that folder, so it is the same wherever the build runs.
- The licence notices sorted package names with the builder's locale. They sort by plain character order now.
- npm's own bookkeeping at the top of `node_modules` (`.package-lock.json`, `.bin`) was packed, and changes with the
  npm version. It is left out; nothing runs it.
- A package with no name in its `package.json` was named in the notices and the bill of materials by the temporary
  build folder. It is named by its place under `node_modules` now.
- A link committed by mistake (`packages/node_modules`, pointing into one person's computer) made the build stop in
  any other checkout. It is removed, `.gitignore` now ignores a `node_modules` link as well as the folder, and the
  build leaves out any tracked link.

The tool that puts the program's files into the Node executable (postject) and its one dependency are installed
with `npm ci` from `scripts/release/postject/package-lock.json`, so each download is checked against a hash in the
repository instead of being whatever the registry serves for a version number. Changing the version means
regenerating that lockfile and reading the diff.

Nothing the build writes may hold a date, a path or a random name. The bill of materials has no timestamp and no
serial number for that reason.

## What is inside: the bill of materials

Each build writes `tabularius-<version>-<os>-<cpu>.sbom.cdx.json`, a [CycloneDX](https://cyclonedx.org) 1.5 file, beside
the program. It lists, with name, version, package URL, licence and (for npm packages) the SHA-512 of the tarball
from `package-lock.json`:

- every npm package that ships inside the program, read from the same `node_modules` the licence notices are,
  so the two lists cannot differ;
- the Node.js runtime the program embeds;
- the projects some source files were written from (`scripts/bundled-sources.ts`), which `NOTICE` credits too.

`npm run release:sbom -- <folder holding node_modules> <out.json>` writes one for any install.

Tests keep this honest (`packages/cli/test/release-notices.test.ts`): every production package in the lock file must
have a licence notice or a declared licence, and a source file that names another project's repository, says it was
ported, or credits a Creative Commons licence must be listed in `scripts/bundled-sources.ts` and credited in `NOTICE`.

## A stored copy has not changed: checksums

After signing, `node scripts/verify-release.ts write dist/tabularius-<version>-<os>-<cpu>` writes
`tabularius-<version>-<os>-<cpu>.sha256` with the SHA-256 of the program, its bill of materials and the licence notices
(the format `sha256sum -c` reads). `node scripts/verify-release.ts verify <that file>` checks them and fails when a
listed file is changed, shortened, missing, replaced by a link, or when the file does not list exactly the program,
its bill of materials and the notices (a list cut down to the program alone does not pass). Names must be plain file
names. The notices file has the same name on every system, so keep each system's files in a folder of their own.

Checksums say the files are the ones the build wrote; the operating system's signature on the program
([signing](signing.md)) says who built them. Someone who can replace the program can replace a checksum file stored
beside it, so publish the checksum file somewhere the program is not. On macOS, signing now also runs
`codesign --verify --strict` on the signed program and stops the build if it fails, as Windows already did with
`signtool verify`.

## Making a release

`.github/workflows/release.yml` builds the program on five GitHub-hosted systems (Linux x64 and arm64, macOS arm64
and Intel, Windows), checks each on the machine it was built on, and then puts a GitHub release together.

- **A tag** like `v0.1.0` builds that version. If the tagged commit is on `main` and `ci` passed on it (or on an
  earlier commit that differs only in files `ci` skips, such as Markdown), the `publish` job makes a **draft**
  release. Nothing is public until a person reads the draft and clicks Publish. The notes are
  `.github/release-notes/v0.1.0.md`; a release whose version has no `-` in it is not made without that file.
- **A manual run** from the Actions tab only builds. Give it a version such as `0.1.0-rc.1` and set `publish` to
  `draft` or `prerelease` to also make a release. That works only from `main`, after the same CI check as for a tag, for a
  pre-release (the version contains a `-`), and for a tag that does not exist yet.
- **Required and optional systems.** The four macOS and Linux programs are required: if one fails its build or its
  check, no release is made. The Windows program is attached when it builds and passes its check, and left out
  when it does not (the release's file list says which).

`node scripts/release-assemble.ts <artifacts> <out> --version 0.1.0 --require linux-x64,...` does the putting
together: it re-checks each program against the checksum file its build wrote (the files have been uploaded and
downloaded since), copies the programs, their bills of materials, the licence notices and `get.sh` into one folder,
and writes one `SHA256SUMS` over all of it. `sha256sum -c SHA256SUMS --ignore-missing` checks any files you
downloaded from the release. The per-system `.sha256` files stay in the workflow's artifacts; the release has the
one list.

## The one-line install

`scripts/get.sh` is attached to every release, so

```sh
curl -fsSL https://github.com/sitotisai/tabularius/releases/latest/download/get.sh | sh
```

always runs the installer that came with the newest published release (pre-releases and drafts are not "latest").
It works out the system (macOS or Linux, arm64 or x64; an Intel shell on an Apple silicon Mac gets the arm64 program;
musl Linux such as Alpine is refused, since the program needs glibc), finds the newest version from the redirect of
`/releases/latest` (so GitHub's API limits don't apply; this needs curl, and without it `--version` names the version), downloads the program and `SHA256SUMS`, and installs nothing
unless the program's SHA-256 matches its line in the list. It copies the program beside its destination and renames it
into `~/.local/bin/tabularius`, so a failure leaves the old program, then runs `tabularius --version` to show it works.
`--version 0.1.0` (or `TABULARIUS_VERSION`) picks a version, `--bin-dir` (or `TABULARIUS_BIN`) another folder, and
`TABULARIUS_RELEASES` another releases page, which is how the tests (`packages/cli/test/get-script.test.ts`) point it at
a stand-in. From an https page it refuses a redirect to plain http. The list comes from the same page as the program, so this catches a damaged or cut-off download, not a
release replaced by someone who controls the page; the platform signatures ([signing](signing.md)) are the answer to
who made it.

## Cutting a release

1. `main` is green, and everything the launch needs has merged.
2. Write `.github/release-notes/v<version>.md`.
3. On a machine with network access and Docker Buildx, collect the current base image digests and save them in `image-digests.json`. For each image reference reported by `node scripts/pin-images.ts check`, run `docker buildx imagetools inspect <image> --format '{{json .Manifest.Digest}}'`; use the returned `sha256:...` value (without JSON quotes) as that image's value in the JSON object. For the current references, the commands are:

   ```sh
   docker buildx imagetools inspect node:22-slim --format '{{json .Manifest.Digest}}'
   docker buildx imagetools inspect caddy:2 --format '{{json .Manifest.Digest}}'
   ```

   Add every `sha256:...` result to `image-digests.json`, keyed by its exact image reference, then run:

   ```sh
   node scripts/pin-images.ts write image-digests.json
   node scripts/pin-images.ts check --require-pinned
   ```

   Do this before making the release tag. The check is deliberately not part of the normal gates, so development can keep readable tags while release builds require pinned digests. The release workflow itself does not run this check; its description here is the release instruction.
4. Run the workflow by hand with `version` `<version>-rc.1` and `publish` `prerelease`, then
   `curl -fsSL https://github.com/sitotisai/tabularius/releases/download/v<version>-rc.1/get.sh | sh -s -- --version <version>-rc.1`
   on a clean machine, and `tabularius demo`. Delete the pre-release and its tag when done.
5. Tag the commit: `git tag v<version> && git push origin v<version>`. Read the draft release, then publish it.

## Windows readiness

Windows execution is unverified. See the [Windows readiness audit](audits/audit-windows.md) for the offline findings, simulated tests, installer trust boundary, and the native install/service/upgrade/backup checklist required before claiming Windows support. The PowerShell source installer requires trusted local source and verifies any Node download before extraction. <!-- known-difference: Windows hosting ;; Windows execution is unverified ;; A Windows build or install can fail where the offline tests pass ;; Follow the Windows readiness checklist on a real Windows machine -->
