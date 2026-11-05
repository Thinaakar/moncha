'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Mail, ShieldAlert, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  const data = automation.data;

  const sendBlockedNote = gate?.isDevMode
    ? 'Development mode: automated emails stay drafts in the Outbox. Nothing reaches a business.'
    : gate?.sendingEnabled
      ? gate.allowlistOpen
        ? 'Sending is on with an open allowlist, so every ready business is emailed.'
        : 'Only allowlisted addresses are sent; every other company address stays a draft.'
      : 'Sending is off on the backend, so everything stays a draft.';

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
                  On
                </Badge>
              ) : (
                <Badge variant="muted" dot>
                  Off
                </Badge>
              ))}
          </CardTitle>
          <CardDescription>
            Every 5 minutes, each lead whose demo is fully ready (bot trained, chatbot on the live site, domain locked,
            company email known) and that was never emailed gets an email, up to the daily customer reach limit. It runs
            while the engine in Crawl & Pipeline Settings is on.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/crawl-settings">Crawl settings</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {automation.isError ? (
          <ErrorState title="Could not load automation" error={automation.error} onRetry={() => void automation.refetch()} />
        ) : !data ? (
          <TableSkeleton rows={2} columns={3} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">Ready now</p>
                <p className="text-lg font-semibold tabular-nums">{formatNumber(data.readyNow)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">Today (daily customer reach limit)</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatNumber(data.usedToday)} <span className="text-sm font-normal text-muted-foreground">/ {formatNumber(data.dailyCap)}</span>
                </p>
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
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const allowlistHint = useMemo(() => {
    if (!gate.data) return null;
    if (!gate.data.sendingEnabled) return 'Sending is off (COLD_EMAIL_SENDING_ENABLED). Drafts and previews still work.';
    if (gate.data.isDevMode) return `Development mode: customer sending blocked. All test sends go to ${gate.data.devInboxes.join(' & ')}.`;
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
    setBusyAction('preview');
    try {
      const result = await preview.mutateAsync({ companyName: c.companyName, demoUrl: c.demoUrl });
      setPreviewHtml(result.html);
      setPreviewSubject(result.subject);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyLeadId(null);
      setBusyAction(null);
    }
  }

  async function onDraft(c: ColdEmailCandidate) {
    if (!c.demoUrl || !c.companyEmail) {
      toast.error('Need a company email and live demo URL');
      return;
    }
    setBusyLeadId(c.leadId);
    setBusyAction('draft');
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
      setBusyAction(null);
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
    setBusyAction('send');
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
      setBusyAction(null);
    }
  }

  /** Send personalized cold email for this lead directly to the approved developer inboxes. */
  async function onSendToDevs(c: ColdEmailCandidate) {
    if (!c.demoUrl) {
      toast.error('This lead has no live demo URL yet');
      return;
    }
    const devRecipients = gate.data?.devInboxes?.length
      ? gate.data.devInboxes
      : ['vinothjv4.tech@gmail.com', 'thinaakark2004@gmail.com'];

    setBusyLeadId(c.leadId);
    setBusyAction('send-dev');
    try {
      const row = await send.mutateAsync({
        leadId: c.leadId,
        companyName: c.companyName,
        toEmail: c.companyEmail ?? devRecipients[0],
        deliverTo: devRecipients,
        demoUrl: c.demoUrl,
      });
      toast.success(`Demo sent to ${row.deliveredTo || devRecipients.join(' & ')}`);
      url.set({ tab: 'sent', page: null });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyLeadId(null);
      setBusyAction(null);
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
    setBusyAction('test');
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
      setBusyAction(null);
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

  /** Send test copy of existing draft to the approved developer inboxes without modifying the lead's email. */
  async function onSendDraftToDevs(row: ColdEmail) {
    const devRecipients = gate.data?.devInboxes?.length
      ? gate.data.devInboxes
      : ['vinothjv4.tech@gmail.com', 'thinaakark2004@gmail.com'];

    setBusyEmailId(row.id);
    try {
      const sentResult = await sendDraft.mutateAsync({
        id: row.id,
        deliverToOverride: devRecipients,
      });
      toast.success(`Test sent to ${sentResult.deliveredTo || devRecipients.join(' & ')}`);
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

      {gate.data?.isDevMode ? (
        <Card className="border-2 border-amber-500/50 bg-amber-500/10 shadow-sm">
          <CardHeader className="flex-row items-start gap-4 space-y-0 pb-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400">
              <ShieldAlert className="size-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className="text-base font-bold tracking-tight text-amber-900 dark:text-amber-200">
                DEVELOPMENT MODE — CUSTOMER EMAIL DELIVERY DISABLED
              </CardTitle>
              <CardDescription className="text-amber-800/90 dark:text-amber-300/90">
                All manual test sends are redirected to the developer inboxes. Automated customer email delivery is disabled.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-sm text-amber-950 dark:text-amber-100">
            <p>
              <span className="font-semibold">Sender:</span> <span className="font-mono">{gate.data.from}</span>
            </p>
            <div>
              <span className="font-semibold">Test recipients:</span>
              <ul className="list-disc list-inside ml-2 font-mono text-xs mt-1 space-y-0.5">
                {gate.data.devInboxes.map((inbox) => (
                  <li key={inbox}>{inbox}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busyLeadId !== null || !c.demoUrl}
                                onClick={() => void onPreview(c)}
                              >
                                Preview
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busyLeadId !== null || !c.demoUrl || !c.companyEmail}
                                onClick={() => void onDraft(c)}
                              >
                                Draft
                              </Button>
                              {gate.data?.isDevMode ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  disabled={busyLeadId !== null || !c.demoUrl || !canEdit}
                                  loading={busy && busyAction === 'send-dev'}
                                  title={`Send personalized demo email directly to ${(gate.data?.devInboxes ?? ['vinothjv4.tech@gmail.com', 'thinaakark2004@gmail.com']).join(' & ')}`}
                                  onClick={() => void onSendToDevs(c)}
                                >
                                  Send to Devs
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busyLeadId !== null || !c.demoUrl || !testAllowed || !canEdit}
                                    title={testAllowed ? `Send this lead's email to ${testInbox} only` : `${testInbox} is not allowlisted`}
                                    onClick={() => void onSendTest(c)}
                                  >
                                    Send test
                                  </Button>
                                  {allowlisted && c.companyEmail ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={busyLeadId !== null || !c.demoUrl}
                                      onClick={() => void onSendAllowlisted(c, c.companyEmail!)}
                                    >
                                      Send
                                    </Button>
                                  ) : null}
                                </>
                              )}
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
                              <div className="flex flex-wrap justify-end gap-1">
                                {gate.data?.isDevMode ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    loading={busyEmailId === row.id}
                                    disabled={!canEdit || busyEmailId !== null}
                                    title={`Send test copy directly to ${(gate.data?.devInboxes ?? ['vinothjv4.tech@gmail.com', 'thinaakark2004@gmail.com']).join(' & ')}`}
                                    onClick={() => void onSendDraftToDevs(row)}
                                  >
                                    Send to Devs
                                  </Button>
                                ) : (
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
                                )}
                              </div>
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
