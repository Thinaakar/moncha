'use client';

import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Icon, type IconName } from '@/components/icon';
import { JobTimeline, type TimelineJob } from '@/components/job-timeline';

const STORAGE_KEY = 'moncha-daily-schedule';
const ZONE = 'Asia/Singapore';
const DAY_MINUTES = 24 * 60;
const MIN_LEADS = 1;
const MAX_LEADS = 50;
const UPCOMING_LIMIT = 5;

const COUNTRIES = [
  { name: 'Singapore', label: 'Singapore', code: 'SG' },
  { name: 'Malaysia', label: 'Malaysia', code: 'MY' },
  { name: 'United Arab Emirates', label: 'UAE', code: 'AE' },
  { name: 'Saudi Arabia', label: 'Saudi Arabia', code: 'SA' },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

type Schedule = {
  id: string;
  countries: string[];
  hours: number[];
  leadsPerRun: number;
  active: boolean;
};

type Draft = { countries: string[]; hours: number[]; leads: string };

type UpcomingRun = {
  key: string;
  schedule: Schedule;
  hour: number;
  minutesAway: number;
  day: 'Today' | 'Tomorrow';
};

type Message = { tone: 'ok' | 'error'; text: string };

const EMPTY_DRAFT: Draft = { countries: [], hours: [], leads: '20' };

function countryInfo(name: string) {
  return COUNTRIES.find((country) => country.name === name) ?? { name, label: name, code: name.slice(0, 2).toUpperCase() };
}

function countryName(raw: string) {
  const value = raw.trim().toLowerCase();
  const match = COUNTRIES.find((country) => country.name.toLowerCase() === value || country.label.toLowerCase() === value);
  if (match) return match.name;
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function sortCountries(names: string[]) {
  const rank = (name: string) => {
    const index = COUNTRIES.findIndex((country) => country.name === name);
    return index === -1 ? COUNTRIES.length : index;
  };
  return [...names].sort((a, b) => rank(a) - rank(b));
}

function sortHours(hours: number[]) {
  return [...new Set(hours)].sort((a, b) => a - b);
}

function clampLeads(value: number) {
  return Math.min(MAX_LEADS, Math.max(MIN_LEADS, Math.round(value) || MIN_LEADS));
}

function fromStored(row: Record<string, unknown>, index: number): Schedule | null {
  const id = row.id ? String(row.id) : `schedule-${index}`;
  if (Array.isArray(row.countries) && Array.isArray(row.hours)) {
    const countries = row.countries.map(String).filter(Boolean);
    const hours = row.hours.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour < 24);
    if (!countries.length || !hours.length) return null;
    return {
      id,
      countries: sortCountries(countries),
      hours: sortHours(hours),
      leadsPerRun: clampLeads(Number(row.leadsPerRun)),
      active: row.active !== false,
    };
  }
  if (typeof row.country === 'string' && row.country.trim()) {
    const hour = Number(String(row.time || '10:00').split(':')[0]);
    return {
      id,
      countries: [countryName(row.country)],
      hours: [Number.isInteger(hour) ? hour % 24 : 10],
      leadsPerRun: 20,
      active: true,
    };
  }
  return null;
}

function loadSchedules(): Schedule[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      .map(fromStored)
      .filter((row): row is Schedule => row !== null);
  } catch {
    return [];
  }
}

function hourLabel(hour: number) {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function countriesText(countries: string[]) {
  return joinWords(countries.map((name) => countryInfo(name).label));
}

function hoursSummary(hours: number[]) {
  if (!hours.length) return 'Pick at least one time.';
  const often = hours.length === 1 ? 'once' : hours.length === 2 ? 'twice' : `${hours.length} times`;
  return `Runs ${often} daily at ${joinWords(hours.map(hourLabel))} SGT.`;
}

function nowMinutesInZone() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return read('hour') * 60 + read('minute');
}

function countdown(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `in ${hours}h ${rest}m` : `in ${rest}m`;
}

function upcomingRuns(schedules: Schedule[], now: number): UpcomingRun[] {
  const runs: UpcomingRun[] = [];
  for (const schedule of schedules) {
    if (!schedule.active) continue;
    for (const hour of schedule.hours) {
      for (const dayOffset of [0, 1]) {
        const at = dayOffset * DAY_MINUTES + hour * 60;
        if (at <= now) continue;
        runs.push({
          key: `${schedule.id}-${dayOffset}-${hour}`,
          schedule,
          hour,
          minutesAway: at - now,
          day: at < DAY_MINUTES ? 'Today' : 'Tomorrow',
        });
      }
    }
  }
  return runs.sort((a, b) => a.minutesAway - b.minutesAway).slice(0, UPCOMING_LIMIT);
}

function sampleHistory(schedules: Schedule[]): TimelineJob[] {
  return schedules.flatMap((schedule) =>
    schedule.hours.slice(0, 2).map((hour, index) => {
      const found = schedule.leadsPerRun;
      const saved = Math.max(0, Math.round(found * 0.6) - index);
      return {
        id: `${schedule.id}-${hour}`,
        title: `Discovery · ${countriesText(schedule.countries)}`,
        when: `Yesterday at ${hourLabel(hour)} SGT`,
        status: 'done',
        detail: `${found} found · ${saved} saved · ${found - saved} skipped`,
      };
    }),
  );
}

function sameSchedule(a: { countries: string[]; hours: number[] }, b: { countries: string[]; hours: number[] }) {
  return a.countries.join('|') === b.countries.join('|') && a.hours.join('|') === b.hours.join('|');
}

function CardHead({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="setup-head">
      <span className="setup-icon">
        <Icon name={icon} />
      </span>
      <div>
        <h2>{title}</h2>
        <p className="muted">{text}</p>
      </div>
    </div>
  );
}

function CountryPill({ name }: { name: string }) {
  const country = countryInfo(name);
  return (
    <span className="country-pill">
      <span className="country-code">{country.code}</span>
      {country.label}
    </span>
  );
}

export function DailySchedule() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setSchedules(loadSchedules());
    setNow(nowMinutesInZone());
    const timer = window.setInterval(() => setNow(nowMinutesInZone()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ready = now !== null;
  const upcoming = useMemo(() => (now === null ? [] : upcomingRuns(schedules, now)), [schedules, now]);
  const history = useMemo(() => sampleHistory(schedules), [schedules]);

  function persist(next: Schedule[]) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSchedules(next);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  }

  function toggleCountry(name: string) {
    const countries = draft.countries.includes(name)
      ? draft.countries.filter((country) => country !== name)
      : sortCountries([...draft.countries, name]);
    updateDraft({ countries });
  }

  function toggleHour(hour: number) {
    const hours = draft.hours.includes(hour) ? draft.hours.filter((value) => value !== hour) : sortHours([...draft.hours, hour]);
    updateDraft({ hours });
  }

  function resetDraft() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  function save() {
    const leads = Number(draft.leads);
    if (!draft.countries.length) {
      setMessage({ tone: 'error', text: 'Pick at least one country.' });
      return;
    }
    if (!draft.hours.length) {
      setMessage({ tone: 'error', text: 'Pick at least one run time.' });
      return;
    }
    if (!Number.isInteger(leads) || leads < MIN_LEADS || leads > MAX_LEADS) {
      setMessage({ tone: 'error', text: `Leads per run must be between ${MIN_LEADS} and ${MAX_LEADS}.` });
      return;
    }
    if (schedules.some((schedule) => schedule.id !== editingId && sameSchedule(schedule, draft))) {
      setMessage({ tone: 'error', text: 'This schedule is already saved.' });
      return;
    }

    if (editingId) {
      persist(
        schedules.map((schedule) =>
          schedule.id === editingId
            ? { ...schedule, countries: draft.countries, hours: draft.hours, leadsPerRun: leads }
            : schedule,
        ),
      );
      setMessage({ tone: 'ok', text: 'Schedule updated.' });
    } else {
      persist([
        ...schedules,
        { id: `schedule-${Date.now()}`, countries: draft.countries, hours: draft.hours, leadsPerRun: leads, active: true },
      ]);
      setMessage({ tone: 'ok', text: `Saved. ${hoursSummary(draft.hours)}` });
    }
    resetDraft();
  }

  function edit(schedule: Schedule) {
    setEditingId(schedule.id);
    setDraft({ countries: schedule.countries, hours: schedule.hours, leads: String(schedule.leadsPerRun) });
    setMessage(null);
    document.getElementById('schedule-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    resetDraft();
    setMessage(null);
  }

  function toggleActive(schedule: Schedule) {
    persist(schedules.map((item) => (item.id === schedule.id ? { ...item, active: !item.active } : item)));
    setMessage(null);
  }

  function remove(schedule: Schedule) {
    if (!window.confirm(`Delete the ${countriesText(schedule.countries)} schedule?`)) return;
    persist(schedules.filter((item) => item.id !== schedule.id));
    if (editingId === schedule.id) resetDraft();
    setMessage(null);
  }

  const draftCountries = draft.countries.length ? countriesText(draft.countries) : 'No countries yet';
  const draftTimes = draft.hours.length ? `${draft.hours.map(hourLabel).join(', ')} SGT` : 'No times yet';

  return (
    <>
      <div className="schedule-setup" id="schedule-setup">
        <section className="card">
          <CardHead icon="globe" title="Countries" text="Choose where Discover searches on each scheduled run." />
          <p className="setup-label">Countries</p>
          <div className="country-chips">
            {COUNTRIES.map((country) => {
              const on = draft.countries.includes(country.name);
              return (
                <button
                  type="button"
                  key={country.name}
                  className={on ? 'country-chip is-on' : 'country-chip'}
                  aria-pressed={on}
                  onClick={() => toggleCountry(country.name)}
                >
                  <span className="country-code">{country.code}</span>
                  {country.label}
                  {on ? <span className="country-tick">✓</span> : null}
                </button>
              );
            })}
          </div>
          <label className="setup-label" htmlFor="leads-per-run">
            Leads per run
          </label>
          <input
            id="leads-per-run"
            type="number"
            min={MIN_LEADS}
            max={MAX_LEADS}
            value={draft.leads}
            onChange={(event) => updateDraft({ leads: event.target.value })}
          />
          <div className="chip-row setup-limits">
            <span className="chip chip-blue">Min {MIN_LEADS}</span>
            <span className="chip chip-blue">Max {MAX_LEADS}</span>
          </div>
        </section>

        <section className="card">
          <CardHead icon="jobs" title="Run schedule" text="Pick the times (SGT) when Discover runs each day." />
          <p className="setup-label">Run times (SGT)</p>
          <div className="hour-grid">
            {HOURS.map((hour) => {
              const on = draft.hours.includes(hour);
              return (
                <button
                  type="button"
                  key={hour}
                  className={on ? 'hour-cell is-on' : 'hour-cell'}
                  aria-pressed={on}
                  onClick={() => toggleHour(hour)}
                >
                  {hourLabel(hour)}
                </button>
              );
            })}
          </div>
          <p className="muted setup-summary">{hoursSummary(draft.hours)}</p>
        </section>
      </div>

      <div className="schedule-summary">
        <div className="schedule-summary-text">
          <strong>{editingId ? 'Editing schedule' : 'New schedule'}</strong>
          <span>
            {draftCountries} · {draftTimes} · {draft.leads || 0} leads per run
          </span>
        </div>
        <div className="schedule-summary-actions">
          {editingId ? (
            <button type="button" className="secondary" onClick={cancelEdit}>
              Cancel
            </button>
          ) : null}
          <button type="button" onClick={save}>
            {editingId ? 'Update schedule' : 'Save schedule'}
          </button>
        </div>
      </div>
      {message ? <p className={`schedule-message is-${message.tone}`}>{message.text}</p> : null}

      <div className="card">
        <CardHead icon="calendar" title="Saved schedules" text="Your saved runs. Discover follows these every day." />
        {!ready ? null : schedules.length === 0 ? (
          <EmptyState title="No schedules saved yet">Pick countries and times above, then press Save.</EmptyState>
        ) : (
          <div className="saved-schedules">
            {schedules.map((schedule) => {
              const next = now === null ? undefined : upcomingRuns([schedule], now)[0];
              const classes = ['saved-schedule'];
              if (!schedule.active) classes.push('is-paused');
              if (editingId === schedule.id) classes.push('is-editing');
              return (
                <article className={classes.join(' ')} key={schedule.id}>
                  <div className="saved-schedule-top">
                    <div className="saved-countries">
                      {schedule.countries.map((name) => (
                        <CountryPill key={name} name={name} />
                      ))}
                    </div>
                    <span className={schedule.active ? 'chip chip-green' : 'chip chip-gray'}>
                      {schedule.active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="saved-schedule-meta">
                    <span>
                      <Icon name="jobs" size={15} />
                      {schedule.hours.map(hourLabel).join(' · ')} SGT
                    </span>
                    <span>
                      <Icon name="users" size={15} />
                      {schedule.leadsPerRun} leads per run
                    </span>
                  </div>
                  <p className="saved-schedule-next">
                    {!schedule.active
                      ? 'Paused. No runs until you resume.'
                      : next
                        ? `Next run: ${next.day} ${hourLabel(next.hour)} (${countdown(next.minutesAway)})`
                        : null}
                  </p>
                  <div className="saved-schedule-actions">
                    <button type="button" className="secondary" onClick={() => edit(schedule)}>
                      Edit
                    </button>
                    <button type="button" className="secondary" onClick={() => toggleActive(schedule)}>
                      {schedule.active ? 'Pause' : 'Resume'}
                    </button>
                    <button type="button" className="btn-danger" onClick={() => remove(schedule)}>
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <CardHead icon="jobs" title="Upcoming runs" text="The next runs across your active schedules." />
        {!ready ? null : upcoming.length === 0 ? (
          <EmptyState title="Nothing scheduled">
            {schedules.length ? 'All schedules are paused.' : 'Save a schedule to see the next runs.'}
          </EmptyState>
        ) : (
          <ol className="upcoming-list">
            {upcoming.map((run, index) => (
              <li className={index === 0 ? 'upcoming-run is-next' : 'upcoming-run'} key={run.key}>
                <span className="upcoming-dot" />
                <strong className="upcoming-when">
                  {run.day} {hourLabel(run.hour)}
                </strong>
                <span className="upcoming-countries">{countriesText(run.schedule.countries)}</span>
                <span className="upcoming-leads">{run.schedule.leadsPerRun} leads</span>
                <span className="upcoming-countdown">{countdown(run.minutesAway)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card">
        <h2>Run history</h2>
        <p className="muted card-intro">Sample runs. Skipped companies were already saved.</p>
        {history.length === 0 ? (
          <EmptyState title="No runs yet">Save a schedule to start the daily fetch.</EmptyState>
        ) : (
          <JobTimeline jobs={history} />
        )}
      </div>
    </>
  );
}
