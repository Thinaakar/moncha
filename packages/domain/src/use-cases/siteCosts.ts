import type { LlmPrice, LlmPriceBook, LlmPriceList, ModelPriceRow, SiteCostRepo, SiteCostSort } from '../ports';

/** Cloudflare R2 Standard storage in USD per GB-month (the account's first 10 GB-month are free). */
export const R2_STORAGE_USD_PER_GB_MONTH = 0.015;
const GB = 1024 ** 3;
const DAY_MS = 86_400_000;

export function storageUsdPerMonth(bytes: number): number {
  return (bytes / GB) * R2_STORAGE_USD_PER_GB_MONTH;
}

/**
 * The listed price of a stored model name: the exact id, else the longest listed id it extends
 * (`openai/gpt-4o-mini-2024-07-18` or `google/gemini-3.5-flash:free` still find their base model).
 */
export function priceForModel(model: string, prices: Map<string, LlmPrice>): LlmPrice | null {
  const exact = prices.get(model);
  if (exact) return exact;
  let best: { id: string; price: LlmPrice } | null = null;
  for (const [id, price] of prices) {
    if ((model.startsWith(`${id}-`) || model.startsWith(`${id}:`)) && (!best || id.length > best.id.length)) {
      best = { id, price };
    }
  }
  return best?.price ?? null;
}

/** Start of the UTC day `days - 1` days before `now`, so a 7-day window holds exactly 7 calendar days. */
export function costWindowStart(now: Date, days: number | undefined): Date | null {
  if (!days) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (days - 1) * DAY_MS);
}

export type SiteCostDeps = { costs: SiteCostRepo; prices: LlmPriceBook };

export type SiteCostPricing = {
  list: LlmPriceList;
  /** Prices of the models actually stored on copies and audits. */
  rows: ModelPriceRow[];
  /** Stored models without a known price; their tokens are not in the cost. */
  unpriced: string[];
};

async function pricing(deps: SiteCostDeps, tenantId: string): Promise<SiteCostPricing> {
  const [list, models] = await Promise.all([deps.prices.list(), deps.costs.models(tenantId)]);
  const rows: ModelPriceRow[] = [];
  const unpriced: string[] = [];
  for (const model of models) {
    const price = priceForModel(model, list.prices);
    if (price) rows.push({ model, input: price.input, output: price.output });
    else unpriced.push(model);
  }
  return { list, rows, unpriced };
}

export async function getSiteCostSummary(deps: SiteCostDeps, input: { tenantId: string; days?: number; now?: Date }) {
  const since = costWindowStart(input.now ?? new Date(), input.days);
  const prices = await pricing(deps, input.tenantId);
  const summary = await deps.costs.summary({ tenantId: input.tenantId, since, prices: prices.rows });
  return { ...summary, since, days: input.days ?? null, pricing: prices };
}

export async function listSiteCostWebsites(
  deps: SiteCostDeps,
  input: { tenantId: string; days?: number; page: number; pageSize: number; search?: string; sort: SiteCostSort; now?: Date },
) {
  const since = costWindowStart(input.now ?? new Date(), input.days);
  const prices = await pricing(deps, input.tenantId);
  const page = await deps.costs.websites({
    tenantId: input.tenantId,
    since,
    prices: prices.rows,
    page: input.page,
    pageSize: input.pageSize,
    search: input.search,
    sort: input.sort,
  });
  return { ...page, pricing: prices };
}

export async function getSiteCostWebsite(deps: SiteCostDeps, input: { tenantId: string; leadId: string }) {
  const prices = await pricing(deps, input.tenantId);
  const detail = await deps.costs.website({ tenantId: input.tenantId, leadId: input.leadId, prices: prices.rows });
  return detail ? { ...detail, pricing: prices } : null;
}
