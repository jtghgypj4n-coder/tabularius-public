# OpenAPI description and TypeScript types

A Tabularius server describes its Data API and OData service in OpenAPI 3.1, so
a client generator, an API explorer or an AI tool can read what the server
answers instead of someone writing it out again.

```
curl http://127.0.0.1:8080/fmi/data/openapi.json
```

No sign-in is needed, and the document depends on neither a file nor an
account. `servers` holds the address the request came to (the `--public-url`
when one is set).

## What it describes

Every Data API route and the OData v4 service that
[the REST reference](reference/rest.md) lists: the parameters, the request
bodies, the response and error shapes, and the sign-in each takes (HTTP Basic,
a session or API token as `Authorization: Bearer`, or the
`X-FM-Data-Access-Token` header). It describes what Tabularius does. It does not
say what FileMaker Server's own description says.

- Operations that FileMaker's Data API does not have carry `x-tabularius-only`,
  and so do the response members FileMaker's guide doesn't show (`x-tabularius`):
  `tabularius:denial`, for example. The Data API
  [compatibility page](data-api-compatibility.md) has the same marks in ＋ rows.
- A response schema in a Data API operation is the *response contract's* where
  the contract has one: one test calls each endpoint and fails on any key the
  schema does not list. The contract is
  `packages/server/test/dataapi-response-contract.json`; where the Claris guide
  shows nothing, it says so under `notVerified`.
- A response schema read off the documented example, not checked key by key,
  carries `x-tabularius-inferred`. It lists the keys the example shows, none <!-- known-difference: Data API ;; A response schema read off the documented example, not checked key by key, carries x-tabularius-inferred; it lists the keys the example shows, none required ;; A client generated from the description treats those properties as optional ;; A captured FileMaker response, or a Claris guide page that shows the shape -->
  required, and allows others.
- Query parameters whose names carry a placeholder (`_offset.{portal}`) cannot be
  written as OpenAPI parameters; they are under `x-tabularius-query-patterns` on the
  operation. In a body they are `patternProperties`.
- Every Data API operation names `FileMakerError` as its default response (the
  `{ "response": {}, "messages": [{ "code", "message" }] }` envelope, with the
  HTTP status each FileMaker code answers); OData operations name `ODataError`.

## TypeScript types

```
tabularius api-types > tabularius-api.d.ts
```

writes a `.d.ts` from the same description, with no dependency and no file
needed. It has a type for each named schema (`DataRecords`, `Message`, …) and
`Operations`, which gives each operation, by its `operationId`, its `method`,
`route`, `params`, `query`, `headers`, `body` and `response`:

```ts
import type { Operations } from './tabularius-api.d.ts';

type Page = Operations['getDatabasesByDatabaseLayoutsByLayoutRecords']['response'];
// { response: DataRecords; messages: Message[]; "tabularius:denial"?: Denial }
```

Regenerate it after upgrading the server; a changed route changes the types.

## How it is made

The description is not typed by hand. `npm run docs:reference` writes
`packages/server/src/data-api.openapi.json` from the route table in
`scripts/reference/rest/` (the notes `docs/reference/rest.md` is built from, which a
test holds against the server's route expressions) and the contract. Tests in
`packages/server/test/openapi.test.ts` fail when:

- the committed file is not what the table and contract generate;
- a route in the table has no operation, or an operation has no route;
- a `$ref` does not resolve, a path parameter is undeclared, an operation has no
  summary, permissions text or security;
- a documented example response, or a live reply (sign-in, record range,
  create, edit, find, delete, metadata, and an error), does not validate against
  its schema;
- the generated types do not compile under `tsc --strict`.

To describe a new route, add it to the route table like any other; run
`npm run docs:reference`.
