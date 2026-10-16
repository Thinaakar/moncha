'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Mail, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from '@/components/app/states';
import {
  useColdEmailCandidates,
  useColdEmailGate,
  useColdEmails,
  useCreateColdEmailDraft,
  usePreviewColdEmail,
  useSendColdEmail,
} from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { ColdEmailCandidate, ColdEmailStatus } from '@/lib/types';
import { useUrlState } from '@/lib/use-url-state';
import { cn } from '@/lib/utils';

const STATUS_VARIANT: Record<ColdEmailStatus, 'muted' | 'info' | 'success' | 'destructive' | 'warning'> = {
  draft: 'muted',
  queued: 'info',
  sent: 'success',
  failed: 'destructive',
  suppressed: 'warning',
};

function canDeliverTo(gate: { allowlist: string[]; allowlistOpen: boolean; sendingEnabled: boolean }, email: string) {
  if (!gate.sendingEnabled) return false;
  if (gate.allowlistOpen) return true;
  return gate.allowlist.map((e) => e.toLowerCase()).includes(email.trim().toLowerCase());
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

      <InlineAlert variant="warning" title="Lead owners are not emailed">
        “Send to company email” stays blocked until that address is allowlisted. Use Preview and Draft freely. During
        development, only addresses on <span className="font-mono">COLD_EMAIL_ALLOWLIST</span> can receive mail.
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sent.data.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <p className="font-medium">{row.companyName}</p>
                          <p className="truncate text-xs text-muted-foreground">{row.subject}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.toEmail}</TableCell>
                        <TableCell className="font-mono text-xs">{row.deliveredTo ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                          {row.error && <p className="mt-1 max-w-[16rem] truncate text-xs text-destructive">{row.error}</p>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground" title={formatDateTime(row.sentAt ?? row.createdAt)}>
                          {formatRelative(row.sentAt ?? row.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
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
