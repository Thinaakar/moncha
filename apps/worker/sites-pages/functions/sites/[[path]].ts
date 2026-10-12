import { PUBLIC_SITE_ENTRY, parsePublicSitePath } from '../../../../../packages/domain/src/site/public-site';

interface Env {
  /** The private bucket the worker writes copies to (`sites/{tenantId}/{copyId}/...`). */
  SITES: R2Bucket;
  TENANT_ID: string;
}

/** Served as text so the original page's scripts never run on this origin, like the console preview. */
const PLAIN_TEXT_FILES = new Set(['source.html', 'rendered.html']);

const BASE_HEADERS: Record<string, string> = {
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...BASE_HEADERS, allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);
  const parsed = parsePublicSitePath(url.pathname.replace(/^\/sites\//, ''));
  if (!parsed) return notFound();
  if (!parsed.file) {
    const root = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return Response.redirect(`${url.origin}${root}${PUBLIC_SITE_ENTRY}`, 302);
  }

  const object = await env.SITES.get(`sites/${env.TENANT_ID}/${parsed.copyId}/${parsed.file}`, { onlyIf: request.headers });
  if (!object) return notFound();

  const headers = new Headers(BASE_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=3600');
  if (PLAIN_TEXT_FILES.has(parsed.file)) {
    const charset = /charset=([^;]+)/i.exec(headers.get('content-type') ?? '')?.[1]?.trim() || 'utf-8';
    headers.set('content-type', `text/plain; charset=${charset}`);
  }
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
};
