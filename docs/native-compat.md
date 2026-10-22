# Native compatibility check and one-way upgrade

`tabularius compat-check <folder> <name>` reads a hosted `.openhbam.sqlite` file and lists each native feature that has no confirmed path to a compat file. It prints the table and field for field findings, with `(file)::(file)` for a file-wide finding. It exits 0 when the list is empty and 1 when there are findings. It does not change the file. A compat file has no findings. A native file reports its file mode and ISO-only date order, then any boolean, integer, decimal, JSON, UUID, ISO date or timestamp fields and JavaScript custom functions. JSON fields are the currently supported array/JSON storage; there is no separate native array field type yet.

```sh
tabularius compat-check hosted MyDatabase
```

The list comes from the registry in `packages/store/src/native-compat.ts`. UUID record IDs and foreign keys are being developed separately and will need entries when their storage lands. SQL expression export behavior is unverified; no SQL-specific feature is identified by the current schema, so the check cannot yet confirm whether such an expression would survive. Export from a native file to `.fmp12` is outside this feature's scope. A clean check does not perform or promise that export. <!-- known-difference: SQL and calculations ;; Whether a native file's SQL expressions survive an export to .fmp12 is unverified, and UUID record IDs and foreign keys are not yet in the compatibility check ;; The check cannot confirm SQL expressions or UUID keys survive ;; A native file with those features and a FileMaker run of the export -->

`tabularius upgrade-file <folder> <name> --to native` previews a compat-to-native conversion. Add `--apply` to take a verified backup of the hosted folder first and then make the one-way change. Old backup sets are kept. Stop the server before applying so its already-open connections cannot keep using compat behavior. A second run reports that the file is already native.

```sh
tabularius upgrade-file hosted MyDatabase --to native
tabularius upgrade-file hosted MyDatabase --to native --apply
```

The upgrade refuses a file with repeating or global fields, naming each table and field. Move those values into records or a settings table first. It checks stored date and timestamp values, converts valid ones to ISO text in the same transaction as the mode change, and refuses values it cannot convert. The preview and error output report counts and field names, never record values. The upgrade cannot be reversed in place; restore the backup if the previous compat file is needed.
