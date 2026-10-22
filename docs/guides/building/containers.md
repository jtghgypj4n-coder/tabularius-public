# Add a container field

Use this guide when a record needs an attached image or file. It covers adding a container field and checking how the browser client presents a synthetic upload.

1. Add a container field to the table that owns the attachment. Decide whether the solution should store container data internally or in an external folder, according to the deployment's storage policy.
2. Add the field to a layout and save the design.
3. In Browse mode, use the field's insert or replace action with a harmless test file. Confirm the allowed account can read and replace it.
4. Check the deployment's backup and container-folder procedures before using real attachments.

## Worked example

This adds a container field to a synthetic table. It does not include or upload any file.

<!-- docs-example: run -->
```sh
printf '%s\n' '[{"op":"createTable","name":"BuildDocuments","fields":[{"name":"Title","type":"text"},{"name":"Attachment","type":"container"}]}]' > changes.json
tabularius design ~/Databases Invoices changes.json
```

## Check afterwards

- Confirm the field is listed as a container in the schema and appears on the layout.
- Upload a harmless image and verify it opens or downloads as expected for the account.
- Run a backup and confirm the deployment's container storage is included by its documented backup process.

See [Design mode](../../design-mode.md), [web client coverage](../../web-client.md), the [REST reference](../../reference/rest.md) for container routes, [backup and restore](../../tutorials/backup-and-restore.md), and [known differences](../../known-differences.md). Container storage behavior is described for Tabularius; do not infer how a FileMaker deployment stores an existing field from this example.
