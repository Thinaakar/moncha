'use client';

import { useState } from 'react';

export default function Login() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: String(f.get('email')) }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      setMsg(data.error?.message || 'Login failed');
    } catch {
      setMsg('Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="brand">
          <img src="/brand/mark.svg" alt="" />
          <span>
            Mon<b>Cha</b> Lead Engine
          </span>
        </div>
        <h1 style={{ margin: '0 0 8px', fontFamily: 'var(--display)', letterSpacing: '-0.03em' }}>
          Internal login
        </h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          Sign in with a seeded operator email to access Discover and leads.
        </p>
        <form className="form-grid" onSubmit={submit}>
          <label>
            Email
            <input
              name="email"
              type="email"
              placeholder="Email"
              defaultValue="operator@moncha.local"
              required
            />
          </label>
          <button disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
        </form>
        {msg && <div className="notice error">{msg}</div>}
      </div>
    </main>
  );
}
