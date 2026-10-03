import { describe, expect, it } from 'vitest';
import type { AuthUserRecord, AuthUserRepo, SessionRepo } from '../ports';
import {
  AuthError,
  bearerToken,
  currentUser,
  hashPassword,
  loginUser,
  logoutUser,
  registerUser,
  SESSION_TTL_MS,
  verifyPassword,
  type AuthDeps,
} from './auth';

function memoryDeps(start = new Date('2026-10-03T00:00:00Z')) {
  let clock = start;
  const users: AuthUserRecord[] = [];
  const sessions: Array<{ tokenHash: string; userId: string; expiresAt: Date; revokedAt: Date | null }> = [];

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
  };
  const deps: AuthDeps = { users: userRepo, sessions: sessionRepo, now: () => clock };
  return { deps, users, sessions, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

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

  it('parses the bearer header', () => {
    expect(bearerToken('Bearer abc.DEF-1')).toBe('abc.DEF-1');
    expect(bearerToken('bearer xyz')).toBe('xyz');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });
});
