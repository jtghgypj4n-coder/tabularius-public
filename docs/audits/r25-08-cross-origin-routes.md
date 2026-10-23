# r25-08 cross-origin route inventory

Generated with `node scripts/audit-cross-origin.ts` from the six modules in `scripts/reference/rest/`. Check with `--check`.

Route-table entries after splitting methods: **448** (261 non-GET/HEAD; 187 GET/HEAD). All reads are included so data-bearing and stateful GETs cannot disappear behind a method-only filter.

Categories and exemption reasons: [audit](r25-08-csrf-cors-matrix.md). A is an ambient-credential origin guard; B is a bearer/header-token exemption from CSRF checks, never from authorization; U is an explicit URL capability; M is MCP; O is OAuth/OIDC; P is public; H is a webhook secret.

The route table groups some action alternatives into a placeholder. Those handlers are reviewed as a family. Parameter substitutions in the harness are synthetic. These rows are an inventory, not a claim that every success path was exercised.

## data-api-sessions

Handler: `packages/server/src/dataapi.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/fmi/data/{version}/databases/{database}/sessions` | A: origin + password/assertion/recovery proof |
| PATCH | `/fmi/data/{version}/databases/{database}/sessions` | B: explicit file token |
| DELETE | `/fmi/data/{version}/databases/{database}/sessions/{sessionToken}` | U: token in path; origin checked |
| GET | `/fmi/data/{version}/validateSession` | B: explicit file token |
| POST | `/fmi/data/{version}/databases/{database}/sessions/passkey` | A: origin + password/assertion/recovery proof |
| POST | `/fmi/data/{version}/databases/{database}/sessions/passkey-2fa` | A: origin + password/assertion/recovery proof |
| POST | `/fmi/data/{version}/databases/{database}/sessions/recovery` | A: origin + password/assertion/recovery proof |
| POST | `/fmi/data/{version}/databases/{database}/recovery-codes` | B: explicit file token |
| POST | `/fmi/data/{version}/databases/{database}/passkey/register/options` | B: explicit file token |
| POST | `/fmi/data/{version}/databases/{database}/passkey/register` | B: explicit file token |
| GET | `/fmi/data/{version}/databases/{database}/passkey` | B: explicit file token |
| DELETE | `/fmi/data/{version}/databases/{database}/passkey/{credentialId}` | B: explicit file token |

## data-api-metadata

Handler: `packages/server/src/dataapi.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/fmi/data/{version}/productInfo` | P: public metadata / optional file list |
| GET | `/fmi/data/openapi.json` | P: public metadata / optional file list |
| HEAD | `/fmi/data/openapi.json` | P: public metadata / optional file list |
| GET | `/fmi/data/{version}/databases` | P: public metadata / optional file list |
| GET | `/fmi/data/{version}/databases/{database}/layouts` | B: explicit file token |
| GET | `/fmi/data/{version}/databases/{database}/layouts/{layout}` | B: explicit file token |
| GET | `/fmi/data/{version}/databases/{database}/scripts` | B: explicit file token |
| PATCH | `/fmi/data/{version}/databases/{database}/globals` | B: explicit file token |

## data-api-records

Handler: `packages/server/src/dataapi.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records` | B: explicit file token; no cookie |
| POST | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records` | B: explicit file token; no cookie |
| GET | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}` | B: explicit file token; no cookie |
| PATCH | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}` | B: explicit file token; no cookie |
| POST | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}` | B: explicit file token; no cookie |
| DELETE | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}` | B: explicit file token; no cookie |
| POST | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}/containers/{field}` | B: explicit file token; no cookie |
| POST | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}/containers/{field}/{repetition}` | B: explicit file token; no cookie |
| POST | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}/container-uploads/{field}` | B: explicit file token; no cookie |
| GET | `/fmi/data/{version}/databases/{database}/layouts/{layout}/container-uploads/{uploadId}` | B: explicit file token; no cookie |
| PUT | `/fmi/data/{version}/databases/{database}/layouts/{layout}/container-uploads/{uploadId}` | B: explicit file token; no cookie |
| POST | `/fmi/data/{version}/databases/{database}/layouts/{layout}/container-uploads/{uploadId}/finish` | B: explicit file token; no cookie |
| DELETE | `/fmi/data/{version}/databases/{database}/layouts/{layout}/container-uploads/{uploadId}` | B: explicit file token; no cookie |
| DELETE | `/fmi/data/{version}/databases/{database}/layouts/{layout}/records/{recordId}/containers/{field}` | B: explicit file token; no cookie |
| POST | `/fmi/data/{version}/databases/{database}/layouts/{layout}/_find` | B: explicit file token; no cookie |
| GET | `/fmi/data/{version}/databases/{database}/layouts/{layout}/script/{script}` | B: explicit file token; no cookie |

## web-client

Handler: `packages/server/src/webclient.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/favicon.ico` | P: public shell/static/discovery |
| HEAD | `/favicon.ico` | P: public shell/static/discovery |
| GET | `/fmi/webd/{database}` | P: public shell/static/discovery |
| HEAD | `/fmi/webd/{database}` | P: public shell/static/discovery |
| GET | `/app` | P: public shell/static/discovery |
| GET | `/app/{path...}` | P: public shell/static/discovery |
| GET | `/next` | P: public shell/static/discovery |
| GET | `/next/` | P: public shell/static/discovery |
| GET | `/tabularius/images/{database}/{id}` | U: signed URL capability |
| GET | `/tabularius/app/v1/databases/{database}/layouts` | B: explicit file token; no cookie |
| GET | `/tabularius/app/v1/databases/{database}/layouts/{layout}` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/view` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/records` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/foundset` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/groups` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/charts` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/menus` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/button` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/value-list` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/explain` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/history` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/revert` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/refresh` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/position` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/index` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/export` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/import` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/undo-import` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/layouts/{layout}/ai-replace` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/runs/{id}/file` | B: explicit file token; no cookie |
| POST | `/tabularius/app/v1/databases/{database}/runs/stop` | B: explicit file token; no cookie |
| GET | `/tabularius/app/v1/databases/{database}/runs/progress` | B: explicit file token; no cookie |
| GET | `/tabularius/app/v1/databases/{database}/prefs` | B: explicit file token; no cookie |
| PUT | `/tabularius/app/v1/databases/{database}/prefs/{key}` | B: explicit file token; no cookie |

## live

Handler: `packages/server/src/live.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/live/v1/databases/{database}/events` | B: explicit file token; no cookie |
| GET | `/tabularius/live/v1/databases/{database}/clients` | B: explicit file token; no cookie |
| GET | `/tabularius/live/v1/databases/{database}/locks` | B: explicit file token; no cookie |
| GET | `/tabularius/live/v1/databases/{database}/viewers` | B: explicit file token; no cookie |
| POST | `/tabularius/live/v1/databases/{database}/layouts/{layout}/records/{id}/lock` | B: explicit file token; no cookie |
| DELETE | `/tabularius/live/v1/databases/{database}/layouts/{layout}/records/{id}/lock` | B: explicit file token; no cookie |
| POST | `/tabularius/live/v1/databases/{database}/layouts/{layout}/records/{id}/view` | B: explicit file token; no cookie |
| DELETE | `/tabularius/live/v1/databases/{database}/layouts/{layout}/records/{id}/view` | B: explicit file token; no cookie |
| GET | `/tabularius/live/v1/databases/{database}/design` | B: explicit file token; no cookie |
| POST | `/tabularius/live/v1/databases/{database}/design` | B: explicit file token; no cookie |
| DELETE | `/tabularius/live/v1/databases/{database}/design` | B: explicit file token; no cookie |

## changes

Handler: `packages/server/src/changes.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/changes/v1/databases/{database}` | B: explicit file token; no cookie |

## calendar

Handler: `packages/server/src/calendar.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/calendar/v1/databases/{database}/layouts/{layout}/calendar.ics` | B/U: header token or scoped feed token |
| HEAD | `/tabularius/calendar/v1/databases/{database}/layouts/{layout}/calendar.ics` | B/U: header token or scoped feed token |
| POST | `/tabularius/calendar/v1/databases/{database}/layouts/{layout}/calendar-import` | B: explicit file token |
| GET | `/tabularius/calendar/v1/databases/{database}/feeds` | B: explicit file token |
| POST | `/tabularius/calendar/v1/databases/{database}/feeds` | B: explicit file token |
| DELETE | `/tabularius/calendar/v1/databases/{database}/feeds/{id}` | B: explicit file token |

## sql

Handler: `packages/server/src/sql.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/tabularius/sql/v1/databases/{database}` | A/B: Basic origin check / explicit token |
| GET | `/tabularius/sql/v1/databases/{database}` | A/B: Basic origin check / explicit token |
| GET | `/tabularius/sql/v1/databases/{database}/tables` | A/B: Basic origin check / explicit token |

## odata

Handler: `packages/server/src/odata.ts`, `packages/server/src/odata-batch.ts`, `packages/server/src/odata-apply.ts`, `packages/server/src/odata-search.ts`, `packages/server/src/odata-crossjoin.ts`, `packages/server/src/odata-schema.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/fmi/odata/v4` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/$metadata` | A/B: Basic origin check / explicit token |
| POST | `/fmi/odata/v4/{database}/$batch` | A/B: Basic origin check / explicit token |
| POST | `/fmi/odata/v4/{database}/Script.{name}` | A/B: Basic origin check / explicit token |
| POST | `/fmi/odata/v4/{database}/FileMaker_Tables` | A/B: Basic origin check / explicit token |
| POST | `/fmi/odata/v4/{database}/FileMaker_Indexes/{table}` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/{entitySet}` | A/B: Basic origin check / explicit token |
| POST | `/fmi/odata/v4/{database}/{entitySet}` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/{entitySet}/$count` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/$crossjoin({sets})` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/{entitySet}({id})/{navigation}/$count` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/{entitySet}({id})/{navigation}/$ref` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/{entitySet}({id})` | A/B: Basic origin check / explicit token |
| PATCH | `/fmi/odata/v4/{database}/{entitySet}({id})` | A/B: Basic origin check / explicit token |
| PUT | `/fmi/odata/v4/{database}/{entitySet}({id})` | A/B: Basic origin check / explicit token |
| DELETE | `/fmi/odata/v4/{database}/{entitySet}({id})` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/{entitySet}({id})/{property}` | A/B: Basic origin check / explicit token |
| HEAD | `/fmi/odata/v4/{database}/{entitySet}({id})/{property}` | A/B: Basic origin check / explicit token |
| GET | `/fmi/odata/v4/{database}/{entitySet}({id})/{property}/$value` | A/B: Basic origin check / explicit token |
| HEAD | `/fmi/odata/v4/{database}/{entitySet}({id})/{property}/$value` | A/B: Basic origin check / explicit token |
| PATCH | `/fmi/odata/v4/{database}/{entitySet}({id})/{property}` | A/B: Basic origin check / explicit token |
| PUT | `/fmi/odata/v4/{database}/{entitySet}({id})/{property}` | A/B: Basic origin check / explicit token |
| DELETE | `/fmi/odata/v4/{database}/{entitySet}({id})/{property}` | A/B: Basic origin check / explicit token |

## cwp-xml

Handler: `packages/server/src/cwp-xml.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/fmi/xml/{grammar}.xml` | A/B: Basic origin check / explicit token |
| HEAD | `/fmi/xml/{grammar}.xml` | A/B: Basic origin check / explicit token |
| POST | `/fmi/xml/{grammar}.xml` | A/B: Basic origin check / explicit token |

## design

Handler: `packages/server/src/design.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/design/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/history` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/ddr` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/docs` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/docs` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/report` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/audit` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/check` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/preview` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/restyle` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/modernize` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/snippet` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/snippet/copy` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/evaluate` | B: explicit file token; no cookie |
| DELETE | `/tabularius/design/v1/databases/{database}/deleted` | B: explicit file token; no cookie |
| DELETE | `/tabularius/design/v1/databases/{database}/deleted/{id}` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/images` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/images` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/suggest-rules` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/impact` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/pending` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/pending` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/pending/apply` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/pending/discard` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/scripts/lint` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/used` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/import-tables` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/graph` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/layouts/{id}` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/layouts/{id}/lint` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/layouts/{id}/lint` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/layouts/{id}/fix` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/layouts/{id}/history` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/layouts/{id}/speed` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/layouts/{id}/phone` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/layouts/{id}/phone` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/library` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/library` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/library/{id}` | B: explicit file token; no cookie |
| DELETE | `/tabularius/design/v1/databases/{database}/library/{id}` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/themes/{id}` | B: explicit file token; no cookie |

## design-scripts

Handler: `packages/server/src/design.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/design/v1/databases/{database}/script-tests` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/script-tests` | B: explicit file token; no cookie |
| DELETE | `/tabularius/design/v1/databases/{database}/script-tests/{id}` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/script-tests/run` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/script-tests/record` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/script-tests/suggest` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/scripts/{id}/history` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/scripts/{id}/profile` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/scripts/{id}/profile` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/scripts/dry-run` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/scripts/{id}/refactor` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/scripts/{id}/refactor` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/scripts/{id}/compare` | B: explicit file token; no cookie |
| GET | `/tabularius/design/v1/databases/{database}/scripts/{id}/dependencies` | B: explicit file token; no cookie |
| POST | `/tabularius/design/v1/databases/{database}/scripts/{id}/dry-run` | B: explicit file token; no cookie |

## debug

Handler: `packages/server/src/debug.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/debug/v1/databases/{database}/scripts` | B: explicit file token; no cookie |
| POST | `/tabularius/debug/v1/databases/{database}/runs` | B: explicit file token; no cookie |
| GET | `/tabularius/debug/v1/databases/{database}/runs` | B: explicit file token; no cookie |
| GET | `/tabularius/debug/v1/databases/{database}/runs/{id}` | B: explicit file token; no cookie |
| POST | `/tabularius/debug/v1/databases/{database}/runs/{id}/{command}` | B: explicit file token; no cookie |
| POST | `/tabularius/debug/v1/databases/{database}/runs/{id}/next` | B: explicit file token; no cookie |
| PUT | `/tabularius/debug/v1/databases/{database}/runs/{id}/breakpoints` | B: explicit file token; no cookie |
| PUT | `/tabularius/debug/v1/databases/{database}/runs/{id}/options` | B: explicit file token; no cookie |
| POST | `/tabularius/debug/v1/databases/{database}/runs/{id}/evaluate` | B: explicit file token; no cookie |
| POST | `/tabularius/debug/v1/databases/{database}/evaluate` | B: explicit file token; no cookie |
| GET | `/tabularius/debug/v1/databases/{database}/current` | B: explicit file token; no cookie |
| POST | `/tabularius/debug/v1/databases/{database}/recordings` | B: explicit file token; no cookie |

## security

Handler: `packages/server/src/security.ts`, `packages/server/src/account-provisioning.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/tabularius/security/v1/databases/{database}/accounts/import/preview` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/accounts/import/apply` | B: explicit file token; no cookie |
| GET | `/tabularius/security/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/tokens` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/migrate` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/record-rule/preview` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/totp/{account}` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/totp/{account}/confirm` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/pending/{id}/approve` | B: explicit file token; no cookie |
| POST | `/tabularius/security/v1/databases/{database}/pending/{id}/reject` | B: explicit file token; no cookie |

## assistant

Handler: `packages/server/src/assistant.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/assistant/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/assistant/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/assistant/v1/databases/{database}/handover` | B: explicit file token; no cookie |
| GET | `/tabularius/assistant/v1/databases/{database}/connections/{name}` | B: explicit file token; no cookie |
| PUT | `/tabularius/assistant/v1/databases/{database}/connections/{name}/secrets/{field}` | B: explicit file token; no cookie |
| POST | `/tabularius/assistant/v1/databases/{database}/connections/{name}/test` | B: explicit file token; no cookie |
| POST | `/tabularius/assistant/v1/databases/{database}/connections/{name}/approve` | B: explicit file token; no cookie |
| DELETE | `/tabularius/assistant/v1/databases/{database}/connections/{name}` | B: explicit file token; no cookie |

## automations

Handler: `packages/server/src/automations.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/automations/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/automations/v1/databases/{database}` | B: explicit file token; no cookie |
| GET | `/tabularius/automations/v1/databases/{database}/{id}` | B: explicit file token; no cookie |
| PUT | `/tabularius/automations/v1/databases/{database}/{id}` | B: explicit file token; no cookie |
| DELETE | `/tabularius/automations/v1/databases/{database}/{id}` | B: explicit file token; no cookie |

## cleanup

Handler: `packages/server/src/cleanup.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/tabularius/cleanup/v1/databases/{database}/scan` | B: explicit file token; no cookie |
| POST | `/tabularius/cleanup/v1/databases/{database}/apply` | B: explicit file token; no cookie |
| GET | `/tabularius/cleanup/v1/databases/{database}/history` | B: explicit file token; no cookie |
| POST | `/tabularius/cleanup/v1/databases/{database}/history/{id}/undo` | B: explicit file token; no cookie |

## dashboards

Handler: `packages/server/src/dashboards.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/dashboards/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/dashboards/v1/databases/{database}` | B: explicit file token; no cookie |
| GET | `/tabularius/dashboards/v1/databases/{database}/{id}` | B: explicit file token; no cookie |
| PUT | `/tabularius/dashboards/v1/databases/{database}/{id}` | B: explicit file token; no cookie |
| DELETE | `/tabularius/dashboards/v1/databases/{database}/{id}` | B: explicit file token; no cookie |

## digests

Handler: `packages/server/src/digests.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/digests/v1/databases/{database}` | B: explicit file token; no cookie |
| POST | `/tabularius/digests/v1/databases/{database}` | B: explicit file token; no cookie |
| GET | `/tabularius/digests/v1/databases/{database}/{id}` | B: explicit file token; no cookie |
| PUT | `/tabularius/digests/v1/databases/{database}/{id}` | B: explicit file token; no cookie |
| DELETE | `/tabularius/digests/v1/databases/{database}/{id}` | B: explicit file token; no cookie |
| POST | `/tabularius/digests/v1/databases/{database}/{id}/run` | B: explicit file token; no cookie |
| GET | `/tabularius/digests/v1/databases/{database}/{id}/runs` | B: explicit file token; no cookie |

## agent

Handler: `packages/server/src/agent.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/tabularius/agent/v1/databases/{database}/dry-run` | B: explicit file token; no cookie |
| POST | `/tabularius/agent/v1/databases/{database}/step` | B: explicit file token; no cookie |
| POST | `/tabularius/agent/v1/databases/{database}/runs/{id}/undo` | B: explicit file token; no cookie |

## inbound-hooks

Handler: `packages/server/src/inbound-hooks.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/tabularius/hooks/v1/{id}` | H: explicit webhook secret/signature |

## admin-sign-in

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/admin/` | P: public shell/static/discovery |
| GET | `/tabularius/admin/v1/sign-in-info` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/sign-in` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/passkey-sign-in` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/sign-out` | A: console origin + auth; mutation header |

## admin-status

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/status` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/metrics` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/solution-map` | A: console origin + auth; mutation header |

## admin-performance

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/profile` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/profile` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/profile/finds` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/indexes` | A: console origin + auth; mutation header |

## admin-files

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/script-network/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/script-network/{database}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/web-viewer-hosts/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/web-viewer-hosts/{database}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/files/{name}/external-containers` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/files/{name}/orphan-containers` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/files/{name}/orphan-containers` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/files/{name}/reconvert-preview` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/files/{name}/reconvert` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/reconvert-all` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/locked/{file}/unlock` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/conversion-guide/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/conversion-guide/{database}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/optimization/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/optimization/{database}/compact` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/optimization/{database}/containers` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/optimization/{database}/containers/undo` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/optimization/{database}/fix` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/optimization/{database}/undo` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/stale-calcs` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/stale-calcs/refresh` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/stale-calcs/undo` | A: console origin + auth; mutation header |

## admin-uploads

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/uploads` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/uploads` | A: console origin + auth; mutation header |
| PUT | `/tabularius/admin/v1/uploads/{id}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/uploads/{id}/finish` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/uploads/{id}` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/uploads/{id}` | A: console origin + auth; mutation header |

## admin-backups

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/backups` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/backup` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/backup-folder` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/backup/stop` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/backups/{set}/verify` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/backups/{set}/test-restore` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/restore` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/restore` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/records/restore` | A: console origin + auth; mutation header |

## admin-security

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/audit` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/audit/settings` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/audit/verify` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/security-events` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/security-events/verify` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/view-as` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/access` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/compare` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/health` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/health/revoke-token` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/health/fix-account` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/least-privilege` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/unusual-access` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/test-account` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/access-review` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/plugin-readiness` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/sso-mapping` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/sso-mapping` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/sso-mapping/{name}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/sso-mapping/test` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/field-access` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/field-access` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/who-can` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/usage` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/relax-unverified` | A: console origin + auth; mutation header | <!-- known-difference-ok: the route name contains the word -->

## admin-accounts

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/passkeys` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/passkeys/register/options` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/passkeys/register` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/passkeys/{id}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/accounts/set-password` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/accounts/unlock` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/accounts/migrate-all` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/accounts/blank-password-lan` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/accounts/blank-password-lan` | A: console origin + auth; mutation header |

## admin-sessions

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/sessions` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/sessions/end` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/clients/{id}/disconnect` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/clients/{id}/message` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/message` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/block-new-users` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/session-timeout` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/responsive` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/notifications` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/notifications/test` | A: console origin + auth; mutation header |

## admin-schedules

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/schedules` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/schedules` | A: console origin + auth; mutation header |
| PATCH | `/tabularius/admin/v1/schedules/{id}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/schedules/{id}/run` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/schedules/{id}/runs` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/schedules/{id}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/server-scripts` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/server-scripts/{id}/cancel` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/script-tests` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/script-tests/run` | A: console origin + auth; mutation header |

## admin-webhooks

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/webhooks` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/webhooks` | A: console origin + auth; mutation header |
| PATCH | `/tabularius/admin/v1/webhooks/{id}` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/webhooks/{id}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/inbound-hooks` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/inbound-hooks` | A: console origin + auth; mutation header |
| PATCH | `/tabularius/admin/v1/inbound-hooks/{id}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/inbound-hooks/{id}/secret` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/inbound-hooks/{id}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/outbox` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/outbox/{id}` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/outbox` | A: console origin + auth; mutation header |

## admin-plugins

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/plugins` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/plugins/{id}/enable` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/plugins/{id}/disable` | A: console origin + auth; mutation header |
| PUT | `/tabularius/admin/v1/plugins/{id}/secrets/{name}` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/plugins/{id}/secrets/{name}` | A: console origin + auth; mutation header |

## admin-connections

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/connections` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/connections` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/connections/{id}` | A: console origin + auth; mutation header |
| PATCH | `/tabularius/admin/v1/connections/{id}` | A: console origin + auth; mutation header |
| PUT | `/tabularius/admin/v1/connections/{id}/secrets/{field}` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/connections/{id}/secrets/{field}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/connections/{id}/approve` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/connections/{id}/test` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/connections/{id}` | A: console origin + auth; mutation header |

## admin-ai

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/ai-policy/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/ai-policy/{database}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/ai-usage` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/ai-access/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/ai-access/{database}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/pii/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/pii/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/pii/{database}/field` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/solutions/plan` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/solutions` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/digests` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/digests/{database}/{id}/run` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/mcp` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/mcp/tokens` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/mcp/tokens/{id}` | A: console origin + auth; mutation header |

## admin-logs

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/logs` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/logs/{name}` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/logs/{name}/download` | A: console origin + auth; mutation header |

## scim

Handler: `packages/server/src/scim.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/scim/v2/databases/{database}/Users` | B: explicit bearer; no cookie |
| POST | `/tabularius/scim/v2/databases/{database}/Users` | B: explicit bearer; no cookie |
| GET | `/tabularius/scim/v2/databases/{database}/Users/{id}` | B: explicit bearer; no cookie |
| PUT | `/tabularius/scim/v2/databases/{database}/Users/{id}` | B: explicit bearer; no cookie |
| PATCH | `/tabularius/scim/v2/databases/{database}/Users/{id}` | B: explicit bearer; no cookie |
| DELETE | `/tabularius/scim/v2/databases/{database}/Users/{id}` | B: explicit bearer; no cookie |
| GET | `/tabularius/scim/v2/databases/{database}/Groups` | B: explicit bearer; no cookie |
| POST | `/tabularius/scim/v2/databases/{database}/Groups` | B: explicit bearer; no cookie |
| GET | `/tabularius/scim/v2/databases/{database}/Groups/{id}` | B: explicit bearer; no cookie |
| PUT | `/tabularius/scim/v2/databases/{database}/Groups/{id}` | B: explicit bearer; no cookie |
| PATCH | `/tabularius/scim/v2/databases/{database}/Groups/{id}` | B: explicit bearer; no cookie |
| DELETE | `/tabularius/scim/v2/databases/{database}/Groups/{id}` | B: explicit bearer; no cookie |
| GET | `/tabularius/scim/v2/databases/{database}/{discovery}` | B: explicit bearer; no cookie |
| GET | `/tabularius/admin/v1/scim` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/scim/token` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/scim/token` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/scim/settings` | A: console origin + auth; mutation header |

## admin-sync

Handler: `packages/server/src/admin.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/admin/v1/sync` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/sync/{database}` | A: console origin + auth; mutation header |
| PUT | `/tabularius/admin/v1/sync/{database}` | A: console origin + auth; mutation header |
| DELETE | `/tabularius/admin/v1/sync/{database}` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/sync/{database}/check` | A: console origin + auth; mutation header |
| POST | `/tabularius/admin/v1/sync/{database}/apply` | A: console origin + auth; mutation header |
| GET | `/tabularius/admin/v1/sync/{database}/log` | A: console origin + auth; mutation header |

## server

Handler: `packages/server/src/index.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/health` | P: public shell/static/discovery |
| GET | `/tabularius/containers/{database}/{id}/{name}` | U: signed URL capability |
| HEAD | `/tabularius/containers/{database}/{id}/{name}` | U: signed URL capability |
| GET | `/docs` | P: public shell/static/discovery |
| GET | `/docs/{guide}` | P: public shell/static/discovery |
| GET | `/` | P: public shell/static/discovery |

## mcp

Handler: `packages/server/src/index.ts`, `packages/server/src/mcp-tokens.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/mcp` | M: MCP origin allow-list + auth/local Host |

## local-tls

Handler: `packages/server/src/local-tls.ts`, `packages/server/src/index.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/tls/` | P: public shell/static/discovery |
| GET | `/tabularius/tls/ca.cer` | P: public shell/static/discovery |
| GET | `/tabularius/tls/tabularius.mobileconfig` | P: public shell/static/discovery |

## acme

Handler: `packages/server/src/acme.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/.well-known/acme-challenge/{token}` | P: public shell/static/discovery |

## admin-api

Handler: `packages/server/src/adminapi.ts`, `packages/server/src/index.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| POST | `/fmi/admin/api/v2/user/auth` | A: origin + Basic |
| DELETE | `/fmi/admin/api/v2/user/auth` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/server/metadata` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/server/status` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/server/status` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/server/config/blocknewusers` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/server/config/blocknewusers` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/server/config/{setting}` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/server/config/{setting}` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/server/certificate/csr` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/server/certificate/import` | B: explicit bearer; no cookie |
| DELETE | `/fmi/admin/api/v2/server/certificate/delete` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/php/config` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/plugins` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/databases` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/databases` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/databases/{id}` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/clients` | B: explicit bearer; no cookie |
| DELETE | `/fmi/admin/api/v2/clients/{id}` | B: explicit bearer; no cookie |
| POST | `/fmi/admin/api/v2/clients/{id}/message` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/schedules` | B: explicit bearer; no cookie |
| POST | `/fmi/admin/api/v2/schedules` | B: explicit bearer; no cookie |
| POST | `/fmi/admin/api/v2/schedules/{type}` | B: explicit bearer; no cookie |
| GET | `/fmi/admin/api/v2/schedules/{id}` | B: explicit bearer; no cookie |
| PATCH | `/fmi/admin/api/v2/schedules/{id}` | B: explicit bearer; no cookie |
| DELETE | `/fmi/admin/api/v2/schedules/{id}` | B: explicit bearer; no cookie |

## replication

Handler: `packages/server/src/replication.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/replication/v1/files` | B: explicit bearer; no cookie |
| GET | `/tabularius/replication/v1/files/{database}/copy` | B: explicit bearer; no cookie |
| GET | `/tabularius/replication/v1/files/{database}/changes` | B: explicit bearer; no cookie |

## oidc

Handler: `packages/server/src/oidc.ts`, `packages/server/src/index.ts`.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/tabularius/auth/v1/providers` | O: public discovery / OIDC state + PKCE |
| GET | `/tabularius/auth/v1/oidc/start/{provider}` | O: public discovery / OIDC state + PKCE |
| GET | `/tabularius/auth/v1/oidc/callback` | O: public discovery / OIDC state + PKCE |
| POST | `/tabularius/auth/v1/oidc/callback` | O: public discovery / OIDC state + PKCE |
| GET | `/fmws/oauthproviderinfo` | O: public discovery / OIDC state + PKCE |
| GET | `/oauth/getoauthurl` | O: public discovery / OIDC state + PKCE |

## Source supplements

OAuthServer.handle and MCP transport methods are not fully represented by the route table. These additional entries were read directly from `oauth.ts` and `index.ts`. The OAuth discovery handler also answers non-OPTIONS methods with the same public metadata; they do not change account state. Unsupported methods on other routes are denied or return public/static responses.

| Method | Route | Credential / invariant |
| --- | --- | --- |
| GET | `/.well-known/oauth-protected-resource` | P: credentialless wildcard CORS discovery |
| GET | `/.well-known/oauth-protected-resource/mcp` | P: credentialless wildcard CORS discovery |
| GET | `/.well-known/oauth-authorization-server` | P: credentialless wildcard CORS discovery |
| GET | `/.well-known/oauth-authorization-server/mcp` | P: credentialless wildcard CORS discovery |
| POST | `/oauth/register` | O: public client registration; no cookie authority |
| GET | `/oauth/authorize` | O: sign-in page / OIDC initiation; no ambient account grant |
| POST | `/oauth/authorize` | A/O: same-origin + explicit account proof + PKCE binding |
| POST | `/oauth/token` | O: code + verifier or refresh token; no cookie authority |
| POST | `/oauth/revoke` | O: possession of token; no cookie authority |
| OPTIONS | `/oauth/* and /.well-known/oauth-*` | P: wildcard; GET, POST; content-type, authorization; max-age 600; no credentials |
| GET | `/mcp` | M: authenticated SSE transport; no cookie authority |
| DELETE | `/mcp` | M: transport operation; same origin/auth gates as POST |
| OPTIONS | `/mcp` | M: same origin/auth gates; no CORS grant |

Legacy `/openhbam/` aliases are canonicalized by `legacy-request.ts` before the shared origin guard; they are not independent exemptions. HTTP upgrades (including WebSocket) and CONNECT receive 400 in `edge-limits.ts`.
