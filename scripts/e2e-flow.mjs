import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function pickCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  // Node fetch may return array via getSetCookie, or a single string.
  const parts = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return parts.map((c) => c.split(';')[0]).join('; ');
}

async function countQueue(cookie, queue) {
  const res = await fetch(`${BASE}/api/v1/leads?queue=${queue}&pageSize=1`, { headers: { cookie } });
  const body = await res.json();
  if (!res.ok) throw new Error(`leads ${queue}: ${JSON.stringify(body)}`);
  return body.total ?? 0;
}

async function main() {
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'operator@moncha.local' }),
  });
  const loginBody = await loginRes.text();
  if (!loginRes.ok) throw new Error(`login ${loginRes.status}: ${loginBody}`);
  const setCookies = loginRes.headers.getSetCookie?.() || [loginRes.headers.get('set-cookie')].filter(Boolean);
  const cookie = pickCookie(setCookies);
  if (!cookie) throw new Error('no session cookie');

  const discoverRes = await fetch(`${BASE}/api/v1/source-imports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      source: 'google_places',
      country: 'Singapore',
      city: 'Singapore',
      keyword: 'dental clinics',
    }),
  });
  const discoverJson = await discoverRes.json();
  if (!discoverRes.ok) throw new Error(`discover ${discoverRes.status}: ${JSON.stringify(discoverJson)}`);
  const jobId = discoverJson.id;
  console.log('discover_job', jobId, discoverJson.status);

  let result = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${BASE}/api/v1/source-imports/${jobId}`, { headers: { cookie } });
    const body = await poll.json();
    console.log(`[${i}] status=${body.status} error=${body.error || body.lastError || ''}`);
    if (body.status === 'done' || body.status === 'failed') {
      result = body;
      break;
    }
  }
  if (!result || result.status !== 'done') {
    throw new Error(`discovery not done: ${JSON.stringify(result)}`);
  }
  console.log('discovery_result', JSON.stringify(result.result || result));

  let last = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const [qualified, pending, needsReview, hasAssistant, noWebsite] = await Promise.all([
      countQueue(cookie, 'QUALIFIED'),
      countQueue(cookie, 'PENDING_AUDIT'),
      countQueue(cookie, 'NEEDS_REVIEW'),
      countQueue(cookie, 'HAS_ASSISTANT'),
      countQueue(cookie, 'NO_WEBSITE'),
    ]);
    last = { qualified, pending, needsReview, hasAssistant, noWebsite };
    console.log(`[audit ${i}]`, JSON.stringify(last));
    if (pending === 0 && i >= 1) {
      const sample = await (
        await fetch(`${BASE}/api/v1/leads?queue=QUALIFIED&pageSize=5`, { headers: { cookie } })
      ).json();
      writeFileSync(
        'e2e-flow-result.json',
        JSON.stringify({ discovery: result.result || result, queues: last, sampleQualified: sample.items }, null, 2),
      );
      console.log('FLOW_OK', JSON.stringify(last));
      return;
    }
  }
  throw new Error(`audits still pending: ${JSON.stringify(last)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
