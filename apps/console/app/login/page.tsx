'use client';

import { useState } from 'react';

export default function Login() {
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: String(f.get('email')) }),
    });
    const data = await res.json();
    if (res.ok) {
      window.location.href = '/leads';
      return;
    }
    setMsg(data.error?.message || 'Login failed');
  }

  return (
    <main className="card">
      <h1>Internal login</h1>
      <p>Sign in with a seeded operator email, for example operator@moncha.local.</p>
      <form onSubmit={submit}>
        <input name="email" type="email" placeholder="Email" defaultValue="operator@moncha.local" required />
        <br />
        <br />
        <button>Continue</button>
      </form>
      {msg && <p>{msg}</p>}
    </main>
  );
}
