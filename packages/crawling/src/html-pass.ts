import { createHash } from 'node:crypto';
import type {
  DetectedChannelInput,
  EvidenceItemInput,
  WebsiteAuditResult,
  WebsiteStatus,
} from '@moncha/domain';
import { DEFAULT_AUDIT_CONFIG } from '@moncha/domain';
import { extractChannelsFromHtml } from './channels';
import { extractTitle } from './http-checker';
import { looksLikeEmptySpa, looksParked, matchAssistantSignatures, partitionHits } from './signatures';
import { assertSafeUrl } from './url-safety';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

export type HtmlPassResult = {
  ok: boolean;
  websiteStatus: WebsiteStatus;
  finalUrl?: string;
  httpStatus?: number;
  httpsOk?: boolean;
  title?: string;
  language?: string;
  html?: string;
  contentHash?: string;
  failureReason?: string;
  assistantHits: ReturnType<typeof matchAssistantSignatures>;
  channels: DetectedChannelInput[];
  ambiguous: boolean;
};

async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, MAX_BYTES);
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    received += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // ignore
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
    .subarray(0, MAX_BYTES)
    .toString('utf8');
}

function extractLanguage(html: string): string | undefined {
  const m = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
  return m?.[1]?.slice(0, 16);
}

/**
 * Pass 1: SSRF-safe HTML fetch + signature scan.
 * Never returns verdict NO_ASSISTANT on fetch failure / partial / blocked.
 */
export async function runHtmlPass(url: string): Promise<HtmlPassResult> {
  try {
    let current = await assertSafeUrl(url);
    let hops = 0;
    while (hops <= MAX_REDIRECTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': 'MonChaLeadEngine/1.0 (+website-audit)',
            accept: 'text/html,application/xhtml+xml',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            return {
              ok: false,
              websiteStatus: 'INACCESSIBLE',
              httpStatus: response.status,
              finalUrl: current.toString(),
              failureReason: 'redirect_missing_location',
              assistantHits: [],
              channels: [],
              ambiguous: true,
            };
          }
          if (hops >= MAX_REDIRECTS) {
            return {
              ok: false,
              websiteStatus: 'INACCESSIBLE',
              httpStatus: response.status,
              finalUrl: current.toString(),
              failureReason: 'too_many_redirects',
              assistantHits: [],
              channels: [],
              ambiguous: true,
            };
          }
          current = await assertSafeUrl(new URL(location, current).toString());
          hops += 1;
          continue;
        }

        const html = await readBody(response);
        const title = extractTitle(html);
        const finalUrl = current.toString();
        const httpsOk = current.protocol === 'https:';
        const contentHash = createHash('sha256').update(html).digest('hex');

        if (response.status === 404 || response.status === 410) {
          return {
            ok: false,
            websiteStatus: 'INACTIVE',
            finalUrl,
            httpStatus: response.status,
            httpsOk,
            title,
            failureReason: `http_${response.status}`,
            assistantHits: [],
            channels: [],
            ambiguous: false,
          };
        }

        if (!response.ok) {
          return {
            ok: false,
            websiteStatus: 'INACCESSIBLE',
            finalUrl,
            httpStatus: response.status,
            httpsOk,
            title,
            failureReason: `http_${response.status}`,
            assistantHits: [],
            channels: [],
            ambiguous: true,
          };
        }

        if (looksParked(html, title)) {
          return {
            ok: true,
            websiteStatus: 'PARKED',
            finalUrl,
            httpStatus: response.status,
            httpsOk,
            title,
            language: extractLanguage(html),
            html,
            contentHash,
            assistantHits: [],
            channels: [],
            ambiguous: false,
          };
        }

        const assistantHits = matchAssistantSignatures(html);
        const channels = extractChannelsFromHtml(html, finalUrl);
        const ambiguous = assistantHits.length === 0 && looksLikeEmptySpa(html);

        return {
          ok: true,
          websiteStatus: 'ACTIVE',
          finalUrl,
          httpStatus: response.status,
          httpsOk,
          title,
          language: extractLanguage(html),
          html,
          contentHash,
          assistantHits,
          channels,
          ambiguous,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    return {
      ok: false,
      websiteStatus: 'INACCESSIBLE',
      failureReason: 'too_many_redirects',
      assistantHits: [],
      channels: [],
      ambiguous: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureReason =
      error instanceof Error && (error.name === 'AbortError' || message.toLowerCase().includes('abort'))
        ? 'timeout'
        : message;
    return {
      ok: false,
      websiteStatus: 'INACCESSIBLE',
      failureReason,
      assistantHits: [],
      channels: [],
      ambiguous: true,
    };
  }
}

export function htmlPassToAuditResult(pass: HtmlPassResult): WebsiteAuditResult {
  const auditedAt = new Date();
  const classifierVersion = DEFAULT_AUDIT_CONFIG.classifierVersion;

  if (pass.websiteStatus !== 'ACTIVE') {
    return {
      websiteStatus: pass.websiteStatus,
      finalUrl: pass.finalUrl,
      httpStatus: pass.httpStatus,
      httpsOk: pass.httpsOk,
      title: pass.title,
      language: pass.language,
      verdict: 'NOT_APPLICABLE',
      kind: 'NONE',
      confidence: 1,
      method: 'html',
      renderRan: false,
      llmRan: false,
      evidence: [],
      channels: pass.channels,
      failureReason: pass.failureReason,
      contentHash: pass.contentHash,
      auditedAt,
      classifierVersion,
    };
  }

  const { definite, generic } = partitionHits(pass.assistantHits);
  const hitEvidence: EvidenceItemInput[] = pass.assistantHits.map((hit) => ({
    type: hit.type,
    excerpt: hit.matched,
    vendor: hit.vendor,
    sourcePage: pass.finalUrl,
  }));

  if (definite.length === 0 && generic.length > 0) {
    return {
      websiteStatus: 'ACTIVE',
      finalUrl: pass.finalUrl,
      httpStatus: pass.httpStatus,
      httpsOk: pass.httpsOk,
      title: pass.title,
      language: pass.language,
      verdict: 'UNCERTAIN',
      kind: 'NONE',
      confidence: 0.45,
      method: 'html',
      renderRan: false,
      llmRan: false,
      evidence: hitEvidence,
      channels: pass.channels,
      failureReason: 'generic_pattern_only',
      contentHash: pass.contentHash,
      auditedAt,
      classifierVersion,
    };
  }

  if (definite.length > 0) {
    const top = definite[0]!;
    const evidence = hitEvidence;
    return {
      websiteStatus: 'ACTIVE',
      finalUrl: pass.finalUrl,
      httpStatus: pass.httpStatus,
      httpsOk: pass.httpsOk,
      title: pass.title,
      language: pass.language,
      verdict: 'HAS_ASSISTANT',
      kind: top.kind,
      vendor: top.vendor,
      confidence: 0.95,
      method: 'html',
      renderRan: false,
      llmRan: false,
      evidence,
      channels: pass.channels,
      contentHash: pass.contentHash,
      auditedAt,
      classifierVersion,
    };
  }

  if (pass.ambiguous || !pass.html) {
    return {
      websiteStatus: 'ACTIVE',
      finalUrl: pass.finalUrl,
      httpStatus: pass.httpStatus,
      httpsOk: pass.httpsOk,
      title: pass.title,
      language: pass.language,
      verdict: 'UNCERTAIN',
      kind: 'NONE',
      confidence: 0.4,
      method: 'html',
      renderRan: false,
      llmRan: false,
      evidence: [
        {
          type: 'page_excerpt',
          excerpt: 'Pass 1 ambiguous (SPA shell or incomplete HTML)',
          sourcePage: pass.finalUrl,
        },
      ],
      channels: pass.channels,
      failureReason: 'html_ambiguous',
      contentHash: pass.contentHash,
      auditedAt,
      classifierVersion,
    };
  }

  // Pass-1-only no-assistant is capped at 0.6 (below minConfidence) until Pass 2 confirms.
  return {
    websiteStatus: 'ACTIVE',
    finalUrl: pass.finalUrl,
    httpStatus: pass.httpStatus,
    httpsOk: pass.httpsOk,
    title: pass.title,
    language: pass.language,
    verdict: 'NO_ASSISTANT',
    kind: 'NONE',
    confidence: 0.6,
    method: 'html',
    renderRan: false,
    llmRan: false,
    evidence: [
      {
        type: 'page_excerpt',
        excerpt: 'No known assistant signatures in HTML (awaiting render confirmation)',
        sourcePage: pass.finalUrl,
      },
    ],
    channels: pass.channels,
    contentHash: pass.contentHash,
    auditedAt,
    classifierVersion,
  };
}

