# Changelog

What changed in each version of Tabularius, newest first. Each area lists its newest changes; work on reading FileMaker files is counted, not listed.

## 0.1.0

### Web client

- Web client: an alternative, data-first client at /next/ (#2)
- Web client: the address bar follows the layout, mode, view and record, and Back and Forward restore them (#11)
- Web client: screen readers hear record position, found counts, sorts, saves and mode changes (#13)
- Web client: a startup bundle budget, and the chart and dashboard view load only when drawn (#30)
- Web client: modules are kept by the browser, keyed by content hash (#181)

### Calculations and scripts

- Scripts: stop writing "?" after a failed calculation; digest auth and script-test fixes (#38)
- Calc: trimming and number checks in the MBS functions run in linear time (#184)
- Calc: JSON functions refuse work and memory a small formula could ask for (#185)
- Scripts: linear-time report masking, bounded PDF cross-references, recorder snapshot budget (#198)

### Build and tests

- Tests: neutral sample account name (#48)
- Tests: build token-shaped sample keys from parts at runtime (#49)
- CI: run macOS on pull requests that touch what fails there; one run per push to main (#116)
- CI: macOS only on main, nightly, by hand or with the macos label (#183)
- CI: gates job, four test shards, and one required check that reports them (#187)

### Other

- README opening names the MIT licence (#1)
- Treat backups as hostile input: signed manifests and checked point-in-time restores (#3)
- Overload: a bounded request gate, a busy screen, and capacity numbers (#4)
- Privileges: automation conditions run as their account; correct privilege-set names (#5)
- Heap gate: collect before refusing a request for memory (#7)
- Add a browser-support self-check page and a no-script message (#8)
- Harden the fmp12 reader against corrupt blocks, varints and deep layouts (#9)
- Observability robustness: debugger runs end cleanly, WAL checkpoints are handed back, logs and sync console checks are bounded (#10)
- CLI folder claim for encrypt/decrypt, stricter option values, mail attachment permission and private secret errors (#12)
- FileMaker file reader: refuse cut-off formulas and text, infer date order from evidence, compare conversion sources by content (#14)
- Roll back a failed bulk plug-in state change and replay suspended steps once (#15)
- Script transactions: cover every window, honour the Open Transaction options at commit, stop cleanly when a paused debugger run is canceled (#16)
- …and 159 more

185 merged pull requests.
