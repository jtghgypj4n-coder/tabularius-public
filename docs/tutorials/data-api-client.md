# Add a Data API client in 10 minutes

Tabularius answers the FileMaker Data API, so a script, a website or a no-code tool that already talks to
FileMaker Server can talk to it by changing the address. This tutorial makes a small contacts file from nothing,
hosts it, and talks to it with `curl` and then with a Node script. It needs Node 22.20 or later and `curl`, and no FileMaker
file.

Every command in the blocks marked `sh` below is run by `packages/cli/test/tutorial-data-api.test.ts` against a
throwaway folder, so if a step stops working the test fails and this page is fixed with it.

## 1. Make and host a file

From the repository, `tabularius` is `npm run tabularius --`; installed, it is just `tabularius`.

<!-- docs-example: run -->
```sh
mkdir -p ~/tabularius-tutorial
tabularius new ~/tabularius-tutorial Contacts
tabularius design-apply ~/tabularius-tutorial Contacts examples/first-app --apply
echo 'a long enough password' | tabularius passwd ~/tabularius-tutorial Contacts Admin
```

This is the [first app](../../examples/first-app/README.md): a Contacts table with a name, an email address and a
status, and a Calls table. Now host the folder in another terminal and leave it running:

<!-- docs-example: illustrative -->
```sh
tabularius serve ~/tabularius-tutorial --port 8080
```

## 2. Sign in

The Data API signs in with an account and password and gives back a token. Every later call carries the token.

```sh run
BASE=http://127.0.0.1:8080/fmi/data/vLatest/databases/Contacts
TOKEN=$(curl -s -X POST -u 'Admin:a long enough password' -H 'Content-Type: application/json' -d '{}' "$BASE/sessions" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "got a token of ${#TOKEN} characters"
```

A wrong password answers HTTP 401. The token goes in the `Authorization: Bearer` header from here on.

## 3. Read the layouts, add a record, find it

A layout is how the Data API sees a table: you read and write through layouts. This file has one for each table.

```sh run
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/layouts"
echo
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fieldData":{"Name":"Ada Lovelace","Email":"ada@example.com","Status":"Lead"}}' "$BASE/layouts/Contacts/records"
echo
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":[{"Status":"Lead"}]}' "$BASE/layouts/Contacts/_find"
echo
```

Adding a record answers its `recordId`. A find takes a list of requests (`query`): the fields inside one request
must all match, and a second request adds more matches. The answer has a `dataInfo` block with the counts and a
`data` list with each record's `fieldData`, `recordId` and `modId`.

## 4. Change and delete a record

```sh run
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fieldData":{"Status":"Customer"}}' "$BASE/layouts/Contacts/records/1"
echo
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/layouts/Contacts/records/1"
echo
```

`recordId` is the record's identity in the Data API (it is not the `ID` field). Every answer carries a `messages`
list with a FileMaker error `code`; `"0"` is success. A find that matches nothing is not an empty list: it answers
error `401` with HTTP status 500, as FileMaker Server does, so a client must treat that one as "no records".
[Data API compatibility](../data-api-compatibility.md) lists what else differs.

## 5. The same in Node

Node 22 has `fetch`, so there is nothing to install. Save this as `client.mjs`:

```js run
// client.mjs
const base = process.env.BASE ?? 'http://127.0.0.1:8080/fmi/data/vLatest/databases/Contacts';

async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  const login = await fetch(base + '/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('Admin:a long enough password').toString('base64') },
    body: '{}',
  }).then((r) => r.json());
  const token = login.response.token;
  try {
    const made = await call('POST', '/layouts/Contacts/records', token, { fieldData: { Name: 'Grace Hopper', Status: 'Lead' } });
    console.log('made record', made.response.recordId);
    const found = await call('POST', '/layouts/Contacts/_find', token, { query: [{ Status: 'Lead' }] });
    if (found.messages[0].code === '401') console.log('no leads');
    else for (const r of found.response.data) console.log(r.recordId, r.fieldData.Name);
    await call('DELETE', `/layouts/Contacts/records/${made.response.recordId}`, token);
  } finally {
    await call('DELETE', `/sessions/${token}`, token);
  }
}
main();
```

```sh run
node client.mjs
```

It signs in, adds a record, finds the leads, deletes the record it made, and always signs out. Signing out ends
the token; a token also ends by itself after a while without use.

## Where next

- The web client is at `http://127.0.0.1:8080/app/` and sees the same records.
- Give a script its own account with only the privileges it needs (Admin can do everything), and use HTTPS before
  anything but your own computer calls it: the password and token travel in every request.
- Not covered here: containers, portals, running scripts and value lists. See
  [Data API compatibility](../data-api-compatibility.md).
