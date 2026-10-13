import type { LlmPrice, LlmPriceBook, LlmPriceList } from '@moncha/domain';

const REFRESH_MS = 12 * 60 * 60_000;
const RETRY_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export type OpenRouterPriceBookConfig = {
  baseUrl?: string;
  apiKey?: string;
  /** Per-model prices that win over the live list, in USD per token. */
  overrides?: Map<string, LlmPrice>;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/** `model=input/output` pairs in USD per million tokens, comma separated. Bad entries are ignored. */
export function parsePriceOverrides(raw: string | undefined): Map<string, LlmPrice> {
  const prices = new Map<string, LlmPrice>();
  for (const entry of (raw ?? '').split(',')) {
    const match = /^\s*([^=\s]+)\s*=\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/.exec(entry);
    if (!match) continue;
    const input = Number(match[2]);
    const output = Number(match[3]);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      prices.set(match[1]!, { input: input / 1_000_000, output: output / 1_000_000 });
    }
  }
  return prices;
}

const perToken = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Model prices from OpenRouter's public model list, cached for 12 hours. */
export class OpenRouterPriceBook implements LlmPriceBook {
  private cached: { prices: Map<string, LlmPrice>; fetchedAt: number } | null = null;
  private lastAttempt = 0;
  private inflight: Promise<void> | null = null;
  private readonly baseUrl: string;
  private readonly overrides: Map<string, LlmPrice>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly config: OpenRouterPriceBookConfig = {}) {
    this.baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    this.overrides = config.overrides ?? new Map();
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
  }

  async list(): Promise<LlmPriceList> {
    const now = this.now();
    const stale = !this.cached || now - this.cached.fetchedAt > REFRESH_MS;
    if (stale && now - this.lastAttempt > RETRY_MS) {
      this.inflight ??= this.refresh().finally(() => {
        this.inflight = null;
      });
      await this.inflight;
    }
    const prices = new Map(this.cached?.prices ?? []);
    for (const [model, price] of this.overrides) prices.set(model, price);
    return {
      source: this.cached ? 'openrouter' : this.overrides.size ? 'overrides' : 'unavailable',
      fetchedAt: this.cached ? new Date(this.cached.fetchedAt) : null,
      prices,
    };
  }

  private async refresh(): Promise<void> {
    this.lastAttempt = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models`, {
        signal: controller.signal,
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: Array<{ id?: string; pricing?: { prompt?: unknown; completion?: unknown } }> };
      const prices = new Map<string, LlmPrice>();
      for (const model of json.data ?? []) {
        const input = perToken(model.pricing?.prompt);
        const output = perToken(model.pricing?.completion);
        if (model.id && input !== null && output !== null) prices.set(model.id, { input, output });
      }
      if (prices.size) this.cached = { prices, fetchedAt: this.now() };
    } catch {
      // Keep the last good list; the next request after RETRY_MS tries again.
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createPriceBookFromEnv(env: Record<string, string | undefined> = process.env): OpenRouterPriceBook {
  return new OpenRouterPriceBook({
    baseUrl: env.OPENROUTER_BASE_URL || undefined,
    apiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
    overrides: parsePriceOverrides(env.LLM_PRICE_OVERRIDES),
  });
}
