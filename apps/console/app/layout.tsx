import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'MonCha Lead Engine',
  description: 'Phase 1 discovery dashboard',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link href="/" className="brand">
              <img src="/brand/mark.svg" alt="" />
              <span>
                Mon<b>Cha</b> Lead Engine
              </span>
            </Link>
            <nav className="nav">
              <Link href="/">Home</Link>
              <Link href="/leads">Leads</Link>
              <Link href="/discover" className="nav-primary">
                Discover
              </Link>
              <Link href="/jobs">Jobs</Link>
              <Link href="/add-lead">Add lead</Link>
              <Link href="/import">Import</Link>
              <Link href="/login">Login</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
