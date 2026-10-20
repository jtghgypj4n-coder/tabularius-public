# Move a FileMaker file in

You have a FileMaker file and want to see it running on Tabularius without losing anything. This tutorial takes
`Invoices.fmp12` (use your own file under that name, or change the name in each command) from "just a file" to
"hosted, checked and answering the Data API". It changes nothing in your `.fmp12`: Tabularius converts a copy into its
own store next to it. It needs Node 22.20 or later and `curl`.

Every command in the blocks marked `sh run` below is run by `packages/cli/test/tutorial-move-in.test.ts` against a
sample file in a throwaway folder (the test is skipped when no sample files are installed), so if a step stops
working the test fails and this page is fixed with it.

From the repository, `tabularius` is `npm run tabularius --`; installed, it is just `tabularius`.

## 1. Look at the file first

These commands read the `.fmp12` directly, change nothing and need no server. Run them in the folder that holds it.

```sh run
tabularius info Invoices.fmp12
tabularius schema Invoices.fmp12 > schema.txt
head -n 12 schema.txt
```

`info` gives the file's header (which FileMaker version saved it, whether it is encrypted, how many objects it
has). `schema` lists the tables, fields, layouts and scripts, so you can compare it with what you expect. A file
saved with Encryption at Rest asks for its passphrase in the terminal.

## 2. Put it in a folder Tabularius hosts

Tabularius hosts a folder. Each `.fmp12` in it is converted once into `<name>.openhbam.sqlite` beside it; the
`.fmp12` stays as it was, and from here on everything people change is in the store.

```sh run
mkdir -p ~/Databases
cp Invoices.fmp12 ~/Databases/
```

## 3. Find out what won't work yet

Before anyone signs in, ask what in the file Tabularius does not handle yet. The first command converts the file if
it has not been converted.

```sh run
tabularius report ~/Databases Invoices
```

The report lists script steps, functions, plug-ins, other files and accounts that need your attention, and what
came over fine. Two more checks help a solution with a lot of logic. Both read the converted file and undo
anything they try:

```sh run
tabularius test-scripts ~/Databases Invoices
tabularius fidelity ~/Databases Invoices
```

`test-scripts` runs every script offline on its own and lists the ones that error, stall or crash. A script that
ends with an error here is not necessarily broken: many need a window, a found set or a parameter that a script
run on its own does not have. `fidelity` recalculates every stored calculation and compares it with the value
FileMaker stored, printing counts only, never values.

## 4. Give the accounts passwords

Accounts come over with their privilege sets. An account with an empty password can sign in from the server's own
computer only, so set one for the account you will use:

```sh run
echo 'a long enough password' | tabularius passwd ~/Databases Invoices Admin
```

## 5. Host it

<!-- docs-example: illustrative -->
```sh
tabularius serve ~/Databases --port 8080
```

Leave that running. Files you copy into the folder later appear within a few seconds.

## 6. Check it from outside

The Data API is FileMaker's, at `/fmi/data/vLatest`. Sign in and list the layouts:

```sh run
BASE=http://127.0.0.1:8080/fmi/data/vLatest/databases
TOKEN=$(curl -s -X POST -u 'Admin:a long enough password' -H 'Content-Type: application/json' -d '{}' "$BASE/Invoices/sessions" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "got a token of ${#TOKEN} characters"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/Invoices/layouts" | head -c 300
echo
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/Invoices/sessions/$TOKEN" > /dev/null
```

Open `http://127.0.0.1:8080/app/` in a browser, enter the file name and sign in with that account to use it in the
web client; `http://127.0.0.1:8080/admin/` is the admin console.

## Where next

- [Moving a solution to Tabularius](../moving-a-solution.md) goes through everything this skipped: carrying over
  accounts and privilege sets, container files, plug-ins, coming from FileMaker Server (`migrate-fms`), keeping the
  server running as a service and what behaves differently.
- Use HTTPS (see [ADMIN.md](../../ADMIN.md)) before anything but your own computer calls the server: passwords and
  tokens travel in every request.
