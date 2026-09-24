'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type JobResult = {
  found?: number;
  created?: number;
  duplicates?: number;
  skipped?: number;
};

export default function Discover() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [tone, setTone] = useState<'info' | 'success' | 'error'>('info');
  const [result, setResult] = useState<JobResult | null>(null);

  const noticeClass = useMemo(() => {
    if (tone === 'success') return 'notice success';
    if (tone === 'error') return 'notice error';
    return 'notice';
  }, [tone]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setResult(null);
    setTone('info');
    setMsg('Starting Google Places discovery…');
    try {
      const res = await fetch('/api/v1/source-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'google_places',
          country: String(f.get('country')),
          city: String(f.get('city')),
          keyword: String(f.get('keyword')),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTone('error');
        setMsg(data.error?.message || data.error || 'Failed to start discovery');
        return;
      }
      setMsg(`Job ${data.id} ${data.status}. Waiting for Google Places…`);
      await pollJob(data.id);
    } catch {
      setTone('error');
      setMsg('Failed to start discovery');
    } finally {
      setBusy(false);
    }
  }

  async function pollJob(id: string) {
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const res = await fetch(`/api/v1/source-imports/${id}`);
      const job = await res.json();
      if (!res.ok) {
        setTone('error');
        setMsg(job.error?.message || 'Could not read job status');
        return;
      }
      if (job.status === 'done') {
        const payload = (job.result || {}) as JobResult;
        const created = job.recordsImported ?? payload.created ?? 0;
        const found = job.recordsDiscovered ?? payload.found ?? 0;
        setResult(payload);
        setTone('success');
        setMsg(`Done. Found ${found}, saved ${created}. Review them in Leads.`);
        return;
      }
      if (job.status === 'failed') {
        setTone('error');
        setMsg(job.error || 'Discovery failed');
        return;
      }
      setMsg(`Job ${id} is ${job.status}…`);
    }
    setTone('info');
    setMsg('Still running. Check Jobs or Leads in a moment.');
  }

  return (
    <main>
      <section className="hero-panel">
        <h1>Discover</h1>
        <p>
          Primary Phase 1 path. Enter country, city, and keyword — MonCha fetches companies from Google
          Places, dedupes by domain, and stores them in Neon.
        </p>
      </section>

      <div className="card">
        <form className="form-grid" onSubmit={submit}>
          <div className="form-grid two">
            <label>
              Country
              <input name="country" placeholder="Country" defaultValue="Singapore" required />
            </label>
            <label>
              City
              <input name="city" placeholder="City" defaultValue="Singapore" required />
            </label>
          </div>
          <label>
            Keyword / industry
            <input
              name="keyword"
              placeholder="e.g. dental clinics"
              defaultValue="dental clinics"
              required
            />
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button disabled={busy}>{busy ? 'Discovering…' : 'Start Google Places discovery'}</button>
            <Link href="/leads" className="btn btn-secondary">
              Open leads
            </Link>
          </div>
        </form>

        {msg && <div className={noticeClass}>{msg}</div>}

        {result && (
          <div className="grid" style={{ marginTop: 16, marginBottom: 0 }}>
            {[
              ['Found', result.found ?? 0],
              ['Created', result.created ?? 0],
              ['Duplicates', result.duplicates ?? 0],
              ['Skipped', result.skipped ?? 0],
            ].map(([label, value]) => (
              <div className="stat-card" key={String(label)}>
                <div className="label">{label}</div>
                <div className="stat">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
