'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function AddLead() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setOk(false);
    const f = new FormData(e.currentTarget);
    const value = (name: string) => {
      const raw = String(f.get(name) || '').trim();
      return raw || undefined;
    };
    try {
      const res = await fetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: value('name'),
          domain: value('domain'),
          country: value('country'),
          city: value('city'),
          phone: value('phone'),
          address: value('address'),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOk(true);
        setMsg(
          data.duplicate
            ? `Existing company reused: ${data.company?.name}`
            : `Created ${data.company?.name}`,
        );
      } else {
        setMsg(data.error?.message || data.error || 'Failed to create lead');
      }
    } catch {
      setMsg('Failed to create lead');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Add lead</h1>
          <p>Secondary fallback. Same normalize + domain dedupe rules as Discover.</p>
        </div>
        <Link href="/discover" className="btn">
          Prefer Discover
        </Link>
      </div>

      <div className="card">
        <form className="form-grid" onSubmit={submit}>
          <div className="form-grid two">
            <label>
              Company name
              <input name="name" placeholder="Company name" required />
            </label>
            <label>
              Domain / website
              <input name="domain" placeholder="example.com" />
            </label>
          </div>
          <div className="form-grid two">
            <label>
              Country
              <input name="country" placeholder="Country" />
            </label>
            <label>
              City
              <input name="city" placeholder="City" />
            </label>
          </div>
          <div className="form-grid two">
            <label>
              Phone
              <input name="phone" placeholder="Phone" />
            </label>
            <label>
              Address
              <input name="address" placeholder="Address" />
            </label>
          </div>
          <button disabled={busy}>{busy ? 'Saving…' : 'Create lead'}</button>
        </form>
        {msg && <div className={ok ? 'notice success' : 'notice error'}>{msg}</div>}
      </div>
    </main>
  );
}
