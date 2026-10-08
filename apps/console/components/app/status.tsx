import { CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type { AssistantVerdict, JobStatus, JobType, LeadQueue, WebsiteStatus } from '@/lib/types';
import { humanize } from '@/lib/format';

export const QUEUES: Array<{ value: LeadQueue; label: string; description: string; variant: BadgeVariant }> = [
  { value: 'QUALIFIED', label: 'Qualified', description: 'No assistant detected — ready for outreach', variant: 'success' },
  { value: 'PENDING_AUDIT', label: 'Pending audit', description: 'Waiting for the website audit', variant: 'info' },
  { value: 'NEEDS_REVIEW', label: 'Needs review', description: 'Uncertain audit — a human decides', variant: 'warning' },
  { value: 'HAS_ASSISTANT', label: 'Has assistant', description: 'Chatbot or live chat already present', variant: 'secondary' },
  { value: 'NO_WEBSITE', label: 'No website', description: 'Business has no website on record', variant: 'muted' },
  { value: 'INACTIVE', label: 'Inactive', description: 'Site parked, down or unreachable', variant: 'destructive' },
];

const queueMeta = Object.fromEntries(QUEUES.map((q) => [q.value, q])) as Record<LeadQueue, (typeof QUEUES)[number]>;

export function queueLabel(queue: LeadQueue) {
  return queueMeta[queue]?.label ?? humanize(queue);
}

export function QueueBadge({ queue }: { queue: LeadQueue }) {
  const meta = queueMeta[queue];
  return (
    <Badge variant={meta?.variant ?? 'outline'} dot>
      {meta?.label ?? humanize(queue)}
    </Badge>
  );
}

const verdictMeta: Record<AssistantVerdict, { label: string; variant: BadgeVariant }> = {
  NO_ASSISTANT: { label: 'No assistant', variant: 'success' },
  HAS_ASSISTANT: { label: 'Has assistant', variant: 'secondary' },
  UNCERTAIN: { label: 'Uncertain', variant: 'warning' },
  NOT_APPLICABLE: { label: 'Not applicable', variant: 'muted' },
};

export function VerdictBadge({ verdict }: { verdict: AssistantVerdict | null }) {
  if (!verdict) return <Badge variant="muted">Not audited</Badge>;
  const meta = verdictMeta[verdict];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

const websiteMeta: Record<WebsiteStatus, BadgeVariant> = {
  UNCHECKED: 'muted',
  ACTIVE: 'success',
  INACTIVE: 'destructive',
  PARKED: 'warning',
  INACCESSIBLE: 'destructive',
  MISSING: 'muted',
};

export function WebsiteStatusBadge({ status }: { status: WebsiteStatus | null | undefined }) {
  if (!status) return <Badge variant="muted">No website</Badge>;
  return (
    <Badge variant={websiteMeta[status]} dot>
      {humanize(status)}
    </Badge>
  );
}

const jobMeta: Record<JobStatus, { variant: BadgeVariant; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { variant: 'muted', icon: Clock },
  running: { variant: 'info', icon: Loader2 },
  done: { variant: 'success', icon: CheckCircle2 },
  failed: { variant: 'destructive', icon: XCircle },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const meta = jobMeta[status] ?? { variant: 'outline' as const, icon: CircleDashed };
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant}>
      <Icon className={status === 'running' ? 'animate-spin' : undefined} />
      {humanize(status)}
    </Badge>
  );
}

export const JOB_TYPES: Array<{ value: JobType; label: string }> = [
  { value: 'country_discovery', label: 'Country discovery' },
  { value: 'website_audit', label: 'Website audit' },
  { value: 'csv_import', label: 'CSV import' },
  { value: 'site_snapshot', label: 'Website copy' },
  { value: 'places_discovery', label: 'Places discovery' },
];

export function jobTypeLabel(type: JobType) {
  return JOB_TYPES.find((t) => t.value === type)?.label ?? humanize(type);
}
