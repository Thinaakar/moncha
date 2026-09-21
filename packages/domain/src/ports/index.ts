export type LeadStatus = 'discovered' | 'review' | 'rejected';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';
export type JobType = 'places_discovery' | 'csv_import' | 'manual' | 'website_check';

export type AuthContext = {
  userId: string;
  tenantId: string;
  role: string;
};

export type DiscoveredCompany = {
  name: string;
  domain?: string;
  websiteUrl?: string;
  country?: string;
  city?: string;
  phone?: string;
  address?: string;
  source: string;
  externalId?: string;
  raw?: unknown;
};

export type CompanyRecord = {
  id: string;
  tenantId: string;
  name: string;
  domain?: string | null;
  country?: string | null;
  city?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type LeadRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  status: LeadStatus;
  createdAt?: Date;
  updatedAt?: Date;
};

export type SourceRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  source: string;
  externalId?: string | null;
  rawJson?: unknown;
};

export type WebsiteResult = {
  reachable: boolean;
  finalUrl?: string;
  httpStatus?: number;
  title?: string;
  error?: string;
};

export type WebsiteRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  url: string;
  reachable?: boolean | null;
  finalUrl?: string | null;
  httpStatus?: number | null;
  title?: string | null;
  lastCheckedAt?: Date | null;
};

export type JobRunRecord = {
  id: string;
  tenantId: string;
  type: JobType;
  status: JobStatus;
  inputJson?: unknown;
  resultJson?: unknown;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt?: Date;
};

export type DiscoveryJobResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
  websiteChecks: number;
  companies: CompanyRecord[];
};

export type LeadListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  country?: string;
  status?: LeadStatus;
};

export type LeadListItem = LeadRecord & {
  company: CompanyRecord & {
    website?: WebsiteRecord | null;
    sourceRecords?: SourceRecord[];
  };
};

export type LeadListResult = {
  items: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface DiscoverySource {
  discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]>;
}

export interface WebsiteChecker {
  check(url: string): Promise<WebsiteResult>;
}

export type CompanyWrite = {
  tenantId: string;
  name: string;
  domain?: string | null;
  country?: string | null;
  city?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type CompanyPatch = Partial<Omit<CompanyWrite, 'tenantId'>>;

export type SourceWrite = {
  tenantId: string;
  companyId: string;
  source: string;
  externalId?: string;
  rawJson?: unknown;
};

export interface CompanyRepo {
  findByDomain(tenantId: string, domain: string): Promise<CompanyRecord | null>;
  create(data: CompanyWrite): Promise<CompanyRecord>;
  update(tenantId: string, id: string, data: CompanyPatch): Promise<CompanyRecord | null>;
  upsertSource(data: SourceWrite): Promise<SourceRecord>;
}

export interface LeadRepo {
  create(data: { tenantId: string; companyId: string; status: LeadStatus }): Promise<LeadRecord>;
  findByCompany(tenantId: string, companyId: string): Promise<LeadRecord | null>;
  get(tenantId: string, id: string): Promise<LeadListItem | null>;
  list(tenantId: string, query: LeadListQuery): Promise<LeadListResult>;
}

export type JobPatch = {
  status?: JobStatus;
  error?: string | null;
  resultJson?: unknown;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export interface JobRepo {
  create(tenantId: string, type: JobType, input: unknown): Promise<JobRunRecord>;
  update(tenantId: string, id: string, data: JobPatch): Promise<JobRunRecord | null>;
  get(tenantId: string, id: string): Promise<JobRunRecord | null>;
}

export interface WebsiteRepo {
  upsert(data: {
    tenantId: string;
    companyId: string;
    url: string;
    reachable?: boolean | null;
    finalUrl?: string | null;
    httpStatus?: number | null;
    title?: string | null;
    lastCheckedAt?: Date | null;
  }): Promise<WebsiteRecord>;
}

export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ['running', 'failed'],
  running: ['done', 'failed'],
  done: [],
  failed: ['running'],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function clampPageSize(pageSize?: number, fallback = 25, max = 100): number {
  if (pageSize === undefined || Number.isNaN(pageSize) || pageSize < 1) return fallback;
  return Math.min(max, Math.floor(pageSize));
}

export function clampPage(page?: number): number {
  if (page === undefined || Number.isNaN(page) || page < 1) return 1;
  return Math.floor(page);
}
