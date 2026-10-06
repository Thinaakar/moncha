'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/icon';
import { NextRunCard } from '@/components/next-run-card';
import { ProfileDrawer, type ProfileUser } from '@/components/profile-drawer';
import { applyTheme, currentTheme, type Theme } from '@/lib/theme';

type NavLink = {
  href: string;
  label: string;
  icon: IconName;
  badge?: 'qualified';
  match: (path: string) => boolean;
};

const GROUPS: NavLink[][] = [
  [{ href: '/', label: 'Home', icon: 'home', match: (path) => path === '/' }],
  [
    {
      href: '/leads?queue=QUALIFIED',
      label: 'Leads',
      icon: 'leads',
      badge: 'qualified',
      match: (path) => path.startsWith('/leads'),
    },
    { href: '/discover', label: 'Discover', icon: 'discover', match: (path) => path.startsWith('/discover') },
  ],
  [
    { href: '/import', label: 'Import', icon: 'import', match: (path) => path.startsWith('/import') },
    { href: '/add-lead', label: 'Add lead', icon: 'add', match: (path) => path.startsWith('/add-lead') },
  ],
  [{ href: '/jobs', label: 'Jobs', icon: 'jobs', match: (path) => path.startsWith('/jobs') }],
];

function Brand() {
  return (
    <Link href="/" className="brand">
      <img src="/brand/mark.svg" alt="" />
      <span>
        Mon<b>Cha</b> Lead Engine
      </span>
    </Link>
  );
}

export function Sidebar({ qualifiedCount, demo }: { qualifiedCount: number | null; demo: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [theme, setTheme] = useState<Theme>('light');
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }

  const closeProfile = useCallback(() => setProfileOpen(false), []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/auth/me', { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { user?: ProfileUser };
        if (data.user) setUser(data.user);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <>
      <header className="mobile-bar">
        <Brand />
        <button
          type="button"
          className="menu-button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <aside className={open ? 'sidebar is-open' : 'sidebar'}>
        <div className="sidebar-brand">
          <Brand />
        </div>

        <nav className="side-nav">
          {GROUPS.map((group, index) => (
            <div className="side-group" key={index}>
              {group.map((link) => {
                const badge = link.badge === 'qualified' ? qualifiedCount : null;
                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={link.match(pathname) ? 'side-link is-active' : 'side-link'}
                  >
                    <span className="side-icon">
                      <Icon name={link.icon} />
                    </span>
                    <span className="side-label">{link.label}</span>
                    {badge ? (
                      <span className="side-badge" title={`${badge} qualified`}>
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <NextRunCard />
          <ul className="account-menu">
            <li>
              <button type="button" className="account-menu-item" onClick={toggleTheme}>
                <span className="side-icon">
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
                </span>
                Theme
                <span className="account-menu-value">{theme === 'dark' ? 'Dark' : 'Light'}</span>
              </button>
            </li>
            <li>
              <button type="button" className="account-menu-item" onClick={() => setProfileOpen(true)}>
                <span className="side-icon">
                  <Icon name="user" />
                </span>
                <span className="account-menu-sub" title={user?.email}>
                  <span>Profile</span>
                  {user || demo ? <small>{user?.name || user?.email || 'Demo mode'}</small> : null}
                </span>
              </button>
            </li>
            <li>
              <button type="button" className="account-menu-item" onClick={signOut} disabled={signingOut}>
                <span className="side-icon">
                  <Icon name="logout" />
                </span>
                {signingOut ? 'Logging out…' : 'Log out'}
              </button>
            </li>
          </ul>
        </div>
      </aside>

      {open ? <div className="sidebar-backdrop" onClick={() => setOpen(false)} /> : null}
      {profileOpen ? <ProfileDrawer user={user} onClose={closeProfile} /> : null}
    </>
  );
}
