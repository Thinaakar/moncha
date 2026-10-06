import { redirect } from 'next/navigation';
import { ServerCrash } from 'lucide-react';
import { getSession } from '@/lib/server/session';
import { AppShell } from '@/components/app/app-shell';
import { UserProvider } from '@/components/app/user-context';
import { BrandLogo } from '@/components/brand';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.status === 'unauthenticated') redirect('/api/auth/logout?expired=1');

  if (session.status === 'unavailable') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-grid px-6 text-center">
        <BrandLogo />
        <div className="max-w-md rounded-xl border bg-card p-8 shadow-sm">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ServerCrash className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">Backend unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The console cannot reach the MonCha API right now. Check that the backend service is running and that{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">BACKEND_URL</code> is correct.
          </p>
          <p className="mt-3 font-mono text-xs text-muted-foreground/80">{session.message}</p>
          <a
            href=""
            className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </a>
        </div>
      </div>
    );
  }

  return (
    <UserProvider user={session.user}>
      <AppShell>{children}</AppShell>
    </UserProvider>
  );
}
