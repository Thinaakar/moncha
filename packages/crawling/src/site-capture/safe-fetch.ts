import { waitForHostSlot } from '../host-rate';
import { assertSafeUrl } from '../url-safety';

export const SITE_USER_AGENT = 'MonChaLeadEngine/1.0 (+site-snapshot)';

export type SafeFetchErrorCode = 'blocked_host' | 'too_many_redirects' | 'too_large' | 'timeout' | 'fetch_error';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message?: string,
    readonly status?: number,
  ) {
    super(message ?? code);
    this.name = 'SafeFetchError';
  }
}

export type SafeFetchResult = {
  url: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
  redirects: string[];
};

export type SafeFetchOptions = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  minHostIntervalMs?: number;
  accept?: string;
  signal?: AbortSignal;
};

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFetchError('too_large', `content-length ${declared}`);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SafeFetchError('too_large', `over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * GET with manual redirects: every hop is re-checked against private/blocked hosts and the
 * per-host rate limit. The body is returned exactly as received (after transfer decompression).
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  const redirects: string[] = [];
  let current = rawUrl;

  for (let hop = 0; ; hop += 1) {
    let url: URL;
    try {
      url = await assertSafeUrl(current);
    } catch (error) {
      throw new SafeFetchError('blocked_host', error instanceof Error ? error.message : 'blocked_host');
    }
    await waitForHostSlot(url.hostname, options.minHostIntervalMs ?? 1_000);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': SITE_USER_AGENT,
          accept: options.accept ?? '*/*',
          'accept-language': 'en;q=0.9,*;q=0.5',
        },
      });

      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        await response.body?.cancel().catch(() => undefined);
        if (hop >= maxRedirects) throw new SafeFetchError('too_many_redirects');
        redirects.push(url.toString());
        current = new URL(response.headers.get('location')!, url).toString();
        continue;
      }

      const bytes = await readCapped(response, options.maxBytes);
      return {
        url: url.toString(),
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes,
        redirects,
      };
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      if (controller.signal.aborted) throw new SafeFetchError('timeout');
      throw new SafeFetchError('fetch_error', error instanceof Error ? error.message.slice(0, 160) : String(error));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
