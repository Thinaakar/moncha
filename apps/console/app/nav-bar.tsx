'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/icon';

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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
          <div className="account-row">
            <span className="account-avatar">
              <Icon name="user" />
            </span>
            <span className="account-text">
              <strong>Operator</strong>
              <span>{demo ? 'Demo mode' : 'Signed in'}</span>
            </span>
            <button type="button" className="signout-button" onClick={signOut} disabled={signingOut}>
              {signingOut ? '…' : 'Sign out'}
            </button>
          </div>
        </div>
      </aside>

      {open ? <div className="sidebar-backdrop" onClick={() => setOpen(false)} /> : null}
    </>
  );
}
