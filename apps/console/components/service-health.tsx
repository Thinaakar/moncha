'use client';

import { useEffect, useState } from 'react';

type Check = { ok: boolean; label: string; detail: string };

export function ServiceHealth() {
  const [checks, setChecks] = useState<Check[]>([
    { ok: false, label: 'Backend API', detail: 'Checking…' },
    { ok: false, label: 'Worker', detail: 'Checking…' },
  ]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/v1/health', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.ok !== true || data.db !== 'up') throw new Error('API or database unavailable');
        return { ok: true, label: 'Backend API', detail: `Database up · ${data.countries?.length ?? 0} countries` };
      }).catch(() => ({ ok: false, label: 'Backend API', detail: 'Unavailable' })),
      fetch('/api/v1/worker-health', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.ok !== true) throw new Error('Worker unavailable');
        return { ok: true, label: 'Worker', detail: data.crawlRunning ? 'Crawl running' : 'Ready' };
      }).catch(() => ({ ok: false, label: 'Worker', detail: 'Unavailable' })),
    ]).then((results) => {
      if (!cancelled) setChecks(results);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="card" aria-label="Service health">
      <div className="card-head"><h2>Service health</h2></div>
      <div className="chip-row">
        {checks.map((check) => (
          <span key={check.label} className={check.ok ? 'chip chip-green' : 'chip chip-red'}>
            {check.label}: {check.detail}
          </span>
        ))}
      </div>
    </section>
  );
}