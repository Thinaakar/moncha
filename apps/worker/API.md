# Moncha Backend API

Every endpoint served by the deployed backend. All examples below are real responses captured from the live
deployment on 2026-10-03 (50 of 50 test cases passed, see [Test report](#test-report)).

- **Base URL (deployed):** `https://moncha-backend.vinothjv4-tech.workers.dev`
- **Base URL (local):** `http://localhost:4000` (`pnpm --filter @moncha/worker api`)
- **Database:** Neon `dev` branch
- **Format:** JSON in, JSON out (`content-type: application/json; charset=utf-8`)

## Contents

- [Summary of all endpoints](#summary-of-all-endpoints)
- [Common rules](#common-rules) (headers, errors, status codes, CORS)
- [Service](#service): `GET /`, `GET /health`
- [Schedules](#schedules): list, create, delete one, delete by country, run history
- [Discovery and jobs](#discovery-and-jobs): start a country crawl, get job status
- [Leads](#leads): list, counts, get one, create, re-audit
- [Enums](#enums)
- [Background processing](#background-processing)
- [Test report](#test-report)

---

## Summary of all endpoints

| # | Method | Endpoint | CRUD | What it does | Success | Tables |
|---|---|---|---|---|---|---|
| 1 | GET | `/` | Read | Service index | 200 | none |
| 2 | GET | `/health` | Read | Health and database check | 200 | none (`SELECT 1`) |
| 3 | OPTIONS | any path | n/a | CORS preflight | 204 | none |
| 4 | GET | `/api/v1/schedules` | Read | List daily schedules, grouped by country | 200 | DiscoverySchedule |
| 5 | POST | `/api/v1/schedules` | Create | Add a daily run time for a country | 201 | DiscoverySchedule |
| 6 | DELETE | `/api/v1/schedules/:id` | Delete | Remove one schedule time | 200 | DiscoverySchedule |
| 7 | DELETE | `/api/v1/schedules?country=` | Delete | Remove all schedule times of a country | 200 | DiscoverySchedule |
| 8 | GET | `/api/v1/schedules/runs` | Read | Country crawl run history | 200 | JobRun |
| 9 | POST | `/api/v1/discovery/country` | Create | Queue a country crawl now | 202 | JobRun |
| 10 | GET | `/api/v1/jobs/:id` | Read | Status of any background job | 200 | JobRun |
| 11 | GET | `/api/v1/leads` | Read | Paginated lead list with filters | 200 | Lead, Company, Website |
| 12 | GET | `/api/v1/leads/counts` | Read | Number of leads per queue | 200 | Lead |
| 13 | GET | `/api/v1/leads/:id` | Read | One lead with company and website | 200 | Lead, Company, Website |
| 14 | POST | `/api/v1/leads` | Create (or Update if duplicate) | Add a lead manually | 201 / 200 | Company, SourceRecord, Lead, Website, JobRun |
| 15 | POST | `/api/v1/leads/:id/audit` | Create + Update | Queue a website re-audit for a lead | 202 | Lead, Website, JobRun |

There are no PUT or PATCH endpoints. To change a schedule time, delete the old one (#6) and create the new one (#5).

---

## Common rules

### Request headers

| Header | Required | Description |
|---|---|---|
| `content-type: application/json` | For POST with a body | Body must be valid JSON. An empty body is treated as `{}`. |
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
| 400 | `validation_error` | Missing or invalid field, invalid JSON body, unsupported country, unknown time zone |
| 401 | `unauthorized` | `x-api-key` is wrong (only when `WORKER_API_KEY` is set) |
| 404 | `not_found` | Unknown route, or the schedule, job or lead does not exist |
| 409 | `conflict` | Schedule already exists for that country and time |
| 500 | `internal_error` | Unexpected server error |
| 503 | `configuration_error` | `DATABASE_URL` is not set on the server |

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
  "endpoints": ["/health", "/api/v1/schedules", "/api/v1/schedules/runs", "/api/v1/leads"]
}
```

The `endpoints` list is informational only; this document is the full list.

### 2. GET `/health`

**CRUD:** Read. Checks the backend and database connection.

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/health
```

**200 OK** (database reachable)

```json
{
  "ok": true,
  "db": "up",
  "tenantId": "tenant_moncha_internal",
  "countries": ["Singapore (SG)", "Malaysia (MY)", "Japan (JP)"]
}
```

**503** when the database is down: `"ok": false`, `"db": "down: <reason>"`.

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` when the database answered |
| `db` | string | `"up"` or `"down: <reason>"` |
| `tenantId` | string | Tenant used for this request |
| `countries` | string[] | Countries the crawler supports |

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
| `queue` | No | `QUALIFIED` | One of the lead queues |
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

### 12. GET `/api/v1/leads/counts`

**CRUD:** Read. Number of leads in each queue (for tabs and badges).

```bash
curl https://moncha-backend.vinothjv4-tech.workers.dev/api/v1/leads/counts
```

**200 OK**

```json
{
  "PENDING_AUDIT": 19,
  "QUALIFIED": 100,
  "HAS_ASSISTANT": 7,
  "NO_WEBSITE": 77,
  "NEEDS_REVIEW": 14,
  "INACTIVE": 9,
  "openReviewTasks": 0
}
```

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

## Enums

| Enum | Values |
|---|---|
| Lead queue | `PENDING_AUDIT`, `QUALIFIED`, `HAS_ASSISTANT`, `NO_WEBSITE`, `NEEDS_REVIEW`, `INACTIVE` |
| Assistant verdict | `NO_ASSISTANT`, `HAS_ASSISTANT`, `UNCERTAIN`, `NOT_APPLICABLE` |
| Website status | `UNCHECKED`, `ACTIVE`, `INACTIVE`, `PARKED`, `INACCESSIBLE`, `MISSING` |
| Job status | `pending`, `running`, `done`, `failed` |
| Job type | `country_discovery`, `website_audit`, `places_discovery`, `csv_import` |
| Schedule run trigger | `schedule`, `manual` |

---

## Background processing

The API only stores requests. The work is done by the background worker (`apps/worker/src/poller.ts`):

| API call | Needs the worker to |
|---|---|
| `POST /api/v1/schedules` | Start the crawl when the time is due |
| `POST /api/v1/discovery/country` | Run the crawl (job goes `pending` → `running` → `done`) |
| `POST /api/v1/leads` with a domain | Audit the website (lead leaves `PENDING_AUDIT`) |
| `POST /api/v1/leads/:id/audit` | Run the re-audit |

On the deployed backend the worker container is not running (the Cloudflare account has no Containers access), so
these jobs stay `pending` until a worker runs, for example `pnpm --filter @moncha/worker start` locally.

---

## Test report

Run on 2026-10-03 against the deployed backend (version `4985559e`): **50 passed, 0 failed.**

| Area | Cases |
|---|---|
| Service | index 200, health 200, CORS preflight 204, unknown path 404, unknown API path 404, wrong method 404 |
| Schedules | list 200; create 201 (default zone and `Asia/Tokyo`, by name and by code); duplicate 409; bad time 400; unsupported country 400; bad time zone 400; invalid JSON 400; delete by id 200 then 404; delete by country 200; missing country 400; unsupported country 400; runs 200; `limit=2` 200; `limit=500` 400 |
| Discovery and jobs | missing country 400; unsupported country 400; `maxPages=4` 400; create 202; get job 200; unknown job 404 |
| Leads | list default 200; queue + page 200; search 200; country 200; bad queue 400; `pageSize=101` 400; counts 200; get 200; unknown 404; create missing name 400; create duplicate 200; create without website 201; create with website 201; same domain as URL 200 duplicate; re-audit with open audit 202 deduped; re-audit without domain 404; re-audit unknown lead 404; re-audit new job 202; re-audit again 202 deduped |
