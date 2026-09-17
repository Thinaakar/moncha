# MonCha Lead Engine — Phase 1

Phase 1 implements the primary loop: **auto discovery → normalize/dedupe → Neon/Postgres → website probe → dashboard review**.

The plan explicitly makes Google Places auto discovery the main path, with CSV/manual entry as fallbacks, and keeps outreach/AI calling/booking out of Phase 1.

## Structure
- `apps/console` — Next.js dashboard + API/BFF
- `apps/worker` — Trigger.dev jobs
- `packages/db` — Prisma schema/repositories
- `packages/contracts` — shared Zod DTOs
- `packages/domain` — provider/DB-free business logic and ports
- `packages/integrations` — Google Places adapter
- `packages/crawling` — basic website HTTP probe; Playwright can slot in later
- `packages/config` — shared TypeScript/ESLint config

## Run
1. `pnpm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `GOOGLE_PLACES_API_KEY`.
3. `pnpm db:generate`
4. `pnpm db:push`
5. `pnpm dev`

The worker jobs are structured for Trigger.dev; deployment requires the Trigger project credentials/configuration.

## Phase 1 exit gates
A: sign in and view leads from Neon.
B: run Discover and have the system fetch companies without spreadsheet upload.
C: auto-find → store → website status → dashboard review.
