# MonCha internal lead service — API integration guide

This guide is for the backend team building MonCha's business-discovery and demo service. It covers all **23 operations** currently exposed by the internal lead API: creating a demo bot, configuring it, training it from a business website, installing it on a preview site, and managing its lifecycle.

The API uses the secret saved in Admin as a **Bearer credential**. There is no customer login or customer-connect approval in this internal workflow. Authentication is still required on every management request.

**Companion:** import [the Postman collection](./internal-lead-agent.postman_collection.json) for ready-to-edit requests. The collection contains no secret. Examples here are illustrative; IDs, dates, domains and counts must be replaced with your actual values.

## Contents

1. [Setup and authentication](#1-setup-and-authentication)
2. [Recommended integration sequence](#2-recommended-integration-sequence)
3. [Create and manage bots](#3-create-and-manage-bots)
4. [Bot settings](#4-bot-settings)
5. [Widget configuration](#5-widget-configuration)
6. [Domains and installation](#6-domains-and-installation)
7. [Website discovery and training](#7-website-discovery-and-training)
8. [Documents and retraining](#8-documents-and-retraining)
9. [Usage and limits](#9-usage-and-limits)
10. [Retries and errors](#10-retries-and-errors)
11. [Lead-service records and launch checks](#11-lead-service-records-and-launch-checks)
12. [Scope and deployment notes](#12-scope-and-deployment-notes)



## 1. Setup and authentication



### Environment

- **UAT base URL:** `https://api.dev-moncha.com/vendor/internal/v1`
- **Production base URL:** `https://api.moncha.co/vendor/internal/v1`

These are the project API origins; availability of the new routes depends on deployment. A key must be configured separately in the environment you call. Do not assume a UAT key or bot ID works in production.

Have the lead-service backend load these variables from its server configuration:

```text
MONCHA_INTERNAL_BASE_URL=https://api.dev-moncha.com/vendor/internal/v1
MONCHA_INTERNAL_KEY=<secret saved in MonCha Admin>
```

The real key is deliberately omitted from this guide and the collection. Store it in backend secret configuration; never add it to a cloned website, widget initialization, URL, browser request, repository or request log.

### Headers

Every management request:

```http
Authorization: Bearer <MONCHA_INTERNAL_KEY>
Accept: application/json
```

For JSON request bodies, also send:

```http
Content-Type: application/json
```

Create and ingest requests additionally require:

```http
Idempotency-Key: lead-123-create-v1
```

You do **not** need a Clerk token, customer email, customer-connect approval, or `X-Vendor-Tenant-Id`. The server determines the enterprise workspace from the key. If you send `X-Vendor-Tenant-Id`, it must match that workspace or the request fails.

### Prerequisites

In MonCha Admin, the enterprise must have both **API - vendor** and **Internal lead agent** enabled, with the shared secret saved. Its workspace must be provisioned through the existing enterprise onboarding flow, and its subscription must satisfy the existing active/trialing and current-period checks. Paid enterprise billing, bot slots and usage limits apply.

Begin with this read-only request:

```bash
curl --fail-with-body "$MONCHA_INTERNAL_BASE_URL/slots" \
  -H "Authorization: Bearer $MONCHA_INTERNAL_KEY" \
  -H 'Accept: application/json'
```



### Common request conventions

- All paths below are relative to the environment's internal base URL.
- Replace `:botId`, `:documentId` and `:trainingId` with returned UUIDs; do not send the colon placeholders literally.
- Bot creation and the settings, widget, domain, discovery and ingestion JSON objects reject unknown top-level fields. Send only documented fields.
- JSON uses booleans/numbers, not strings such as `"true"` or `"50"`.
- Maximum request body: **11 MiB**, with smaller per-field and per-request limits below.
- Rate limit: **300 requests/minute per enterprise**, shared with its external Vendor API traffic. Respect `429` and `Retry-After`.
- Response envelopes vary by operation. For example, creation uses `data`, settings uses `settings`, and install returns fields at the top level.



## 2. Recommended integration sequence

For each business lead:

1. Save the business's original website URL and a stable lead identifier in your service.
2. Call `GET /slots` and choose a tier with capacity. The create operation remains the authoritative capacity check if requests race.
3. Call `POST /bots` with a stable creation idempotency key. Persist the returned bot and tenant IDs immediately.
4. Call `PUT /bots/:botId/settings` to define language, instructions and persona.
5. Call `PUT /bots/:botId/widget` to set the displayed business name, greeting and appearance.
6. Call `PUT /bots/:botId/domains` with the **preview website's hostname**.
7. Call discovery for the **original business website**; choose useful pages from the returned URLs.
8. Call ingestion with those selected pages. Persist every returned training ID.
9. Poll each job until training finishes. Investigate failed documents; a queued response does not mean the bot is trained.
10. Fetch install details, add the widget to your hosted preview, and test a question grounded in the source website.
11. Mark the preview ready in your service before your existing outreach workflow shares it.

Website discovery by country, cloning, hosting, lead records and cold-email sending belong to the lead service. These APIs handle the MonCha bot portion of that sequence.

## 3. Create and manage bots



### 3.1 Available slots — `GET /slots`

No body. Success: **200**.

```json
{
  "data": {
    "starter": { "allocated": 20, "used": 3, "available": 17 },
    "growth": { "allocated": 5, "used": 1, "available": 4 },
    "scale": { "allocated": 0, "used": 0, "available": 0 }
  }
}
```

Counts reflect the enterprise's existing allocation pool. Paused bots keep their allocation. Creating a bot consumes one available slot in its selected tier; deleting releases its allocation through the existing lifecycle.

### 3.2 Create — `POST /bots`

Required header: `Idempotency-Key`.

```json
{
  "name": "Acme Demo L123",
  "plan_tier": "starter",
  "language": "en"
}
```

Fields:

- `name`: required string, trimmed, **1–30 characters**. Must be unique within the workspace. Include a short lead identifier if business names repeat.
- `plan_tier`: required, `starter`, `growth` or `scale`; needs an available slot in that tier.
- `language`: optional string, **2–10 characters**, defaults to `en`. Set the desired reply language in bot settings as well.

Do not send `tenant_id`, `customer_tenant_id`, `connection_id`, a website URL or prospect email here. Ownership is derived from the credential. Website URLs are supplied during discovery/ingestion.

```bash
curl --fail-with-body -X POST "$MONCHA_INTERNAL_BASE_URL/bots" \
  -H "Authorization: Bearer $MONCHA_INTERNAL_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: lead-123-create-v1' \
  --data '{"name":"Acme Demo L123","plan_tier":"starter","language":"en"}'
```

Success: **201**.

```json
{
  "data": {
    "bot_id": "11111111-1111-4111-8111-111111111111",
    "customer_tenant_id": "22222222-2222-4222-8222-222222222222",
    "connection_id": "33333333-3333-4333-8333-333333333333",
    "plan_tier": "starter",
    "funding": "vendor",
    "install": {
      "tenantId": "22222222-2222-4222-8222-222222222222",
      "chatbotId": "11111111-1111-4111-8111-111111111111"
    }
  }
}
```

`bot_id` and `install.chatbotId` identify the same bot. `customer_tenant_id` and `install.tenantId` identify the **MonCha enterprise workspace**, despite the inherited response field name. This operation does not create a separate tenant/account for each prospect. `connection_id` is an internal ownership grant; you do not need to pass it on subsequent calls.

Persist the result against your lead ID. `GET /bots` (3.8) lists the bots this key manages, but it carries no lead reference: your stored `bot_id` is what links a bot to its lead.

### 3.3 Read — `GET /bots/:botId`

No body. Success: **200**.

```json
{
  "data": {
    "bot_id": "11111111-1111-4111-8111-111111111111",
    "customer_tenant_id": "22222222-2222-4222-8222-222222222222",
    "name": "Acme Demo L123",
    "plan_tier": "starter",
    "is_active": true,
    "vendor_deactivated_at": null
  }
}
```



### 3.4 Update basic properties — `PATCH /bots/:botId`

All fields are optional; send only properties being changed:

```json
{
  "name": "Acme Demo L123",
  "is_active": true,
  "auto_sync_enabled": false
}
```

- `name`: trimmed string, 1–30 characters.
- `is_active`: boolean; controls normal public bot availability.
- `auto_sync_enabled`: boolean; enables/disables the existing scheduled knowledge refresh, subject to tier/contract capabilities.

Success: **200**, with the same `data` shape as reading a bot. That response does not include `auto_sync_enabled`. This endpoint does not change the plan tier. Set `widget.botName` separately if you have overridden the displayed name.

### 3.5 Pause — `POST /bots/:botId/deactivate`

No body. Success: **200**, `{"ok":true}`.

Sets the vendor deactivation state. The bot's slot remains reserved; pausing does not cancel or reduce enterprise billing.

### 3.6 Resume — `POST /bots/:botId/reactivate`

No body. Success: **200**, `{"ok":true}`.

Clears vendor deactivation and requires an existing allocation. `is_active`, widget `chatDisabled`, paid entitlement and domain rules are separate controls. Resuming does not automatically undo `is_active:false` or `chatDisabled:true`.

### 3.7 Delete — `DELETE /bots/:botId`

No body. Success: **200**.

```json
{"deleted":"11111111-1111-4111-8111-111111111111"}
```

Use for intentional demo cleanup. Bot deletion is destructive; associated resource cleanup is dispatched asynchronously. Remove the preview widget and update your lead record. Deletion does not itself cancel the enterprise subscription. There is no restore endpoint in this API.

### 3.8 List — `GET /bots`

```http
GET /bots?limit=50
GET /bots?limit=50&cursor=<next_cursor from the previous page>
```

| Query | Rules |
| --- | --- |
| `limit` | 1–100, default 50 |
| `cursor` | Optional bot UUID returned as `next_cursor` |

Returns only the demo bots this key can manage, which are the same bots accepted by every `/bots/:botId` route. External customers' bots and ordinary enterprise bots are never listed. Results are ordered by `bot_id`. Repeat with `cursor=next_cursor` until `next_cursor` is `null`. Deleting a bot between pages does not break paging. No migration is required; the same Bearer key, rate limit and paid-enterprise requirement apply.

Success: **200**.

```json
{
  "data": [
    {
      "bot_id": "<bot UUID>",
      "name": "Acme demo",
      "plan_tier": "growth",
      "is_active": true,
      "vendor_deactivated_at": null,
      "live": true,
      "created_at": "2026-10-17T03:00:00.000Z",
      "limits": { "message_limit": 6000, "pages_limit": 25000, "voice_minutes_limit": 180 },
      "usage": { "messages": 12, "voice_minutes": 0, "pages": 40 },
      "training": { "pending": 1, "failed": 0 }
    }
  ],
  "total": 7,
  "next_cursor": "<bot UUID, or null on the last page>"
}
```

- `limits` are the plan-tier quotas: Starter 2,500 messages / 5,000 pages / 60 voice minutes; Growth 6,000 / 25,000 / 180; Scale 25,000 / 100,000 / 600.
- `usage.messages` and `usage.voice_minutes` cover the current monthly window. They return `0` once the window has reset, matching `GET /bots/:botId/usage`. `usage.pages` is the total trained pages.
- `live` is `true` when the bot holds a plan slot and has not been deactivated. A paused bot (`POST /bots/:botId/deactivate`) shows `live: false`.
- `training.pending` counts queued or processing documents. `training.failed` counts failed documents.
- `total` is the number of manageable demo bots across all pages.
- Remaining slot capacity per tier is still returned by `GET /slots`.

In this lead service, the console's MonCha settings → Bots table reads this list through `GET /api/v1/moncha/bots?cursor=&limit=` and links each bot to its lead by the stored `bot_id` (`LeadBot.chatbotId`).

## 4. Bot settings



### 4.1 Read — `GET /bots/:botId/settings`

No body. Success: **200**, `{"settings":{...}}`. The object contains stored settings merged with defaults.

### 4.2 Write — `PUT /bots/:botId/settings`

Send the settings object directly, **not** a `settings` wrapper:

```json
{
  "modelTier": "fast",
  "language": "en",
  "languageMode": "match",
  "supportedLanguages": ["en"],
  "historyMessages": 2,
  "instructionPreset": "custom",
  "instructions": "Answer questions about Acme using its website information. Do not invent prices, services or opening hours. If information is unavailable, say so.",
  "personaPreset": "custom",
  "persona": "Friendly, clear and concise.",
  "temperature": 0.3,
  "fallbackMessage": "I do not have that information yet. Please contact the business directly.",
  "collectUserData": "off",
  "captureMode": "off"
}
```

Success: **200**, `{"settings":{...}}`, containing submitted settings merged with defaults.

**Replacement semantics:** this PUT replaces saved settings. Omitted custom values are removed and defaults apply where defined. For an existing bot, GET first, merge your changes into the returned `settings`, and PUT the resulting object. Serialize updates per bot to avoid overwriting concurrent edits.

### All accepted settings fields

Every field is optional. Limits below are validation limits, not recommended prompt lengths.

- `modelTier`: `fast` or `quality`; default `fast`.
- `language`: string, 2–10 characters; settings default `en-IN`. Explicitly send your desired language even if it was supplied during creation.
- `languageMode`: `match` or `fixed`; default `match`.
- `supportedLanguages`: up to 40 language codes, each 2–10 characters. Empty/omitted permits all supported languages; use supported product language codes such as `en`, `ja-JP` or `hi-IN`.
- `fallbackMessage`: string, maximum 500 characters.
- `historyMessages`: integer 0–6; default 2.
- `instructions`: string, maximum 4,000 characters.
- `instructionPreset`: string, maximum 40 characters. Use `custom` with explicit `instructions` for your own behavior.
- `persona`: string, maximum 2,000 characters.
- `personaPreset`: string, maximum 40 characters. Use `custom` with explicit `persona` for your own tone.
- `temperature`: number 0–1; default 0.5.
- `collectUserData`: `mandatory`, `optional` or `off`; default `off`. Controls the legacy upfront form.
- `collectFields`: up to three values from `name`, `email`, `phone`; default `["email"]`.
- `captureMode`: `off`, `passive`, `conversational` or `form`; default `off`. Passive scores conversations; conversational can ask for contact details; form uses the upfront form.
- `leadGoal`: string, maximum 2,000 characters, describing what counts as a lead for this business.
- `notifyThreshold`: integer 0–100; default 75. Sets the existing lead-notification score threshold; it does not configure notification recipients or create a webhook.
- `translations`: object keyed by language code of 2–10 characters. Each value accepts an optional `fallbackMessage` of maximum 500 characters.

Example translation fragment, to merge into the full settings object:

```json
{"translations":{"en":{"fallbackMessage":"Please contact the business for more information."}}}
```

The minimal reply-settings defaults are:

```json
{
  "modelTier": "fast", "language": "en-IN", "languageMode": "match",
  "historyMessages": 2, "collectUserData": "off", "collectFields": ["email"],
  "temperature": 0.5, "captureMode": "off", "notifyThreshold": 75
}
```



## 5. Widget configuration



### 5.1 Read — `GET /bots/:botId/widget`

No body. Success: **200**, `{"config":{...}}`, containing saved configuration merged with defaults and the bot name.

### 5.2 Write — `PUT /bots/:botId/widget`

Send configuration directly, **not** a `config` wrapper:

```json
{
  "botName": "Acme Assistant",
  "welcomeMessage": "Hello! How can I help you learn about Acme?",
  "tooltip": "Ask a question about Acme",
  "inputPlaceholder": "Type your question...",
  "primaryColor": "#1677FF",
  "position": "bottom-right",
  "iconSize": "medium",
  "iconShape": "circle",
  "quickPrompts": ["What services do you offer?", "How can I contact you?"],
  "chatDisabled": false,
  "voiceMode": false,
  "hideBranding": false
}
```

Success: **200**, `{"config":{...}}`, with merged defaults. **This PUT replaces saved configuration.** Read, merge and write when modifying an existing configuration. `hideBranding:true` is rejected with `403 branding_locked`.

### All accepted widget fields

All fields are optional. Enabling a UI element does not provision an underlying channel/service or bypass its entitlement/setup requirements.

**Content and colors**

- `botName`: string, 1–30 characters.
- `tooltip`, `disabledMessage`: strings, maximum 300 characters each.
- `welcomeMessage`, `disclaimerText`: strings, maximum 500 characters each.
- `inputPlaceholder`: string, maximum 80 characters.
- `primaryColor`, `textColor`, `linkColor`, `iconBgColor`, `botAvatarBgColor`, `voiceOrbColor`: six-digit hex colors, such as `#1677FF`.
- `launcherIconUrl`, `botIconUrl`, `userIconUrl`, `agentIconUrl`: valid URL strings for already-hosted images; this API has no image upload endpoint.
- `transparentIconBg`, `showExpand`, `darkMode`: booleans.
- `fontSize`: integer 11–20.
- `chatHeightPct`: integer 40–100.

**Behavior**

- `autoOpenDesktopSec`, `autoOpenMobileSec`: integer 0–120 or `null`.
- `requireTerms`, `rtl`, `chatDisabled`, `showDownload`: booleans.
- `termsUrl`, `externalLinkUrl`: valid URL strings.
- `maxMessagesPerConversation`: integer 0–100. Zero removes the per-conversation cap; account and bot quotas still apply.

**Position and visibility**

- `iconSize`: `small`, `medium`, `large`.
- `iconShape`: `circle`, `square`, `rounded`.
- `position`: `bottom-right`, `bottom-left`.
- `offsetBottom`, `offsetSide`, `offsetBottomMobile`, `offsetSideMobile`: integers 0–200.
- `launcherShade`: integer 0–100, controlling launcher shadow strength.
- `hideBranding`, `hideSources`, `hideFeedback`, `hideRefresh`, `hideTooltip`, `voiceMode`: booleans. Keep `hideBranding` false; voice still requires the normal supporting service and allowance.
- `ticketDepartments`: object mapping department IDs to booleans; omitted/true is visible.
- `watermarkLink`, `watermarkIconUrl`: valid URL strings. Existing branding restrictions continue to apply.

**Prompts and localization**

- `quickPrompts`: up to 6 strings, each 1–120 characters.
- `followUpChips`: boolean.
- `followUpPrompts`: up to 3 strings, each 1–120 characters.
- `translations`: object keyed by language code of 2–10 characters. Each entry accepts `welcomeMessage` (max 500), `tooltip` (max 300), and `quickPrompts` (up to 6 strings, each 1–120).
- `strings`: optional UI text overrides. Accepted keys and maximum character lengths:
  - 40: `online`, `send`, `recording`, `fieldName`, `fieldEmail`, `fieldPhone`, `submit`, `skip`.
  - 60: `poweredBy`, `openChat`, `closeChat`, `talkToHuman`.
  - 80: `placeholder`, `startVoice`, `stopVoice`.
  - 200: `errorGeneric`, `errorNoResponse`, `handoffSent`, `handoffFailed`, `leadThanks`.
  - 500: `welcome`.

**Booking and home shortcut**

- `bookingEnabled`: boolean.
- `bookingConfig`: optional object with:
  - `label`: string, maximum 60 characters.
  - `requireNotes`, `visitorPicksTime`: booleans.
  - `hoursStart`, `hoursEnd`: strings in `HH:MM` form; use valid clock times.
  - `slotMinutes`: integer 1–1,440.
  - `mapsUrl`: string, maximum 2,000 characters.
  - `extraFields`: up to 5 objects, each containing `key` (string max 40), `label` (string max 60), and `required` (boolean).
- `homeChannels`: array with **at most one** object containing:
  - `type`: `whatsapp`, `facebook`, `x`, `twitter`, `line` or `booking`. `twitter` normalizes to `x`.
  - `url`: valid URL, maximum 2,000 characters. Required for Facebook/X/LINE; optional for WhatsApp; forbidden for booking.
  - `logo`: optional string, maximum 40 characters. WhatsApp accepts `green`, `black`, `white`; Facebook `primary`, `secondary`; X `black`, `white`.
  - A booking shortcut requires `bookingEnabled:true` in the submitted configuration.

A WhatsApp shortcut is a widget link; it does not create or configure a WhatsApp bot/channel. Channel setup APIs are outside this internal endpoint group.

## 6. Domains and installation



### 6.1 Read domains — `GET /bots/:botId/domains`

No body. Success: **200**.

```json
{"domains":["preview.example.com"]}
```



### 6.2 Set domains — `PUT /bots/:botId/domains`

```json
{"domains":["preview.example.com"]}
```

`domains` is required: at most 20 strings, maximum 253 characters each. Prefer bare hostnames. Inputs are normalized to hostnames; schemes, paths and ports are not separate restrictions. Stored duplicates are removed. Success: **200**, `{"domains":["preview.example.com"]}`.

This replaces the whole list. A nonempty list enables the domain restriction, and subdomains of listed hosts are also allowed. MonCha's own configured surfaces retain existing access. `{"domains":[]}` disables the domain restriction; it does not mean “block every domain.”

Use the hosted **preview domain**, not the source business website, unless the widget is actually installed there. Domain restrictions do not protect the management credential; keep the key on your backend.

### 6.3 Get installation values — `GET /bots/:botId/install`

No body. Success: **200**. Example when a widget URL has not been configured:

```json
{
  "tenantId": "22222222-2222-4222-8222-222222222222",
  "chatbotId": "11111111-1111-4111-8111-111111111111",
  "apiUrl": "https://api.dev-moncha.com",
  "widgetUrl": null
}
```

`widgetUrl` is the configured widget JavaScript URL, or `null`. When null, obtain the correct deployed widget asset URL from the MonCha team before rendering the embed. Do not guess it from the API hostname.

Use these returned values in your preview template:

```html
<!-- Replace the placeholders with installation values from your backend. -->
<script src="WIDGET_URL_FROM_INSTALL_RESPONSE"></script>
<script>
  window.MonCha.init({
    tenantId: "TENANT_ID_FROM_INSTALL_RESPONSE",
    chatbotId: "BOT_ID_FROM_INSTALL_RESPONSE",
    apiUrl: "API_ORIGIN_FROM_INSTALL_RESPONSE"
  });
</script>
```

Load the widget script before calling `init`; if using async loading, call `init` from its load callback. `apiUrl` is the returned API **origin**, without `/vendor/internal/v1`. The widget uses its normal public runtime. Never pass the internal secret to the widget. Always include `chatbotId` so the intended demo bot is selected.

## 7. Website discovery and training



### 7.1 Discover pages — `POST /bots/:botId/knowledge/discover`

No idempotency header required.

```json
{
  "url": "https://example.com/",
  "max_pages": 50,
  "exclude_paths": ["/privacy", "/terms"]
}
```

Fields:

- `url`: required public website URL, maximum 2,048 characters. Local/private addresses are rejected.
- `max_pages`: optional integer 1–100; default 100.
- `include_paths`, `exclude_paths`: optional arrays, each up to 20 strings of maximum 200 characters, passed to the discovery provider as path filters.

Success: **200**.

```json
{
  "urls": ["https://example.com/", "https://example.com/services"],
  "pagesFetched": 2,
  "truncated": false,
  "next_step": "Select URLs and POST knowledge/ingest-bulk. Discovery does not train documents."
}
```

Discovery requires the configured crawler provider and uses the existing discovery implementation. Returned candidates are filtered for public URLs; counts/coverage are not a guarantee that every site page was found. **Discovery creates no trained documents.** Select useful URLs and submit them for ingestion.

### 7.2 Train one document — `POST /bots/:botId/knowledge/ingest`

Required header: `Idempotency-Key`.

```json
{
  "documents": [
    { "title": "Acme home", "url": "https://example.com/", "source_type": "url" }
  ]
}
```

The `documents` array must contain **exactly one** document. Training the homepage does not automatically train the whole website.

```bash
curl --fail-with-body -X POST \
  "$MONCHA_INTERNAL_BASE_URL/bots/$MONCHA_BOT_ID/knowledge/ingest" \
  -H "Authorization: Bearer $MONCHA_INTERNAL_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: lead-123-home-training-v1' \
  --data '{"documents":[{"title":"Acme home","url":"https://example.com/","source_type":"url"}]}'
```

Set `MONCHA_BOT_ID` to the UUID saved from creation before running that command.

Success: **202**.

```json
{
  "data": {
    "training_id": "44444444-4444-4444-8444-444444444444",
    "status": "queued",
    "total": 1
  }
}
```



### 7.3 Train several documents — `POST /bots/:botId/knowledge/ingest-bulk`

Required header: `Idempotency-Key`. Same document schema, with **1–100** entries:

```json
{
  "documents": [
    { "title": "Acme home", "url": "https://example.com/", "source_type": "url" },
    {
      "title": "Acme services",
      "url": "https://example.com/services",
      "source_type": "url",
      "scrape_options": { "extractMainOnly": true, "excludeSelectors"i: ["nav", "footer"] }
    }
  ]
}
```

Success: **202**, the same `data` shape as single ingestion, with `total` matching the submitted count. Split larger selections into batches; persist one stable idempotency key and one training ID per batch. Each batch still has to fit the body and page/training limits.

### Document payload fields

- `title`: required trimmed string, 1–300 characters.
- Exactly **one** of:
  - `url`: public URL, maximum 2,048 characters.
  - `text`: nonempty string, maximum 200,000 characters.
- `source_type`: optional `url`, `qa` or `snippet`; default `url`. Use `url` for a source URL, `snippet` for text and `qa` for question/answer text.
- `scrape_options`: optional object:
  - `extractMainOnly`: boolean.
  - `includeSelectors`, `excludeSelectors`: arrays with at most 30 CSS selector strings each, maximum 200 characters per string.

Example text document, sent within `documents`:

```json
{
  "documents": [
    { "title": "Acme contact FAQ", "text": "Q: How can I contact Acme?\nA: Use the contact form on the business website.", "source_type": "qa" }
  ]
}
```

The examples are alternatives. Do not ingest the same homepage through both single and bulk examples unless you intentionally want separate documents. A new idempotency key does not deduplicate by source URL.

### 7.4 Check training — `GET /bots/:botId/training/:trainingId`

No body. Success: **200**.

```json
{
  "training_id": "44444444-4444-4444-8444-444444444444",
  "total": 1,
  "ready": 1,
  "failed": 0,
  "status": "completed",
  "documents": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "title": "Acme home",
      "status": "ready",
      "chunk_count": 3,
      "pages_count": 1
    }
  ],
  "poll_after_seconds": 5
}
```

Job statuses:

- `processing`: some documents are still pending/working; continue polling.
- `completed`: no remaining pending documents or failures. Check `total` and `ready` against your expected batch size before marking a preview ready, especially if documents were deleted/retrained during the job.
- `partial_failure`: at least one ready document and at least one failed document. Review/retry failures and decide explicitly whether the remaining material is sufficient.
- `failed`: all terminal documents failed. Do not mark the preview ready.

Poll no faster than `poll_after_seconds` (currently 5). Bound your worker's waiting time and resume polling later if necessary. A timeout in your worker does not mean server training stopped; do not submit a fresh ingestion request simply because polling took too long. There is no internal training-completion webhook endpoint in this API group.

## 8. Documents and retraining



### 8.1 List — `GET /bots/:botId/knowledge`

No body or pagination parameters. Success: **200**.

```json
{
  "data": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "title": "Acme home",
      "source_url": "https://example.com/",
      "source_type": "url",
      "status": "ready",
      "chunk_count": 3,
      "pages_count": 1,
      "error_message": null
    }
  ]
}
```

A text document can have `source_url:null`. Failed documents have a generic error message. Save document IDs for maintenance.

### 8.2 Read one — `GET /bots/:botId/knowledge/:documentId`

No body. Success: **200**, `{"data":{...}}` with the same document fields as above plus `content` and `synced_at`. These additional fields can be null. Content may include extracted website text, so keep it in your backend if you do not need it in the preview UI.

### 8.3 Retrain — `POST /bots/:botId/knowledge/:documentId/retrain`

No body; no required idempotency header. Success: **202**.

```json
{
  "data": {
    "training_id": "66666666-6666-4666-8666-666666666666",
    "status": "queued",
    "document_id": "55555555-5555-4555-8555-555555555555"
  }
}
```

Uses the existing document/source. Poll the returned training ID. If the document is already queued/processing, the implementation returns its current job/status. After a job completes, another retrain request may start another job. This endpoint is not covered by the creation/ingestion idempotency contract; inspect current state after an uncertain response before posting again.

### 8.4 Delete a document — `DELETE /bots/:botId/knowledge/:documentId`

No body. Success: **200**.

```json
{"deleted":"55555555-5555-4555-8555-555555555555"}
```

Removes that document and schedules associated cleanup. It does not delete the bot. Avoid deleting/retraining documents in a batch while another worker is relying on its training completion counts.

## 9. Usage and limits



### `GET /bots/:botId/usage`

No body. Success: **200**. Top-level fields:

- `funding`: `vendor` for these internally provisioned bots.
- `live`: current sponsored-entitlement state, not a complete widget-readiness check.
- `plan_tier`: the allocated tier.
- `limits`: the existing resolved plan object, including `message_limit`, `pages_limit`, `voice_minutes_limit` and other plan capabilities. Read returned values instead of hard-coding a billing policy.
- `usage`: `messages`, `voice_minutes` and `pages` counters.

Illustrative excerpt, not the full `limits` object:

```json
{
  "funding": "vendor",
  "live": true,
  "plan_tier": "starter",
  "limits": { "message_limit": 2500, "pages_limit": 5000, "voice_minutes_limit": 60 },
  "usage": { "messages": 12, "voice_minutes": 0, "pages": 2 }
}
```

The internal key does not provide free bots, unlimited training, quota resets or a payment bypass. Existing enterprise slots, per-bot limits, contract restrictions and subscription gates remain applicable. All management routes require eligible enterprise access, including reads and cleanup operations.

## 10. Retries and errors



### Idempotency

Required for `POST /bots`, `POST .../knowledge/ingest` and `POST .../knowledge/ingest-bulk`:

- Header value length: **8–200 characters**.
- Allowed characters: letters, digits, underscore, colon, period and hyphen.
- Generate a stable key per logical operation and save it **before** sending the request.
- Retry a timeout/uncertain response using the same key and identical JSON payload.
- A reused key with a different payload returns `409 idempotency_conflict`.
- Training keys are enterprise-scoped; include a lead/bot reference, operation and batch/version so separate jobs cannot collide.
- Use a new key only for an intentionally new operation. A new key after a timeout can create another bot or duplicate documents.
- Deleting a bot does not remove its creation idempotency record. Retrying its old key can return its original IDs; use a deliberately new operation key when replacing a deleted bot.

Examples: `lead-123-create-v1`, `lead-123-bot-abc-ingest-batch-01-v1`.

### Error bodies

Business/auth errors generally look like:

```json
{
  "error": { "code": "slot_unavailable", "message": "slot unavailable" }
}
```

Some responses also include `request_id`. Save it when present. Do not require it or `error.message` to exist on every error: body-limit responses may contain only `error.code`.

Schema validation failures return **400** and can use the validator's `success:false` / `error` shape instead of an `error.code` envelope. Handle HTTP status first, then inspect available error details; do not assume every unsuccessful response has the same structure.

### Common errors and actions

- **400** `idempotency_key_required`: header missing or invalid. Correct it and retain the stable operation key.
- **400** `invalid_bot_id`, `invalid_domain`, or JSON schema failure: fix the request. Check UUIDs, allowed fields, enum values and length limits.
- **401** `invalid_internal_credentials`: key absent, incorrect, replaced, or internal/vendor feature disabled. Check the environment and Admin configuration.
- **401** `vendor_tenant_mismatch`: remove the unnecessary tenant header or use the matching enterprise workspace.
- **402** `vendor_subscription_required`: enterprise activation/payment/current period is not eligible; ingestion/discovery also require live sponsored entitlement. Have the MonCha administrator resolve the state.
- **403** `vendor_disabled`, `internal_workspace_unavailable`, `connection_revoked`, `insufficient_consent` or `insufficient_scope`: resolve enterprise/workspace/access configuration; do not retry repeatedly unchanged.
- **403** `branding_locked`: do not send `hideBranding:true`.
- **404** `bot_not_found`: wrong ID/environment, deleted bot, or bot outside this internal credential's permitted ownership.
- **404** `document_not_found`, `training_not_found`: verify the resource belongs to the supplied bot and environment.
- **409** `slot_unavailable`: no suitable available slot, or a lifecycle operation needs a valid allocation. Check `GET /slots` and the bot's state.
- **409** `bot_name_taken`: choose a unique name within 30 characters. Treat a changed create payload as a revised operation.
- **409** `idempotency_conflict`: recover your original key/payload mapping; do not silently create a new operation.
- **409** `training_limit_reached` or `kb_pages_limit`: existing training/page capacity is exhausted. Review usage and batch size; a new key does not bypass the limit.
- **413** `payload_too_large`: request exceeds 11 MiB; also respect each document's individual limits.
- **429** `rate_limit_exceeded`: wait for `Retry-After`, with backoff/jitter across workers.
- **503** `discovery_unavailable`: crawler provider unavailable/unconfigured; retry with a bounded policy or contact MonCha.
- **503** `request_failed`: generic server failure. Capture operation/status/request ID; retry only with the operation's appropriate retry rules.

Retry transient network/429/5xx failures with bounded exponential backoff and jitter. For create/ingest, keep the same key and body. GETs can be retried; configuration replacement should use the same intended snapshot without overwriting newer changes. For DELETE/retrain and lifecycle actions, reconcile current state before a blind repeat. Do not retry authentication, validation, ownership or billing errors indefinitely.

## 11. Lead-service records and launch checks



### Save per lead

Keep these fields in your own database; they are **not additional MonCha API payload fields**:

- Environment and your lead/business ID.
- Original website URL and hosted preview URL/domain.
- MonCha `bot_id`, `customer_tenant_id` and optional `connection_id`.
- Selected `plan_tier`.
- Creation idempotency key and exact request payload.
- Each selected URL batch, its ingestion key, payload, training ID and completion state.
- Document IDs when maintenance/retraining is needed.
- Current preview readiness, last API error/request ID and outreach state.

Keep the shared credential in the service secret store, rather than copying it into every lead record.

### UAT launch checks

1. Verify `GET /slots` succeeds using the intended environment and credential.
2. Create one deliberate test demo and save its IDs. Retrying the same key/body should return the original bot, not consume another slot.
3. Configure settings/widget/domain and read them back.
4. Submit one real public source page; poll until the expected document is ready.
5. Fetch install values; ensure `widgetUrl` is usable and the widget answers on the intended preview domain.
6. Confirm the preview HTML and browser management traffic contain no internal secret.
7. Exercise pause/resume if your service uses them; delete the test bot only when finished with that fixture.
8. Run the lead-service workflow once through its normal readiness/outreach handoff before scaling workers.



### Postman use

Import `internal-lead-agent.postman_collection.json`. Set `internal_key` as a **local, unshared environment secret**; its collection default is blank. The collection defaults to UAT. Set `base_url`, a unique `lead_ref`, `bot_name`, `source_url` and `preview_domain` for the test.

Run requests individually in workflow order. Create captures `bot_id` and `tenant_id`; ingest/retrain captures `training_id`; polling/listing can capture `document_id`. Each new training response replaces the collection's single training variable, so your real service must persist all batch IDs separately. Change `lead_ref` and `bot_name` for a new demo; retain both and the exact payload during retries. Single and bulk ingestion are alternative examples, not a script to run consecutively against duplicate URLs.

**Do not run the whole collection unattended.** It includes manual lifecycle and destructive cleanup examples. The collection provides payloads; it is not the lead service's orchestration logic. Remove local secrets before exporting or sharing an environment.

## 12. Scope and deployment notes

This credential can manage bots provisioned through this internal service within its own enterprise, including after key rotation. It cannot manage ordinary enterprise bots or external customers' bots.

Not exposed by this internal endpoint group:

- Customer connect, prospect account creation, customer claiming or bot ownership transfer.
- Listing ordinary enterprise bots or external customers' bots (`GET /bots` lists only this key's demo bots), or changing a bot's tier through `/bots/:botId/plan`.
- File uploads, document text-edit endpoints, Notion/Google Drive source connections.
- WhatsApp/email channel provisioning, functions, webhooks or API & Agents token/MCP management.
- Billing mutations, invoice management, unlimited allowances, or quota resets.
- Website cloning/hosting or cold-email sending.

External Vendor API clients continue to use `/vendor/v1` and their existing credentials/tenant header/customer approval. Workspace API & Agents remains a separate integration surface.

### MonCha operator rollout

Apply migration `078_internal_lead_agent.sql` after 077 before deploying the corresponding API/Admin changes. Complete existing enterprise onboarding and billing, enable both Admin options and save the key. The server stores a hash. Blank key on edit retains the existing credential; replacing it invalidates the previous credential. Disabling either internal access or Vendor API removes the internal credential, and re-enabling requires a new one.

Disabling the key blocks service management access; it does not automatically deactivate existing demo bots. If a demo must be taken offline, perform the bot lifecycle action while access is available or use the existing administrative controls.

### Contract source

This guide is derived from the repository implementation, not a live production deployment test:

- `src/routes/internalLead.ts`: creation and internal route allowlist.
- `src/lib/internalLead.ts`: credential, billing and ownership checks.
- `src/routes/vendor.ts`, `src/lib/vendor.ts`: shared operations and error handling.
- `src/lib/botSettings.ts`, `src/lib/widgetConfig.ts`: request schemas/defaults.
- `migrations/063_api_vendor.sql` through `078_internal_lead_agent.sql`: provisioning, training, mutations and ownership storage.
- `../moncha-widget/src/index.ts`: browser widget initialization.

The guide and collection do not change application behavior or perform deployments.