'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { ErrorState } from '@/components/app/states';
import type { FollowUpEmailPreviewView } from '@/lib/types';

export function FollowUpPreviewDialog({
  open,
  onOpenChange,
  preview,
  loading,
  error,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: FollowUpEmailPreviewView | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [tab, setTab] = useState<'html' | 'text'>('html');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="space-y-3 border-b p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle>Follow-up email preview</DialogTitle>
              <DialogDescription>Rendered with a sample business. Unsaved template edits are included.</DialogDescription>
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'html' | 'text')}>
              <TabsList>
                <TabsTrigger value="html">Email</TabsTrigger>
                <TabsTrigger value="text">Plain text</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {preview && (
            <p className="truncate rounded-md bg-muted/50 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">Subject: </span>
              <span className="font-medium text-foreground">{preview.subject}</span>
            </p>
          )}
        </DialogHeader>

        <div className="flex flex-1 justify-center overflow-y-auto bg-muted/20 p-5">
          {loading ? (
            <div className="flex items-center gap-2 p-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Rendering preview…
            </div>
          ) : error ? (
            <ErrorState title="Could not render the preview" error={error} onRetry={onRetry} />
          ) : tab === 'html' ? (
            <iframe
              srcDoc={preview?.html}
              className="min-h-[580px] w-full max-w-[580px] rounded-lg border bg-white"
              title="Follow-up email preview"
              sandbox=""
            />
          ) : (
            <pre className="w-full max-w-[580px] rounded-lg border bg-card p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
              {preview?.text}
            </pre>
          )}
        </div>

        <DialogFooter className="border-t p-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
