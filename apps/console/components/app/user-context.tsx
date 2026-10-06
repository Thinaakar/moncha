'use client';

import { createContext, useContext, useState } from 'react';
import type { User } from '@/lib/types';

const UserContext = createContext<{ user: User; setUser: (user: User) => void } | null>(null);

export function UserProvider({ user: initial, children }: { user: User; children: React.ReactNode }) {
  const [user, setUser] = useState(initial);
  return <UserContext.Provider value={{ user, setUser }}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used inside UserProvider');
  return ctx;
}

/** Viewers can read everything but not start jobs or change data. */
export function useCanEdit() {
  return useUser().user.role !== 'viewer';
}
