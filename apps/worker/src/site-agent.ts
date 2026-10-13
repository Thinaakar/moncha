import type { SiteGithubPublisher, SiteStore } from '@moncha/domain';
import { createGitHubSitePublisherFromEnv, createR2SiteStoreFromEnv } from '@moncha/integrations';

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
  /** Copies one worker makes at the same time. Each one is a Chromium page, so raise it only with memory to spare. */
  concurrency: number;
  model: string | undefined;
  llmTimeoutMs: number;
  limits: { maxAssets: number; maxFileBytes: number; maxTotalBytes: number };
  /** Origin of the sites Pages project that serves public copy links; null hides the links. */
  publicBaseUrl: string | null;
  /** R2 and the preview secret are both required; otherwise copies cannot be stored or viewed. */
  ready: boolean;
};

function publicBaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

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
    concurrency: Math.min(Math.floor(num('SITE_CONCURRENCY', 1, 1)), 4),
    model: process.env.SITE_AGENT_MODEL?.trim() || undefined,
    llmTimeoutMs: num('SITE_AGENT_TIMEOUT_MS', 90_000, 5_000),
    limits: {
      maxAssets: num('SITE_MAX_ASSETS', 400, 1),
      maxFileBytes: num('SITE_MAX_FILE_MB', 10, 1) * MB,
      maxTotalBytes: num('SITE_MAX_TOTAL_MB', 80, 1) * MB,
    },
    publicBaseUrl: publicBaseUrl(process.env.SITE_PUBLIC_BASE_URL),
    ready: Boolean(store && previewSecret),
  };
  return cached;
}

let cachedPublisher: SiteGithubPublisher | null | undefined;

/** GITHUB_TOKEN + GITHUB_SITES_REPO (+ GITHUB_SITES_BRANCH, default main); null skips the push. */
export function siteGithubPublisher(): SiteGithubPublisher | null {
  if (cachedPublisher === undefined) cachedPublisher = createGitHubSitePublisherFromEnv(process.env);
  return cachedPublisher;
}

/** SITE_AUTO_COPY=false switches the copy automation off on this worker, whatever the console setting says. */
export function siteAutoCopyEnabled(): boolean {
  return process.env.SITE_AUTO_COPY?.trim().toLowerCase() !== 'false';
}
