'use client';

import { useState, type FormEvent } from 'react';

export default function Login() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
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
        <div className="login-card-head">
          <div className="brand">
            <img src="/brand/mark.svg" alt="" />
            <span>
              Mon<b>Cha</b> Lead Engine
            </span>
          </div>
          <h1>Sign in</h1>
          <p>Use your operator email to open Discover, jobs, and leads.</p>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <label>
            Email
            <input
              name="email"
              type="email"
              placeholder="operator@moncha.local"
              defaultValue="operator@moncha.local"
              autoComplete="email"
              required
            />
          </label>
          <button disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
        </form>
        {msg ? <div className="notice error">{msg}</div> : null}
      </div>
    </main>
  );
}
