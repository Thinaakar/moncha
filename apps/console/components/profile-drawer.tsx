'use client';

import { useEffect } from 'react';

export type ProfileUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt?: string;
};

function initials(user: ProfileUser) {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function memberSince(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function ProfileDrawer({ user, onClose }: { user: ProfileUser | null; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Profile">
        <div className="drawer-head">
          <h2>Profile</h2>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close profile">
            ×
          </button>
        </div>
        <div className="drawer-body">
          {user ? (
            <>
              <div className="profile-hero">
                <span className="profile-avatar">{initials(user)}</span>
                <span className="profile-hero-text">
                  <strong>{user.name || user.email}</strong>
                  <span>{user.email}</span>
                </span>
              </div>
              <dl className="profile-list">
                <div>
                  <dt>Name</dt>
                  <dd>{user.name || '—'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{user.email}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd style={{ textTransform: 'capitalize' }}>{user.role}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{user.tenantId}</dd>
                </div>
                <div>
                  <dt>Member since</dt>
                  <dd>{memberSince(user.createdAt)}</dd>
                </div>
              </dl>
              <div className="notice">Profile details can&apos;t be edited yet.</div>
            </>
          ) : (
            <div className="notice">Profile details aren&apos;t available right now. Try again in a moment.</div>
          )}
        </div>
      </aside>
    </>
  );
}
