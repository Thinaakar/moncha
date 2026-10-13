import { describe, expect, it } from 'vitest';
import type { AuthUserRecord, AuthUserRepo, PasswordResetEmail, PasswordResetRepo, SessionRepo } from '../ports';
import {
  AuthError,
  bearerToken,
  changePassword,
  currentUser,
  FORGOT_PASSWORD_REPLY,
  hashPassword,
  loginUser,
  logoutUser,
  PASSWORD_RESET_TTL_MS,
  registerUser,
  requestPasswordReset,
  resetPassword,
  SESSION_TTL_MS,
  updateProfile,
  verifyPassword,
  type AuthDeps,
} from './auth';

function memoryDeps(start = new Date('2026-10-03T00:00:00Z')) {
  let clock = start;
  const users: AuthUserRecord[] = [];
  const sessions: Array<{ tokenHash: string; userId: string; expiresAt: Date; revokedAt: Date | null }> = [];
  const resetTokens: Array<{ tokenHash: string; userId: string; tenantId: string; expiresAt: Date; usedAt: Date | null }> = [];
  const sent: PasswordResetEmail[] = [];

  const userRepo: AuthUserRepo = {
    async findByEmail(tenantId, email) {
      return users.find((u) => u.tenantId === tenantId && u.email.toLowerCase() === email.toLowerCase()) ?? null;
    },
    async create(data) {
      if (users.some((u) => u.tenantId === data.tenantId && u.email === data.email)) return null;
      const user = { id: `user_${users.length + 1}`, createdAt: clock, ...data };
      users.push(user);
      return user;
    },
    async updateName(userId, name) {
      const user = users.find((u) => u.id === userId);
      if (!user) return null;
      user.name = name;
      return user;
    },
    async setPasswordHash(userId, passwordHash) {
      const user = users.find((u) => u.id === userId);
      if (user) user.passwordHash = passwordHash;
    },
  };
  const sessionRepo: SessionRepo = {
    async create(data) {
      sessions.push({ tokenHash: data.tokenHash, userId: data.userId, expiresAt: data.expiresAt, revokedAt: null });
      return { id: `sess_${sessions.length}`, expiresAt: data.expiresAt };
    },
    async findActiveUser(tokenHash, now) {
      const s = sessions.find((x) => x.tokenHash === tokenHash && !x.revokedAt && x.expiresAt > now);
      return s ? (users.find((u) => u.id === s.userId) ?? null) : null;
    },
    async revoke(tokenHash, now) {
      const s = sessions.find((x) => x.tokenHash === tokenHash && !x.revokedAt);
      if (!s) return false;
      s.revokedAt = now;
      return true;
    },
    async revokeAllForUser(userId, now, keepTokenHash) {
      const open = sessions.filter((x) => x.userId === userId && !x.revokedAt && x.tokenHash !== keepTokenHash);
      for (const s of open) s.revokedAt = now;
      return open.length;
    },
  };
  const resetRepo: PasswordResetRepo = {
    async create(data) {
      resetTokens.push({ ...data, usedAt: null });
    },
    async consume(tokenHash, now) {
      const t = resetTokens.find((x) => x.tokenHash === tokenHash && !x.usedAt && x.expiresAt > now);
      if (!t) return null;
      t.usedAt = now;
      return { userId: t.userId, tenantId: t.tenantId };
    },
    async invalidateForUser(userId, now) {
      for (const t of resetTokens) if (t.userId === userId && !t.usedAt) t.usedAt = now;
    },
  };
  const mailer = {
    async sendPasswordReset(email: PasswordResetEmail) {
      sent.push(email);
    },
  };
  const deps: AuthDeps = { users: userRepo, sessions: sessionRepo, now: () => clock };
  const resetDeps = { ...deps, resets: resetRepo, mailer };
  return {
    deps,
    resetDeps,
    users,
    sessions,
    resetTokens,
    sent,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}

const RESET_URL = 'https://console.example.com/reset-password';
const tokenFromLink = (link: string) => new URL(link).searchParams.get('token')!;

const TENANT = 'tenant_test';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('wrong horse', stored)).toBe(false);
    expect(await verifyPassword('correct horse', 'garbage')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('auth use cases', () => {
  it('registers an operator, logs in, reads me, and logs out', async () => {
    const { deps, users, sessions } = memoryDeps();
    const reg = await registerUser(deps, { tenantId: TENANT, email: ' Ana@Example.COM ', password: 'pass-1234', name: 'Ana' });
    expect(reg.user).toMatchObject({ email: 'ana@example.com', role: 'operator', name: 'Ana', tenantId: TENANT });
    expect(reg.tokenType).toBe('Bearer');
    expect(users[0]!.passwordHash).not.toContain('pass-1234');
    expect(sessions[0]!.tokenHash).not.toBe(reg.token);

    const login = await loginUser(deps, { tenantId: TENANT, email: 'ANA@example.com', password: 'pass-1234' });
    expect(await currentUser(deps, { token: login.token })).toMatchObject({ email: 'ana@example.com' });

    expect(await logoutUser(deps, { token: login.token })).toEqual({ ok: true });
    await expect(currentUser(deps, { token: login.token })).rejects.toMatchObject({ status: 401 });
    expect(await currentUser(deps, { token: reg.token })).toMatchObject({ email: 'ana@example.com' });
  });

  it('rejects a duplicate email with 409', async () => {
    const { deps } = memoryDeps();
    await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });
    await expect(registerUser(deps, { tenantId: TENANT, email: 'A@B.co', password: 'pass-5678' })).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('gives the same 401 for an unknown email, a wrong password, and a passwordless user', async () => {
    const { deps, users } = memoryDeps();
    await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });
    users.push({ ...users[0]!, id: 'legacy', email: 'old@b.co', passwordHash: null });
    for (const input of [
      { email: 'nobody@b.co', password: 'pass-1234' },
      { email: 'a@b.co', password: 'wrong-pass' },
      { email: 'old@b.co', password: 'anything' },
    ]) {
      const error = await loginUser(deps, { tenantId: TENANT, ...input }).catch((e) => e);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 401, message: 'Invalid email or password' });
    }
  });

  it('expires sessions after the TTL', async () => {
    const { deps, advance } = memoryDeps();
    const { token } = await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });
    advance(SESSION_TTL_MS + 1);
    await expect(currentUser(deps, { token })).rejects.toMatchObject({ status: 401 });
  });

  it('requires a token for me and logout, and logout is idempotent', async () => {
    const { deps } = memoryDeps();
    await expect(currentUser(deps, {})).rejects.toMatchObject({ status: 401 });
    await expect(logoutUser(deps, {})).rejects.toMatchObject({ status: 401 });
    expect(await logoutUser(deps, { token: 'unknown' })).toEqual({ ok: true });
  });

  it('updates the profile name for the logged-in user', async () => {
    const { deps } = memoryDeps();
    const { token } = await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });
    expect(await updateProfile(deps, { token, name: '  Ana Lee ' })).toMatchObject({ name: 'Ana Lee' });
    expect(await currentUser(deps, { token })).toMatchObject({ name: 'Ana Lee' });
    await expect(updateProfile(deps, { name: 'x' })).rejects.toMatchObject({ status: 401 });
  });

  it('changes the password, keeps this session and logs out the others', async () => {
    const { deps } = memoryDeps();
    const reg = await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });
    const other = await loginUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });

    await expect(
      changePassword(deps, { token: reg.token, currentPassword: 'wrong-pass', newPassword: 'new-pass-1' }),
    ).rejects.toMatchObject({ code: 'invalid_password', status: 400 });
    await expect(
      changePassword(deps, { token: reg.token, currentPassword: 'pass-1234', newPassword: 'pass-1234' }),
    ).rejects.toMatchObject({ status: 400 });

    expect(
      await changePassword(deps, { token: reg.token, currentPassword: 'pass-1234', newPassword: 'new-pass-1' }),
    ).toEqual({ ok: true, otherSessionsRevoked: 1 });
    expect(await currentUser(deps, { token: reg.token })).toMatchObject({ email: 'a@b.co' });
    await expect(currentUser(deps, { token: other.token })).rejects.toMatchObject({ status: 401 });
    await expect(loginUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' })).rejects.toMatchObject({
      status: 401,
    });
    await loginUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'new-pass-1' });
  });

  it('gives the same forgot-password reply for unknown emails and sends nothing', async () => {
    const { resetDeps, sent } = memoryDeps();
    expect(
      await requestPasswordReset(resetDeps, { tenantId: TENANT, email: 'nobody@b.co', resetUrl: RESET_URL }),
    ).toEqual(FORGOT_PASSWORD_REPLY);
    expect(sent).toHaveLength(0);
  });

  it('refuses forgot-password when email or the reset URL is not configured', async () => {
    const { resetDeps } = memoryDeps();
    for (const [deps, resetUrl] of [
      [{ ...resetDeps, mailer: undefined }, RESET_URL],
      [resetDeps, undefined],
      [resetDeps, 'not a url'],
    ] as const) {
      await expect(requestPasswordReset(deps, { tenantId: TENANT, email: 'a@b.co', resetUrl })).rejects.toMatchObject({
        code: 'service_unavailable',
        status: 503,
      });
    }
  });

  it('resets the password once from the emailed link and logs out every session', async () => {
    const { deps, resetDeps, sent, resetTokens } = memoryDeps();
    const reg = await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234', name: 'Ana' });

    expect(
      await requestPasswordReset(resetDeps, { tenantId: TENANT, email: 'A@B.co', resetUrl: RESET_URL }),
    ).toEqual(FORGOT_PASSWORD_REPLY);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'a@b.co', name: 'Ana' });
    expect(sent[0]!.resetUrl.startsWith(`${RESET_URL}?token=`)).toBe(true);
    const token = tokenFromLink(sent[0]!.resetUrl);
    expect(resetTokens[0]!.tokenHash).not.toBe(token);

    expect(await resetPassword(resetDeps, { token, password: 'brand-new-1' })).toEqual({ ok: true });
    await expect(currentUser(deps, { token: reg.token })).rejects.toMatchObject({ status: 401 });
    await loginUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'brand-new-1' });
    await expect(resetPassword(resetDeps, { token, password: 'again-123' })).rejects.toMatchObject({
      code: 'invalid_token',
      status: 400,
    });
  });

  it('expires reset links and only the newest link works', async () => {
    const { deps, resetDeps, sent, advance } = memoryDeps();
    await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });
    await requestPasswordReset(resetDeps, { tenantId: TENANT, email: 'a@b.co', resetUrl: RESET_URL });
    await requestPasswordReset(resetDeps, { tenantId: TENANT, email: 'a@b.co', resetUrl: RESET_URL });
    const [first, second] = sent.map((m) => tokenFromLink(m.resetUrl));
    await expect(resetPassword(resetDeps, { token: first!, password: 'brand-new-1' })).rejects.toMatchObject({
      code: 'invalid_token',
    });
    advance(PASSWORD_RESET_TTL_MS + 1);
    await expect(resetPassword(resetDeps, { token: second!, password: 'brand-new-1' })).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('still answers ok when sending the email fails', async () => {
    const { deps, resetDeps } = memoryDeps();
    await registerUser(deps, { tenantId: TENANT, email: 'a@b.co', password: 'pass-1234' });
    const failing = {
      ...resetDeps,
      mailer: {
        async sendPasswordReset() {
          throw new Error('resend 403');
        },
      },
    };
    expect(await requestPasswordReset(failing, { tenantId: TENANT, email: 'a@b.co', resetUrl: RESET_URL })).toEqual(
      FORGOT_PASSWORD_REPLY,
    );
  });

  it('parses the bearer header', () => {
    expect(bearerToken('Bearer abc.DEF-1')).toBe('abc.DEF-1');
    expect(bearerToken('bearer xyz')).toBe('xyz');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });
});
