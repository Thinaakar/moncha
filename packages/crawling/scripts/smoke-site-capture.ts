/**
 * Captures one or more sites into a local folder (no R2, no LLM):
 *   pnpm --filter @moncha/crawling exec tsx scripts/smoke-site-capture.ts https://example.com [more urls]
 * Output: .site-smoke/{host}/ with the same layout as the R2 snapshot prefix.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { injectDemo, WIDGET_FILE, type SiteBrand } from '@moncha/domain';
import { closeRenderBrowser } from '../src/render-pass.ts';
import { MONCHA_WIDGET_JS, MonchaSiteCapturer } from '../src/site-capture/index.ts';

const OUT_ROOT = path.resolve(process.cwd(), '.site-smoke');

function placeholderBrand(title: string | null): SiteBrand {
  return {
    businessName: title,
    logo: null,
    colors: { primary: null, secondary: null, accent: null, background: null, text: null },
    fonts: { heading: null, body: null },
    contact: { phones: [], emails: [], address: null, whatsapp: null },
    services: [],
    hours: [],
    hoursText: null,
    socialLinks: [],
    language: null,
    tone: null,
    chatbot: { greeting: `Hi! Welcome to ${title ?? 'our site'}. How can we help?`, faqs: [] },
    confidence: 0,
    notes: 'smoke test placeholder',
    source: 'evidence',
  };
}

async function captureOne(url: string) {
  const started = Date.now();
  const capturer = new MonchaSiteCapturer();
  const result = await capturer.capture({ url, signal: AbortSignal.timeout(240_000) });
  const dir = path.join(OUT_ROOT, new URL(result.finalUrl).hostname);
  await rm(dir, { recursive: true, force: true });

  const write = async (rel: string, bytes: Uint8Array | string) => {
    const file = path.join(dir, ...rel.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };

  const primary = result.evidence.colors.find((c) => c.usage === 'button-background')?.value ?? null;
  const brand = placeholderBrand(result.evidence.title);
  brand.colors.primary = primary;
  const demo = injectDemo(result.indexHtml, {
    businessName: brand.businessName,
    greeting: brand.chatbot.greeting,
    faqs: [],
    colors: { primary, background: null, text: null },
    phone: result.evidence.links.tel[0] ?? null,
    email: result.evidence.links.mailto[0] ?? null,
    whatsapp: null,
    language: result.evidence.lang,
    logoPath: null,
  });

  await write('source.html', result.source.bytes);
  await write('rendered.html', result.renderedHtml);
  await write('index.html', result.indexHtml);
  await write('demo.html', demo.bytes);
  await write(WIDGET_FILE, MONCHA_WIDGET_JS);
  await write('manifest.json', JSON.stringify({ snapshotId: 'smoke', ...result.manifest }, null, 2));
  await write('evidence.json', JSON.stringify(result.evidence, null, 2));
  if (result.screenshots.desktop) await write('screenshot-desktop.png', result.screenshots.desktop);
  if (result.screenshots.mobile) await write('screenshot-mobile.png', result.screenshots.mobile);
  for (const file of result.files) await write(file.path, file.bytes);

  const skippedByReason: Record<string, number> = {};
  for (const s of result.manifest.skipped) skippedByReason[s.reason] = (skippedByReason[s.reason] ?? 0) + 1;
  console.log(
    JSON.stringify(
      {
        url,
        finalUrl: result.finalUrl,
        status: result.httpStatus,
        charset: `${result.source.charset} (${result.source.charsetSource})`,
        sourceBytes: result.source.bytes.byteLength,
        assets: result.manifest.assets.length,
        totalAssetBytes: result.manifest.assets.reduce((n, a) => n + a.bytes, 0),
        skipped: skippedByReason,
        rewrites: result.manifest.rewrites,
        warnings: result.warnings,
        logoCandidates: result.evidence.logoCandidates.length,
        screenshots: { desktop: !!result.screenshots.desktop, mobile: !!result.screenshots.mobile },
        seconds: Math.round((Date.now() - started) / 1000),
        out: dir,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) throw new Error('usage: smoke-site-capture.ts <url> [url...]');
  for (const url of urls) {
    try {
      await captureOne(url);
    } catch (error) {
      console.error(url, error instanceof Error ? `${error.name}: ${error.message}` : error);
    }
  }
  await closeRenderBrowser();
}

main().catch(async (error) => {
  console.error(error);
  await closeRenderBrowser();
  process.exit(1);
});
