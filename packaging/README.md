# Package manager files

`node scripts/packaging.ts --version 1.2.3 --repo owner/name --dist dist` writes a Homebrew formula, winget
manifests and a Scoop manifest to `packaging/generated/`, from the programs `scripts/build-release.ts` wrote to `dist/`
(their names carry the version, system and processor; the checksums are taken from the files). Run it once per release,
after the release's programs are uploaded to the GitHub release `v1.2.3`.

Publishing is manual:

- **Homebrew:** copy `homebrew/tabularius.rb` into a tap (`homebrew-tabularius/Formula/`). People then run `brew install owner/tabularius/tabularius`.
- **winget:** copy `winget/*` into `manifests/o/tabularius/tabularius/1.2.3/` in a fork of `microsoft/winget-pkgs` and open a pull request.
- **Scoop:** put `scoop/tabularius.json` in a bucket's `bucket/` folder. `checkver` and `autoupdate` keep it current.

A system the release has no program for (Intel Macs, Windows on Arm today) is left out of the files.
