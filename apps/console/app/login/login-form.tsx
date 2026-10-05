'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Icon, type IconName } from '@/components/icon';

const DEMO_EMAIL = 'operator@moncha.local';
const REMEMBER_KEY = 'moncha-remember-email';
const RESET_DELAY_MS = 700;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const FIELD_LABELS: Record<string, string> = { email: 'Email', password: 'Password', name: 'Name' };

function registerError(data: {
  error?: { message?: string; details?: { fieldErrors?: Record<string, string[] | undefined> } };
}): string {
  const fields = data.error?.details?.fieldErrors;
  if (fields) {
    for (const [field, messages] of Object.entries(fields)) {
      if (messages?.[0]) return `${FIELD_LABELS[field] || field}: ${messages[0]}`;
    }
  }
  return data.error?.message || 'Could not create account';
}

const TILES: { icon: IconName; label: string }[] = [
  { icon: 'discover', label: 'Discover' },
  { icon: 'check', label: 'Check websites' },
  { icon: 'leads', label: 'Keep leads' },
];

type View = 'signin' | 'register' | 'forgot' | 'sent';

function BrandName() {
  return (
    <span>
      Mon<b>Cha</b> Lead Engine
    </span>
  );
}

function Hero() {
  return (
    <section className="login-hero">
      <span className="login-eyebrow">Lead engine for SG · MY · JP</span>
      <h2>
        Find companies
        <br />
        <span className="login-underline">without a chatbot.</span>
      </h2>
      <p>
        MonCha discovers businesses every day, checks their websites, and keeps a clean list of qualified leads for
        your team.
      </p>
      <ul className="login-tiles">
        {TILES.map((tile) => (
          <li key={tile.label}>
            <span className="login-tile-icon">
              <Icon name={tile.icon} size={18} />
            </span>
            {tile.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const [view, setView] = useState<View>('signin');
  const [email, setEmail] = useState(demo ? DEMO_EMAIL : '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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
    if (nextView === 'register' || view === 'register') {
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
    }
    setView(nextView);
  }

  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return fail(`Password must be at least ${PASSWORD_MIN} characters`);
    if (password.length > PASSWORD_MAX) return fail(`Password must be at most ${PASSWORD_MAX} characters`);
    if (password !== confirmPassword) return fail('Passwords do not match');
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, ...(name.trim() ? { name: name.trim() } : {}) }),
      });
      if (res.ok) {
        window.location.href = next;
        return;
      }
      fail(registerError(await res.json().catch(() => ({}))));
    } catch {
      fail('Could not create account');
    }
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
      <header className="login-topbar">
        <span className="brand">
          <img src="/brand/mark.svg" alt="" />
          <BrandName />
        </span>
        <div className="login-topbar-actions">
          <div className="login-help-menu">
            <button
              type="button"
              className="login-topbar-link"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((value) => !value)}
            >
              Need help?
            </button>
            {helpOpen ? (
              <div className="login-help-pop" role="note">
                Ask your MonCha admin for access. Forgot your password?{' '}
                <button
                  type="button"
                  className="login-link"
                  onClick={() => {
                    setHelpOpen(false);
                    switchView('forgot');
                  }}
                >
                  Reset it
                </button>
              </div>
            ) : null}
          </div>
          {view === 'register' ? (
            <button type="button" className="login-topbar-cta" onClick={() => switchView('signin')}>
              Sign in
            </button>
          ) : (
            <button type="button" className="login-topbar-cta" onClick={() => switchView('register')}>
              Sign up
            </button>
          )}
        </div>
      </header>

      <div className="login-main">
        <Hero />

        <section className="login-card">
          <div
            className={shaking ? 'login-form-wrap is-shaking' : 'login-form-wrap'}
            onAnimationEnd={() => setShaking(false)}
          >
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
                <p className="login-help">
                  New here?{' '}
                  <button type="button" className="login-link" onClick={() => switchView('register')}>
                    Create one
                  </button>
                </p>
              </div>
            ) : null}

            {view === 'register' ? (
              <div className="login-view" key="register">
                <button type="button" className="login-link login-back" onClick={() => switchView('signin')}>
                  ← Back to sign in
                </button>
                <h1>Create your account</h1>
                <p className="login-sub">Sign up to start discovering businesses and reviewing leads.</p>

                <form className="login-form" onSubmit={register}>
                  <div className="login-field">
                    <label htmlFor="register-name">Name (optional)</label>
                    <div className="login-input">
                      <Icon name="user" />
                      <input
                        id="register-name"
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        autoComplete="name"
                        maxLength={100}
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="login-field">
                    <label htmlFor="register-email">Email</label>
                    <div className="login-input">
                      <Icon name="mail" />
                      <input
                        id="register-email"
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        maxLength={254}
                        required
                      />
                    </div>
                  </div>

                  <div className="login-field">
                    <label htmlFor="register-password">Password</label>
                    <div className="login-input">
                      <Icon name="lock" />
                      <input
                        id="register-password"
                        className="has-toggle"
                        type={showPassword ? 'text' : 'password'}
                        placeholder={`At least ${PASSWORD_MIN} characters`}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="new-password"
                        minLength={PASSWORD_MIN}
                        maxLength={PASSWORD_MAX}
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

                  <div className="login-field">
                    <label htmlFor="register-confirm">Confirm password</label>
                    <div className="login-input">
                      <Icon name="lock" />
                      <input
                        id="register-confirm"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Type your password again"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        autoComplete="new-password"
                        maxLength={PASSWORD_MAX}
                        required
                      />
                    </div>
                  </div>

                  <button className="login-submit" disabled={busy}>
                    {busy ? (
                      <>
                        <span className="login-spinner" aria-hidden="true" />
                        Creating account…
                      </>
                    ) : (
                      <>
                        Create account <span aria-hidden="true">→</span>
                      </>
                    )}
                  </button>
                </form>

                {msg ? <div className="notice error">{msg}</div> : null}
                <p className="login-help">
                  Already have an account?{' '}
                  <button type="button" className="login-link" onClick={() => switchView('signin')}>
                    Sign in
                  </button>
                </p>
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
      </div>

      <p className="login-footer">© {new Date().getFullYear()} MonCha</p>
    </main>
  );
}
