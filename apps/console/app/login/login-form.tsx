'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Icon, type IconName } from '@/components/icon';

const DEMO_EMAIL = 'operator@moncha.local';
const REMEMBER_KEY = 'moncha-remember-email';
const RESET_DELAY_MS = 700;

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: 'discover', label: 'Discover businesses' },
  { icon: 'check', label: 'Check websites' },
  { icon: 'leads', label: 'Keep qualified leads' },
];

const PREVIEW_KPIS = [
  { label: 'Total leads', value: '128' },
  { label: 'Qualified', value: '42' },
  { label: 'Qualify rate', value: '33%' },
];

const PREVIEW_SLICES = [
  { pct: 33, color: '#4ade80' },
  { pct: 25, color: '#fbbf24' },
  { pct: 20, color: '#fb923c' },
  { pct: 22, color: 'rgba(255, 255, 255, 0.55)' },
];

const PREVIEW_COUNTRIES = [
  { name: 'Malaysia', count: 52 },
  { name: 'Singapore', count: 38 },
  { name: 'UAE', count: 24 },
  { name: 'Saudi Arabia', count: 14 },
];

type View = 'signin' | 'forgot' | 'sent';

function BrandName() {
  return (
    <span>
      Mon<b>Cha</b> Lead Engine
    </span>
  );
}

function PreviewDonut() {
  let offset = 25;
  return (
    <svg viewBox="0 0 42 42" className="login-preview-donut">
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="6" />
      {PREVIEW_SLICES.map((slice) => {
        const circle = (
          <circle
            key={slice.color}
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            stroke={slice.color}
            strokeWidth="6"
            strokeDasharray={`${slice.pct} ${100 - slice.pct}`}
            strokeDashoffset={offset}
          />
        );
        offset -= slice.pct;
        return circle;
      })}
    </svg>
  );
}

function BrandPanel() {
  const max = Math.max(...PREVIEW_COUNTRIES.map((country) => country.count));
  return (
    <section className="login-brand">
      <div className="login-glow login-glow-a" />
      <div className="login-glow login-glow-b" />

      <div className="login-brand-top">
        <span className="login-brand-mark">
          <img src="/brand/mark.svg" alt="" />
        </span>
        <BrandName />
      </div>

      <div className="login-brand-body">
        <span className="login-eyebrow">Lead engine for SG · MY · AE · SA</span>
        <h2>
          Find companies.
          <br />
          <span>Review leads.</span>
        </h2>
        <p>Discover businesses, check their websites, and keep a clean list of qualified leads.</p>
      </div>

      <div className="login-preview" aria-hidden="true">
        <div className="login-preview-card">
          <div className="login-preview-head">
            <span className="login-preview-dots">
              <i />
              <i />
              <i />
            </span>
            <strong>Overview</strong>
          </div>
          <div className="login-preview-kpis">
            {PREVIEW_KPIS.map((kpi) => (
              <div key={kpi.label}>
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
              </div>
            ))}
          </div>
          <div className="login-preview-body">
            <PreviewDonut />
            <div className="login-preview-bars">
              {PREVIEW_COUNTRIES.map((country) => (
                <div className="login-preview-bar" key={country.name}>
                  <span>{country.name}</span>
                  <div className="login-preview-track">
                    <i style={{ width: `${(country.count / max) * 100}%` }} />
                  </div>
                  <b>{country.count}</b>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="login-float login-float-a">
          <span className="login-float-icon is-ok">
            <Icon name="check" size={18} />
          </span>
          <div>
            <strong>Website checked</strong>
            <small>harbordental.sg</small>
          </div>
        </div>
        <div className="login-float login-float-b">
          <span className="login-float-icon">
            <Icon name="users" size={18} />
          </span>
          <div>
            <strong>+12 new leads</strong>
            <small>Today · Malaysia</small>
          </div>
        </div>
      </div>

      <ul className="login-features">
        {FEATURES.map((feature) => (
          <li key={feature.label}>
            <span className="login-feature-icon">
              <Icon name={feature.icon} size={15} />
            </span>
            {feature.label}
          </li>
        ))}
      </ul>

      <p className="login-brand-foot">© {new Date().getFullYear()} MonCha</p>
    </section>
  );
}

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const [view, setView] = useState<View>('signin');
  const [email, setEmail] = useState(demo ? DEMO_EMAIL : '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }
  }, []);

  function fail(text: string) {
    setMsg(text);
    setShaking(true);
    setBusy(false);
  }

  function switchView(nextView: View) {
    setMsg('');
    setBusy(false);
    if (nextView === 'forgot') setResetEmail(email);
    setView(nextView);
  }

  async function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (res.ok) {
        if (remember) window.localStorage.setItem(REMEMBER_KEY, email.trim());
        else window.localStorage.removeItem(REMEMBER_KEY);
        window.location.href = next;
        return;
      }
      const data = await res.json().catch(() => ({}));
      fail(data.error?.message || 'Login failed');
    } catch {
      fail('Login failed');
    }
  }

  async function sendReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    await new Promise((resolve) => window.setTimeout(resolve, RESET_DELAY_MS));
    setBusy(false);
    setView('sent');
  }

  return (
    <main className="login-page">
      <BrandPanel />

      <section className="login-panel">
        <div
          className={shaking ? 'login-form-wrap is-shaking' : 'login-form-wrap'}
          onAnimationEnd={() => setShaking(false)}
        >
          <div className="login-mobile-brand brand">
            <img src="/brand/mark.svg" alt="" />
            <BrandName />
          </div>

          {view === 'signin' ? (
            <div className="login-view" key="signin">
              <h1>Welcome back</h1>
              <p className="login-sub">Sign in to MonCha to open Discover, jobs, and leads.</p>

              <form className="login-form" onSubmit={signIn}>
                <div className="login-field">
                  <label htmlFor="login-email">Email</label>
                  <div className="login-input">
                    <Icon name="mail" />
                    <input
                      id="login-email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      autoFocus
                      required
                    />
                  </div>
                </div>

                <div className="login-field">
                  <div className="login-label-row">
                    <label htmlFor="login-password">Password</label>
                    <button type="button" className="login-link" onClick={() => switchView('forgot')}>
                      Forgot password?
                    </button>
                  </div>
                  <div className="login-input">
                    <Icon name="lock" />
                    <input
                      id="login-password"
                      className="has-toggle"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="login-eye"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <Icon name={showPassword ? 'eye-off' : 'eye'} />
                    </button>
                  </div>
                </div>

                <label className="login-remember">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  Remember me
                </label>

                <button className="login-submit" disabled={busy}>
                  {busy ? (
                    <>
                      <span className="login-spinner" aria-hidden="true" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in <span aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </form>

              {msg ? <div className="notice error">{msg}</div> : null}
              {demo ? (
                <div className="login-demo-note">
                  <Icon name="info" size={16} />
                  <span>
                    Demo mode: sign in with <b>{DEMO_EMAIL}</b> and any password.
                  </span>
                </div>
              ) : null}
              <p className="login-help">Need access? Ask your MonCha admin.</p>
            </div>
          ) : null}

          {view === 'forgot' ? (
            <div className="login-view" key="forgot">
              <button type="button" className="login-link login-back" onClick={() => switchView('signin')}>
                ← Back to sign in
              </button>
              <h1>Forgot password?</h1>
              <p className="login-sub">Enter your email and we&apos;ll send you a link to reset your password.</p>

              <form className="login-form" onSubmit={sendReset}>
                <div className="login-field">
                  <label htmlFor="reset-email">Email</label>
                  <div className="login-input">
                    <Icon name="mail" />
                    <input
                      id="reset-email"
                      type="email"
                      placeholder="you@company.com"
                      value={resetEmail}
                      onChange={(event) => setResetEmail(event.target.value)}
                      autoComplete="email"
                      autoFocus
                      required
                    />
                  </div>
                </div>
                <button className="login-submit" disabled={busy}>
                  {busy ? (
                    <>
                      <span className="login-spinner" aria-hidden="true" />
                      Sending…
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </button>
              </form>
            </div>
          ) : null}

          {view === 'sent' ? (
            <div className="login-view" key="sent">
              <span className="login-sent-icon">
                <Icon name="mail" size={26} />
              </span>
              <h1>Check your email</h1>
              <p className="login-sub">
                If an account exists for <b>{resetEmail.trim()}</b>, a password reset link is on its way.
              </p>
              <div className="login-demo-note login-demo-note-flat">
                <Icon name="info" size={16} />
                <span>Password reset isn&apos;t connected to a mail server yet, so no email was actually sent.</span>
              </div>
              <button type="button" className="login-submit" onClick={() => switchView('signin')}>
                Back to sign in
              </button>
              <p className="login-help">
                Didn&apos;t get it?{' '}
                <button type="button" className="login-link" onClick={() => switchView('forgot')}>
                  Try again
                </button>
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
