import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const _monchaworker = service("@moncha/worker", {
    source: github("Thinaakar/moncha", { branch: "Backend", checkSuites: false }),
    build: { buildCommand: "pnpm --filter @moncha/worker build", buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile", watchPatterns: ["/apps/worker/**", "/packages/**", "/pnpm-lock.yaml"] },
    start: "pnpm --filter @moncha/worker start",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "monchaworker" },
    env: { DATABASE_URL: preserve(), DATABASE_URL_UNPOOLED: preserve(), DB_ENV: preserve(), DEFAULT_TENANT_ID: preserve(), DIRECT_URL: preserve(), DISCOVERY_MAX_CALLS_PER_DAY: preserve(), DISCOVERY_MAX_CALLS_PER_RUN: preserve(), GOOGLE_PLACES_API_KEY: preserve(), LLM_MAX_CALLS_PER_DAY: preserve(), LLM_TIMEOUT_MS: preserve(), NEON_BRANCH: preserve(), NEXT_PUBLIC_APP_URL: preserve(), OMIT_CHATBOT_SITES: preserve(), OPENROUTER_API_KEY: preserve(), OPENROUTER_BASE_URL: preserve(), OPENROUTER_MODEL: preserve(), PROD_DB_HOST: preserve(), SCHEDULER_TICK_MS: preserve(), SESSION_SECRET: preserve(), WORKER_CONCURRENCY: preserve(), R2_ACCOUNT_ID: preserve(), R2_ACCESS_KEY_ID: preserve(), R2_SECRET_ACCESS_KEY: preserve(), R2_BUCKET: preserve(), SITE_AGENT_MODEL: preserve(), SITE_AGENT_TIMEOUT_MS: preserve(), SITE_PREVIEW_SECRET: preserve(), SITE_PREVIEW_TTL_SEC: preserve(), SITE_JOB_TIMEOUT_MS: preserve(), SITE_MAX_ASSETS: preserve(), SITE_MAX_FILE_MB: preserve(), SITE_MAX_TOTAL_MB: preserve() },
  });
  const monchaConsole = service("moncha-console", {
    source: github("Thinaakar/moncha", { branch: "Backend", checkSuites: false }),
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/console/Dockerfile", watchPatterns: ["/apps/console/**", "/packages/contracts/**", "/packages/config/**", "/pnpm-lock.yaml"] },
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    replicas: { "sfo": 1 },
    env: { BACKEND_URL: preserve(), PORT: preserve(), TENANT_ID: preserve() },
  });

  return project("celebrated-nature", {
    resources: [_monchaworker, monchaConsole],
  });
});
