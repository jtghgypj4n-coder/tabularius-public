# Connect an S3 bucket

Your scripts sometimes need to store or fetch files somewhere else: invoices in a bucket, scans from a shared drive.
Tabularius keeps that connection on the server, by name, with the keys sealed where no script, plug-in, AI tool or API call
can read them. This tutorial sets one up against MinIO (an S3 you run yourself, so nothing here touches Amazon); with
Amazon S3, Cloudflare R2, Backblaze B2 or Wasabi only the settings differ. It needs Node 22.20 or later and `curl`.

Every command in the blocks marked `sh run` below is run by `packages/cli/test/tutorial-connect-s3.test.ts` against a
local stand-in for S3 that checks every request's signature the way S3 does, so if a step stops working the test fails
and this page is fixed with it. Nothing in the test reaches a real service.

From the repository, `tabularius` is `npm run tabularius --`; installed, it is just `tabularius`.

## 1. What you need

A bucket with a pair of keys that can list, read and write in it. For MinIO on your own machine that is its address
(`http://localhost:9000`), the bucket you made (`invoices`) and the root user and password you started it with. Use keys
limited to that one bucket when your service lets you: the connection can also stay inside one folder of the bucket,
but a narrow key is the stronger fence.

Plain `http` is accepted only for a machine of your own (localhost, a private network address or a one-word name). A
service on the internet has to use `https`.

## 2. Start the server with a secrets passphrase

Keys are sealed with AES-256-GCM. With `TABULARIUS_SECRETS_KEY` set to a passphrase, the key that opens them never touches
the folder; without it the server writes a key file only its user can read. Keep the passphrase somewhere safe: if it
is lost the keys have to be typed again.

<!-- docs-example: illustrative -->
```sh
mkdir -p ~/Databases
TABULARIUS_SECRETS_KEY='a long passphrase only you know' tabularius serve ~/Databases --port 8080
```

Leave that running. Until you set an admin password (`tabularius admin-password ~/Databases`), the admin console and its
API accept only requests from this machine.

## 3. Add the connection

This is what the Connections page of the admin console does when you press Add. The connection is a draft until you
have set its keys and approved it. `prefix` is the folder of the bucket that everything is kept inside.

```sh run
curl -sS -X POST http://127.0.0.1:8080/tabularius/admin/v1/connections \
  -H 'x-tabularius-admin: 1' -H 'content-type: application/json' \
  -d '{"name":"invoices","type":"s3","config":{"bucket":"invoices","endpoint":"http://localhost:9000","prefix":"acme"}}'
```

The answer shows `"status":"draft"` and `"ready":false`: the keys are not set yet. Names are what scripts call it by.

## 4. Type the keys

The keys go straight into the sealed store. Nothing ever returns them: the console, the API and the logs only say
whether each one is set.

```sh run
ID=$(curl -sS http://127.0.0.1:8080/tabularius/admin/v1/connections | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).connections[0].id))')
curl -sS -X PUT http://127.0.0.1:8080/tabularius/admin/v1/connections/$ID/secrets/accessKey \
  -H 'x-tabularius-admin: 1' -H 'content-type: application/json' -d '{"value":"minioadmin"}'
curl -sS -X PUT http://127.0.0.1:8080/tabularius/admin/v1/connections/$ID/secrets/secretKey \
  -H 'x-tabularius-admin: 1' -H 'content-type: application/json' -d '{"value":"tutorial-secret-key-1234"}'
echo
curl -sS http://127.0.0.1:8080/tabularius/admin/v1/connections/$ID
```

Look at the listing: both keys say `"set":true` and neither shows a value. Check the folder too: the secret is nowhere
in it in plain text.

```sh run
if grep -rq tutorial-secret-key-1234 ~/Databases; then echo "LEAK: the secret is in the folder"; exit 1; fi
echo "the secret is not in the folder in plain text"
ls -a ~/Databases | grep connection
```

## 5. Test it, then approve it

Test signs in with the sealed keys and asks the service something harmless (for S3, a listing of one object), so you
see a wrong key or bucket now and not in the middle of a script. It works on a draft.

```sh run
ID=$(curl -sS http://127.0.0.1:8080/tabularius/admin/v1/connections | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).connections[0].id))')
curl -sS -X POST http://127.0.0.1:8080/tabularius/admin/v1/connections/$ID/test -H 'x-tabularius-admin: 1'
echo
curl -sS -X POST http://127.0.0.1:8080/tabularius/admin/v1/connections/$ID/approve -H 'x-tabularius-admin: 1'
echo
```

Approval is a person's go-ahead. A connection an AI drafted (see below) can never approve itself, and no tool sets keys.

## 6. Use it from a script

A script uses the connection with Insert from URL and an address that starts with `connection://` and the name. The
server signs each request with the keys, so the script never holds them.

```
# Store the container in $file as acme/2026/scan.pdf in the bucket
Insert from URL [ Select ; With dialog: Off ; Target: $r ; "connection://invoices/2026/scan.pdf" ; cURL options: "-X PUT --data-binary @$file" ]

# Fetch it back into a container field
Insert from URL [ Select ; With dialog: Off ; Target: Invoices::Scan ; "connection://invoices/2026/scan.pdf" ]

# List a folder (S3's XML, names relative to the connection's folder)
Insert from URL [ Select ; With dialog: Off ; Target: $list ; "connection://invoices/?prefix=2026/" ]

# Remove it
Insert from URL [ Select ; With dialog: Off ; Target: $r ; "connection://invoices/2026/scan.pdf" ; cURL options: "-X DELETE" ]
```

A script cannot reach beyond the connection's bucket and folder, add ACLs, copy from another bucket or see the keys.
Like every outbound step it works once **Script network** is turned on for the file in the admin console (or the server is started with `--allow-script-network`, which turns it on for every file), never when a capture-only
file is anywhere on the call stack, and never for a script an AI runs. A scheduled script uses connections only while
the files are as a person last approved them for that schedule.

## 7. Or ask an AI to set it up

Ask an AI app connected to Tabularius, or the assistant in the web client: "set up an S3 connection to our invoices
bucket". It calls `draft_connection`, which makes a draft with the settings you gave and limited to the file you asked
from. It never sees, asks for or invents a key. You open Connections, check the settings, type the keys, press Test and
approve. On a server started with `--allow-app-connections` the web client's assistant shows a card where a
Full Access person does the same without leaving the file.

## Where to go next

- Mail works the same way: an SMTP connection, marked "Send Mail steps use it", is what Send Mail via SMTP uses.
- A web API takes a bearer token, basic sign-in, an API-key header or OAuth 2 client credentials. The keys stay on the
  server in the same way.
- The calls on this page are in the [REST reference](../reference/rest.md#admin-connections).
