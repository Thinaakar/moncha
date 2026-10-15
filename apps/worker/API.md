# Moncha Backend API

Every endpoint served by the backend (35 in total). Endpoints 1 to 19 were captured from the live deployment on
2026-10-03 (50 of 50 full test cases, 26 of 26 re-checks after the audit changes, and 22 of 22 auth cases passed).
Endpoints 20 to 26 and `queue=ALL` were added on 2026-10-05 and tested against the local API on the dev database
(34 of 34 cases passed). Endpoints 27 to 29 (review actions) were added on 2026-10-05 and tested against the local
API on the dev database (27 of 27 cases passed), see [Test report](#test-report). Endpoints 30 to 35 (website
copies) were added on 2026-10-08.

- **Base URL (deployed):** `https://moncha-backend.vinothjv4-tech.workers.dev`
- **Base URL (local):** `http://localhost:4000` (`pnpm --filter @moncha/worker api`), see [Local API differences](#local-api-differences)
- **Database:** Neon `dev` branch
- **Format:** JSON in, JSON out (`content-type: application/json; charset=utf-8`)
- **Postman:** [`apps/worker/postman/moncha-worker-api.postman_collection.json`](postman/moncha-worker-api.postman_collection.json)

## Contents

- [Summary of all endpoints](#summary-of-all-endpoints)
- [Common rules](#common-rules) (headers, errors, status codes, CORS)
- [Service](#service): `GET /`, `GET /health`
- [Schedules](#schedules): list, create, delete one, delete by country, run history
- [Discovery and jobs](#discovery-and-jobs): start a country crawl, get job status
- [Leads](#leads): list, counts, get one, create, re-audit
- [Auth](#auth): login (admin emails from env only), logout, current user, update profile
- [Source imports](#source-imports): CSV import and import status
- [Worker health](#worker-health): is the background worker running
- [Reviews](#reviews): list review tasks, get one, resolve one (confirm, mark chatbot, re-audit)
- [Website copies](#website-copies): copy a lead's homepage, list copies, get one, view source, stored files, queue, cancel, GitHub push, Worker deploy, copy progress
- [Copy automation](#copy-automation): queue copies for new qualified leads after each country crawl
- [Lead bots](#lead-bots): a MonCha demo bot per lead, created and trained on the lead's website before it is copied
- [How a lead's queue is decided](#how-a-leads-queue-is-decided)
- [Enums](#enums)
- [Background processing](#background-processing)
- [Local API differences](#local-api-differences)
- [Test report](#test-report)

---

## Summary of all endpoints

| # | Method | Endpoint | CRUD | What it does | Success | Tables |
|---|---|---|---|---|---|---|
| 1 | GET | `/` | Read | Service index | 200 | none |
| 2 | GET | `/health` | Read | Health, database and worker check | 200 | WorkerHeartbeat, JobRun (read) |
| 3 | OPTIONS | any path | n/a | CORS preflight | 204 | none |
| 4 | GET | `/api/v1/schedules` | Read | List daily schedules, grouped by country | 200 | DiscoverySchedule |
| 5 | POST | `/api/v1/schedules` | Create | Add a daily run time for a country | 201 | DiscoverySchedule |
| 6 | DELETE | `/api/v1/schedules/:id` | Delete | Remove one schedule time | 200 | DiscoverySchedule |
| 7 | DELETE | `/api/v1/schedules?country=` | Delete | Remove all schedule times of a country | 200 | DiscoverySchedule |
| 8 | GET | `/api/v1/schedules/runs` | Read | Country crawl run history | 200 | JobRun |
| 9 | POST | `/api/v1/discovery/country` | Create | Queue a country crawl now | 202 | JobRun |
| 9a | GET | `/api/v1/discovery/options` | Read | Supported countries, search areas, industries and defaults | 200 | none |
| 10 | GET | `/api/v1/jobs/:id` | Read | Status of any background job | 200 | JobRun |
| 10a | GET | `/api/v1/jobs` | Read | Paginated list of background jobs | 200 | JobRun |
| 11 | GET | `/api/v1/leads` | Read | Paginated lead list with filters | 200 | Lead, Company, Website |
| 11a | GET | `/api/v1/leads/export` | Read | Every lead matching the filters as a CSV file | 200 | Lead, Company, Website, SourceRecord |
| 12 | GET | `/api/v1/leads/counts` | Read | Number of leads per queue | 200 | Lead |
| 13 | GET | `/api/v1/leads/:id` | Read | One lead with company and website | 200 | Lead, Company, Website |
| 14 | POST | `/api/v1/leads` | Create (or Update if duplicate) | Add a lead manually | 201 / 200 | Company, SourceRecord, Lead, Website, JobRun |
| 15 | POST | `/api/v1/leads/:id/audit` | Create + Update | Queue a website re-audit for a lead | 202 | Lead, Website, JobRun |
| 17 | POST | `/api/v1/auth/login` | Create | Sign in as one of the `MONCHA_LEAD_ADMIN_USERS`, get a token | 200 | User, Session |
| 18 | POST | `/api/v1/auth/logout` | Update | Sign out (revoke the token) | 200 | Session |
| 19 | GET | `/api/v1/auth/me` | Read | The signed-in user | 200 | Session, User |
| 20 | PATCH | `/api/v1/auth/me` | Update | Change the signed-in user's name | 200 | Session, User |
| 24 | POST | `/api/v1/source-imports` | Create | Import companies from a CSV | 202 | JobRun, Company, SourceRecord, Lead, Website |
| 25 | GET | `/api/v1/source-imports/:id` | Read | Status and result of an import | 200 | JobRun |
| 26 | GET | `/api/v1/worker/health` | Read | Is the background worker running | 200 | WorkerHeartbeat, JobRun |
| 27 | GET | `/api/v1/reviews` | Read | Review tasks (default: open) with lead, company and audit | 200 | ReviewTask, Lead, Company, Website, WebsiteAudit |
| 28 | GET | `/api/v1/reviews/:id` | Read | One review task | 200 | ReviewTask |
| 29 | POST | `/api/v1/reviews/:id/resolve` | Update | Apply a human decision to a `NEEDS_REVIEW` lead | 200 | ReviewTask, Lead, AuditLog, Website, JobRun |
| 30 | POST | `/api/v1/leads/:id/site-snapshots` | Create | Queue a website copy of a lead's homepage (editor session) | 202 / 200 | SiteSnapshot, JobRun |
| 31 | GET | `/api/v1/leads/:id/site-snapshots` | Read | Website copies of one lead | 200 | SiteSnapshot |
| 32 | GET | `/api/v1/site-snapshots` | Read | Paginated website copies | 200 | SiteSnapshot, Lead, Company |
| 33 | GET | `/api/v1/site-snapshots/:id` | Read | One website copy with brand, file links and manifest | 200 | SiteSnapshot (+ R2) |
| 34 | GET | `/api/v1/site-snapshots/:id/source` | Read | `source.html` decoded for View source | 200 | SiteSnapshot (+ R2) |
| 35 | GET | `/api/v1/site-files/:token/*path` | Read | One stored file, token-gated (preview iframe) | 200 | none (R2) |
| 36 | GET | `/api/v1/site-snapshots/queue` | Read | Website copy queue in run order, with start estimates | 200 | SiteSnapshot, JobRun |
| 36a | GET | `/api/v1/site-pipeline` | Read | The website being copied, pushed or deployed now, and whether the pipeline is paused | 200 | SiteSnapshot, JobRun |
| 37 | POST | `/api/v1/site-snapshots/:id/cancel` | Update | Cancel a copy that has not started (editor session) | 200 | SiteSnapshot, JobRun |
| 38 | GET | `/api/v1/site-automation` | Read | Copy automation settings and today's count | 200 | SiteAutomationSettings, SiteAutomationCrawl, SiteSnapshot |
| 39 | PUT | `/api/v1/site-automation` | Update | Turn copy automation on or off (editor session) | 200 | SiteAutomationSettings |
| 40 | GET | `/api/v1/site-automation/crawls` | Read | Crawls followed by the automation and their copies | 200 | SiteAutomationCrawl, JobRun, SiteSnapshot |
| 41 | POST | `/api/v1/site-snapshots/:id/github-push` | Update | Push a finished copy to its website's own GitHub repo now (editor session) | 202 | SiteSnapshot |
| 41a | GET | `/api/v1/site-automation/github-check` | Read | Check the GitHub connection for the site repos (editor session) | 200 | - |
| 41c | POST | `/api/v1/site-snapshots/:id/deploy` | Update | Deploy a finished copy to its website's own Cloudflare Worker now (editor session) | 202 | SiteSnapshot |
| 41d | GET | `/api/v1/site-automation/deploy-check` | Read | Check the Cloudflare Workers connection (editor session) | 200 | - |
| 41e | GET | `/api/v1/site-automation/moncha-check` | Read | Check the MonCha internal lead API key with `GET /slots` (editor session) | 200 | - |
| 42 | GET | `/api/v1/lead-bots` | Read | Paginated lead bots with counts per status | 200 | LeadBot, Lead, Company |
| 43 | GET | `/api/v1/leads/:id/bot` | Read | One lead's MonCha bot (IDs and the full `POST /bots` response) | 200 | LeadBot |
| 44 | POST | `/api/v1/leads/:id/bot` | Create | Create the lead's bot now (editor session) | 201 / 200 | LeadBot, Lead |
| 45 | POST | `/api/v1/leads/:id/bot/retry` | Update | Retry a failed bot or training and queue the lead's copy again (editor session) | 200 | LeadBot, Lead, SiteSnapshot, JobRun |
| 46 | POST | `/api/v1/leads/:id/bot/train` | Update | Discover and train the bot on the lead's website now, or poll its training (editor session) | 202 / 200 | LeadBot |

The only PATCH is #20. To change a schedule time, delete the old one (#6) and create the new one (#5).

---

## Common rules

### Request headers

| Header | Required | Description |
|---|---|---|
| `content-type: application/json` | For POST with a body | Body must be valid JSON. An empty body is treated as `{}`. |
| `authorization: Bearer <token>` | For `/api/v1/auth/logout`, `/api/v1/auth/me` (GET and PATCH) and the editor-session website copy endpoints; optional on `/api/v1/reviews/:id/resolve` | Token from login. On resolve it records who decided. Other endpoints do not check it yet. |
| `x-tenant-id` | No | Tenant to read and write. Default: `tenant_moncha_internal` (`DEFAULT_TENANT_ID`). |
| `x-api-key` | Only if `WORKER_API_KEY` is set on the server | Currently **not** set on the deployed backend, so it is not needed. |

### Error format

Every error has the same shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request",
    "details": { "formErrors": [], "fieldErrors": { "time": ["Use 24-hour HH:mm"] } }
  }
}
```

`details` is only present for field validation errors.

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | Missing or invalid field, invalid JSON body, unsupported country, unknown time zone, CSV without rows |
| 400 | `unsupported_source` | Source import with a source other than `csv` |
| 401 | `unauthorized` | Wrong email or password; missing, expired or logged-out token; a token of a user no longer in `MONCHA_LEAD_ADMIN_USERS`; or wrong `x-api-key` (only when `WORKER_API_KEY` is set) |
| 403 | `forbidden` | Resolve review: the bearer token belongs to a user of another tenant |
| 404 | `not_found` | Unknown route, or the schedule, job, lead, import or review task does not exist |
| 405 | `method_not_allowed` | Local API only: known path, wrong method (deployed returns 404) |
| 409 | `conflict` | Schedule already exists for that country and time, or the review task is already resolved |
| 413 | `too_many_rows` | CSV with more than 20,000 rows |
| 413 | `payload_too_large` | Local API only: body larger than 10 MB |
| 500 | `internal_error` | Unexpected server error |
| 503 | `configuration_error` | `DATABASE_URL` is not set on the server |
| 503 | `service_unavailable` | Login when `MONCHA_LEAD_ADMIN_USERS` or `MONCHA_LEAD_ADMIN_PASSWORD` is not set on the server |

Unknown routes (and unsupported methods on known paths) return:

```json
{ "error": { "code": "not_found", "message": "No route for GET /api/v1/nope" } }
```

### CORS

All responses include CORS headers. The request `Origin` is echoed back, so any frontend origin works.

```
Access-Control-Allow-Origin: <request origin or *>
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD
Access-Control-Allow-Headers: <requested headers or Content-Type, Authorization, x-tenant-id, x-api-key>
Access-Control-Max-Age: 86400
```

### Supported countries

`Singapore (SG)`, `Malaysia (MY)`, `Japan (JP)`. Anywhere a `country` is accepted you can send the name or the
code, for example `"Singapore"` or `"SG"`.

### Dates

All timestamps are ISO 8601 in UTC, for example `2026-10-03T14:00:00.000Z`.

---

## Service

### 1. GET `/`

**CRUD:** Read. Service index.

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/
```

**200 OK**

```json
{
  "service": "moncha-backend",
  "status": "ok",
  "endpoints": [
    "/health",
    "/api/v1/auth/login",
    "/api/v1/auth/me",
    "/api/v1/schedules",
    "/api/v1/schedules/runs",
    "/api/v1/leads",
    "/api/v1/source-imports",
    "/api/v1/worker/health"
  ]
}
```

The `endpoints` list is informational only; this document is the full list.

### 2. GET `/health`

**CRUD:** Read. Checks the backend, the database connection and whether the background worker is running.

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/health
```

**200 OK** (database reachable)

```json
{
  "ok": true,
  "db": "up",
  "tenantId": "tenant_moncha_internal",
  "countries": ["Singapore (SG)", "Malaysia (MY)", "Japan (JP)"],
  "worker": { "running": false, "status": "offline", "lastSeenAt": "2026-10-05T10:41:12.402Z" }
}
```

**503** when the database is down: `"ok": false`, `"db": "down: <reason>"`, and no `worker` field.

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` when the database answered |
| `db` | string | `"up"` or `"down: <reason>"` |
| `tenantId` | string | Tenant used for this request |
| `countries` | string[] | Countries the crawler supports |
| `worker` | object | Short worker status. `ok` does not depend on it. Full details: [`GET /api/v1/worker/health`](#26-get-apiv1workerhealth) |

---

## Schedules

A schedule is one daily run time for one country. A country can have several times per day. When a time is due,
the background worker starts a country crawl (see [Background processing](#background-processing)).

**Schedule object**

| Field | Type | Description |
|---|---|---|
| `id` | string | Schedule id |
| `countryCode` | string | `SG`, `MY` or `JP` |
| `country` | string | Country name |
| `time` | string | Local time `HH:mm` (24-hour) |
| `timezone` | string | IANA time zone, for example `Asia/Kuala_Lumpur` |
| `nextRunAt` | string | Next run in UTC |
| `nextRunDay` | string | `"today"`, `"tomorrow"` or `YYYY-MM-DD` in the schedule's time zone |
| `lastRunAt` | string \| null | Last time it started a run |

### 4. GET `/api/v1/schedules`

**CRUD:** Read. All schedules, grouped by country (sorted by country name, then time).

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/schedules
```

**200 OK**

```json
{
  "countries": [
    {
      "countryCode": "JP",
      "country": "Japan",
      "timesPerDay": 2,
      "schedules": [
        {
          "id": "sched_9ff62537650f48b5",
          "countryCode": "JP",
          "country": "Japan",
          "time": "09:15",
          "timezone": "Asia/Tokyo",
          "nextRunAt": "2026-10-04T00:15:00.000Z",
          "nextRunDay": "tomorrow",
          "lastRunAt": null
        },
        {
          "id": "sched_908b52bfda9d4422",
          "countryCode": "JP",
          "country": "Japan",
          "time": "21:45",
          "timezone": "Asia/Tokyo",
          "nextRunAt": "2026-10-03T12:45:00.000Z",
          "nextRunDay": "today",
          "lastRunAt": null
        }
      ]
    },
    {
      "countryCode": "SG",
      "country": "Singapore",
      "timesPerDay": 1,
      "schedules": [
        {
          "id": "sched_86698cf497e64b0c",
          "countryCode": "SG",
          "country": "Singapore",
          "time": "22:00",
          "timezone": "Asia/Kuala_Lumpur",
          "nextRunAt": "2026-10-03T14:00:00.000Z",
          "nextRunDay": "today",
          "lastRunAt": null
        }
      ]
    }
  ]
}
```

With no schedules: `{ "countries": [] }`.

### 5. POST `/api/v1/schedules`

**CRUD:** Create. Adds one daily run time.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `country` | string | Yes | Supported country name or code |
| `time` | string | Yes | 24-hour `HH:mm`, `00:00` to `23:59` (`9:00` is rejected, use `09:00`) |
| `timezone` | string | No | IANA zone. Default `Asia/Kuala_Lumpur` (same clock as Singapore, UTC+8) |

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/schedules \
  -H "content-type: application/json" \
  -d '{ "country": "Singapore", "time": "22:00" }'
```

**201 Created** (a schedule object)

```json
{
  "id": "sched_86698cf497e64b0c",
  "countryCode": "SG",
  "country": "Singapore",
  "time": "22:00",
  "timezone": "Asia/Kuala_Lumpur",
  "nextRunAt": "2026-10-03T14:00:00.000Z",
  "nextRunDay": "today",
  "lastRunAt": null
}
```

**Errors**

| Status | Example message |
|---|---|
| 400 | `fieldErrors.time: ["Use 24-hour HH:mm"]` |
| 400 | `Unsupported country "France". Supported: Singapore (SG), Malaysia (MY), Japan (JP)` |
| 400 | `Unknown time zone "Mars/Base"` |
| 400 | `Invalid JSON body` |
| 409 | `Singapore is already scheduled at 22:00` |

### 6. DELETE `/api/v1/schedules/:id`

**CRUD:** Delete. Removes one schedule time.

```bash
curl -X DELETE https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/schedules/sched_86698cf497e64b0c
```

**200 OK**

```json
{ "deleted": 1 }
```

**404** `{ "error": { "code": "not_found", "message": "Schedule not found" } }`

### 7. DELETE `/api/v1/schedules?country=<country>`

**CRUD:** Delete. Removes every schedule time of one country.

| Query | Required | Description |
|---|---|---|
| `country` | Yes | Supported country name or code |

```bash
curl -X DELETE "https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/schedules?country=Japan"
```

**200 OK** (`deleted` is the number removed, can be `0`)

```json
{ "deleted": 2 }
```

**400** when `country` is missing (`fieldErrors.country`) or unsupported.

### 8. GET `/api/v1/schedules/runs`

**CRUD:** Read. History of country crawls (scheduled and manual), newest first.

| Query | Required | Default | Rules |
|---|---|---|---|
| `limit` | No | 50 | Integer 1 to 200 |

```bash
curl "https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/schedules/runs?limit=2"
```

**200 OK**

```json
{
  "runs": [
    {
      "id": "job_f77ffd5d69b4467b",
      "day": "2026-10-03",
      "countryCode": "SG",
      "country": "Singapore",
      "time": "13:11",
      "timezone": "Asia/Kuala_Lumpur",
      "trigger": "manual",
      "status": "pending",
      "found": 0,
      "saved": 0,
      "skipped": 0,
      "stoppedReason": null,
      "error": null,
      "startedAt": null,
      "finishedAt": null
    },
    {
      "id": "cmumkan1n0003g5z8wmghre8k",
      "day": "2026-09-29",
      "countryCode": "SG",
      "country": "Singapore",
      "time": "18:57",
      "timezone": "Asia/Kuala_Lumpur",
      "trigger": "schedule",
      "status": "done",
      "found": 60,
      "saved": 57,
      "skipped": 3,
      "stoppedReason": "run_budget_reached",
      "error": null,
      "startedAt": "2026-09-29T10:57:05.060Z",
      "finishedAt": "2026-09-29T10:57:44.906Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Job id (use with `GET /api/v1/jobs/:id`) |
| `day` | string | Local date of the run, `YYYY-MM-DD` |
| `time` | string | Local time of the run, `HH:mm` |
| `trigger` | string | `schedule` (from a schedule) or `manual` (from `POST /api/v1/discovery/country`) |
| `status` | string | `pending`, `running`, `done`, `failed` |
| `found` | number | Places found |
| `saved` | number | New leads saved |
| `skipped` | number | Already in the database |
| `stoppedReason` | string \| null | Why the run stopped, for example `run_budget_reached` |
| `error` | string \| null | Last error message |
| `startedAt`, `finishedAt` | string \| null | UTC timestamps |

**400** when `limit` is outside 1 to 200.

---

## Discovery and jobs

### 9. POST `/api/v1/discovery/country`

**CRUD:** Create. Queues a country-wide crawl (Google Places across the country's cities and industries).
Returns immediately; the background worker runs it.

**Body**

| Field | Type | Required | Default | Rules |
|---|---|---|---|---|
| `country` | string | Yes | | Supported country name or code |
| `source` | string | No | `google_places` | Only `google_places` |
| `cities` | string[] | No | All search areas of the country | At least 1 item if sent |
| `industries` | string[] | No | Built-in industry list | At least 1 item if sent |
| `maxPages` | number | No | 3 | Integer 1 to 3 (result pages per search) |
| `maxSearches` | number | No | Server budget | Integer ≥ 1 |
| `maxCallsPerDay` | number | No | Server budget (500) | Integer ≥ 1 |
| `reset` | boolean | No | `false` | Restart the country crawl from the beginning |

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/discovery/country \
  -H "content-type: application/json" \
  -d '{ "country": "Singapore", "cities": ["Singapore"], "industries": ["dental clinic"], "maxPages": 1 }'
```

**202 Accepted**

```json
{ "id": "job_453a40d1336341e3", "status": "pending", "type": "country_discovery" }
```

**400** when `country` is missing or unsupported, or `maxPages` is above 3.

### 9a. GET `/api/v1/discovery/options`

**CRUD:** Read. Everything a client needs to build the country crawl and schedule forms. No database access.

**200 OK**

```json
{
  "countries": [{ "code": "SG", "name": "Singapore", "cities": ["Bedok", "Jurong West", "..."] }],
  "industries": ["dental clinic", "..."],
  "defaults": { "source": "google_places", "maxPages": 3, "timezone": "Asia/Kuala_Lumpur" }
}
```

### 10a. GET `/api/v1/jobs`

**CRUD:** Read. Background jobs of the tenant, newest first.

| Query | Type | Default | Rules |
|---|---|---|---|
| `page` | number | 1 | Integer ≥ 1 |
| `pageSize` | number | 25 | Integer 1 to 100 |
| `type` | string | all | `country_discovery`, `website_audit`, `csv_import`, `places_discovery`, `site_snapshot` |
| `status` | string | all | `pending`, `running`, `done`, `failed` |
| `origin` | string | all | `auto` or `manual`; returns website copy jobs only. Copies without `payload.origin` count as `manual` |
| `deploy` | string | all | Website copy jobs only, by where the whole pipeline (copy, GitHub push, Worker deploy) stands. See below |

`deploy` buckets (each website copy job lands in exactly one):

| Value | Meaning |
|---|---|
| `live` | The Worker is deployed (`workerStatus = deployed`) |
| `problem` | Not live, and the copy failed, or the GitHub push or Worker deploy failed or is retrying after an error |
| `in_progress` | Not live, no problem, and the copy, push or deploy is still queued or running |
| `not_deployed` | The copy is done but a Worker deploy was never queued |

**200 OK** `{ "items": Job[], "total": 2, "page": 1, "pageSize": 25, "totalPages": 1 }`

Each item has `id, type, status, payload, result, attempts, maxAttempts, runAfter, lastError, startedAt,
finishedAt, createdAt`. A queued CSV import's `payload.records` (the raw rows) is left out to keep the list small.

A `site_snapshot` job also has `site`: the copy it produced as a `SiteSnapshotSummary` (same shape as
`GET /api/v1/site-snapshots` items, including `github` and `deploy` with `status`, `error`, `nextAt` and the
live `deploy.url`), or `null` when the copy row is gone. Errors are `"code: message"`. Other job types have no `site`.

When GitHub or Cloudflare is configured, a `site_snapshot` job stays `running` after the copy until the website is
live (`done`, with `result.liveUrl` and `result.githubRepo`) or a publish step gave up (`failed`, with `lastError`
`GitHub push failed: …` or `Deploy failed: …`). See #36a.

**400** when `type`, `status`, `origin`, `deploy`, `page` or `pageSize` is invalid.

### 10. GET `/api/v1/jobs/:id`

**CRUD:** Read. Status of any background job (country crawl or website audit).

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/jobs/job_453a40d1336341e3
```

**200 OK**

```json
{
  "id": "job_453a40d1336341e3",
  "tenantId": "tenant_moncha_internal",
  "type": "country_discovery",
  "status": "pending",
  "payload": {
    "mode": "country",
    "reset": false,
    "cities": ["Singapore"],
    "origin": "manual",
    "country": "Singapore",
    "maxPages": 1,
    "industries": ["dental clinic"],
    "countryCode": "SG",
    "maxSearches": 1,
    "maxCallsPerDay": 1
  },
  "result": null,
  "attempts": 0,
  "maxAttempts": 1,
  "runAfter": "2026-10-03T05:13:16.824Z",
  "lockedAt": null,
  "lockedBy": null,
  "lastError": null,
  "dedupeKey": null,
  "startedAt": null,
  "finishedAt": null,
  "createdAt": "2026-10-03T05:13:16.952Z"
}
```

| Field | Type | Description |
|---|---|---|
| `type` | string | `country_discovery`, `website_audit`, `places_discovery`, `csv_import` |
| `status` | string | `pending` → `running` → `done` or `failed` |
| `payload` | object | Job input. Country crawl: as above. Website audit: `{ leadId, companyId, url, force }` |
| `result` | object \| null | Job output when finished. Country crawl: `{ found, created, duplicates, stoppedReason, calls, ... }` |
| `attempts` / `maxAttempts` | number | Tries so far / allowed |
| `runAfter` | string | Earliest time the worker may pick it up |
| `lockedAt` / `lockedBy` | string \| null | Set while a worker holds the job |
| `lastError` | string \| null | Last failure message |
| `dedupeKey` | string \| null | Prevents duplicate jobs |

**404** `{ "error": { "code": "not_found", "message": "Job not found" } }`

---

## Leads

**Lead object** (list items and `GET /api/v1/leads/:id`)

```json
{
  "id": "cmugv7jqx000hg5b0ptdja5hp",
  "tenantId": "tenant_moncha_internal",
  "companyId": "cmugv7fk4000dg5b0vdvcbsmj",
  "queue": "QUALIFIED",
  "assistantVerdict": "NO_ASSISTANT",
  "assistantVendor": null,
  "qualificationReason": "no_assistant_high_confidence",
  "latestAuditId": "cmukorq5p00fsg5b8qkda1b5q",
  "version": 3,
  "createdAt": "2026-09-25T11:15:59.289Z",
  "updatedAt": "2026-09-28T03:26:56.210Z",
  "company": {
    "id": "cmugv7fk4000dg5b0vdvcbsmj",
    "tenantId": "tenant_moncha_internal",
    "name": "Straits Dental Group Orchard",
    "domain": "straitsdental.com",
    "country": "Singapore",
    "city": "Singapore",
    "phone": "+65 6235 4686",
    "address": "360 Orchard Rd, #04-01 International Building, Singapore 238869",
    "website": {
      "id": "cmugv7n1p000jg5b0lbeqapq3",
      "tenantId": "tenant_moncha_internal",
      "companyId": "cmugv7fk4000dg5b0vdvcbsmj",
      "url": "https://straitsdental.com",
      "canonicalUrl": null,
      "status": "ACTIVE",
      "language": null,
      "finalUrl": null,
      "httpStatus": null,
      "title": "Home | Straits Dental | Orchard | Tai Seng | Raffles Place",
      "latestAuditId": null,
      "lastCheckedAt": null
    },
    "sourceRecords": []
  }
}
```

| Field | Type | Description |
|---|---|---|
| `queue` | string | Lead queue, see [Enums](#enums). `QUALIFIED` means no chatbot found: a sales lead |
| `assistantVerdict` | string \| null | Audit result; `null` until the first audit finishes |
| `assistantVendor` | string \| null | Chatbot vendor if one was found |
| `qualificationReason` | string \| null | Why it is in this queue, for example `no_assistant_high_confidence`, `no_website`, `pending_audit` |
| `latestAuditId` | string \| null | Last website audit |
| `version` | number | Increases on every audit update |
| `company.website` | object \| null | `null` when the company has no website |

On the deployed backend, `company.website` only fills `id`, `url`, `status` and `title`; the other website
fields are `null`, and `sourceRecords` is always `[]`.

### 11. GET `/api/v1/leads`

**CRUD:** Read. Paginated lead list, newest first.

| Query | Required | Default | Rules |
|---|---|---|---|
| `queue` | No | `QUALIFIED` | One of the lead queues, or `ALL` for every lead whatever its queue (upper case only) |
| `page` | No | 1 | Integer ≥ 1 |
| `pageSize` | No | 25 | Integer 1 to 100 |
| `search` | No | | Matches company name or domain (contains, case-insensitive) |
| `country` | No | | Exact company country, for example `Singapore` |

```bash
curl "https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads?queue=QUALIFIED&page=1&pageSize=25&search=dental&country=Singapore"
```

**200 OK**

```json
{
  "items": [ { "...": "lead object" } ],
  "total": 100,
  "page": 1,
  "pageSize": 25,
  "totalPages": 4
}
```

`totalPages` is `0` when `total` is `0`.

With `queue=ALL` the list holds leads from every queue (pending, qualified, has assistant, no website, needs review
and inactive), and `OMIT_CHATBOT_SITES` is not applied. Without `queue` the default is still `QUALIFIED`, so
existing callers are unchanged.

```bash
curl "https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads?queue=ALL&page=1&pageSize=25"
```

**400** for an invalid `queue`, `page` below 1, or `pageSize` above 100:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request",
    "details": {
      "formErrors": [],
      "fieldErrors": {
        "queue": ["Invalid option: expected one of \"PENDING_AUDIT\"|\"QUALIFIED\"|\"HAS_ASSISTANT\"|\"NO_WEBSITE\"|\"NEEDS_REVIEW\"|\"INACTIVE\""]
      }
    }
  }
}
```

### 11a. GET `/api/v1/leads/export`

**CRUD:** Read. Every lead that matches the filters, as one CSV file (no paging). It takes the same `queue`, `search`
and `country` as the lead list, so `queue=QUALIFIED` gives every qualified lead and `queue=ALL` every lead. The rows
are streamed newest first, in batches of 1000.

```bash
curl -o leads.csv "https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads/export?queue=QUALIFIED&country=Singapore"
```

**200 OK** with `content-type: text/csv; charset=utf-8` and
`content-disposition: attachment; filename="moncha-leads-qualified-2026-10-12.csv"`. The file starts with a UTF-8
byte order mark so Excel shows Japanese and Chinese names correctly. Columns:

`Company, Domain, Website, Phone, Address, City, Country, Queue, Assistant, Assistant vendor, Website status, Source, Reason, Added, Lead ID`

`Added` is an ISO timestamp. Cells that a spreadsheet would run as a formula (starting with `=`, `+`, `-` or `@`) get
a leading `'`, except plain phone numbers. **400** for an invalid `queue`, same as the list.

### 12. GET `/api/v1/leads/counts`

**CRUD:** Read. Number of leads in each queue (for tabs and badges).

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads/counts
```

**200 OK**

```json
{
  "PENDING_AUDIT": 0,
  "QUALIFIED": 128,
  "HAS_ASSISTANT": 7,
  "NO_WEBSITE": 76,
  "NEEDS_REVIEW": 0,
  "INACTIVE": 14,
  "openReviewTasks": 0
}
```

All six queues are always present, `0` when empty.

On the deployed backend `openReviewTasks` is always `0`.

### 13. GET `/api/v1/leads/:id`

**CRUD:** Read. One lead with its company and website (lead object above).

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads/cmugv7jqx000hg5b0ptdja5hp
```

**200 OK** → lead object. **404** `{ "error": { "code": "not_found", "message": "Lead not found" } }`

### 14. POST `/api/v1/leads`

**CRUD:** Create (or Update when the domain already exists). Adds a lead by hand.

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Company name |
| `domain` | string | No | Domain or full URL; normalized, so `https://www.example.org/` becomes `example.org` |
| `country` | string | No | |
| `city` | string | No | |
| `phone` | string | No | |
| `address` | string | No | |

**What happens**

- **New domain:** creates Company, Lead (`PENDING_AUDIT`) and Website, and queues a `website_audit` job.
  Returns **201** with `auditEnqueued: true`.
- **No domain:** creates Company and Lead (`NO_WEBSITE`, verdict `NOT_APPLICABLE`). No audit. Returns **201**.
- **Domain already exists:** does not create a new lead; fills empty company fields (country, city, phone, address)
  and returns the existing lead with **200** and `duplicate: true`.

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads \
  -H "content-type: application/json" \
  -d '{ "name": "API Docs Test Web Co", "domain": "example.org", "country": "Singapore", "city": "Singapore" }'
```

**201 Created** (new, with website)

```json
{
  "company": {
    "id": "comp_8a7352a728984f91",
    "tenantId": "tenant_moncha_internal",
    "name": "API Docs Test Web Co",
    "domain": "example.org",
    "country": "Singapore",
    "city": "Singapore",
    "phone": null,
    "address": null
  },
  "lead": {
    "id": "lead_25f6709a53cb4280",
    "tenantId": "tenant_moncha_internal",
    "companyId": "comp_8a7352a728984f91",
    "queue": "PENDING_AUDIT",
    "assistantVerdict": null,
    "assistantVendor": null,
    "qualificationReason": "pending_audit",
    "latestAuditId": null,
    "version": 1,
    "createdAt": "2026-10-03T05:13:25.582Z",
    "updatedAt": "2026-10-03T05:13:25.582Z"
  },
  "duplicate": false,
  "auditEnqueued": true
}
```

**201 Created** (new, no website): same shape with `"domain": null`, `"queue": "NO_WEBSITE"`,
`"assistantVerdict": "NOT_APPLICABLE"`, `"qualificationReason": "no_website"`, `"auditEnqueued": false`.

**200 OK** (duplicate): same shape with the existing company and lead, `"duplicate": true`, `"auditEnqueued": false`.

**400** when `name` is missing:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request",
    "details": { "formErrors": [], "fieldErrors": { "name": ["Invalid input: expected string, received undefined"] } }
  }
}
```

### 15. POST `/api/v1/leads/:id/audit`

**CRUD:** Create + Update. Queues a forced re-audit of the lead's website (sets the website status back to
`UNCHECKED` and creates a `website_audit` job). No body.

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads/cmugv7jqx000hg5b0ptdja5hp/audit
```

**202 Accepted** (new job)

```json
{ "id": "job_598f2ccec3cf4711", "status": "pending" }
```

**202 Accepted** (an audit for this lead is already pending or running; no new job)

```json
{ "id": "job_598f2ccec3cf4711", "status": "pending", "deduped": true }
```

**404** `{ "error": { "code": "not_found", "message": "Lead or its website domain not found" } }` when the lead does
not exist or has no domain.

---

## Auth

Admin-only sign-in with bearer-token sessions. The accounts are set on the server, not in the console:

- `MONCHA_LEAD_ADMIN_USERS`: the emails that can sign in, separated by commas.
- `MONCHA_LEAD_ADMIN_PASSWORD`: the one password they all use.

There is no sign-up, change password, forgot password or reset password. To add or remove a person, or change the
password, edit these variables and restart the backend.

**How it works**

1. Call **login**. It returns a `token`.
2. Store the token on the client and send it as `Authorization: Bearer <token>` on later requests.
3. Call **me** to restore the signed-in user (for example on page reload). A `401` means the token expired or was
   logged out: send the user to the login page.
4. Call **logout** to end the session. The token stops working immediately on the server.

**Rules**

- A token is valid for **7 days** (`expiresAt`). Every login creates a new, separate session, so a user can be signed
  in on several devices; logout ends only the session of the token sent.
- Accounts belong to a tenant (`x-tenant-id`, default `tenant_moncha_internal`). The same email can exist in
  different tenants. Emails are stored in lower case and matched without regard to case.
- The first login of a listed email creates its user with the role `admin`. An existing user with that email is
  promoted to `admin`. No password is stored in the database.
- A user whose email is removed from `MONCHA_LEAD_ADMIN_USERS` gets `401` on the next request, even with a token
  that has not expired.
- Tokens are stored only as SHA-256 hashes, so a database leak does not expose working tokens.
- Login gives the same `401 Invalid email or password` for an unlisted email and a wrong password, so it does not
  reveal which emails can sign in. If either variable is empty, login returns `503 service_unavailable`.
- No cookies are used: the token is returned in the JSON body. CORS already allows the `Authorization` header from
  any origin.
- The other endpoints (1 to 15) do **not** require a token yet.

**User object**

| Field | Type | Description |
|---|---|---|
| `id` | string | User id |
| `tenantId` | string | Tenant the account belongs to |
| `email` | string | Lower-case email |
| `name` | string \| null | Display name |
| `role` | string | `admin`, `operator` or `viewer` |
| `createdAt` | string | UTC timestamp |

**Session object** (returned by login)

| Field | Type | Description |
|---|---|---|
| `token` | string | Bearer token (43 characters). Shown only once; it cannot be retrieved again |
| `tokenType` | string | Always `"Bearer"` |
| `expiresAt` | string | UTC time the token stops working (7 days after sign-in) |
| `user` | object | The user object |

### 17. POST `/api/v1/auth/login`

**CRUD:** Create. Checks the email against `MONCHA_LEAD_ADMIN_USERS` and the password against
`MONCHA_LEAD_ADMIN_PASSWORD`, creates the admin user on first login, then creates a new session.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | Yes | Valid email (any case) |
| `password` | string | Yes | 1 to 128 characters |

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/auth/login \
  -H "content-type: application/json" \
  -d '{ "email": "ana@example.com", "password": "<MONCHA_LEAD_ADMIN_PASSWORD>" }'
```

**200 OK** (session object)

```json
{
  "token": "24b3TgV9cK1mQ7zR2xLp8sW4yN6aE0dJ3hU5oFiBtGk",
  "tokenType": "Bearer",
  "expiresAt": "2026-10-10T07:28:46.854Z",
  "user": {
    "id": "user_6aff46d70f004d29",
    "tenantId": "tenant_moncha_internal",
    "email": "ana@example.com",
    "name": "Ana",
    "role": "admin",
    "createdAt": "2026-10-03T07:28:41.632Z"
  }
}
```

**Errors**

| Status | Example |
|---|---|
| 400 | `fieldErrors.password: ["Invalid input: expected string, received undefined"]` |
| 401 | `{ "error": { "code": "unauthorized", "message": "Invalid email or password" } }` (unlisted email or wrong password) |
| 503 | `{ "error": { "code": "service_unavailable", "message": "Admin login is not configured on the server" } }` |

### 18. POST `/api/v1/auth/logout`

**CRUD:** Update. Marks the session as revoked (`revokedAt`); the token stops working at once. No body.

| Header | Required |
|---|---|
| `authorization: Bearer <token>` | Yes |

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/auth/logout \
  -H "authorization: Bearer 24b3TgV9cK1mQ7zR2xLp8sW4yN6aE0dJ3hU5oFiBtGk"
```

**200 OK**

```json
{ "ok": true }
```

Logout is safe to repeat: an expired, unknown or already logged-out token also returns `200 { "ok": true }`.

**401** when the header is missing:

```json
{ "error": { "code": "unauthorized", "message": "Missing Authorization: Bearer <token> header" } }
```

### 19. GET `/api/v1/auth/me`

**CRUD:** Read. Returns the user of the token.

| Header | Required |
|---|---|
| `authorization: Bearer <token>` | Yes |

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/auth/me \
  -H "authorization: Bearer 24b3TgV9cK1mQ7zR2xLp8sW4yN6aE0dJ3hU5oFiBtGk"
```

**200 OK**

```json
{
  "user": {
    "id": "user_6aff46d70f004d29",
    "tenantId": "tenant_moncha_internal",
    "email": "ana@example.com",
    "name": "Ana",
    "role": "admin",
    "createdAt": "2026-10-03T07:28:41.632Z"
  }
}
```

**401**

| When | `message` |
|---|---|
| No `Authorization` header | `Missing Authorization: Bearer <token> header` |
| Token unknown, expired or logged out | `Session expired or logged out` |
| Email removed from `MONCHA_LEAD_ADMIN_USERS` | `This account no longer has access` |

**Frontend example**

```ts
const API = 'https://moncha-backend.vinothjv4-tech.workers.dev';

// Login
const res = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) throw new Error((await res.json()).error.message);
const { token, user } = await res.json();
localStorage.setItem('moncha_token', token);

// Current user (on page load)
const me = await fetch(`${API}/api/v1/auth/me`, {
  headers: { authorization: `Bearer ${localStorage.getItem('moncha_token')}` },
});
if (me.status === 401) {/* go to login */}

// Logout
await fetch(`${API}/api/v1/auth/logout`, {
  method: 'POST',
  headers: { authorization: `Bearer ${localStorage.getItem('moncha_token')}` },
});
localStorage.removeItem('moncha_token');
```

### 20. PATCH `/api/v1/auth/me`

**CRUD:** Update. Changes the signed-in user's display name.

| Header | Required |
|---|---|
| `authorization: Bearer <token>` | Yes |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | Yes | 1 to 100 characters after trimming spaces |

```bash
curl -X PATCH https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/auth/me \
  -H "authorization: Bearer 24b3TgV9cK1mQ7zR2xLp8sW4yN6aE0dJ3hU5oFiBtGk" \
  -H "content-type: application/json" \
  -d '{ "name": "Ana Tan" }'
```

**200 OK** (same shape as `GET /api/v1/auth/me`, with the new name)

```json
{
  "user": {
    "id": "user_6aff46d70f004d29",
    "tenantId": "tenant_moncha_internal",
    "email": "ana@example.com",
    "name": "Ana Tan",
    "role": "admin",
    "createdAt": "2026-10-03T07:28:41.632Z"
  }
}
```

**Errors:** 400 for an empty or missing `name` or a name over 100 characters; 401 as for `GET /api/v1/auth/me`.

`POST /api/v1/auth/register`, `/auth/change-password`, `/auth/forgot-password` and `/auth/reset-password` (formerly
16, 21, 22 and 23) were removed and return `404`.

---

## Source imports

Imports companies from a CSV as leads. Each new company gets a lead in `PENDING_AUDIT` and a website audit job,
the same as companies found by discovery.

- **Up to 1,000 rows:** imported during the request. The reply already has `status: "done"` and the `result`.
- **1,001 to 20,000 rows:** saved as a `csv_import` job (`status: "pending"`) and imported by the background worker.
  Poll `GET /api/v1/source-imports/:id` until `status` is `done` or `failed`.
- Companies are matched by domain. A company that already exists is counted as a duplicate; the CSV only fills its
  empty fields (country, city, phone, address). Rows repeating a domain within the same file are also duplicates.
- Rows without a name or without a website/domain are skipped.

### 24. POST `/api/v1/source-imports`

**CRUD:** Create.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `source` | string | Yes | `"csv"`. Any other source returns 400 `unsupported_source` |
| `csv` | string | One of `csv` or `records` | CSV text with a header row. Columns: `name` (required), `website` or `domain` (required), `country`, `city`, `phone`, `address` |
| `records` | object[] | One of `csv` or `records` | Already-parsed rows with the same fields. Used instead of `csv` when not empty |

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/source-imports \
  -H "content-type: application/json" \
  -d '{ "source": "csv", "csv": "name,website,country,city\nAcme Dental,https://acme-dental.sg,Singapore,Singapore\nBright Smiles,brightsmiles.sg,Singapore,Singapore" }'
```

**202 Accepted** (up to 1,000 rows: imported now)

```json
{
  "id": "cmuv3fp2n0009g5s0q7m0d1xk",
  "status": "done",
  "mode": "inline",
  "rows": 2,
  "result": { "found": 2, "created": 2, "duplicates": 0, "skipped": 0, "auditsEnqueued": 2, "noWebsite": 0 }
}
```

**202 Accepted** (more than 1,000 rows: queued for the worker)

```json
{ "id": "cmuv3h457000fg5s0ymfwh4lt", "status": "pending", "mode": "queued", "rows": 1001 }
```

| `result` field | Description |
|---|---|
| `found` | Rows in the file |
| `created` | New companies (each with a new lead) |
| `duplicates` | Rows whose domain already existed, or repeated a domain earlier in the file |
| `skipped` | Rows without a name or website/domain |
| `auditsEnqueued` | Website audit jobs created (pending leads already audited today are not queued again) |
| `noWebsite` | Matched companies whose lead is in `NO_WEBSITE` |

**Errors**

| Status | Example |
|---|---|
| 400 | `{ "error": { "code": "validation_error", "message": "No rows found. The CSV needs a header row with a \"name\" column and a \"website\" or \"domain\" column." } }` |
| 400 | `{ "error": { "code": "unsupported_source", "message": "Only source \"csv\" is imported here. Use POST /api/v1/discovery/country for Google Places discovery." } }` |
| 400 | `fieldErrors.csv: ["CSV import requires csv text or records"]` |
| 413 | `{ "error": { "code": "too_many_rows", "message": "CSV has 25000 rows; the limit is 20000." } }` |

### 25. GET `/api/v1/source-imports/:id`

**CRUD:** Read. Status and result of an import (the `id` from #24).

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/source-imports/cmuv3h457000fg5s0ymfwh4lt
```

**200 OK**

```json
{
  "id": "cmuv3h457000fg5s0ymfwh4lt",
  "status": "done",
  "source": "csv",
  "type": "csv_import",
  "mode": "queued",
  "rows": 1001,
  "startedAt": "2026-10-05T10:39:02.118Z",
  "finishedAt": "2026-10-05T10:39:04.870Z",
  "createdAt": "2026-10-05T10:38:58.533Z",
  "result": { "found": 1001, "created": 1001, "duplicates": 0, "skipped": 0, "auditsEnqueued": 1001, "noWebsite": 0 },
  "recordsDiscovered": 1001,
  "recordsImported": 1001,
  "error": null
}
```

| Field | Description |
|---|---|
| `status` | `pending` (waiting for the worker), `running`, `done` or `failed` |
| `mode` | `inline` or `queued` |
| `result` | `null` until the import is done |
| `recordsDiscovered` / `recordsImported` | `result.found` / `result.created` |
| `error` | Failure reason when `status` is `failed` |

**404** `{ "error": { "code": "not_found", "message": "Import not found" } }` for an unknown id or a job that is not an
import.

---

## Worker health

The background worker writes a heartbeat to the database every 30 seconds. It counts as offline when no heartbeat
arrived for 120 seconds.

### 26. GET `/api/v1/worker/health`

**CRUD:** Read.

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/worker/health
```

**200 OK**

```json
{
  "running": true,
  "status": "online",
  "message": "Background worker is running.",
  "lastSeenAt": "2026-10-05T10:39:30.114Z",
  "secondsSinceLastSeen": 12,
  "staleAfterSeconds": 120,
  "workers": [
    {
      "workerId": "worker-local-3f9c2a1b",
      "hostname": "DESKTOP-MONCHA",
      "lastSeenAt": "2026-10-05T10:39:30.114Z",
      "secondsSinceLastSeen": 12,
      "online": true
    }
  ],
  "jobs": {
    "pending": { "website_audit": 3, "country_discovery": 0, "csv_import": 0, "site_snapshot": 0 },
    "running": { "website_audit": 1, "country_discovery": 0, "csv_import": 0, "site_snapshot": 0 }
  }
}
```

When offline: `"running": false`, `"status": "offline"`, and `message` is `"Background worker is offline: discovery,
schedules, website audits, website copies and large CSV imports wait until it starts."`. `lastSeenAt` and `secondsSinceLastSeen` are
`null` if no worker has ever run.

| Field | Description |
|---|---|
| `running` | `true` when the latest heartbeat is at most 120 seconds old |
| `workers` | Up to 5 most recent workers |
| `jobs` | This tenant's waiting (`pending`) and active (`running`) jobs per type |

---

## Reviews

When an audit is not sure (no chatbot found but confidence below 0.8, or still uncertain after all passes), the
lead goes to the `NEEDS_REVIEW` queue and an open review task is created for it. A person checks the website and
resolves the task with one of three actions. Each lead has at most one open review task. The audit itself is never
changed; the decision is stored on the lead, the task and the audit log.

Served by the Node API (the Cloudflare backend container, and local).

**Review task object**

```json
{
  "id": "cmuvr7k2p0001a8tq3x9d2f1b",
  "tenantId": "tenant_moncha_internal",
  "leadId": "cmuv6c3vp016bt30uhaiwsu6a",
  "auditId": "cmuv6d1qa0190t30u7bq2k4mn",
  "reason": "no_assistant_below_confidence",
  "status": "open",
  "resolvedBy": null,
  "resolutionNote": null,
  "resolvedAt": null,
  "createdAt": "2026-10-05T11:02:41.118Z"
}
```

| Field | Description |
|---|---|
| `reason` | Why the audit was not sure: `no_assistant_below_confidence`, `uncertain` or `llm_no_assistant_pending_precision` |
| `status` | `open` or `resolved` |
| `resolvedBy` | Email of the signed-in user who resolved it, or `api` when no bearer token was sent |
| `resolutionNote` | The note sent with the decision |

### 27. GET `/api/v1/reviews`

**CRUD:** Read. Paginated review tasks, each with its lead, company, website and the audit that raised it.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | `open`, `resolved`, `all` | `open` | Which tasks to list |
| `page` | integer ≥ 1 | `1` | |
| `pageSize` | integer 1 to 100 | `25` | |
| `search` | string | none | Matches company name or domain (case-insensitive) |
| `country` | string | none | Exact company country |

Open tasks are sorted oldest first (work through them as a queue); `resolved` and `all` are sorted newest first.

```bash
curl "https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/reviews?pageSize=10"
```

**200 OK**

```json
{
  "items": [
    {
      "id": "cmuvr7k2p0001a8tq3x9d2f1b",
      "tenantId": "tenant_moncha_internal",
      "leadId": "cmuv6c3vp016bt30uhaiwsu6a",
      "auditId": "cmuv6d1qa0190t30u7bq2k4mn",
      "reason": "no_assistant_below_confidence",
      "status": "open",
      "resolvedBy": null,
      "resolutionNote": null,
      "resolvedAt": null,
      "createdAt": "2026-10-05T11:02:41.118Z",
      "lead": {
        "id": "cmuv6c3vp016bt30uhaiwsu6a",
        "tenantId": "tenant_moncha_internal",
        "companyId": "cmuv6c3th0169t30u5wz1y2xq",
        "queue": "NEEDS_REVIEW",
        "assistantVerdict": "NO_ASSISTANT",
        "assistantVendor": null,
        "qualificationReason": "no_assistant_below_confidence",
        "latestAuditId": "cmuv6d1qa0190t30u7bq2k4mn",
        "version": 2,
        "createdAt": "2026-10-05T10:58:12.004Z",
        "updatedAt": "2026-10-05T11:02:41.090Z",
        "company": {
          "id": "cmuv6c3th0169t30u5wz1y2xq",
          "tenantId": "tenant_moncha_internal",
          "name": "Example Dental Clinic",
          "domain": "exampledental.sg",
          "country": "Singapore",
          "city": "Singapore",
          "phone": "+65 6123 4567",
          "address": "1 Example Road",
          "createdAt": "2026-10-05T10:58:11.950Z",
          "updatedAt": "2026-10-05T10:58:11.950Z",
          "website": {
            "id": "cmuv6c3ue016at30u8n4p0r2s",
            "url": "https://exampledental.sg",
            "status": "ACTIVE",
            "title": "Example Dental Clinic",
            "finalUrl": "https://exampledental.sg/",
            "httpStatus": 200,
            "latestAuditId": "cmuv6d1qa0190t30u7bq2k4mn",
            "lastCheckedAt": "2026-10-05T11:02:40.877Z"
          }
        }
      },
      "audit": {
        "id": "cmuv6d1qa0190t30u7bq2k4mn",
        "method": "render",
        "verdict": "NO_ASSISTANT",
        "kind": "NONE",
        "vendor": null,
        "confidence": 0.7,
        "classifierVersion": "assistants-v2",
        "failureReason": null,
        "finalUrl": "https://exampledental.sg/",
        "auditedAt": "2026-10-05T11:02:40.877Z"
      }
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 10,
  "totalPages": 1
}
```

`website` contains every website field (shortened above). `audit` is `null` only if the audit row is missing.

**400** `validation_error` for an unknown `status` or a `pageSize` over 100.

### 28. GET `/api/v1/reviews/:id`

**CRUD:** Read. One review task (task object above, without lead and audit).

**200 OK** → review task object. **404** `{ "error": { "code": "not_found", "message": "Review task not found" } }`

### 29. POST `/api/v1/reviews/:id/resolve`

**CRUD:** Update. Applies a human decision and closes the task.

**Headers:** `authorization: Bearer <token>` is optional. When sent, `resolvedBy` is that user's email; an invalid
or expired token returns 401, and a user of another tenant returns 403. Without it, `resolvedBy` is `api`.

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | `confirm_no_assistant`, `mark_has_assistant`, `request_reaudit` | Yes | The decision |
| `note` | string | Yes | Why (not blank) |
| `vendor` | string | No | Only for `mark_has_assistant`: the chatbot vendor seen, for example `tidio`. Default: the vendor the audit detected, if any |

**What each action does**

| `action` | Lead after | `qualificationReason` | Job |
|---|---|---|---|
| `confirm_no_assistant` | `QUALIFIED`, verdict `NO_ASSISTANT`, vendor `null` | `review_confirmed_no_assistant` | none |
| `mark_has_assistant` | `HAS_ASSISTANT`, verdict `HAS_ASSISTANT`, vendor from the body | `review_marked_has_assistant` | none |
| `request_reaudit` | Unchanged (stays `NEEDS_REVIEW` until the new audit finishes) | unchanged | Forced `website_audit` job, same as `POST /api/v1/leads/:id/audit` |

Every action marks the task `resolved` (with `resolvedBy`, `resolutionNote`, `resolvedAt`) and writes an audit log
entry (`entityType: "ReviewTask"`, `action: "review_resolved"`, lead state before and after). The first two also
raise the lead's `version`. If the re-audit is still not sure, it opens a new review task.

```bash
curl -X POST https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/reviews/cmuvr7k2p0001a8tq3x9d2f1b/resolve \
  -H "content-type: application/json" \
  -H "authorization: Bearer <token>" \
  -d '{ "action": "mark_has_assistant", "note": "Tidio bubble bottom right", "vendor": "tidio" }'
```

**200 OK**

```json
{
  "review": {
    "id": "cmuvr7k2p0001a8tq3x9d2f1b",
    "status": "resolved",
    "action": "mark_has_assistant",
    "resolvedBy": "ops@moncha.example",
    "resolutionNote": "Tidio bubble bottom right"
  },
  "lead": {
    "id": "cmuv6c3vp016bt30uhaiwsu6a",
    "queue": "HAS_ASSISTANT",
    "assistantVerdict": "HAS_ASSISTANT",
    "assistantVendor": "tidio",
    "qualificationReason": "review_marked_has_assistant"
  },
  "job": null
}
```

For `request_reaudit`, `job` is the queued audit, for example `{ "id": "cmuvr9...", "status": "pending" }`, or
`{ "id": "...", "status": "running", "deduped": true }` when an audit for this lead was already queued.

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | Missing or blank `note`, unknown `action`, or `request_reaudit` on a lead without a domain |
| 401 | `unauthorized` | Bearer token sent but invalid, expired or logged out |
| 403 | `forbidden` | Bearer token of a user in another tenant |
| 404 | `not_found` | Unknown review task (or one in another tenant) |
| 409 | `conflict` | Task already resolved |

---

## Website copies

The Website Copy Agent copies one lead's homepage. The worker runs a `site_snapshot` job and stores the files in the
private R2 bucket under `sites/{tenantId}/{snapshotId}/`:

| File | What it is |
|---|---|
| `source.html` | The HTML exactly as served (same bytes, charset and SHA-256 as view-source) |
| `rendered.html` | The DOM after the browser ran the page's scripts |
| `index.html` | `source.html` with only asset URLs rewritten to the local copies, for offline viewing |
| `brand.json` | Business name, logo, colors, fonts, contact, services, hours, greeting and FAQs (Gemini via OpenRouter, checked against the page) |
| `manifest.json` | Assets, skipped assets with reasons, redirects, rewrite counts, exceptions and limits |
| `screenshot-desktop.png`, `screenshot-mobile.png` | 1440 px and 390 px screenshots |
| `assets/{host}/...` | Images, CSS, JS, fonts and media (400 files, 10 MB per file, 80 MB per copy) |

Needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `SITE_PREVIEW_SECRET`; without
them every route here returns 503 `site_agent_not_configured`. The deployed edge forwards these paths to the
container.

### 30. POST `/api/v1/leads/:id/site-snapshots`

**CRUD:** Create. **Headers:** `authorization: Bearer <token>` is required (role `admin` or `operator`).

```bash
curl -X POST http://localhost:4000/api/v1/leads/cmuv6c3vp016bt30uhaiwsu6a/site-snapshots \
  -H "authorization: Bearer <token>"
```

**202 Accepted** `{ "snapshotId": "cmw1...", "jobId": "cmw1...", "status": "pending" }`. When a copy of this lead
is already pending or running: **200 OK** with the same fields and `"deduped": true`.

| Status | `code` | When |
|---|---|---|
| 401 | `unauthorized` | No bearer token, or an invalid one |
| 403 | `forbidden` | Viewer role, or a user of another tenant |
| 404 | `not_found` | Unknown lead |
| 409 | `no_website` | The lead has no website |
| 503 | `site_agent_not_configured` | R2 or `SITE_PREVIEW_SECRET` missing |

### 31. GET `/api/v1/leads/:id/site-snapshots`

**200 OK** `{ "items": [ <summary>, ... ] }`, newest first, at most 20. A summary has `id`, `leadId`, `jobId`,
`status`, `sourceUrl`, `finalUrl`, `httpStatus`, `sourceHash`, `sourceBytes`, `sourceCharset`, `assetCount`,
`skippedAssetCount`, `totalBytes`, `llmModel`, `llmPromptTokens`, `llmCompletionTokens`, `warnings`,
`failureReason`, `failureDetail`, `attempts`, `origin` (`manual` or `auto`), `crawlJobId` (the country crawl behind
an automatic copy, else `null`), `createdAt`, `finishedAt`, `thumbnailPath` (`site-files/<token>/screenshot-desktop.png`
once `done`, else `null`) and `github` (see #41; `null` when the copy was never queued for GitHub). A cancelled copy is
`failed` with `failureReason: "cancelled"`.

A copy is tried up to 3 times. Failures that a retry cannot fix (`blocked_host`, `robots_disallowed`, `not_html`,
`source_too_large`, `too_many_redirects`, `blocked_or_captcha`, `http_4xx`) fail on the first attempt. `failureReason`
is the code and `failureDetail` the error message behind it, for example:

```json
{
  "status": "failed",
  "failureReason": "fetch_failed",
  "failureDetail": "fetch failed: getaddrinfo ENOTFOUND exampledental.sg",
  "attempts": 3
}
```

While a retry waits, the copy is `pending` and keeps the last attempt's `failureReason` and `failureDetail`; both are
cleared when the copy is `done`. Other codes: `http_<status>`, `timeout`, `render_failed`, `unexpected_error`.

### 32. GET `/api/v1/site-snapshots`

Query: `page` (default 1), `pageSize` (1 to 100, default 25), `status`, `search` (source URL, company name or
domain), `origin` (`auto` or `manual`). **200 OK** `{ "items", "total", "page", "pageSize", "totalPages" }`; each item is a summary plus
`company { id, name, domain }`.

### 33. GET `/api/v1/site-snapshots/:id`

**200 OK**: the summary plus `brand`, `previewBase` (`site-files/<token>/`), `files` (`index`, `source`,
`rendered`, `desktop`, `mobile`) and `manifest`. The last three are `null` until the copy is `done`. Also
`githubConfigured` (the worker has a GitHub token and owner), `githubRepo` (`owner/{siteName}`, the website's repo, or
`null`) and `deployConfigured` (the worker has Cloudflare credentials).
**404** for an unknown copy or one in another tenant.

### 34. GET `/api/v1/site-snapshots/:id/source`

**200 OK** `{ "text": "<!DOCTYPE html>...", "charset": "shift_jis", "bytes": 48213, "sha256": "...", "truncated": false }`.
The text is decoded with the stored charset for display only (first 3 MB). **409** `not_ready` before `done`.

### 35. GET `/api/v1/site-files/:token/*path`

Streams one stored file. No `x-tenant-id` needed: the token (HMAC-SHA256 with `SITE_PREVIEW_SECRET`, valid for
`SITE_PREVIEW_TTL_SEC`, default 1 hour) names the tenant and the copy. `source.html` and `rendered.html` are served
as `text/plain`; `?download=1` adds `content-disposition: attachment`.

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_path` | `..`, `.`, empty segments, backslashes or encoded traversal |
| 403 | `invalid_token` | Bad or expired token |
| 404 | `not_found` | No such file in this copy |

### 36. GET `/api/v1/site-snapshots/queue`

The worker makes one copy at a time and takes the queue first in, first out (`runAfter`, then `createdAt`). A retry
waits 1 min, then 5 min (3 tries). The next copy starts only when the previous website is live or failed (#36a), so
`averageRunMs` includes the GitHub push and Worker deploy.

```json
{
  "running": [ { "...summary": "...", "position": null, "estimatedAt": "2026-10-09T10:02:10.000Z", "startedAt": "2026-10-09T10:00:00.000Z", "attempts": 1, "maxAttempts": 3, "retrying": false, "runAfter": "...", "lastError": null } ],
  "waiting": [ { "...summary": "...", "position": 1, "estimatedAt": "2026-10-09T10:02:10.000Z", "attempts": 0, "retrying": false } ],
  "averageRunMs": 138399,
  "measured": true
}
```

Each item is a summary (#31) plus `company`. `estimatedAt` is the expected finish for running copies and the
expected start for waiting ones, chained with `averageRunMs` (mean of the last 20 finished copies; 120 s with
`measured: false` when there are none).

### 36a. GET `/api/v1/site-pipeline`

The worker takes **one website at a time** through three steps: copy, GitHub push (#41), Cloudflare Worker deploy
(#41c). The next website starts only when the current one is live or one of its steps gave up:

- Each step gets 3 tries, 1 min then 5 min apart. Errors a retry cannot fix fail at once.
- After the last try the step is `failed`, the website's job is `failed` with the step's error, and the next website starts.
- When the Worker is deployed, the job is `done` with `result.liveUrl`, and the next website starts.
- A GitHub rate limit (`github_rate_limited`) or a full Cloudflare account (`worker_limit_reached`) **pauses** the
  whole pipeline on the current website without using up a try. It resumes by itself (the Worker limit is checked
  every 15 min).
- Finished copies never pushed or deployed (backlog) go through the same steps when no new copy is in progress,
  already-live copies first, then newest first. An older copy of a website that has a newer finished copy is skipped.
- After a restart the worker resumes at the step the website was on.

**CRUD:** Read. **200 OK**:

```json
{
  "enabled": true,
  "steps": { "github": true, "deploy": true },
  "current": {
    "site": { "...summary": "..." },
    "step": "deploy",
    "state": "paused",
    "attempts": 0,
    "maxAttempts": 3,
    "nextAt": "2026-10-14T10:15:00.000Z",
    "error": "worker_limit_reached: The account has 100 of 100 Workers"
  },
  "toPublish": 412,
  "waitingCopies": 3
}
```

| Field | Meaning |
|---|---|
| `enabled` | The worker can copy websites (R2 and `SITE_PREVIEW_SECRET` set) |
| `steps` | Which publish steps are configured; a missing one is skipped |
| `current` | The website in the pipeline, `null` when idle (or busy with another tenant's website). `site` is a summary (#31) plus `company` |
| `current.step` | `copy`, `github` or `deploy` |
| `current.state` | `working` (running or about to), `retrying` (waits for `nextAt` after an error), `paused` (waits for a GitHub or Cloudflare limit) |
| `current.attempts` / `maxAttempts` | Tries of this step so far |
| `current.error` | Last error of this step, `"code: message"` |
| `toPublish` | Finished copies still waiting for their push or deploy (the current website not counted) |
| `waitingCopies` | Copies waiting for their first try |

### 37. POST `/api/v1/site-snapshots/:id/cancel`

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). Takes a copy out of the queue before it
starts: the snapshot and its job both become `failed` with reason `cancelled`. **200 OK** `{ "cancelled": true }`.

| Status | `code` | When |
|---|---|---|
| 401 | `unauthorized` | No bearer token, or an invalid one |
| 403 | `forbidden` | Viewer role, or a user of another tenant |
| 404 | `not_found` | Unknown copy |
| 409 | `not_pending` | The copy is already running or finished |

### 41. POST `/api/v1/site-snapshots/:id/github-push`

One website = one GitHub repo. When `GITHUB_TOKEN` and `GITHUB_SITES_OWNER` (or `GITHUB_SITES_REPO`, whose owner is
used) are set, the worker pushes every finished copy to the website's own private repo `{owner}/{siteName}` by
itself, as one commit on `GITHUB_SITES_BRANCH` (default `main`). `siteName` is the domain without `www.`, dots as
dashes (`ja.edu.sg` → `ja-edu-sg`). The repo is created when missing, with the description
`{Company} ({domain}) · Automatic|Manual website copy by MonCha`, the live Worker URL as homepage and the topics
`moncha-site` plus `auto-copy` or `manual-copy`. An existing repo without the `moncha-site` topic is never touched
(`github_repo_taken`). A newer copy of the same website becomes a new commit in the same repo; its tree is exactly
the new copy, so files that are gone are removed. Repo layout:

```
README.md          company, original URL, live URL, copy type (automatic/manual), capture date, copy ID
wrangler.jsonc     the same static-assets Worker, for `npx wrangler deploy`
public/            the website: index.html plus every copied asset (images, fonts, CSS, JS)
moncha/            brand.json, manifest.json, source.html (HTML exactly as served)
```

The push uses the git CLI (one push per copy whatever the number of files); screenshots and `rendered.html` stay in
R2. The token needs Repository access "All repositories" with Administration: Read and write (to create repos) and
Contents: Read and write.

A GitHub problem never fails the copy: it stays `done`, `github.error` explains the problem and the worker retries
after 1 min and 5 min (3 tries), then sets `github.status` to `failed` and the website's job to `failed` (see #36a).
Errors a retry cannot fix (for example `github_repo_taken` or `copy_files_missing`) fail at once. This route queues a push
right away: the first push of a copy made before GitHub was set up, a retry after `failed`, or a push again.

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). **202 Accepted** `{ "queued": true }`.

The summary's `github` object:

```json
{
  "status": "pushed",
  "attempts": 1,
  "maxAttempts": 3,
  "nextAt": null,
  "commitSha": "4f1c2e9...",
  "commitUrl": "https://github.com/Thinaakar/ja-edu-sg/commit/4f1c2e9...",
  "folderUrl": "https://github.com/Thinaakar/ja-edu-sg",
  "repo": "Thinaakar/ja-edu-sg",
  "error": null,
  "pushedAt": "2026-10-09T10:03:12.000Z"
}
```

`status` is `pending` (waiting for the worker; with `error` set it is a scheduled retry at `nextAt`), `pushing`,
`pushed` or `failed`. Copies pushed before per-site repos keep their old `folderUrl` in the shared repo and have no
`repo`.

| Status | `code` | When |
|---|---|---|
| 401 | `unauthorized` | No bearer token, or an invalid one |
| 403 | `forbidden` | Viewer role, or a user of another tenant |
| 404 | `not_found` | Unknown copy |
| 409 | `not_ready` | The copy is not `done` |
| 409 | `push_in_progress` | The worker is pushing this copy right now |
| 503 | `github_not_configured` | `GITHUB_TOKEN` or the owner missing |

A GitHub rate limit (`github_rate_limited`) does not use up a try: the copy waits until the time GitHub gives
(`retry-after` or `x-ratelimit-reset`, else 15 min). The whole website pipeline pauses on that website until then
(#36a), so creating hundreds of repos goes at the pace GitHub allows.

Common `github.error` codes: `github_cannot_create_repo` (token lacks Administration write or All repositories),
`github_forbidden` (token cannot push), `github_repo_taken` (a repo with that name exists that is not a MonCha
site repo, or the token cannot see it), `github_bad_token`, `github_rate_limited`, `git_failed`.

### 41a. GET `/api/v1/site-automation/github-check`

Checks the GitHub connection with the worker's own settings: the token is valid, belongs to `login`, and can see the
owner (`ownerType` `user` means repos are created with `/user/repos`, `org` with `/orgs/{owner}/repos`). Nothing is
created. The token is never returned or logged; `keys` only says which variables are set. The worker runs the same
check once at start-up and logs it as `site_github_check`.

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). **200 OK**:

```json
{
  "configured": true,
  "keys": { "GITHUB_TOKEN": true, "GITHUB_SITES_REPO": true, "GITHUB_SITES_BRANCH": true, "GITHUB_SITES_OWNER": true },
  "repo": "Thinaakar/{siteName}",
  "branch": "main",
  "private": true,
  "canPush": null,
  "canRead": true,
  "canWrite": false,
  "branchHead": null,
  "folderPattern": "Thinaakar/{siteName}",
  "owner": "Thinaakar",
  "login": "Thinaakar",
  "ownerType": "user",
  "error": null,
  "checkedAt": "2026-10-13T09:30:00.000Z"
}
```

`canPush`, `canWrite` and `branchHead` belong to the older shared repo and are always `null`/`false` now; whether
the token can create repos shows on the first push (`github_cannot_create_repo`).

### 41c. POST `/api/v1/site-snapshots/:id/deploy`

One website = one Cloudflare Worker = one URL. When `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (or
`R2_ACCOUNT_ID`) are set, the worker deploys every finished copy by itself as a static-assets Worker named
`{siteName}`, live at `https://{siteName}.{subdomain}.workers.dev` (the subdomain is read from the account, or
`CLOUDFLARE_WORKERS_SUBDOMAIN`). It uploads `index.html` (served at `/`) and every asset through the Workers API (no
wrangler), tags the Worker `moncha-site` and turns on its workers.dev route. A newer copy of the same website
redeploys the same Worker, so the URL never changes. A Worker with that name that has no `moncha-site` tag is never
replaced (`worker_name_taken`). Files over 25 MB are skipped (Cloudflare's per-file limit).

Retries work like GitHub pushes (1 min, 5 min; 3 tries); a deploy problem never fails the copy, but after the last
try the website's job is `failed` and the pipeline moves on to the next website (#36a).
This route queues a deploy right away: first deploy of an older copy, a retry, or a redeploy.

When GitHub is configured too, the Worker is deployed only after the copy's GitHub push is done (`github.status`
`pushed`), so the URL always serves what the repo holds. A queued deploy waits while the push is pending, retrying
or failed; a deploy that was already under way when the worker restarted is still finished.

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). **202 Accepted** `{ "queued": true }`.

The summary's `deploy` object (and `siteName`, e.g. `"ja-edu-sg"`):

```json
{
  "status": "deployed",
  "attempts": 1,
  "maxAttempts": 3,
  "nextAt": null,
  "name": "ja-edu-sg",
  "url": "https://ja-edu-sg.vinothjv4-tech.workers.dev",
  "error": null,
  "deployedAt": "2026-10-13T09:24:27.000Z"
}
```

`status` is `pending`, `deploying`, `deployed` or `failed`; `null` when the copy was never queued.

| Status | `code` | When |
|---|---|---|
| 401 | `unauthorized` | No bearer token, or an invalid one |
| 403 | `forbidden` | Viewer role, or a user of another tenant |
| 404 | `not_found` | Unknown copy |
| 409 | `not_ready` | The copy is not `done` |
| 409 | `deploy_in_progress` | The worker is deploying this copy right now |
| 503 | `deploy_not_configured` | `CLOUDFLARE_API_TOKEN` or the account id missing |

Common `deploy.error` codes: `cloudflare_bad_token` (needs Workers Scripts: Edit), `worker_name_taken`,
`cloudflare_rate_limited`, `worker_limit_reached`.

Worker limit: before reading a copy's files, the worker checks whether the deploy creates a new Worker and, if so,
whether the account already has `CLOUDFLARE_WORKERS_LIMIT` Workers (default 100, Workers Free; set 500 on Workers
Paid). At the limit, or when Cloudflare itself refuses a new Worker, the deploy stays `pending` with
`error` `worker_limit_reached: …`, does not use up a try, and is checked again 15 minutes later (or right away with
this route). Meanwhile the whole website pipeline is paused on that website (#36a): no new copy starts until Workers
are freed or the limit is raised. Redeploys of a website's existing Worker are never blocked.

Backfill (newest copy per website, from `apps/worker`): `pnpm sites:backfill -- --limit 10` queues them for the
worker; add `--dry-run` to list them, `--run` to publish from this machine, `--only github|worker`, `--site ja-edu-sg`.
With `--run` each website is pushed to GitHub first and its Worker deployed only once that push is done.

### 41e. Copy progress (`progress`)

Every copy summary (lists, lead copies, queue items, copy detail) has `progress`: one ordered list of steps from the
queue to the live URL, and the step the copy is on now. Older API versions omit it.

| Step | Shown as | When |
|---|---|---|
| `queued` | Queued | Waiting in the copy queue |
| `copying` | Copying website | The worker opens the site and downloads its pages and assets |
| `reading_source` | Viewing source code | The source is read for the brand, colours and contact details |
| `building` | Building website | The website files are built and saved to R2 |
| `updating_git` | Updating Git | Push to the website's own GitHub repo |
| `deploying_url` | Deploying URL | Deploy to the website's own Cloudflare Worker (after the push) |
| `live` | Live | The Worker URL is up |

Each step's `state` is `not_started` (not reached, or never queued for this copy), `waiting`, `active`, `retrying`,
`failed` or `done`. `updating_git` is listed when GitHub is configured or the copy was pushed before;
`deploying_url` and `live` when Cloudflare is configured or the copy was deployed before. A failed copy keeps the
step it failed in.

```json
{
  "step": "updating_git",
  "state": "retrying",
  "error": "github_rate_limited: GitHub rate limit reached until 2026-10-13T12:37:32.000Z",
  "since": null,
  "nextAt": "2026-10-13T12:37:32.000Z",
  "steps": [
    { "step": "queued", "state": "done" },
    { "step": "copying", "state": "done" },
    { "step": "reading_source", "state": "done" },
    { "step": "building", "state": "done" },
    { "step": "updating_git", "state": "retrying" },
    { "step": "deploying_url", "state": "waiting" },
    { "step": "live", "state": "not_started" }
  ]
}
```

`step` is the first step that is not `done` (the last step once all are); `since` is when the current step started
(or when the last one finished); `nextAt` is the next try of a waiting or retrying push or deploy.

### 41d. GET `/api/v1/site-automation/deploy-check`

Reads the account's workers.dev subdomain and its Worker list with the worker's own settings. Nothing is deployed;
the token is never returned. The worker runs the same check at start-up and logs it as `site_worker_check`.

```json
{
  "configured": true,
  "keys": { "CLOUDFLARE_API_TOKEN": true, "CLOUDFLARE_ACCOUNT_ID": false, "R2_ACCOUNT_ID": true },
  "subdomain": "vinothjv4-tech",
  "urlPattern": "https://{siteName}.vinothjv4-tech.workers.dev",
  "canRead": true,
  "siteWorkers": 3,
  "totalWorkers": 7,
  "workerLimit": 100,
  "error": null,
  "checkedAt": "2026-10-13T09:30:00.000Z"
}
```

### 41e. GET `/api/v1/site-automation/moncha-check`

Checks the MonCha internal lead API ([internal-lead-agent.md](../../internal-lead-agent.md), section 1) with the
worker's own settings: calls `GET {MONCHA_INTERNAL_BASE_URL}/slots` with `Authorization: Bearer {MONCHA_INTERNAL_KEY}`.
Nothing is created. The key is never returned or logged; `keys` only says which variables are set. An empty
`MONCHA_INTERNAL_BASE_URL` means UAT (`environment` `uat`); `production` only when the production URL is set on purpose.
The same check from a shell: `pnpm --filter @moncha/worker exec tsx src/check-moncha-internal.ts`.

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). **200 OK**:

```json
{
  "configured": true,
  "keys": { "MONCHA_INTERNAL_BASE_URL": true, "MONCHA_INTERNAL_KEY": true },
  "environment": "uat",
  "baseUrl": "https://api.dev-moncha.com/vendor/internal/v1",
  "canAuthenticate": true,
  "slots": {
    "starter": { "allocated": 20, "used": 3, "available": 17 },
    "growth": { "allocated": 5, "used": 1, "available": 4 },
    "scale": { "allocated": 0, "used": 0, "available": 0 }
  },
  "error": null,
  "requestId": null,
  "checkedAt": "2026-10-15T05:40:00.000Z"
}
```

Without a key: `configured: false` and `error` says what to set. When MonCha answers with an error, `canAuthenticate`
is `false` and `error` is `code: message`, for example `invalid_internal_credentials` (wrong key or environment, or
the Admin options are off), `vendor_subscription_required`, `vendor_disabled`, `internal_workspace_unavailable`,
`rate_limit_exceeded` or `moncha_unreachable`; `requestId` is MonCha's request ID when it sends one.

### 41b. Public copy links (`publicUrl`)

Every copy summary (lists, lead copies, copy detail) has `publicUrl`: the website's Worker URL once
`deploy.status` is `deployed`. Before that (or without Cloudflare) it falls back to the older shared link below when
`SITE_PUBLIC_BASE_URL` is set, else `null`; always `null` when the copy is not `done`.

```
https://moncha-sites.pages.dev/sites/{domain}/{copyId}/index.html
```

The shared links are served by the Cloudflare Pages project in `apps/worker/sites-pages`: a Pages Function bound to the
R2 bucket reads `sites/{tenantId}/{copyId}/{file}` and returns it as is, so the relative asset links in `index.html`
resolve to the same copy. There is no build or deploy per copy; a copy is live the moment it is `done`.

- GET and HEAD only. `/sites/{domain}/{copyId}/` redirects to `index.html`. Unknown copies or files return 404.
- Every response has `x-robots-tag: noindex, nofollow, noarchive` and `robots.txt` disallows all crawling.
- `source.html` and `rendered.html` are served as plain text so the captured scripts never run from them.
- Responses are cached for 1 hour (`cache-control: public, max-age=3600`) and support `if-none-match`.

Deploy (from `apps/worker`, Wrangler logged in): `pnpm sites:deploy`. First time only:
`wrangler pages project create moncha-sites --production-branch main`. Local preview: `pnpm sites:dev`.

---

## Costs

What each website costs to create, in AI tokens and USD. A website is a lead with at least one copy.

- **AI cost (one-time)** = every brand extraction of its copies (all attempts) + every AI website audit of the lead
  (`llmRan`). OpenRouter reports the charge of each call (`usage.include`), stored as `llmCostUsd` on the copy and
  the audit. Older rows without it are priced as tokens × the model's listed price and flagged `estimated`.
- **Prices** come from OpenRouter's public model list (`GET {OPENROUTER_BASE_URL}/models`), cached 12 hours.
  `LLM_PRICE_OVERRIDES` (`model=input/output` in USD per million tokens, comma-separated) adds or replaces models.
  Models with no known price are listed in `pricing.unpricedModels`, their tokens count as $0 and the website is
  flagged `unpriced` (the cost is a lower bound).
- **Storage** = bytes of the copies in R2 × $0.015 per GB-month. GitHub repos and Cloudflare Workers are $0.
- **`days`** (1–365, optional) keeps websites whose copies were made since the start of the UTC day `days - 1` days
  ago; omitted = all time.

### 41c. GET `/api/v1/costs/summary?days=30`

`SiteCostSummary`: `websites`, `copies`, `aiAudits`, `copyTokens`/`auditTokens` (`{ input, output }`),
`copyCostUsd`, `auditCostUsd`, `aiCostUsd`, `exactCostUsd`, `estimatedCostUsd`, `averagePerWebsiteUsd`,
`averageTokensPerWebsite`, `storageBytes`, `storageUsdPerMonth`, `byModel[]` (`model`, `kind` `copy`|`audit`,
`calls`, `tokens`, `costUsd`, `price`), `byDay[]` (`day`, `websites`, `costUsd`, `tokens`) and `pricing`
(`source` `openrouter`|`overrides`|`unavailable`, `fetchedAt`, `models[]` with `inputPerMillionUsd` and
`outputPerMillionUsd`, `unpricedModels`, `r2StorageUsdPerGbMonth`).

### 41d. GET `/api/v1/costs/websites?days=30&page=1&pageSize=25&search=&sort=cost`

`{ items: SiteCostWebsite[], total, page, pageSize, totalPages, pricing }`. `sort` is `cost` (default), `tokens`,
`newest` or `size`; `search` matches the company name and domain. Each item: `leadId`, `company`, `copies`,
`aiAudits`, `copyTokens`, `auditTokens`, `copyCostUsd`, `auditCostUsd`, `aiCostUsd`, `estimated`, `unpriced`,
`storageBytes`, `storageUsdPerMonth`, `firstCopyAt`, `lastCopyAt` and `latest { snapshotId, status, workerStatus,
workerUrl, githubRepo }`.

### 41e. GET `/api/v1/costs/websites/:leadId`

One `SiteCostWebsite` plus every call behind its cost: `copyRuns[]` (`snapshotId`, `createdAt`, `status`, `model`,
`tokens`, `costUsd`, `estimated`, `totalBytes`, `attempts`) and `auditRuns[]` (`auditId`, `auditedAt`, `method`,
`verdict`, `model`, `tokens`, `costUsd`, `estimated`), and `pricing`. `costUsd` is `null` when the model has no
known price. **`404`** when the lead has no website copies.

---

## Copy automation

When a country crawl (scheduled or manual) finishes, the worker queues website copies for the crawl's new
qualified leads. CSV imports and single leads are not included.

1. Every website audit a crawl starts carries `payload.crawlJobId`.
2. Every 30 seconds the worker picks up crawls that are `done` or `failed`, finished after the automation was turned
   on, and at most 7 days ago.
3. A crawl waits until all its audits are finished, for up to 3 hours. After that, copies are queued for whatever
   has qualified so far, and later audits are still followed for up to 24 hours.
4. Every qualified lead with no website copy at all is queued, oldest first, crawls oldest first, as
   `origin: "auto"`. There is no daily limit. A lead is never copied automatically twice (job dedupe key
   `site_snapshot:auto:<leadId>`).
5. Each copy is tried up to 3 times; a copy that still fails is `failed` with `failureReason` and `failureDetail`
   (see #31).

Needs the website copy settings (R2 and `SITE_PREVIEW_SECRET`). `SITE_AUTO_COPY=false` in `apps/worker/.env` turns it
off on that worker whatever the setting says.

### 38. GET `/api/v1/site-automation`

```json
{
  "enabled": true,
  "dailyCap": 20,
  "enabledAt": "2026-10-09T08:00:00.000Z",
  "updatedAt": "2026-10-09T08:00:00.000Z",
  "updatedBy": "ops@moncha.ai",
  "today": { "day": "2026-10-09", "used": 7, "cap": 20, "remaining": 13, "resetsAt": "2026-10-10T00:00:00.000Z" },
  "carriedOver": 0,
  "waitingCrawls": 1,
  "agentReady": true,
  "workerEnabled": true
}
```

Off until someone turns it on. `today.used` counts automatic copies queued this UTC day; `waitingCrawls` counts
crawls whose audits are still running. `dailyCap`, `today.cap`, `today.remaining` and `carriedOver` are deprecated:
they are still returned for older clients, but no cap is enforced and `carriedOver` is always 0.

### 39. PUT `/api/v1/site-automation`

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). Body: `{ "enabled": true }`. Turning the
automation on only picks up crawls that finish from then on. `dailyCap` (0 to 500) is still accepted and stored for
older clients but has no effect. **200 OK** with the same shape as #38.

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | Empty body, or a `dailyCap` outside 0 to 500 |
| 401 | `unauthorized` | No bearer token, or an invalid one |
| 403 | `forbidden` | Viewer role, or a user of another tenant |

### 40. GET `/api/v1/site-automation/crawls`

Query: `limit` (1 to 200, default 50). **200 OK** `{ "items": [...] }`, newest crawl first:

```json
{
  "crawlJobId": "cmv0...",
  "country": "Singapore",
  "countryCode": "SG",
  "trigger": "schedule",
  "crawlStatus": "done",
  "status": "queuing",
  "crawlFinishedAt": "2026-10-09T02:10:00.000Z",
  "lastCheckedAt": "2026-10-09T02:40:00.000Z",
  "completedAt": null,
  "leadsCreated": 48,
  "auditsEnqueued": 41,
  "auditsTotal": 41,
  "auditsPending": 0,
  "qualified": 25,
  "queued": 25,
  "carriedOver": 0,
  "copies": { "pending": 17, "running": 1, "done": 7, "failed": 0 }
}
```

`status` is `waiting_audits` (audits still running), `queuing` (copies queued while late audits are still followed,
or more than 1,000 leads that are queued over several sweeps) or `complete`. Only crawls the automation picked up are listed.

---

## Lead bots

Every lead whose website is copied gets a MonCha demo bot first, through the internal lead API
([internal-lead-agent.md](../../internal-lead-agent.md), section 3). The bot's IDs are stored so later bot settings,
widget and training calls can find it. Needs `MONCHA_INTERNAL_KEY` (see #41e); without it the worker skips this step
and copies websites as before.

1. A copy that is queued (by the automation after a scheduled or manual crawl, or by hand) waits until its lead has a
   `created` bot. On every poll (`WORKER_POLL_MS`, default 2 seconds) the worker queues a bot for each lead whose copy
   waits, then creates one bot at a time, leads with a waiting copy first.
2. **3.1 Pick the tier:** `GET /slots`, then the tier with the most `available` slots (ties: starter, growth, scale).
3. **3.2 Create:** `POST /bots` with `name` = the lead's company name (at most 30 characters), `plan_tier` = that tier,
   `language` = `en`, and an `Idempotency-Key` of `lead-{leadId}-bot-v{n}`. The name, tier and key are saved before the
   call, so a retry after a timeout or a worker restart sends the same request and never creates a second bot.
4. The response is stored in `LeadBot`: `chatbotId` (`data.bot_id`), `monchaTenantId` (`data.customer_tenant_id`),
   `connectionId`, `planTier`, and the entire response in `config`. `Lead.botStatus` becomes `created` and
   `Lead.botCreatedAt` is set.
5. **Up to 3 tries.** A failed try waits 1 minute, then 5 minutes. `bot_name_taken` retries with a lead reference
   (`Acme Dental L4f2a9`) and `slot_unavailable` picks the tier again, both with a new key. After the 3rd failed try the
   bot is `failed`, `error` keeps the last `code: message`, and the lead's waiting copy ends `failed` with
   `failureReason: "bot_failed"` and `lastError: "Bot creation failed after 3 attempts: ..."`. The worker then moves
   on to the next lead. #45 tries again.
6. Problems that are not the lead's fault do not use up a try: an invalid key, subscription or Admin option
   (`401`/`402`/`403`) pauses every bot for 15 minutes, `rate_limit_exceeded` until `Retry-After`, and every tier full
   for 1 hour.

**Training on the lead's website** (section 7), one bot at a time in its own worker loop, once the bot is created
(`knowledge.status` in #43):

1. **7.1 Discover:** `POST /bots/{chatbotId}/knowledge/discover` with only `url` (the lead's website: the audit's final
   URL, else its URL, else `https://{domain}/`) and `max_pages: 100`. The returned `urls`, `pagesFetched` and
   `truncated` are stored (`knowledge.discoveredUrls`). Status `discovering`.
2. **7.3 Train:** `POST /bots/{chatbotId}/knowledge/ingest-bulk` with one document per discovered URL (at most 100,
   without fragments or duplicates; the website alone when none was found), each only
   `{ "title": "{company} - {page path}", "url": "...", "source_type": "url" }`, for example
   `Acme Dental - services / implants`, and `Acme Dental - Home` for the homepage. The body and its
   `Idempotency-Key` (`lead-{leadId}-train-v{n}`) are saved before sending, so a retry never trains the pages twice.
   The returned `training_id` is stored. Status `training`.
3. **7.4 Wait:** `GET /bots/{chatbotId}/training/{trainingId}` every `poll_after_seconds` (at least 5 seconds) until it is
   `completed`. The latest answer is kept in `knowledge.trainingResult`. Then status `trained`, `error` is `success`
   (`success: 2 of 40 pages failed to train` for a `partial_failure` with pages ready), and the lead's copy starts.
4. **Up to 3 tries**, 1 minute then 5 minutes apart. A training that ends `failed` (or `partial_failure` with no page
   ready) is a failed try and starts over with a new discovery and key; one that is still running is polled until it
   ends, never resubmitted; a submit
   that fails sends the same saved request again. After the 3rd failed try the training is `failed`, `error` keeps the
   MonCha error, and the lead's waiting copy ends `failed` (`bot_failed`, `lastError: "Bot training failed after 3
   attempts: ..."`); the worker moves on to the next lead. `kb_pages_limit` and `training_limit_reached` (page quota used
   up) and a lead without a website fail at once. #45 tries again.
5. `401`/`402` (for example the sponsored entitlement is not live)/`403` and `discovery_unavailable` pause training for
   15 minutes, `rate_limit_exceeded` until `Retry-After`, without using up a try. A failed status poll (network or 5xx)
   is tried again a minute later.

`GET /api/v1/leads` and `GET /api/v1/leads/:id` include `botStatus` (`null` when no bot was queued yet, else one of
the statuses below) and `botCreatedAt`.

**Backfill** for websites copied before this step (from `apps/worker`):
`pnpm bots:backfill -- --dry-run` prints how many live websites have no bot; `pnpm bots:backfill` queues them
(`--tenant <id>` for one tenant) and the running worker creates them one at a time. Every created bot that is not
trained yet (backfilled ones too) is trained by the worker.

### 42. GET `/api/v1/lead-bots`

Query: `page` (default 1), `pageSize` (1 to 100, default 25), `status` (`pending`, `creating`, `created`, `failed`),
`knowledgeStatus` (`pending`, `discovering`, `training`, `trained`, `failed`). Most recently updated first.
**200 OK** `{ "items": [ ...as #43 ], "total", "page", "pageSize", "totalPages", "counts", "knowledgeCounts" }` with
`counts` per status, for example `{ "pending": 4, "creating": 1, "created": 120, "failed": 2 }`, and `knowledgeCounts`
per training status of the created bots, for example `{ "pending": 80, "discovering": 1, "training": 2, "trained": 37, "failed": 0 }`.

### 43. GET `/api/v1/leads/:id/bot`

**200 OK**:

```json
{
  "id": "6b0f...",
  "leadId": "cmv0...",
  "company": { "id": "cmv0...", "name": "Acme Dental", "domain": "acmedental.sg" },
  "environment": "uat",
  "status": "created",
  "name": "Acme Dental",
  "planTier": "starter",
  "attempts": 1,
  "maxAttempts": 3,
  "nextAt": null,
  "error": "success",
  "chatbotId": "11111111-1111-4111-8111-111111111111",
  "monchaTenantId": "22222222-2222-4222-8222-222222222222",
  "connectionId": "33333333-3333-4333-8333-333333333333",
  "config": {
    "data": {
      "bot_id": "11111111-1111-4111-8111-111111111111",
      "customer_tenant_id": "22222222-2222-4222-8222-222222222222",
      "connection_id": "33333333-3333-4333-8333-333333333333",
      "plan_tier": "starter",
      "funding": "vendor",
      "install": { "tenantId": "22222222-2222-4222-8222-222222222222", "chatbotId": "11111111-1111-4111-8111-111111111111" }
    }
  },
  "createdBotAt": "2026-10-15T10:20:00.000Z",
  "knowledge": {
    "status": "trained",
    "attempts": 1,
    "maxAttempts": 3,
    "nextAt": null,
    "websiteUrl": "https://acmedental.sg/",
    "discoveredUrls": ["https://acmedental.sg/", "https://acmedental.sg/services"],
    "pagesFetched": 2,
    "truncated": false,
    "discoveredAt": "2026-10-15T10:20:05.000Z",
    "documents": [
      { "title": "Acme Dental - Home", "url": "https://acmedental.sg/", "source_type": "url" },
      { "title": "Acme Dental - services", "url": "https://acmedental.sg/services", "source_type": "url" }
    ],
    "trainingKey": "lead-cmv0...-train-v1",
    "trainingId": "44444444-4444-4444-8444-444444444444",
    "trainingResult": { "training_id": "44444444-4444-4444-8444-444444444444", "total": 2, "ready": 2, "failed": 0, "status": "completed" },
    "submittedAt": "2026-10-15T10:20:30.000Z",
    "trainedAt": "2026-10-15T10:21:10.000Z"
  },
  "createdAt": "2026-10-15T10:19:40.000Z",
  "updatedAt": "2026-10-15T10:21:10.000Z"
}
```

`status` `pending` with `nextAt` is waiting for its next try; `failed` has the last error in `error`. `knowledge.status`
`pending` with `knowledge.nextAt` waits for its next try, `training` with `knowledge.nextAt` for its next status poll.
`error` is the last MonCha error of creation or training, `success` once trained. 404 `bot_not_found` when the lead
has no bot yet.

### 44. POST `/api/v1/leads/:id/bot`

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). No body. Creates the lead's bot right away
(3.1 and 3.2 above) instead of waiting for the worker. **201 Created** when MonCha created it now; **200 OK** when the
bot already existed (`outcome: null`) or the try did not succeed (`outcome.status` `retry`, `failed` or `paused`):

```json
{
  "bot": { "...": "as #43" },
  "outcome": { "status": "created", "leadId": "cmv0...", "botId": "6b0f...", "chatbotId": "11111111-1111-4111-8111-111111111111", "planTier": "starter", "name": "Acme Dental" }
}
```

| Status | `code` | When |
|---|---|---|
| 401 / 403 | `unauthorized` / `forbidden` | No editor session |
| 404 | `not_found` | Lead not found |
| 409 | `bot_failed` | The bot already gave up after 3 tries; use #45 |
| 409 | `bot_busy` | The worker is creating this bot right now |
| 503 | `moncha_not_configured` | `MONCHA_INTERNAL_KEY` is not set |

### 45. POST `/api/v1/leads/:id/bot/retry`

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). No body. Puts a `failed` bot back to
`pending` with 3 new tries, or a `failed` training back to `pending` with 3 new tries and a new discovery; the worker
picks it up within seconds. When the lead's latest copy ended with `bot_failed`, a new copy is queued too
(`copyQueued: true`). **200 OK** `{ "bot": { ...as #43 }, "copyQueued": true }`. 404 `bot_not_found`, 409
`bot_not_failed` when neither creation nor training failed.

### 46. POST `/api/v1/leads/:id/bot/train`

**Headers:** `authorization: Bearer <token>` (role `admin` or `operator`). No body. Runs the lead's training step now
instead of waiting for the worker: discover and submit when it waits (**202 Accepted**, `outcome.status: "submitted"`),
or one status poll while it trains (**200 OK**, `outcome.status` `training` or `trained`). Call it again to poll.
**200 OK** with `outcome: null` when the bot is already trained.

```json
{
  "bot": { "...": "as #43" },
  "outcome": { "status": "submitted", "leadId": "cmv0...", "botId": "6b0f...", "trainingId": "44444444-...", "documents": 2, "nextAt": "2026-10-15T10:20:35.000Z" }
}
```

| Status | `code` | When |
|---|---|---|
| 401 / 403 | `unauthorized` / `forbidden` | No editor session |
| 404 | `bot_not_found` | The lead has no bot |
| 409 | `bot_not_created` | The bot is not created yet |
| 409 | `training_failed` | Training already gave up after 3 tries; use #45 |
| 409 | `bot_busy` | The worker is running this bot's training step right now |
| 503 | `moncha_not_configured` | `MONCHA_INTERNAL_KEY` is not set |

---

## How a lead's queue is decided

The worker audits the lead's website in up to three passes and stops at the first clear answer:

1. **HTML check:** fetches the page and looks for known chatbot and live-chat scripts.
2. **Browser render (Playwright):** opens the site in a real browser (home page plus a few internal pages) when
   the HTML check is not sure. Skipped when the site's `robots.txt` blocks crawlers.
3. **AI check (OpenRouter):** only when the first two are still not sure. The AI's answer, confidence and reasons
   are stored on the audit.

The result then sets `queue` and `qualificationReason`:

| Result | `queue` | `qualificationReason` |
|---|---|---|
| Company has no website | `NO_WEBSITE` | `no_website` |
| Audit not finished yet | `PENDING_AUDIT` | `pending_audit` |
| Site is down, parked or blocks access | `INACTIVE` | `website_inactive`, `website_parked`, `website_inaccessible` |
| Chatbot or live chat found | `HAS_ASSISTANT` | `has_assistant` |
| No chatbot, confidence ≥ 0.8 (HTML, render, or AI with confidence ≥ 0.85) | `QUALIFIED` | `no_assistant_high_confidence` |
| No chatbot, but confidence below 0.8 | `NEEDS_REVIEW` | `no_assistant_below_confidence` |
| Still not sure after all passes | `NEEDS_REVIEW` | `uncertain` |
| Reviewer confirmed no chatbot (#29) | `QUALIFIED` | `review_confirmed_no_assistant` |
| Reviewer saw a chatbot (#29) | `HAS_ASSISTANT` | `review_marked_has_assistant` |

Every `NEEDS_REVIEW` lead has an open review task; see [Reviews](#reviews).

WhatsApp, Messenger, Telegram, LINE and Viber links are contact channels, not chatbots, so a site with only those
can still be `QUALIFIED`.

---

## Enums

| Enum | Values |
|---|---|
| Lead queue | `PENDING_AUDIT`, `QUALIFIED`, `HAS_ASSISTANT`, `NO_WEBSITE`, `NEEDS_REVIEW`, `INACTIVE` |
| Assistant verdict | `NO_ASSISTANT`, `HAS_ASSISTANT`, `UNCERTAIN`, `NOT_APPLICABLE` |
| Website status | `UNCHECKED`, `ACTIVE`, `INACTIVE`, `PARKED`, `INACCESSIBLE`, `MISSING` |
| Job status | `pending`, `running`, `done`, `failed` |
| Job type | `country_discovery`, `website_audit`, `places_discovery`, `csv_import`, `site_snapshot` |
| Schedule run trigger | `schedule`, `manual` |
| Website copy origin | `manual`, `auto` |
| Copy automation crawl status | `waiting_audits`, `queuing`, `complete` |
| GitHub push status | `pending`, `pushing`, `pushed`, `failed` |
| Lead bot status (`LeadBot.status`, `Lead.botStatus`) | `pending`, `creating`, `created`, `failed` |
| Lead bot plan tier | `starter`, `growth`, `scale` |
| Lead bot training status (`LeadBot.knowledgeStatus`) | `pending`, `discovering`, `training`, `trained`, `failed` |
| User role | `admin`, `operator`, `viewer` |

---

## Background processing

The API only stores requests. The work is done by the background worker (`apps/worker/src/poller.ts`):

| API call | Needs the worker to |
|---|---|
| `POST /api/v1/schedules` | Start the crawl when the time is due |
| `POST /api/v1/discovery/country` | Run the crawl (job goes `pending` → `running` → `done`) |
| `POST /api/v1/leads` with a domain | Audit the website (lead leaves `PENDING_AUDIT`) |
| `POST /api/v1/leads/:id/audit` | Run the re-audit |
| `POST /api/v1/reviews/:id/resolve` with `request_reaudit` | Run the re-audit |
| `POST /api/v1/source-imports` | Import files over 1,000 rows, and audit the imported leads' websites |
| `POST /api/v1/leads/:id/site-snapshots` | Capture the homepage, extract the brand and upload the copy to R2 |
| `PUT /api/v1/site-automation` with `enabled: true` | Queue copies for qualified leads after each finished crawl |
| Every queued copy (with `MONCHA_INTERNAL_KEY`), `POST /api/v1/leads/:id/bot/retry`, `pnpm bots:backfill` | Create the lead's MonCha bot and train it on the lead's website before the website is copied |
| `POST /api/v1/site-snapshots/:id/github-push` (and every finished copy) | Push the website to its own GitHub repo |
| `POST /api/v1/site-snapshots/:id/deploy` (and every finished copy) | Deploy the website to its own Cloudflare Worker |

On the deployed backend the worker container is not running (the Cloudflare account has no Containers access), so
these jobs stay `pending` until a worker runs, for example `pnpm --filter @moncha/worker start` locally.
Poll `GET /api/v1/jobs/:id` until `status` is `done` or `failed`. `GET /api/v1/worker/health` shows whether a
worker is running.

---

## Local API differences

The local API (`pnpm --filter @moncha/worker api` on port 4000, or the worker itself on `HEALTH_PORT`) serves the
same endpoints 2 to 26 with the same payloads, plus the reviews endpoints 27 to 29. Differences from the deployed
backend:

| Area | Local API | Deployed backend |
|---|---|---|
| `GET /` | Not served (404) | Service index |
| Wrong method on a known path | 405 `method_not_allowed` | 404 `not_found` |
| Body over 10 MB | 413 `payload_too_large` | No 10 MB check (Cloudflare's own request size limit applies) |
| No tenant | 400 if no `x-tenant-id` and no `DEFAULT_TENANT_ID` | `DEFAULT_TENANT_ID`, else `tenant_moncha_internal` |
| `GET /health` `worker` field | Local API: none. Run by the worker: `{ "workerId", "startedAt", "crawlRunning" }` | `{ "running", "status", "lastSeenAt" }` |
| Leads `queue=<one queue>` | Hides chatbot sites when `OMIT_CHATBOT_SITES=true` | `OMIT_CHATBOT_SITES` not applied |
| Lead `company.website` | All website fields filled | Only `id`, `url`, `status`, `title` |
| Lead `company.sourceRecords` | Filled | Always `[]` |
| `openReviewTasks` in counts | Real count | Always `0` |
| Reviews (#27 to #29) | Served | Not served (404) |

---

## Test report

**Review actions (2026-10-05, local API on the Neon dev database): 27 passed, 0 failed.** Run on an isolated test
tenant; every task, job and user it created was removed afterwards and the test lead restored. List: open task
listed with lead, company and audit; hidden from another tenant; `status=bogus` 400; search by domain 200 with
`pageSize=5`; get one 200, unknown 404. Resolve: missing note 400, unknown action 400, invalid token 401, other
tenant 404; `confirm_no_assistant` 200 (lead `QUALIFIED`, version +1, task resolved by `api`, audit log written);
same task again 409; `mark_has_assistant` with `vendor: "tidio"` 200 (`HAS_ASSISTANT`, vendor `tidio`);
`request_reaudit` 200 returning the already-running audit job (`deduped: true`), lead stays `NEEDS_REVIEW`, task
resolved; `POST /api/v1/leads/:id/audit` still 202 deduped; signed-in resolve records the user's email; token of
another tenant 403; `status=resolved` lists the 4 resolved tasks; open list empty; counts `openReviewTasks: 0`.
Plus 10 of 10 unit tests for the resolve logic (including retry when an audit changes the lead at the same time).

**New endpoints (2026-10-05, local API on the Neon dev database): 34 passed, 0 failed.** Worker health: 200
online with job counts. Leads: `queue=ALL` 200, default 200, `queue=all` 400. Auth: register 201; update profile
200 with the name trimmed, empty name 400, no token 401, `me` shows the new name; change password with a wrong
current password 400 `invalid_password`, short new password 400, ok 200 with 1 other session logged out, calling
session still valid, other session 401, old password 401, new password 200; forgot password with a bad email 400
(a valid email returns 503 `service_unavailable` until `RESEND_API_KEY` and `RESET_PASSWORD_URL` are set); reset
password with an unknown token 400 `invalid_token`, ok 200 with a real token, same token again 400
`invalid_token`, old session 401, old password 401, new password 200. Source imports: 4-row CSV imported inline 202
`done` (4 found, 2 created, 1 duplicate in the file, 1 skipped, 2 audits), import status 200 with the console
fields, `records` re-import (1 created, 1 duplicate, 1 audit), `queue=ALL` lists the 3 imported leads,
`google_places` 400 `unsupported_source`, CSV without a name column 400, unknown import 404, 1,001-row CSV queued
202 `pending` and imported by the worker (1,001 created).

**Auth (2026-10-03, deployed version `a67dc3fb`, and the local API): 22 passed, 0 failed on each.** Register: empty
body 400, short password 400, bad email 400, invalid JSON 400, ok 201, duplicate email in other case 409. Login:
missing password 400, wrong password 401, unknown email 401, account without password 401, ok with email in other
case 200. Me: ok 200, no token 401, bogus token 401, after logout 401, other session still valid 200. Logout: no
token 401, ok 200, repeat 200, second session 200. Unknown auth route 404, wrong method 404 (local 405).

**Re-check (2026-10-03, after the audit changes): 26 passed, 0 failed.** Read-only and validation cases only, so no
test data was written: index, health, CORS preflight 204, schedules list, runs, runs `limit=500` 400, bad time 400,
unsupported country 400, invalid JSON 400, delete without country 400, delete unknown schedule 404, discovery
missing country 400, `maxPages=4` 400, unknown job 404, get job 200, leads list 200, bad queue 400, `pageSize=101`
400, filtered list 200, counts 200, get lead 200, unknown lead 404, create without name 400, re-audit unknown lead
404, unknown path 404, `PUT` 404.

**Full run** on 2026-10-03 against the deployed backend (version `4985559e`): **50 passed, 0 failed.**

| Area | Cases |
|---|---|
| Service | index 200, health 200, CORS preflight 204, unknown path 404, unknown API path 404, wrong method 404 |
| Schedules | list 200; create 201 (default zone and `Asia/Tokyo`, by name and by code); duplicate 409; bad time 400; unsupported country 400; bad time zone 400; invalid JSON 400; delete by id 200 then 404; delete by country 200; missing country 400; unsupported country 400; runs 200; `limit=2` 200; `limit=500` 400 |
| Discovery and jobs | missing country 400; unsupported country 400; `maxPages=4` 400; create 202; get job 200; unknown job 404 |
| Leads | list default 200; queue + page 200; search 200; country 200; bad queue 400; `pageSize=101` 400; counts 200; get 200; unknown 404; create missing name 400; create duplicate 200; create without website 201; create with website 201; same domain as URL 200 duplicate; re-audit with open audit 202 deduped; re-audit without domain 404; re-audit unknown lead 404; re-audit new job 202; re-audit again 202 deduped |
