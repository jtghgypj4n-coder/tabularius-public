# Back up a file and restore it

A backup matters when you can put it back. This tutorial makes a small contacts file from nothing, adds two
records, takes a backup and checks it, then deletes the hosted store and restores it. It needs Node 22.20 or later and a
POSIX shell, and no FileMaker file. Use a fresh `~/tabularius-backup-tutorial` folder for this exercise.

Every command in the blocks marked `sh run` below is run by `packages/cli/test/tutorial-backup-and-restore.test.ts`
against a throwaway folder, so if a step stops working the test fails and this page is fixed with it.

From the repository, `tabularius` is `npm run tabularius --`; installed, it is just `tabularius`.

## 1. Make a file and set its password

```sh run
mkdir -p ~/tabularius-backup-tutorial
tabularius new ~/tabularius-backup-tutorial Contacts
```

This creates `Contacts.openhbam.sqlite`, the store that holds the file's design, records and accounts.
Give its Admin account a password:

```sh run
echo 'a long enough password' | tabularius passwd ~/tabularius-backup-tutorial Contacts Admin
```

## 2. Give it something to keep

Make a table with one text field. `design` reads the changes from a JSON file; creating a table also makes a
layout with the same name.

```sh run
cat > ~/tabularius-backup-tutorial/design.json <<'JSON'
[{"op":"createTable","name":"Contacts","fields":[{"name":"Name","type":"text"}]}]
JSON
tabularius design ~/tabularius-backup-tutorial Contacts ~/tabularius-backup-tutorial/design.json
```

In another terminal, host the folder. Automatic backups are off for this exercise so we can take one by hand:

<!-- docs-example: illustrative -->
```sh
tabularius serve ~/tabularius-backup-tutorial --port 8080 --no-backups
```

Leave that running. Back in the first terminal, sign in through the Data API, add two records, and sign out.
Node 22 includes `fetch`, so there is nothing else to install:

```sh run
node --input-type=module <<'JS'
const base = 'http://127.0.0.1:8080/fmi/data/vLatest/databases/Contacts';
async function call(path, options) {
  const response = await fetch(base + path, options);
  const body = await response.json();
  if (!response.ok || body.messages[0].code !== '0') throw new Error(JSON.stringify(body));
  return body.response;
}
const { token } = await call('/sessions', {
  method: 'POST',
  headers: { Authorization: 'Basic ' + Buffer.from('Admin:a long enough password').toString('base64'),
    'Content-Type': 'application/json' },
  body: '{}',
});
try {
  for (const Name of ['Ada Lovelace', 'Grace Hopper']) {
    const made = await call('/layouts/Contacts/records', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldData: { Name } }),
    });
    console.log('made record', made.recordId, Name);
  }
} finally {
  await call('/sessions/' + token, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}
JS
```

Stop the server with **Ctrl-C** in its terminal and wait for it to exit. Keep it stopped for the rest of this
exercise: restoring a backup requires the server to be stopped. Check the records from the first terminal:

```sh run
tabularius records ~/tabularius-backup-tutorial Contacts Contacts
```

You should see two JSON lines, one for Ada Lovelace and one for Grace Hopper. `records` reads the hosted store;
`info` reads a FileMaker `.fmp12` header and object counts, so it cannot check records in this new file.

## 3. Take a backup

```sh run
tabularius backup ~/tabularius-backup-tutorial
```

The answer says `backed up 1 files to` followed by a folder under `~/tabularius-backup-tutorial/Backups/`.
The folder's name is the backup set's date and time. A set contains a copy of each hosted store, including
its accounts and passwords. `design.json` is just our input to `design` and is not part of the backup.

## 4. Check the copy before you need it

```sh run
tabularius verify-backup ~/tabularius-backup-tutorial
```

This checks every set in the backup folder. With this one file, expect `checked: 1 file ok`. The check compares
the copy's checksum and runs SQLite's full integrity check; a damaged set makes the command exit with status 1.
Only continue when the check passes.

## 5. Pretend the hosted store was lost

This deletes only the store we just made. Double-check the path and keep the server stopped. Leave `Backups`
alone: it holds the copy we are about to restore.

```sh run
rm ~/tabularius-backup-tutorial/Contacts.openhbam.sqlite
test ! -e ~/tabularius-backup-tutorial/Contacts.openhbam.sqlite
echo 'the hosted store is gone'
```

## 6. Put it back

Pick the newest set in this exercise's backup folder and restore it:

```sh run
SET=$(ls -1 ~/tabularius-backup-tutorial/Backups | sort | tail -n 1)
tabularius restore ~/tabularius-backup-tutorial "$SET"
```

The answer says `restored Contacts.openhbam.sqlite`. In a real recovery, choose the set from before the loss
or unwanted change; the newest set is not always the right one. Restoring replaces the hosted stores in that set.

## 7. Set the password again

A restore keeps the current file's sign-in state, so that a password or token you revoked since the backup
cannot come back. Here the hosted store was lost altogether, so there is no current state to keep: the restored
accounts have no password until you set one. Give Admin its password again:

```sh run
echo 'a long enough password' | tabularius passwd ~/tabularius-backup-tutorial Contacts Admin
```

The answer says `password set for Admin in Contacts`. Passkeys, two-factor codes and API tokens from the backup
are not brought back either; add them again when you need them.

## 8. Check the records are back

```sh run
tabularius records ~/tabularius-backup-tutorial Contacts Contacts
```

The same two records, with the same record IDs, should be back. You can start `serve` again and sign in with the
password from step 7.

## Where next

- [Backups in the README](../../README.md#hosting-for-a-team) covers scheduled backups, encryption and
  restoring a file to a moment.
- Keep a copy off this computer too: a backup beside the hosted store cannot survive losing the whole disk.
- [Add a Data API client in 10 minutes](data-api-client.md) goes further with the API used here.
