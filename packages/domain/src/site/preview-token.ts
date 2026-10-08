export type PreviewTokenClaims = { snapshotId: string; tenantId: string; exp: number };

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `base64url(snapshotId.tenantId.exp).base64url(hmacSha256)`; `exp` is unix seconds. */
export async function signPreviewToken(
  claims: { snapshotId: string; tenantId: string },
  secret: string,
  ttlSec: number,
  now = Date.now(),
): Promise<string> {
  const exp = Math.floor(now / 1000) + ttlSec;
  const payload = toBase64Url(encoder.encode(`${claims.snapshotId}.${claims.tenantId}.${exp}`));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${toBase64Url(mac)}`;
}

/** Verifies the signature (constant time, via WebCrypto) and the expiry. */
export async function verifyPreviewToken(token: string, secret: string, now = Date.now()): Promise<PreviewTokenClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, macText] = parts as [string, string];
  const mac = fromBase64Url(macText);
  const payloadBytes = fromBase64Url(payload);
  if (!mac || mac.byteLength !== 32 || !payloadBytes) return null;
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), mac, encoder.encode(payload));
  if (!valid) return null;

  const fields = new TextDecoder().decode(payloadBytes).split('.');
  if (fields.length !== 3) return null;
  const [snapshotId, tenantId, expRaw] = fields as [string, string, string];
  const exp = Number(expRaw);
  if (!snapshotId || !tenantId || !Number.isInteger(exp)) return null;
  if (exp * 1000 <= now) return null;
  return { snapshotId, tenantId, exp };
}

/**
 * Validates a file path requested under a snapshot root. Returns the normalized relative path or
 * null for anything that could escape the root.
 */
export function normalizeSiteFilePath(raw: string): string | null {
  let decoded = raw;
  for (let i = 0; i < 3; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (!decoded || decoded.length > 512) return null;
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.startsWith('/')) return null;
  const segments = decoded.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) return null;
  return segments.join('/');
}
