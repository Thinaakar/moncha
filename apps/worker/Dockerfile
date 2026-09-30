# Backend worker image for Cloudflare Containers. Build context is the repository root
# (see image_build_context in wrangler.jsonc). The Playwright tag must match the
# playwright version in packages/crawling so the preinstalled Chromium is used.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@moncha/worker..." \
 && pnpm --filter @moncha/db exec prisma generate

ENV NODE_ENV=production \
    HEALTH_PORT=8080 \
    EVIDENCE_DIR=/tmp/evidence
WORKDIR /app/apps/worker
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/poller.ts"]
