'use client';

import { useState } from 'react';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCanEdit } from '@/components/app/user-context';
import { useCancelSiteSnapshot } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import type { SiteCopyOrigin } from '@/lib/types';

/** Cancels a copy that is still waiting in the queue, after a confirmation. Hidden for viewers. */
export function CancelCopyButton({
  snapshotId,
  company,
  origin,
  variant = 'ghost',
}: {
  snapshotId: string;
  company?: string;
  origin?: SiteCopyOrigin;
  variant?: 'ghost' | 'outline';
}) {
  const canEdit = useCanEdit();
  const cancel = useCancelSiteSnapshot();
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;

  async function confirm() {
    try {
      await cancel.mutateAsync(snapshotId);
      toast.success('Website copy cancelled');
      setOpen(false);
    } catch (e) {
      toast.error('Could not cancel the copy', { description: errorMessage(e) });
      setOpen(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Ban /> Cancel
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this website copy?</AlertDialogTitle>
            <AlertDialogDescription>
              {company ? `${company} leaves the queue.` : 'The copy leaves the queue.'}{' '}
              {origin === 'auto'
                ? 'Automation will not queue this lead again; you can still start a copy from the lead page.'
                : 'You can start a new copy from the lead page at any time.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel copy'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
