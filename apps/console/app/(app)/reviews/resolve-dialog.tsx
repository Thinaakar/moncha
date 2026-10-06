'use client';

import { useState } from 'react';
import { Bot, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/app/field';
import { api, errorMessage } from '@/lib/api';
import { useApiMutation } from '@/lib/queries';
import type { ReviewAction, ReviewTask } from '@/lib/types';
import { cn } from '@/lib/utils';

const ACTIONS: Array<{
  value: ReviewAction;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}> = [
  {
    value: 'confirm_no_assistant',
    title: 'Confirm no assistant',
    description: 'Moves the lead to Qualified.',
    icon: CheckCircle2,
    tone: 'text-success bg-success/12',
  },
  {
    value: 'mark_has_assistant',
    title: 'Mark as has assistant',
    description: 'Moves the lead to Has assistant.',
    icon: Bot,
    tone: 'text-[#6366f1] bg-[#6366f1]/12',
  },
  {
    value: 'request_reaudit',
    title: 'Request re-audit',
    description: 'Closes this task and audits the site again.',
    icon: RefreshCw,
    tone: 'text-info bg-info/12',
  },
];

type ResolveResult = { lead: { queue: string }; job: { id: string } | null };

export function ResolveDialog({
  task,
  open,
  onOpenChange,
}: {
  task: ReviewTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [action, setAction] = useState<ReviewAction>('confirm_no_assistant');
  const [note, setNote] = useState('');
  const [vendor, setVendor] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const resolve = useApiMutation(
    (input: { id: string; action: ReviewAction; note: string; vendor?: string }) =>
      api<ResolveResult>(`reviews/${input.id}/resolve`, {
        method: 'POST',
        body: { action: input.action, note: input.note, ...(input.vendor ? { vendor: input.vendor } : {}) },
      }),
    [['reviews'], ['leads']],
  );

  function reset(nextOpen: boolean) {
    if (!nextOpen) {
      setAction('confirm_no_assistant');
      setNote('');
      setVendor('');
      setNoteError(null);
    }
    onOpenChange(nextOpen);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!task) return;
    if (!note.trim()) {
      setNoteError('Add a short note explaining your decision');
      return;
    }
    try {
      await resolve.mutateAsync({
        id: task.id,
        action,
        note: note.trim(),
        vendor: action === 'mark_has_assistant' ? vendor.trim() || undefined : undefined,
      });
      toast.success(
        action === 'request_reaudit' ? 'Re-audit queued' : action === 'confirm_no_assistant' ? 'Lead qualified' : 'Lead marked as has assistant',
        { description: task.lead.company.name },
      );
      reset(false);
    } catch (err) {
      toast.error('Could not resolve the review', { description: errorMessage(err) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Resolve review</DialogTitle>
            <DialogDescription>
              {task ? (
                <>
                  Decide what <span className="font-medium text-foreground">{task.lead.company.name}</span> has on its website.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div role="radiogroup" aria-label="Decision" className="grid gap-2">
            {ACTIONS.map((a) => {
              const selected = action === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAction(a.value)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition',
                    selected ? 'border-primary bg-primary/[0.04] ring-2 ring-primary/20' : 'hover:bg-muted/50',
                  )}
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', a.tone)}>
                    <a.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.title}</span>
                    <span className="block text-xs text-muted-foreground">{a.description}</span>
                  </span>
                  <span
                    className={cn(
                      'flex size-4 items-center justify-center rounded-full border',
                      selected ? 'border-primary' : 'border-input',
                    )}
                  >
                    {selected && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                </button>
              );
            })}
          </div>

          {action === 'mark_has_assistant' && (
            <Field label="Vendor" htmlFor="vendor" hint="Optional — e.g. Intercom, Tidio, WhatsApp widget.">
              <Input
                id="vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder={task?.audit.vendor ?? 'Vendor name'}
              />
            </Field>
          )}

          <Field label="Note" htmlFor="note" required error={noteError ?? undefined} hint="Saved to the audit log.">
            <Textarea
              id="note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (noteError) setNoteError(null);
              }}
              placeholder="What did you see on the site?"
              rows={3}
              aria-invalid={Boolean(noteError)}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reset(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={resolve.isPending}>
              Save decision
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
