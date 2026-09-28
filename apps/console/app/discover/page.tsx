'use client';

import { useMemo, useState, type FormEvent } from 'react';

type JobResult = {
  found?: number;
  created?: number;
  duplicates?: number;
  skipped?: number;
  auditsEnqueued?: number;
  noWebsite?: number;
};

const SOURCES = [
  { value: 'google_places', label: 'Google Places' },
  { value: 'yelp', label: 'Yelp (name, phone, address — no website)' },
  { value: 'foursquare', label: 'Foursquare' },
  { value: 'search', label: 'Search (DataForSEO / Google Custom Search)' },
  { value: 'all', label: 'All configured sources' },
] as const;

function sourceLabel(value: string): string {
  return SOURCES.find((s) => s.value === value)?.label.replace(/\s*\(.*\)$/, '') ?? value;
}

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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const source = String(f.get('source') || 'google_places');
    const label = sourceLabel(source);
    setBusy(true);
    setResult(null);
    setTone('info');
    setMsg(`Starting ${label} discovery…`);
    try {
      const res = await fetch('/api/v1/source-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source,
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
      setMsg(`Job ${data.id} ${data.status}. Waiting for ${label}…`);
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
        const duplicates = payload.duplicates ?? 0;
        setResult(payload);
        setTone('success');
        if (created > 0) {
          setMsg(
            `Done. Found ${found}, saved ${created} new lead${created === 1 ? '' : 's'} into Pending audit.` +
              (duplicates > 0 ? ` ${duplicates} already in your pipeline.` : ''),
          );
        } else if (duplicates > 0) {
          setMsg(
            `Done. Found ${found} — all ${duplicates} were already saved from an earlier run (deduped by domain). Open Pending audit to review them.`,
          );
        } else {
          setMsg(`Done. Found ${found}, saved ${created}.`);
        }
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
          Discovery source → Neon. New companies become leads in Pending audit. Re-running the same
          city/keyword dedupes by domain (counts as already saved, not failed).
        </p>
      </section>

      <div className="card">
        <form className="form-grid" onSubmit={submit}>
          <label>
            Source
            <select name="source" defaultValue="google_places" suppressHydrationWarning>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid two">
            <label>
              Country
              <input
                name="country"
                placeholder="Country"
                defaultValue="Singapore"
                required
                suppressHydrationWarning
              />
            </label>
            <label>
              City
              <input
                name="city"
                placeholder="City"
                defaultValue="Singapore"
                required
                suppressHydrationWarning
              />
            </label>
          </div>
          <label>
            Keyword / industry
            <input
              name="keyword"
              placeholder="e.g. dental clinics"
              defaultValue="dental clinics"
              required
              suppressHydrationWarning
            />
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button disabled={busy} suppressHydrationWarning>
              {busy ? 'Discovering…' : 'Start discovery'}
            </button>
            <a href="/leads?queue=PENDING_AUDIT" className="btn btn-secondary">
              Open pending audits
            </a>
          </div>
        </form>

        {msg && <div className={noticeClass}>{msg}</div>}

        {result && (
          <>
            <div className="grid" style={{ marginTop: 16, marginBottom: 0 }}>
              {[
                ['Found', result.found ?? 0],
                ['New leads', result.created ?? 0],
                ['Already saved', result.duplicates ?? 0],
                ['Skipped', result.skipped ?? 0],
              ].map(([label, value]) => (
                <div className="stat-card" key={String(label)}>
                  <div className="label">{label}</div>
                  <div className="stat">{value}</div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
              New leads land in <strong>Pending audit</strong> until the worker finishes website audit.
              Qualified leads (active site, no chatbot) appear on the Qualified tab.{' '}
              <a href="/leads?queue=PENDING_AUDIT">Pending audit →</a>
              {' · '}
              <a href="/leads?queue=QUALIFIED">Qualified →</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
