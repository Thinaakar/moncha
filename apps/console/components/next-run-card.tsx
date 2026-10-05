'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icon';

type Schedule = { id: string; country: string; timezone: string; nextRunAt: string };
type ScheduleResponse = { countries?: { schedules?: Schedule[] }[] };

const REFRESH_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ZONE_NAMES: Record<string, string> = {
  'Asia/Singapore': 'SGT',
  'Asia/Kuala_Lumpur': 'MYT',
  'Asia/Tokyo': 'JST',
};

function zoneName(timezone: string, at: Date) {
  if (ZONE_NAMES[timezone]) return ZONE_NAMES[timezone];
  const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((item) => item.type === 'timeZoneName');
  return part?.value || timezone;
}

function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  );
}

function whenLabel(schedule: Schedule, now: Date) {
  const run = new Date(schedule.nextRunAt);
  const days = Math.round((Date.parse(dayKey(run, schedule.timezone)) - Date.parse(dayKey(now, schedule.timezone))) / DAY_MS);
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(run);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone, hour: 'numeric', minute: '2-digit' }).format(run);
  return `${day} • ${time} ${zoneName(schedule.timezone, run)}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function NextRunCard() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/schedules', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load schedules');
      const data = (await res.json()) as ScheduleResponse;
      setSchedules((data.countries || []).flatMap((country) => country.schedules || []));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [load]);

  const next = (schedules || [])
    .filter((schedule) => Date.parse(schedule.nextRunAt) > now)
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0];

  const hasPassedRuns = (schedules || []).some((schedule) => Date.parse(schedule.nextRunAt) <= now);
  useEffect(() => {
    if (!hasPassedRuns) return;
    const timer = window.setTimeout(load, 3000);
    return () => window.clearTimeout(timer);
  }, [hasPassedRuns, load]);

  const remaining = next ? Math.max(0, Math.floor((Date.parse(next.nextRunAt) - now) / 1000)) : 0;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const units = [
    { label: 'HRS', value: hours },
    { label: 'MIN', value: minutes },
    { label: 'SEC', value: seconds },
  ];

  return (
    <div className="next-run-card">
      <div className="next-run-head">
        <span className="next-run-icon">
          <Icon name="calendar" size={16} />
        </span>
        <span className="next-run-text">
          <span className="next-run-label">Next run</span>
          {next ? (
            <>
              <span className="next-run-when">{whenLabel(next, new Date(now))}</span>
              <span className="next-run-country">{next.country}</span>
            </>
          ) : (
            <span className="next-run-when">{schedules === null && !failed ? 'Loading…' : 'Not scheduled'}</span>
          )}
        </span>
      </div>

      {next ? (
        <div className="next-run-countdown" aria-label={`${hours} hours ${minutes} minutes ${seconds} seconds`}>
          {units.map((unit, index) => (
            <Fragment key={unit.label}>
              {index > 0 ? <span className="next-run-sep">:</span> : null}
              <span className="next-run-unit">
                <strong>{pad(unit.value)}</strong>
                <small>{unit.label}</small>
              </span>
            </Fragment>
          ))}
        </div>
      ) : failed ? (
        <p className="next-run-empty">Could not load schedules.</p>
      ) : schedules !== null ? (
        <p className="next-run-empty">
          No daily runs yet. <Link href="/jobs">Add a schedule</Link>
        </p>
      ) : null}
    </div>
  );
}
