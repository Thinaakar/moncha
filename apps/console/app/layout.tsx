import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavBar } from './nav-bar';

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
            <NavBar />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
