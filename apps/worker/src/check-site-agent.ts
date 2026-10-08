/**
 * Checks the website-copy agent configuration without printing secrets:
 *   pnpm --filter @moncha/worker exec tsx src/check-site-agent.ts
 * Reports which keys are set, round-trips one object through R2 and checks the model slug on OpenRouter.
 */
import './env';
import { createR2SiteStoreFromEnv } from '@moncha/integrations';

const KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'SITE_PREVIEW_SECRET',
  'OPENROUTER_API_KEY',
  'SITE_AGENT_MODEL',
] as const;

async function main() {
  const present = Object.fromEntries(KEYS.map((k) => [k, Boolean(process.env[k]?.trim())]));
  console.log('keys set:', present);

  const store = createR2SiteStoreFromEnv();
  if (!store) {
    console.log('r2: not configured');
  } else {
    const key = `sites/_healthcheck/${Date.now()}.txt`;
    const body = new TextEncoder().encode(`moncha r2 check ${new Date().toISOString()}`);
    await store.put(key, body, 'text/plain; charset=utf-8');
    const back = await store.getBytes(key);
    const same = !!back && Buffer.from(back).equals(Buffer.from(body));
    const streamed = await store.get(key);
    let streamedBytes = 0;
    if (streamed) for await (const chunk of streamed.body) streamedBytes += chunk.byteLength;
    console.log('r2:', { put: true, roundTrip: same, streamedBytes, contentType: streamed?.contentType, missingIsNull: (await store.get(`${key}.missing`)) === null });
  }

  const model = process.env.SITE_AGENT_MODEL?.trim() || 'google/gemini-3.5-flash';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const json = (await res.json()) as { data?: Array<{ id: string; architecture?: { input_modalities?: string[] } }> };
    const found = json.data?.find((m) => m.id === model);
    const similar = (json.data ?? []).map((m) => m.id).filter((id) => id.startsWith('google/gemini')).slice(0, 15);
    console.log('model:', { model, available: !!found, inputModalities: found?.architecture?.input_modalities, similar: found ? undefined : similar });
  } catch (error) {
    console.log('model: lookup failed', error instanceof Error ? error.message : error);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
});
