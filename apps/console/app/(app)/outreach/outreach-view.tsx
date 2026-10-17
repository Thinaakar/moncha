'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Mail, ShieldAlert, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import { useCanEdit, useUser } from '@/components/app/user-context';
import {
  useColdEmailAutomation,
  useColdEmailCandidates,
  useColdEmailGate,
  useColdEmails,
  useCreateColdEmailDraft,
  usePreviewColdEmail,
  useSendColdEmail,
  useSendColdEmailDraft,
  useUpdateColdEmailAutomation,
} from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import type { ColdEmail, ColdEmailCandidate, ColdEmailGate, ColdEmailStatus } from '@/lib/types';
import { useUrlState } from '@/lib/use-url-state';
import { cn } from '@/lib/utils';

const STATUS_VARIANT: Record<ColdEmailStatus, 'muted' | 'info' | 'success' | 'destructive' | 'warning'> = {
  draft: 'muted',
  queued: 'info',
  sent: 'success',
  failed: 'destructive',
  suppressed: 'warning',
};

const ORIGIN_LABEL: Record<NonNullable<ColdEmail['origin']>, string> = { manual: 'Manual', auto: 'Automation', test: 'Test' };

function canDeliverTo(gate: { allowlist: string[]; allowlistOpen: boolean; sendingEnabled: boolean }, email: string) {
  if (!gate.sendingEnabled) return false;
  if (gate.allowlistOpen) return true;
  return gate.allowlist.map((e) => e.toLowerCase()).includes(email.trim().toLowerCase());
}

function AutomationCard({ gate }: { gate: ColdEmailGate | undefined }) {
  const automation = useColdEmailAutomation();
  const update = useUpdateColdEmailAutomation();
  const canEdit = useCanEdit();
  const [cap, setCap] = useState('');
  const data = automation.data;
  useEffect(() => {
    if (data) setCap(String(data.dailyCap));
  }, [data?.dailyCap]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(input: Parameters<typeof update.mutateAsync>[0], done: string) {
    try {
      await update.mutateAsync(input);
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const sendBlockedNote =
    data?.mode === 'send'
      ? gate?.sendingEnabled
        ? gate.allowlistOpen
          ? 'Send mode with an open allowlist emails every ready business.'
          : 'Send mode, but only allowlisted addresses are sent; every company address stays a draft.'
        : 'Send mode, but sending is off on the backend, so everything stays a draft.'
      : 'Draft mode: drafts wait in the Outbox for you to approve. Nothing is sent.';

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4 space-y-0">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Workflow className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            Automation
            {data &&
              (data.enabled ? (
                <Badge variant="success" dot>
                  On · {data.mode === 'send' ? 'Send' : 'Draft only'}
                </Badge>
              ) : (
                <Badge variant="muted" dot>
                  Off
                </Badge>
              ))}
          </CardTitle>
          <CardDescription>
            Every 5 minutes, each lead whose demo is fully ready (bot trained, chatbot on the live site, domain locked,
            company email known) and that was never emailed gets an email, up to the daily cap.
          </CardDescription>
        </div>
        {data && (
          <Switch
            checked={data.enabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(enabled) => void save({ enabled }, enabled ? 'Automation on' : 'Automation off')}
            aria-label="Cold email automation"
          />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {automation.isError ? (
          <ErrorState title="Could not load automation" error={automation.error} onRetry={() => void automation.refetch()} />
        ) : !data ? (
          <TableSkeleton rows={2} columns={3} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">Ready now</p>
                <p className="text-lg font-semibold tabular-nums">{formatNumber(data.readyNow)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">Today</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatNumber(data.usedToday)} <span className="text-sm font-normal text-muted-foreground">/ {formatNumber(data.dailyCap)}</span>
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Mode</p>
                <Select
                  value={data.mode}
                  disabled={!canEdit || update.isPending}
                  onValueChange={(mode) => void save({ mode: mode as 'draft' | 'send' }, `Mode: ${mode}`)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft only</SelectItem>
                    <SelectItem value="send">Send (allowlist only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Daily cap</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={cap}
                    disabled={!canEdit}
                    onChange={(e) => setCap(e.target.value)}
                    className="h-9"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canEdit || update.isPending || Number(cap) === data.dailyCap || !/^\d+$/.test(cap) || Number(cap) > 500}
                    onClick={() => void save({ dailyCap: Number(cap) }, 'Daily cap saved')}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {sendBlockedNote}
              {data.updatedBy && (
                <>
                  {' '}
                  Last changed by {data.updatedBy}
                  {data.updatedAt && <span title={formatDateTime(data.updatedAt)}> {formatRelative(data.updatedAt)}</span>}.
                </>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function OutreachView() {
  const url = useUrlState();
  const page = url.getNumber('page', 1);
  const readyOnly = url.get('readyOnly', '1') !== '0';
  const tab = url.get('tab', 'candidates') === 'sent' ? 'sent' : 'candidates';

  const gate = useColdEmailGate();
  const candidates = useColdEmailCandidates({ page, pageSize: 25, readyOnly });
  const sent = useColdEmails({ page, pageSize: 25 });
  const preview = usePreviewColdEmail();
  const draft = useCreateColdEmailDraft();
  const send = useSendColdEmail();
  const sendDraft = useSendColdEmailDraft();
  const canEdit = useCanEdit();
  const testInbox = useUser().user.email.trim().toLowerCase();
  const testAllowed = Boolean(gate.data && canDeliverTo(gate.data, testInbox));
  const [busyEmailId, setBusyEmailId] = useState<string | null>(null);

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);

  const allowlistHint = useMemo(() => {
    if (!gate.data) return null;
    if (!gate.data.sendingEnabled) return 'Sending is off (COLD_EMAIL_SENDING_ENABLED). Drafts and previews still work.';
    if (gate.data.allowlistOpen) return 'Allowlist is open (*) — any address can receive mail.';
    if (!gate.data.allowlist.length) return 'Allowlist is empty — nobody can receive mail.';
    return `Only allowlisted addresses can receive mail: ${gate.data.allowlist.join(', ')}`;
  }, [gate.data]);

  async function onPreview(c: ColdEmailCandidate) {
    if (!c.demoUrl) {
      toast.error('This lead has no live demo URL yet');
      return;
    }
    setBusyLeadId(c.leadId);
    try {
      const result = await preview.mutateAsync({ companyName: c.companyName, demoUrl: c.demoUrl });
      setPreviewHtml(result.html);
      setPreviewSubject(result.subject);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyLeadId(null);
    }
  }

  async function onDraft(c: ColdEmailCandidate) {
    if (!c.demoUrl || !c.companyEmail) {
      toast.error('Need a company email and live demo URL');
      return;
    }
    setBusyLeadId(c.leadId);
    try {
      await draft.mutateAsync({
        leadId: c.leadId,
        companyName: c.companyName,
        toEmail: c.companyEmail,
        demoUrl: c.demoUrl,
      });
      toast.success('Draft saved — not sent');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyLeadId(null);
    }
  }

  async function onSendAllowlisted(c: ColdEmailCandidate, deliverTo: string) {
    if (!c.demoUrl) {
      toast.error('This lead has no live demo URL yet');
      return;
    }
    if (!gate.data || !canDeliverTo(gate.data, deliverTo)) {
      toast.error('Recipient is not on the allowlist (or sending is disabled)');
      return;
    }
    setBusyLeadId(c.leadId);
    try {
      const row = await send.mutateAsync({
        leadId: c.leadId,
        companyName: c.companyName,
        toEmail: c.companyEmail ?? deliverTo,
        deliverTo,
        demoUrl: c.demoUrl,
      });
      toast.success(`Sent to ${row.deliveredTo}`);
      url.set({ tab: 'sent', page: null });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyLeadId(null);
    }
  }

  /** The lead's exact email, delivered only to your own (allowlisted) inbox; recorded as a test, not as emailing the lead. */
  async function onSendTest(c: ColdEmailCandidate) {
    if (!c.demoUrl) {
      toast.error('This lead has no live demo URL yet');
      return;
    }
    if (!testAllowed) {
      toast.error(`${testInbox} is not on COLD_EMAIL_ALLOWLIST (or sending is off)`);
      return;
    }
    setBusyLeadId(c.leadId);
    try {
      const row = await send.mutateAsync({
        leadId: c.leadId,
        companyName: c.companyName,
        toEmail: c.companyEmail ?? testInbox,
        deliverTo: testInbox,
        demoUrl: c.demoUrl,
      });
      toast.success(`Test sent to ${row.deliveredTo}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyLeadId(null);
    }
  }

  async function onApproveDraft(row: ColdEmail) {
    setBusyEmailId(row.id);
    try {
      const sent = await sendDraft.mutateAsync(row.id);
      toast.success(`Sent to ${sent.deliveredTo}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyEmailId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cold email"
        description="Digest-style outreach for live MonCha demos. Delivery is blocked unless the address is on COLD_EMAIL_ALLOWLIST."
      />

      {gate.isError ? (
        <ErrorState title="Could not load send gate" error={gate.error} onRetry={() => void gate.refetch()} />
      ) : gate.data ? (
        <Card>
          <CardHeader className="flex-row items-start gap-4 space-y-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldAlert className="size-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                Send gate
                {gate.data.sendingEnabled ? (
                  <Badge variant="warning" dot>
                    Enabled
                  </Badge>
                ) : (
                  <Badge variant="muted" dot>
                    Disabled
                  </Badge>
                )}
                {gate.data.resendConfigured ? (
                  <Badge variant="success" dot>
                    Resend ready
                  </Badge>
                ) : (
                  <Badge variant="destructive" dot>
                    Resend missing
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>{allowlistHint}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <p>
              From: <span className="font-mono text-foreground">{gate.data.from}</span>
            </p>
            <p>
              Allowlist:{' '}
              <span className="font-mono text-foreground">
                {gate.data.allowlistOpen ? '*' : gate.data.allowlist.length ? gate.data.allowlist.join(', ') : '(empty)'}
              </span>
            </p>
          </CardContent>
        </Card>
      ) : null}

      <AutomationCard gate={gate.data} />

      <InlineAlert variant="warning" title="Lead owners are not emailed">
        Sending to a company address (automation in send mode, or approving a draft) stays blocked until that address is
        on <span className="font-mono">COLD_EMAIL_ALLOWLIST</span>. Preview, Draft and Send test (to your own allowlisted
        inbox) are safe.
      </InlineAlert>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={tab === 'candidates' ? 'default' : 'outline'}
          onClick={() => url.set({ tab: null, page: null })}
        >
          Candidates
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === 'sent' ? 'default' : 'outline'}
          onClick={() => url.set({ tab: 'sent', page: null })}
        >
          Outbox
        </Button>
        {tab === 'candidates' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => url.set({ readyOnly: readyOnly ? '0' : null, page: null })}
          >
            {readyOnly ? 'Showing ready only' : 'Showing all leads'}
          </Button>
        )}
      </div>

      {tab === 'candidates' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4" /> Candidates
            </CardTitle>
            <CardDescription>
              Leads with a company email and live Worker demo{readyOnly ? '' : ' (filter off)'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {candidates.isError ? (
              <ErrorState title="Could not load candidates" error={candidates.error} onRetry={() => void candidates.refetch()} />
            ) : candidates.isLoading ? (
              <TableSkeleton rows={6} columns={5} />
            ) : !candidates.data?.items.length ? (
              <EmptyState title="No ready candidates" description="Need company email + deployed Worker URL." />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Demo</TableHead>
                      <TableHead>Bot</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.data.items.map((c) => {
                      const busy = busyLeadId === c.leadId;
                      const allowlisted =
                        gate.data && c.companyEmail ? canDeliverTo(gate.data, c.companyEmail) : false;
                      return (
                        <TableRow key={c.leadId}>
                          <TableCell>
                            <Link href={`/leads/${c.leadId}`} className="font-medium hover:underline">
                              {c.companyName}
                            </Link>
                            {c.domain && <p className="text-xs text-muted-foreground">{c.domain}</p>}
                            {c.lastColdEmail && (
                              <Badge variant={STATUS_VARIANT[c.lastColdEmail.status]} className="mt-1">
                                {c.lastColdEmail.status}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{c.companyEmail ?? '—'}</TableCell>
                          <TableCell>
                            {c.demoUrl ? (
                              <a
                                href={c.demoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                              >
                                Open <ExternalLink className="size-3" />
                              </a>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.botTrained ? 'success' : 'muted'}>{c.botTrained ? 'Trained' : '—'}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button type="button" size="sm" variant="outline" disabled={busy || !c.demoUrl} onClick={() => void onPreview(c)}>
                                Preview
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy || !c.demoUrl || !c.companyEmail}
                                onClick={() => void onDraft(c)}
                              >
                                Draft
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy || !c.demoUrl || !testAllowed || !canEdit}
                                title={testAllowed ? `Send this lead's email to ${testInbox} only` : `${testInbox} is not allowlisted`}
                                onClick={() => void onSendTest(c)}
                              >
                                Send test
                              </Button>
                              {allowlisted && c.companyEmail ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={busy || !c.demoUrl}
                                  onClick={() => void onSendAllowlisted(c, c.companyEmail!)}
                                >
                                  Send
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <Pagination
                  page={candidates.data.page}
                  pageSize={candidates.data.pageSize}
                  total={candidates.data.total}
                  totalPages={candidates.data.totalPages}
                  onPageChange={(p) => url.set({ page: p === 1 ? null : p })}
                />
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Outbox</CardTitle>
            <CardDescription>Drafts, sends, failures, and suppressed attempts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sent.isError ? (
              <ErrorState title="Could not load outbox" error={sent.error} onRetry={() => void sent.refetch()} />
            ) : sent.isLoading ? (
              <TableSkeleton rows={6} columns={5} />
            ) : !sent.data?.items.length ? (
              <EmptyState title="Outbox empty" description="Create a draft or send an allowlisted demo first." />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Intended</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sent.data.items.map((row) => {
                      const approvable = row.status === 'draft' || row.status === 'failed';
                      const allowed = Boolean(gate.data && canDeliverTo(gate.data, row.toEmail));
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            <p className="font-medium">{row.companyName}</p>
                            <p className="truncate text-xs text-muted-foreground">{row.subject}</p>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.toEmail}</TableCell>
                          <TableCell className="font-mono text-xs">{row.deliveredTo ?? '—'}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                              {row.origin && <Badge variant="outline">{ORIGIN_LABEL[row.origin]}</Badge>}
                            </div>
                            {row.error && <p className="mt-1 max-w-[16rem] truncate text-xs text-destructive">{row.error}</p>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground" title={formatDateTime(row.sentAt ?? row.createdAt)}>
                            {formatRelative(row.sentAt ?? row.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            {approvable ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                loading={busyEmailId === row.id}
                                disabled={!allowed || !canEdit || busyEmailId !== null}
                                title={allowed ? `Send to ${row.toEmail}` : `${row.toEmail} is not allowlisted; the draft stays a draft`}
                                onClick={() => void onApproveDraft(row)}
                              >
                                Send
                              </Button>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <Pagination
                  page={sent.data.page}
                  pageSize={sent.data.pageSize}
                  total={sent.data.total}
                  totalPages={sent.data.totalPages}
                  onPageChange={(p) => url.set({ page: p === 1 ? null : p })}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {previewHtml && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Preview</CardTitle>
              <CardDescription>{previewSubject}</CardDescription>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewHtml(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <div
              className={cn('overflow-hidden rounded-lg border bg-[#f3f4f6]')}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
