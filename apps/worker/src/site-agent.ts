import type { SiteStore } from '@moncha/domain';
import { createR2SiteStoreFromEnv } from '@moncha/integrations';

const MB = 1024 * 1024;

function num(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export type SiteAgentConfig = {
  store: SiteStore | null;
  previewSecret: string | null;
  previewTtlSec: number;
  jobTimeoutMs: number;
  model: string | undefined;
  llmTimeoutMs: number;
  limits: { maxAssets: number; maxFileBytes: number; maxTotalBytes: number };
  /** R2 and the preview secret are both required; otherwise copies cannot be stored or viewed. */
  ready: boolean;
};

let cached: SiteAgentConfig | null = null;

/** Website-copy agent settings from apps/worker/.env (read once). */
export function siteAgentConfig(): SiteAgentConfig {
  if (cached) return cached;
  const store = createR2SiteStoreFromEnv(process.env);
  const previewSecret = process.env.SITE_PREVIEW_SECRET?.trim() || null;
  cached = {
    store,
    previewSecret,
    previewTtlSec: num('SITE_PREVIEW_TTL_SEC', 3600, 60),
    jobTimeoutMs: num('SITE_JOB_TIMEOUT_MS', 240_000, 30_000),
    model: process.env.SITE_AGENT_MODEL?.trim() || undefined,
    llmTimeoutMs: num('SITE_AGENT_TIMEOUT_MS', 90_000, 5_000),
    limits: {
      maxAssets: num('SITE_MAX_ASSETS', 400, 1),
      maxFileBytes: num('SITE_MAX_FILE_MB', 10, 1) * MB,
      maxTotalBytes: num('SITE_MAX_TOTAL_MB', 80, 1) * MB,
    },
    ready: Boolean(store && previewSecret),
  };
  return cached;
}
