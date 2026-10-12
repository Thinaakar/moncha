export type ApiErrorDetails = {
  fieldErrors?: Record<string, string[] | undefined>;
  formErrors?: string[];
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parse(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { code: 'bad_response', message: text.slice(0, 200) } };
  }
}

/** First field error, else the envelope message. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) {
    const field = Object.entries(error.details?.fieldErrors ?? {}).find(([, v]) => v?.length);
    if (field) return `${field[0]}: ${field[1]![0]}`;
    return error.message || fallback;
  }
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

/** Same-origin request to a Next route; the session cookie rides along. */
export async function request<T>(
  url: string,
  init: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(withQuery(url, init.query), {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = (await parse(res)) as { error?: { code?: string; message?: string; details?: ApiErrorDetails } } | null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/auth/')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}&expired=1`);
    }
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'http_error',
      data?.error?.message ?? `Request failed (${res.status})`,
      data?.error?.details,
    );
  }
  return data as T;
}

/** Backend `/api/v1/<path>` through the console's server proxy. */
export function api<T>(path: string, init?: Parameters<typeof request>[1]) {
  return request<T>(`/api/proxy/${path.replace(/^\/+/, '')}`, init);
}

/**
 * Downloads a backend file (e.g. a CSV export) through the proxy and saves it under the name the
 * backend sends in content-disposition. Errors come back as the usual ApiError.
 */
export async function downloadFile(path: string, init: { query?: Query; fallbackName: string }) {
  const res = await fetch(withQuery(`/api/proxy/${path.replace(/^\/+/, '')}`, init.query), {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const data = (await parse(res)) as { error?: { code?: string; message?: string } } | null;
    if (res.status === 401) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}&expired=1`);
    }
    throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? init.fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return name;
}
