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

## Putting it in the release workflow

Workflow files need a token with the `workflow` scope, so the steps are proposed rather than pushed: a job that runs
`npm run release:verify-repro` before the matrix builds, and a "Checksums" step after "Sign it". See
`notes/proposed/release-reproducible.yml` in the project files.
