'use client';

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground ring-8 ring-muted/40">
        <Icon className="size-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const unavailable = error instanceof ApiError && [502, 503, 504].includes(error.status);
  title ??= unavailable ? 'Service temporarily unavailable' : 'Could not load data';
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-8 ring-destructive/5">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-48' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function InlineAlert({
  variant = 'info',
  title,
  children,
  icon: Icon,
  className,
}: {
  variant?: 'info' | 'warning' | 'destructive' | 'success';
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const tone = {
    info: 'border-info/25 bg-info/6 text-info',
    warning: 'border-warning/30 bg-warning/8 text-warning',
    destructive: 'border-destructive/25 bg-destructive/6 text-destructive',
    success: 'border-success/25 bg-success/6 text-success',
  }[variant];
  return (
    <div role="alert" className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', tone, className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/75">{children}</div>}
      </div>
    </div>
  );
}
