'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  DiscoveryOptions,
  Job,
  JobStatus,
  JobType,
  Lead,
  LeadQueue,
  Paginated,
  QueueCounts,
  ReviewTask,
  ScheduleGroup,
  ScheduleRun,
  SiteSnapshotDetail,
  SiteSnapshotQueued,
  SiteSnapshotSource,
  SiteSnapshotSummary,
  SourceImport,
  SystemHealth,
  WorkerHealth,
} from '@/lib/types';

export const qk = {
  counts: ['leads', 'counts'] as const,
  leads: (q: object) => ['leads', 'list', q] as const,
  lead: (id: string) => ['leads', 'detail', id] as const,
  reviews: (q: object) => ['reviews', 'list', q] as const,
  jobs: (q: object) => ['jobs', 'list', q] as const,
  job: (id: string) => ['jobs', 'detail', id] as const,
  sourceImport: (id: string) => ['source-imports', id] as const,
  schedules: ['schedules'] as const,
  runs: (limit: number) => ['schedules', 'runs', limit] as const,
  options: ['discovery', 'options'] as const,
  worker: ['worker', 'health'] as const,
  health: ['health'] as const,
  sites: ['site-snapshots'] as const,
  siteList: (q: object) => ['site-snapshots', 'list', q] as const,
  leadSites: (leadId: string) => ['site-snapshots', 'lead', leadId] as const,
  site: (id: string) => ['site-snapshots', 'detail', id] as const,
  siteSource: (id: string) => ['site-snapshots', 'source', id] as const,
};

const isTerminal = (status: JobStatus | undefined) => status === 'done' || status === 'failed';

export function useQueueCounts() {
  return useQuery({ queryKey: qk.counts, queryFn: () => api<QueueCounts>('leads/counts'), refetchInterval: 30_000 });
}

export type LeadListParams = {
  queue: LeadQueue | 'ALL';
  page: number;
  pageSize: number;
  search?: string;
  country?: string;
};

export function useLeads(params: LeadListParams) {
  return useQuery({
    queryKey: qk.leads(params),
    queryFn: () => api<Paginated<Lead>>('leads', { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: string) {
  return useQuery({ queryKey: qk.lead(id), queryFn: () => api<Lead>(`leads/${id}`) });
}

export type ReviewListParams = {
  status: 'open' | 'resolved' | 'all';
  page: number;
  pageSize: number;
  search?: string;
  country?: string;
};

export function useReviews(params: ReviewListParams) {
  return useQuery({
    queryKey: qk.reviews(params),
    queryFn: () => api<Paginated<ReviewTask>>('reviews', { query: params }),
    placeholderData: keepPreviousData,
  });
}

export type JobListParams = { page: number; pageSize: number; type?: JobType; status?: JobStatus };

export function useJobs(params: JobListParams) {
  return useQuery({
    queryKey: qk.jobs(params),
    queryFn: () => api<Paginated<Job>>('jobs', { query: params }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((j) => !isTerminal(j.status)) ? 5_000 : 30_000),
  });
}

/** Polls until the job is done or failed. */
export function useJob(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.job(id ?? ''),
    queryFn: () => api<Job>(`jobs/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? false : 2_500),
  });
}

export function useSourceImport(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.sourceImport(id ?? ''),
    queryFn: () => api<SourceImport>(`source-imports/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? false : 2_500),
  });
}

export function useSchedules() {
  return useQuery({
    queryKey: qk.schedules,
    queryFn: async () => (await api<{ countries: ScheduleGroup[] }>('schedules')).countries,
    refetchInterval: 60_000,
  });
}

export function useScheduleRuns(limit = 50) {
  return useQuery({
    queryKey: qk.runs(limit),
    queryFn: async () => (await api<{ runs: ScheduleRun[] }>('schedules/runs', { query: { limit } })).runs,
    refetchInterval: (q) => (q.state.data?.some((r) => !isTerminal(r.status)) ? 5_000 : 30_000),
  });
}

export function useDiscoveryOptions() {
  return useQuery({
    queryKey: qk.options,
    queryFn: () => api<DiscoveryOptions>('discovery/options'),
    staleTime: Infinity,
  });
}

export function useWorkerHealth() {
  return useQuery({ queryKey: qk.worker, queryFn: () => api<WorkerHealth>('worker/health'), refetchInterval: 30_000 });
}

export function useSystemHealth() {
  return useQuery({ queryKey: qk.health, queryFn: () => api<SystemHealth>('health'), refetchInterval: 60_000 });
}

export type SiteListParams = { page: number; pageSize: number; status?: JobStatus; search?: string };

/** Paginated website copies; polls while any copy is still being made. */
export function useSiteSnapshots(params: SiteListParams) {
  return useQuery({
    queryKey: qk.siteList(params),
    queryFn: () => api<Paginated<SiteSnapshotSummary>>('site-snapshots', { query: params }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((s) => !isTerminal(s.status)) ? 4_000 : 60_000),
  });
}

export function useLeadSiteSnapshots(leadId: string) {
  return useQuery({
    queryKey: qk.leadSites(leadId),
    queryFn: async () => (await api<{ items: SiteSnapshotSummary[] }>(`leads/${leadId}/site-snapshots`)).items,
    refetchInterval: (q) => (q.state.data?.some((s) => !isTerminal(s.status)) ? 4_000 : false),
  });
}

/**
 * One website copy. Polls while it is being made, and refreshes every 30 minutes once done so the
 * signed file links (valid 1 hour) never expire on an open page.
 */
export function useSiteSnapshot(id: string) {
  return useQuery({
    queryKey: qk.site(id),
    queryFn: () => api<SiteSnapshotDetail>(`site-snapshots/${id}`),
    staleTime: (q) => (isTerminal(q.state.data?.status) ? 20 * 60_000 : 0),
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? 30 * 60_000 : 3_000),
  });
}

export function useSiteSource(id: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.siteSource(id),
    queryFn: () => api<SiteSnapshotSource>(`site-snapshots/${id}/source`),
    enabled,
    staleTime: Infinity,
  });
}

export function useCreateSiteSnapshot(leadId: string) {
  return useApiMutation(
    () => api<SiteSnapshotQueued>(`leads/${leadId}/site-snapshots`, { method: 'POST' }),
    [qk.sites, ['jobs']],
  );
}

/** Proxy URL for a backend-relative website copy path (`site-files/<token>/...`). */
export function siteFileUrl(path: string, download = false) {
  return `/api/proxy/${path}${download ? '?download=1' : ''}`;
}

/** Mutation that refreshes the given query prefixes on success. */
export function useApiMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  invalidate: ReadonlyArray<readonly unknown[]> = [],
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}
