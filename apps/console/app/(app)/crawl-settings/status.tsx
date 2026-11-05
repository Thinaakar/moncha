'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/misc';
import { InlineAlert } from '@/components/app/states';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { ColdEmailGate } from '@/lib/types';
import { cn } from '@/lib/utils';

export type EmailDelivery = { label: string; tone: 'info' | 'warning' | 'success' | 'muted'; detail: string };

/** What the backend's cold email gate (COLD_EMAIL_DEV_MODE, COLD_EMAIL_SENDING_ENABLED, allowlist, Resend) allows. */
export function emailDelivery(gate: ColdEmailGate | undefined, forbidden: boolean): EmailDelivery {
  if (forbidden) return { label: 'Editors only', tone: 'muted', detail: 'Email delivery settings are visible to editors.' };
  if (!gate) return { label: 'Checking…', tone: 'muted', detail: 'Loading the email delivery settings.' };
  if (gate.isDevMode) {
    return {
      label: 'Development mode',
      tone: 'info',
      detail: `Automated emails and follow-ups are saved as drafts and never reach a business. Test sends go only to ${formatNumber(
        gate.devInboxes.length,
      )} developer inbox${gate.devInboxes.length === 1 ? '' : 'es'}.`,
    };
  }
  if (!gate.resendConfigured) {
    return { label: 'Not configured', tone: 'warning', detail: 'Resend is not set up on the backend, so nothing can be sent. Emails stay drafts.' };
  }
  if (!gate.sendingEnabled) {
    return { label: 'Sending off', tone: 'warning', detail: 'Sending is switched off on the backend, so every automated email stays a draft.' };
  }
  if (gate.allowlistOpen) {
    return { label: 'Live', tone: 'success', detail: 'Automated emails and follow-ups are sent to every ready business.' };
  }
  return {
    label: 'Allowlist only',
    tone: 'warning',
    detail: `Only ${formatNumber(gate.allowlist.length)} allowlisted address${gate.allowlist.length === 1 ? '' : 'es'} receive email; every other business stays a draft.`,
  };
}

const TONE_DOT: Record<EmailDelivery['tone'], string> = {
  info: 'bg-info',
  warning: 'bg-warning',
  success: 'bg-success',
  muted: 'bg-muted-foreground/40',
};

function StatusCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1 px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex min-h-6 items-center gap-2 text-sm font-medium">{children}</div>
    </div>
  );
}

const Dot = ({ className }: { className: string }) => <span aria-hidden className={cn('size-2 shrink-0 rounded-full', className)} />;

export function StatusStrip({
  active,
  canEdit,
  toggling,
  onToggle,
  workerOnline,
  delivery,
  updatedAt,
  updatedBy,
}: {
  active: boolean;
  canEdit: boolean;
  toggling: boolean;
  onToggle: (next: boolean) => void;
  workerOnline: boolean;
  delivery: EmailDelivery;
  updatedAt: string | null;
  updatedBy: string | null;
}) {
  return (
    <Card className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
      <StatusCell label="Automation engine">
        <Switch
          id="engine-switch"
          checked={active}
          disabled={!canEdit || toggling}
          onCheckedChange={onToggle}
          aria-label="Automation engine"
        />
        <label htmlFor="engine-switch" className={cn(active ? 'text-success' : 'text-muted-foreground')}>
          {active ? 'On' : 'Paused'}
        </label>
      </StatusCell>
      <StatusCell label="Worker">
        <Dot className={workerOnline ? 'bg-success' : 'bg-warning'} />
        <span>{workerOnline ? 'Online' : 'Not reporting'}</span>
      </StatusCell>
      <StatusCell label="Email delivery">
        <Dot className={TONE_DOT[delivery.tone]} />
        <Link href="/outreach" className="truncate hover:underline">
          {delivery.label}
        </Link>
      </StatusCell>
      <StatusCell label="Last saved">
        {updatedAt ? (
          <span className="truncate" title={formatDateTime(updatedAt)}>
            {formatRelative(updatedAt)}
            {updatedBy && <span className="font-normal text-muted-foreground"> by {updatedBy}</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </StatusCell>
    </Card>
  );
}

export function EmailDeliveryNotice({ delivery }: { delivery: EmailDelivery }) {
  if (delivery.tone === 'muted' || delivery.tone === 'success') return null;
  return (
    <InlineAlert variant={delivery.tone === 'info' ? 'info' : 'warning'} title={`Email delivery: ${delivery.label}`}>
      {delivery.detail}
    </InlineAlert>
  );
}
