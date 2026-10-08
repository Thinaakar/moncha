import { siteBrandSchema } from '@moncha/contracts';
import {
  BrandExtractionError,
  type BrandExtractionInput,
  type BrandExtractionResult,
  type BrandExtractor,
  type SiteBrand,
  type SiteEvidence,
} from '@moncha/domain';
import type { JsonImageInput, MultimodalJsonClient } from './openrouter';

export const DEFAULT_SITE_AGENT_MODEL = 'google/gemini-3.5-flash';

const SYSTEM_PROMPT = `You extract brand details for a small business from evidence of its homepage.
You NEVER write or modify HTML. You only return one JSON object.

Rules:
- Use only facts present in the evidence or visible in the screenshots. Do not invent phone numbers, emails, addresses, social links or opening hours. Use null or [] when unknown.
- logo.assetId must be one of the provided logo candidate assetIds, or null.
- Colors are lowercase 6-digit hex (#rrggbb). primary is the main brand/call-to-action color, not white, black or grey unless the brand is monochrome.
- fonts are family names as used on the site.
- language is a BCP 47 tag of the page content (e.g. "en", "ms", "id", "th", "zh-Hans").
- tone is a short description of the writing style (e.g. "warm and professional").
- chatbot.greeting is a short, friendly first message a website assistant for this business would send, in the page language.
- chatbot.faqs: up to 6 question/answer pairs a visitor would ask, answered ONLY from facts in the evidence. Skip a FAQ rather than guess.
- services: up to 12 short service or product names offered.
- hours: [{days, opens, closes}] in 24h "HH:MM" when explicitly stated; otherwise hoursText or null.
- confidence: 0..1 for how complete and reliable the extraction is.

JSON shape:
{"businessName": string|null, "logo": {"assetId": string}|null,
 "colors": {"primary","secondary","accent","background","text"},
 "fonts": {"heading","body"},
 "contact": {"phones": string[], "emails": string[], "address": string|null, "whatsapp": string|null},
 "services": string[], "hours": [{"days","opens","closes"}], "hoursText": string|null,
 "socialLinks": [{"platform","url"}], "language": string|null, "tone": string|null,
 "chatbot": {"greeting": string, "faqs": [{"question","answer"}]},
 "confidence": number, "notes": string|null}`;

const MAX_JSON_LD_CHARS = 8_000;

function evidencePayload(input: BrandExtractionInput): string {
  const e = input.evidence;
  let jsonLd = JSON.stringify(e.jsonLd);
  if (jsonLd.length > MAX_JSON_LD_CHARS) jsonLd = `${jsonLd.slice(0, MAX_JSON_LD_CHARS)}…`;
  return JSON.stringify(
    {
      company: input.company,
      page: { title: e.title, description: e.description, lang: e.lang, meta: e.meta },
      jsonLd,
      links: e.links,
      colorCandidates: e.colors.slice(0, 20),
      fontCandidates: e.fonts,
      logoCandidates: e.logoCandidates
        .filter((c) => c.assetId)
        .map((c) => ({ assetId: c.assetId, url: c.url, alt: c.alt, width: c.width, height: c.height, inHeader: c.inHeader, source: c.source })),
      visibleText: e.visibleText,
    },
    null,
    0,
  );
}

const digits = (s: string) => s.replace(/\D/g, '');

function normalizeSocial(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.|m\.)/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/**
 * Drops anything the model could have made up: phones, emails, WhatsApp, social links and the logo
 * must be traceable to the evidence or to the lead record.
 */
export function groundBrand(
  brand: SiteBrand,
  evidence: SiteEvidence,
  company: BrandExtractionInput['company'],
): { brand: SiteBrand; warnings: string[] } {
  const warnings: string[] = [];
  const corpus = [
    evidence.visibleText,
    JSON.stringify(evidence.jsonLd),
    JSON.stringify(evidence.meta),
    evidence.links.tel.join(' '),
    evidence.links.mailto.join(' '),
    evidence.links.whatsapp.join(' '),
    company.phone ?? '',
    company.address ?? '',
  ].join('\n');
  const corpusLower = corpus.toLowerCase();
  const corpusDigits = digits(corpus);

  const phones = brand.contact.phones.filter((p) => {
    const d = digits(p);
    return d.length >= 6 && corpusDigits.includes(d.length > 9 ? d.slice(-9) : d);
  });
  if (phones.length < brand.contact.phones.length) warnings.push(`brand_dropped_phones:${brand.contact.phones.length - phones.length}`);

  const emails = brand.contact.emails.filter((m) => corpusLower.includes(m.toLowerCase().replace(/^mailto:/, '')));
  if (emails.length < brand.contact.emails.length) warnings.push(`brand_dropped_emails:${brand.contact.emails.length - emails.length}`);

  let whatsapp = brand.contact.whatsapp;
  if (whatsapp) {
    const d = digits(whatsapp);
    const known = evidence.links.whatsapp.some((w) => w === whatsapp || (d.length >= 6 && digits(w).includes(d.slice(-9))));
    if (!known) {
      warnings.push('brand_dropped_whatsapp');
      whatsapp = null;
    }
  }

  const socialKnown = new Set([...evidence.links.social, ...extractUrls(JSON.stringify(evidence.jsonLd))].map(normalizeSocial));
  const socialLinks = brand.socialLinks.filter((s) => socialKnown.has(normalizeSocial(s.url)));
  if (socialLinks.length < brand.socialLinks.length) warnings.push(`brand_dropped_social:${brand.socialLinks.length - socialLinks.length}`);

  let logo = brand.logo;
  if (logo && !evidence.logoCandidates.some((c) => c.assetId === logo!.assetId)) {
    warnings.push('brand_dropped_logo');
    logo = null;
  }

  return {
    brand: { ...brand, logo, socialLinks, contact: { ...brand.contact, phones, emails, whatsapp } },
    warnings,
  };
}

function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s"'\\]+/g) ?? [];
}

export type GeminiBrandExtractorOptions = {
  client: MultimodalJsonClient;
  model?: string;
  timeoutMs?: number;
};

export class GeminiBrandExtractor implements BrandExtractor {
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GeminiBrandExtractorOptions) {
    this.model = options.model || DEFAULT_SITE_AGENT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async extract(input: BrandExtractionInput): Promise<BrandExtractionResult> {
    const usage = { promptTokens: 0, completionTokens: 0 };
    let model = this.model;
    const images: JsonImageInput[] = [];
    if (input.screenshots.desktopViewport) images.push({ mimeType: 'image/jpeg', bytes: input.screenshots.desktopViewport });
    if (input.screenshots.mobileViewport) images.push({ mimeType: 'image/jpeg', bytes: input.screenshots.mobileViewport });

    const call = async (text: string, withImages: boolean): Promise<unknown> => {
      if (input.budget && !(await input.budget.allow())) {
        throw new BrandExtractionError('budget_exhausted', 'llm_budget_exhausted', usage);
      }
      let failed = true;
      try {
        const res = await this.options.client.completeJsonWithImages({
          model: this.model,
          timeoutMs: this.timeoutMs,
          system: SYSTEM_PROMPT,
          text,
          images: withImages ? images : [],
          maxTokens: 3_000,
          parse: (raw) => raw,
        });
        usage.promptTokens += res.usage.promptTokens;
        usage.completionTokens += res.usage.completionTokens;
        model = res.model;
        failed = false;
        return res.data;
      } catch (error) {
        if (error instanceof Error && error.message === 'openrouter_invalid_json') return undefined;
        throw new BrandExtractionError('llm_failed', error instanceof Error ? error.message.slice(0, 200) : String(error), usage);
      } finally {
        await input.budget?.record(failed);
      }
    };

    const evidenceText = `Evidence (JSON):\n${evidencePayload(input)}\n\nScreenshots attached: desktop and mobile first viewport.`;
    let raw = await call(evidenceText, true);
    let parsed = siteBrandSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = raw === undefined ? 'The reply was not valid JSON.' : JSON.stringify(parsed.error.issues.slice(0, 10));
      const repair = `${evidenceText}\n\nYour previous reply did not match the required JSON shape.\nProblems: ${issues}\nPrevious reply: ${JSON.stringify(raw ?? null).slice(0, 4_000)}\nReturn the corrected JSON object only.`;
      raw = await call(repair, false);
      parsed = siteBrandSchema.safeParse(raw);
      if (!parsed.success) throw new BrandExtractionError('invalid_output', 'brand_schema_invalid', usage);
    }

    const grounded = groundBrand({ ...parsed.data, source: 'llm' }, input.evidence, input.company);
    return { brand: grounded.brand, model, usage, warnings: grounded.warnings };
  }
}
