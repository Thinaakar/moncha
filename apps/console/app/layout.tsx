import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'MonCha Lead Engine',
  description: 'Phase 1 discovery dashboard',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
