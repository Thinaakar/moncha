'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

type JobResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
};

type PreviewLead = { id: string; name: string; domain: string | null; country: string | null };

type Step = 'idle' | 'starting' | 'finding' | 'saving' | 'done' | 'failed';

const RECENT_KEY = 'moncha-discover-recent';
const RECENT_LIMIT = 5;

const COUNTRIES = [
  'Japan',
  'Malaysia',
  'Singapore',
];

const STEPS: { key: Exclude<Step, 'idle' | 'failed'>; label: string }[] = [
  { key: 'starting', label: 'Starting' },
  { key: 'finding', label: 'Finding companies' },
  { key: 'saving', label: 'Saving leads' },
  { key: 'done', label: 'Done' },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadRecent(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function stepState(current: Step, failedAt: Step, key: Step) {
  const order = STEPS.map((step) => step.key as Step);
  const active = current === 'failed' ? failedAt : current;
  const activeIndex = order.indexOf(active);
  const index = order.indexOf(key);
  if (current === 'failed' && index === activeIndex) return 'failed';
  if (current === 'done' || index < activeIndex) return 'complete';
  if (index === activeIndex) return 'active';
  return 'upcoming';
}

export function DiscoverPanel() {
  const [country, setCountry] = useState('Singapore');
  const [recent, setRecent] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('idle');
  const [failedAt, setFailedAt] = useState<Step>('starting');
  const [msg, setMsg] = useState('');
  const [tone, setTone] = useState<'info' | 'success' | 'error'>('info');
  const [result, setResult] = useState<JobResult | null>(null);
  const [preview, setPreview] = useState<PreviewLead[]>([]);
  const [searched, setSearched] = useState('');

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const busy = step === 'starting' || step === 'finding' || step === 'saving';

  function remember(value: string) {
    const next = [value, ...recent.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(
      0,
      RECENT_LIMIT,
    );
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    setRecent(next);
  }

  function clearRecent() {
    window.localStorage.removeItem(RECENT_KEY);
    setRecent([]);
  }

  function fail(at: Step, message: string) {
    setFailedAt(at);
    setStep('failed');
    setTone('error');
    setMsg(message);
  }

  function finish(value: string, next: JobResult) {
    setResult(next);
    setStep('done');
    setTone('success');
    if (next.created > 0) {
      setMsg(
        `Done. Found ${next.found}, saved ${next.created} new lead${next.created === 1 ? '' : 's'} into Pending audit.` +
          (next.duplicates > 0 ? ` ${next.duplicates} already in your pipeline.` : ''),
      );
    } else if (next.duplicates > 0) {
      setMsg(`Done. Found ${next.found} in ${value}. All ${next.duplicates} were already saved from an earlier run.`);
    } else {
      setMsg(`Done. No companies found in ${value}. Try another country.`);
    }
  }

  async function loadPreview(value: string) {
    try {
      const params = new URLSearchParams({ queue: 'PENDING_AUDIT', country: value, pageSize: '5' });
      const res = await fetch(`/api/v1/leads?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: { id: string; company?: { name?: string; domain?: string | null; country?: string | null } }[];
      };
      setPreview(
        (data.items || []).map((item) => ({
          id: item.id,
          name: item.company?.name || 'Unnamed company',
          domain: item.company?.domain ?? null,
          country: item.company?.country ?? value,
        })),
      );
    } catch {
      setPreview([]);
    }
  }

  async function runLive(value: string) {
    setStep('starting');
    setMsg(`Starting discovery for ${value}…`);
    let data: { id?: string; status?: string; error?: { message?: string } | string };
    try {
      const res = await fetch('/api/v1/discovery/country', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ country: value }),
      });
      data = await res.json();
      if (!res.ok || !data.id) {
        const error = typeof data.error === 'string' ? data.error : data.error?.message;
        fail('starting', error || 'Failed to start discovery');
        return;
      }
    } catch {
      fail('starting', 'Failed to start discovery. Is the backend running?');
      return;
    }

    for (let i = 0; i < 40; i += 1) {
      await wait(2000);
      try {
        const res = await fetch(`/api/v1/jobs/${data.id}`);
        const job = await res.json();
        if (!res.ok) {
          fail('finding', job.error?.message || 'Could not read job status');
          return;
        }
        if (job.status === 'done') {
          const payload = job.result || {};
          const next: JobResult = {
            found: payload.found ?? 0,
            created: payload.created ?? payload.saved ?? 0,
            duplicates: payload.duplicates ?? 0,
            skipped: payload.skipped ?? 0,
          };
          setStep('saving');
          if (next.created > 0) await loadPreview(value);
          finish(value, next);
          return;
        }
          if (job.status === 'failed') {
            fail('finding', job.lastError || 'Discovery failed');
          return;
        }
        setStep(job.status === 'running' ? 'finding' : 'starting');
        setMsg(job.status === 'running' ? `Finding companies in ${value}…` : `Job ${data.id} is queued…`);
      } catch {
        fail('finding', 'Lost connection while checking the job.');
        return;
      }
    }
    setTone('info');
    setMsg('Still running. Check Jobs or Leads in a moment.');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = country.trim();
    if (!value || busy) return;
    setResult(null);
    setPreview([]);
    setTone('info');
    setSearched(value);
    remember(value);
    await runLive(value);
  }

  const cards = result
    ? [
        { label: 'Found', value: result.found, tone: 'blue', href: null },
        { label: 'New leads', value: result.created, tone: 'green', href: '/leads?queue=PENDING_AUDIT' },
        { label: 'Already saved', value: result.duplicates, tone: 'gray', href: '/leads' },
        { label: 'Skipped', value: result.skipped, tone: 'amber', href: null },
      ]
    : [];

  return (
    <>
      <div className="card">
        <form className="discover-form" onSubmit={submit}>
          <label className="discover-field">
            Country
            <input
              name="country"
              list="discover-countries"
              placeholder="Start typing a country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              autoComplete="off"
              required
              suppressHydrationWarning
            />
            <datalist id="discover-countries">
              {COUNTRIES.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <button type="submit" disabled={busy} suppressHydrationWarning>
            {busy ? 'Discovering…' : 'Start discovery'}
          </button>
          <a href="/leads?queue=PENDING_AUDIT" className="btn btn-secondary">
            Open pending audits
          </a>
        </form>

        {recent.length > 0 ? (
          <div className="discover-recent">
            <span className="discover-recent-label">Recent</span>
            {recent.map((item) => (
              <button
                type="button"
                key={item}
                className="discover-recent-chip"
                onClick={() => setCountry(item)}
                disabled={busy}
              >
                {item}
              </button>
            ))}
            <button type="button" className="discover-recent-clear" onClick={clearRecent} disabled={busy}>
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {step !== 'idle' ? (
        <div className="card">
          <ol className="discover-steps">
            {STEPS.map((item) => (
              <li key={item.key} className={`discover-step is-${stepState(step, failedAt, item.key)}`}>
                <span className="discover-step-dot" aria-hidden="true" />
                <span>{item.label}</span>
              </li>
            ))}
          </ol>
          {msg ? (
            <div className={tone === 'success' ? 'notice success' : tone === 'error' ? 'notice error' : 'notice'}>
              {msg}
            </div>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="grid discover-results">
          {cards.map((card) => {
            const body = (
              <>
                <div className="label">{card.label}</div>
                <div className="stat">{card.value}</div>
              </>
            );
            return card.href ? (
              <Link key={card.label} href={card.href} className={`stat-card discover-stat tone-${card.tone}`}>
                {body}
              </Link>
            ) : (
              <div key={card.label} className={`stat-card discover-stat tone-${card.tone}`}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}

      {result && preview.length > 0 ? (
        <div className="card">
          <div className="discover-preview-head">
            <h2>New leads in {searched}</h2>
            <Link href="/leads?queue=PENDING_AUDIT">View all →</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Website</th>
                  <th>Country</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
                    </td>
                    <td>{lead.domain || '—'}</td>
                    <td>{lead.country || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
