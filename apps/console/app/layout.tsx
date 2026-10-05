import './globals.css';
import type { ReactNode } from 'react';
import { THEME_SCRIPT } from '@/lib/theme';

export const metadata = {
  title: 'MonCha Lead Engine',
  description: 'Phase 1 discovery dashboard',
};

export const viewport = {
  themeColor: '#1877F2',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
