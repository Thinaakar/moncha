import type { JobStatus } from './index';

/** USD per token for one model. */
export type LlmPrice = { input: number; output: number };

export type LlmPriceList = {
  /** `openrouter` = live model list (plus any overrides), `overrides` = LLM_PRICE_OVERRIDES only. */
  source: 'openrouter' | 'overrides' | 'unavailable';
  fetchedAt: Date | null;
  prices: Map<string, LlmPrice>;
};

export interface LlmPriceBook {
  list(): Promise<LlmPriceList>;
}

export type CostTokens = { input: number; output: number };

/** Price per token for each model stored on copies and audits, matched before the query runs. */
export type ModelPriceRow = { model: string; input: number; output: number };

export type SiteCostFilter = {
  tenantId: string;
  /** Websites whose copies were created at or after this moment; null = all time. */
  since: Date | null;
  prices: ModelPriceRow[];
};

export type SiteCostSort = 'cost' | 'tokens' | 'newest' | 'size';

/** AI and storage spend of one website (one lead): every copy in the window plus all of the lead's AI audits. */
export type SiteCostWebsiteRow = {
  leadId: string;
  company: { id: string; name: string; domain: string | null };
  copies: number;
  aiAudits: number;
  copyTokens: CostTokens;
  auditTokens: CostTokens;
  copyCostUsd: number;
  auditCostUsd: number;
  /** Part of the cost was computed from tokens × price instead of OpenRouter's reported charge. */
  estimated: boolean;
  /** Some tokens belong to a model without a known price, so the cost is a lower bound. */
  unpriced: boolean;
  storageBytes: number;
  firstCopyAt: Date;
  lastCopyAt: Date;
  latest: {
    snapshotId: string;
    status: JobStatus;
    workerStatus: string | null;
    workerUrl: string | null;
    githubRepo: string | null;
  };
};

export type SiteCostTotals = {
  websites: number;
  copies: number;
  aiAudits: number;
  copyTokens: CostTokens;
  auditTokens: CostTokens;
  copyCostUsd: number;
  auditCostUsd: number;
  /** Spend OpenRouter reported per call. */
  exactCostUsd: number;
  /** Spend computed from tokens × the model's current price. */
  estimatedCostUsd: number;
  storageBytes: number;
};

export type SiteCostModelRow = {
  model: string | null;
  kind: 'copy' | 'audit';
  calls: number;
  tokens: CostTokens;
  costUsd: number;
};

export type SiteCostDayRow = { day: string; websites: number; costUsd: number; tokens: number };

export type SiteCostCopyRun = {
  id: string;
  createdAt: Date;
  status: JobStatus;
  model: string | null;
  tokens: CostTokens;
  /** Null when tokens were spent on a model without a known price. */
  costUsd: number | null;
  estimated: boolean;
  totalBytes: number;
  attempts: number;
};

export type SiteCostAuditRun = {
  id: string;
  auditedAt: Date;
  method: string;
  verdict: string;
  model: string | null;
  tokens: CostTokens;
  costUsd: number | null;
  estimated: boolean;
};

export interface SiteCostRepo {
  /** Every model name stored on the tenant's copies and audits. */
  models(tenantId: string): Promise<string[]>;
  summary(filter: SiteCostFilter): Promise<{ totals: SiteCostTotals; byModel: SiteCostModelRow[]; byDay: SiteCostDayRow[] }>;
  websites(
    filter: SiteCostFilter & { page: number; pageSize: number; search?: string; sort: SiteCostSort },
  ): Promise<{ items: SiteCostWebsiteRow[]; total: number; page: number; pageSize: number; totalPages: number }>;
  website(
    filter: Omit<SiteCostFilter, 'since'> & { leadId: string },
  ): Promise<{ row: SiteCostWebsiteRow; copies: SiteCostCopyRun[]; audits: SiteCostAuditRun[] } | null>;
}
