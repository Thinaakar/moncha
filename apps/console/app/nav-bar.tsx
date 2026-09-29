'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Home', match: (path: string) => path === '/' },
  { href: '/leads?queue=QUALIFIED', label: 'Leads', match: (path: string) => path.startsWith('/leads') },
  { href: '/discover', label: 'Discover', match: (path: string) => path.startsWith('/discover') },
  { href: '/jobs', label: 'Jobs', match: (path: string) => path.startsWith('/jobs') },
  { href: '/add-lead', label: 'Add lead', match: (path: string) => path.startsWith('/add-lead') },
  { href: '/import', label: 'Import', match: (path: string) => path.startsWith('/import') },
  { href: '/login', label: 'Login', match: (path: string) => path.startsWith('/login') },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {LINKS.map((link) => (
        <Link key={link.label} href={link.href} className={link.match(pathname) ? 'nav-primary' : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
