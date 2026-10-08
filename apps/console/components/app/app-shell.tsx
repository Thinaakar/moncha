'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Activity,
  CalendarClock,
  ClipboardCheck,
  FileUp,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Radar,
  ScanEye,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogTitle, SheetContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { BrandLogo } from '@/components/brand';
import { useUser } from '@/components/app/user-context';
import { useQueueCounts, useWorkerHealth } from '@/lib/queries';
import { request } from '@/lib/api';
import { formatNumber, formatRelative, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: 'reviews' | 'qualified';
};

const NAV: Array<{ title: string; items: NavItem[] }> = [
  { title: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    title: 'Pipeline',
    items: [
      { href: '/leads', label: 'Leads', icon: Users, badge: 'qualified' },
      { href: '/reviews', label: 'Review queue', icon: ClipboardCheck, badge: 'reviews' },
      { href: '/sites', label: 'Website copies', icon: ScanEye },
    ],
  },
  {
    title: 'Discovery',
    items: [
      { href: '/discovery', label: 'Country crawl', icon: Radar },
      { href: '/schedules', label: 'Schedules', icon: CalendarClock },
      { href: '/imports', label: 'CSV import', icon: FileUp },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/jobs', label: 'Jobs', icon: ListChecks },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: counts } = useQueueCounts();
  const badgeValue = (badge?: NavItem['badge']) =>
    badge === 'reviews' ? counts?.openReviewTasks : badge === 'qualified' ? counts?.QUALIFIED : undefined;

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4 scrollbar-thin">
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const badge = badgeValue(item.badge);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    )}
                  >
                    {active && (
                      <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
                    )}
                    <item.icon className={cn('size-4', active ? 'text-sidebar-primary' : 'opacity-80')} />
                    <span className="flex-1">{item.label}</span>
                    {badge !== undefined && badge > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums',
                          item.badge === 'reviews' ? 'bg-amber-400/20 text-amber-300' : 'bg-white/10 text-white/80',
                        )}
                      >
                        {formatNumber(badge)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { data, isLoading } = useWorkerHealth();
  const online = data?.running;
  const queued = data ? Object.values(data.jobs.pending).reduce((a, b) => a + b, 0) : 0;
  const running = data ? Object.values(data.jobs.running).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="border-t border-sidebar-border p-3">
      <Link
        href="/jobs"
        className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2.5 text-xs transition hover:bg-white/[0.07]"
      >
        <span className="relative flex size-2.5">
          {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span
            className={cn(
              'relative inline-flex size-2.5 rounded-full',
              isLoading ? 'bg-white/30' : online ? 'bg-emerald-400' : 'bg-rose-400',
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">
            {isLoading ? 'Checking worker…' : online ? 'Worker online' : 'Worker offline'}
          </p>
          <p className="truncate text-sidebar-foreground/70">
            {data
              ? online
                ? `${running} running · ${queued} queued`
                : data.lastSeenAt
                  ? `Last seen ${formatRelative(data.lastSeenAt)}`
                  : 'Never seen'
              : '—'}
          </p>
        </div>
      </Link>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <Link href="/" onClick={onNavigate}>
          <BrandLogo inverted />
        </Link>
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <SidebarFooter />
    </div>
  );
}

function ThemeMenuItems() {
  const { setTheme } = useTheme();
  return (
    <>
      <DropdownMenuItem onSelect={() => setTheme('light')}>
        <Sun /> Light
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme('dark')}>
        <Moon /> Dark
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setTheme('system')}>
        <Monitor /> System
      </DropdownMenuItem>
    </>
  );
}

function WorkerPill() {
  const { data } = useWorkerHealth();
  if (!data) return null;
  return (
    <Tooltip content={data.message}>
      <Link
        href="/jobs"
        className={cn(
          'hidden items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition hover:bg-muted sm:inline-flex',
          data.running ? 'text-success' : 'border-destructive/30 bg-destructive/5 text-destructive',
        )}
      >
        <Activity className="size-3.5" />
        {data.running ? 'Pipeline running' : 'Worker offline'}
      </Link>
    </Tooltip>
  );
}

function UserMenu() {
  const { user } = useUser();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {
      toast.error('Sign out failed on the server; your local session was cleared.');
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-full p-0.5 pr-2 transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#1877f2] to-[#0b3d8f] text-xs font-semibold text-white">
            {initials(user.name, user.email)}
          </span>
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-sm font-medium">{user.name || user.email.split('@')[0]}</span>
            <span className="block text-xs text-muted-foreground capitalize">{user.role}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <p className="font-medium">{user.name || 'Signed in'}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={signingOut} onSelect={signOut}>
          <LogOut /> {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Dialog>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <div className="lg:hidden">
            <BrandLogo />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <WorkerPill />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
