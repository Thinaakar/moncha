import type { AuthUserRecord, AuthUserRepo, SessionRepo, UserRole } from '../ports';

export type AuthErrorCode = 'validation_error' | 'unauthorized' | 'conflict';

const STATUS_BY_CODE: Record<AuthErrorCode, number> = { validation_error: 400, unauthorized: 401, conflict: 409 };

/** Carries an HTTP-style code/status so API routes can map it without knowing the use case. */
export class AuthError extends Error {
  readonly status: number;
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
    this.status = STATUS_BY_CODE[code];
  }
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Cloudflare Workers' WebCrypto rejects PBKDF2 above 100k iterations. */
const PBKDF2_ITERATIONS = 100_000;
const HASH_PREFIX = 'pbkdf2_sha256';

export type AuthDeps = {
  users: AuthUserRepo;
  sessions: SessionRepo;
  now?: () => Date;
};

export type PublicUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: string;
};

export type AuthSession = {
  token: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: PublicUser;
};

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Format: pbkdf2_sha256$<iterations>$<salt>$<hash>, salt and hash base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, iterationsText, saltText, hashText] = stored.split('$');
  const iterations = Number(iterationsText);
  if (prefix !== HASH_PREFIX || !Number.isInteger(iterations) || iterations < 1 || !saltText || !hashText) {
    return false;
  }
  const actual = await pbkdf2(password, fromBase64Url(saltText), iterations);
  return timingSafeEqual(actual, fromBase64Url(hashText));
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads `Authorization: Bearer <token>`; undefined when absent or malformed. */
export function bearerToken(header: string | null | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1];
}

export function toPublicUser(user: AuthUserRecord): PublicUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

async function startSession(deps: AuthDeps, user: AuthUserRecord): Promise<AuthSession> {
  const now = deps.now?.() ?? new Date();
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const session = await deps.sessions.create({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: await hashSessionToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return { token, tokenType: 'Bearer', expiresAt: session.expiresAt.toISOString(), user: toPublicUser(user) };
}

/** Self-registration always creates an operator; admins are promoted in the database. */
export async function registerUser(
  deps: AuthDeps,
  input: { tenantId: string; email: string; password: string; name?: string },
): Promise<AuthSession> {
  const email = input.email.trim().toLowerCase();
  if (await deps.users.findByEmail(input.tenantId, email)) {
    throw new AuthError('conflict', 'An account with this email already exists');
  }
  const user = await deps.users.create({
    tenantId: input.tenantId,
    email,
    name: input.name?.trim() || null,
    role: 'operator',
    passwordHash: await hashPassword(input.password),
  });
  if (!user) throw new AuthError('conflict', 'An account with this email already exists');
  return startSession(deps, user);
}

const INVALID_LOGIN = 'Invalid email or password';

export async function loginUser(
  deps: AuthDeps,
  input: { tenantId: string; email: string; password: string },
): Promise<AuthSession> {
  const user = await deps.users.findByEmail(input.tenantId, input.email.trim().toLowerCase());
  if (!user?.passwordHash) {
    // Same work as a real check so response time does not reveal which emails exist.
    await hashPassword(input.password);
    throw new AuthError('unauthorized', INVALID_LOGIN);
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new AuthError('unauthorized', INVALID_LOGIN);
  }
  return startSession(deps, user);
}

/** Idempotent: an unknown, expired or already revoked token still returns ok. */
export async function logoutUser(deps: AuthDeps, input: { token?: string }): Promise<{ ok: true }> {
  if (!input.token) throw new AuthError('unauthorized', 'Missing Authorization: Bearer <token> header');
  await deps.sessions.revoke(await hashSessionToken(input.token), deps.now?.() ?? new Date());
  return { ok: true };
}

export async function currentUser(deps: AuthDeps, input: { token?: string }): Promise<PublicUser> {
  if (!input.token) throw new AuthError('unauthorized', 'Missing Authorization: Bearer <token> header');
  const user = await deps.sessions.findActiveUser(await hashSessionToken(input.token), deps.now?.() ?? new Date());
  if (!user) throw new AuthError('unauthorized', 'Session expired or logged out');
  return toPublicUser(user);
}
