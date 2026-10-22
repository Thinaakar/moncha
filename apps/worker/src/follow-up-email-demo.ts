/**
 * One-shot demo: send a demo follow-up reminder email to developers' accounts
 * (Vino and Thinaakar).
 *
 *   pnpm --filter @moncha/worker follow-up-email:demo
 *
 * Uses the rich MonCha follow-up template with:
 * - Brand header (#2563eb + MonCha logo)
 * - Heading: "Have you had a chance to explore your AI assistant?"
 * - Benefits checklist (Accurate answers, Available 24/7, Leads & bookings)
 * - Interactive demo card with "Open demo" button
 * - Verified developer recipients only (vinothjv4.tech@gmail.com, thinaakark2004@gmail.com)
 */
import './env';
import { prisma, PrismaColdEmailRepository } from '@moncha/db';
import {
  coldEmailSendingEnabled,
  createResendMailerFromEnv,
  followUpEmailContent,
  isColdEmailRecipientAllowed,
} from '@moncha/integrations';

const DEVELOPER_INBOXES = [
  'vinothjv4.tech@gmail.com',
  'thinaakark2004@gmail.com',
];

const FALLBACK_DEMO_URL = 'https://carbattery-sg.vinothjv4-tech.workers.dev';
const FALLBACK_COMPANY_NAME = 'Car Battery Roadside Assistance';

async function main() {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim() || 'tenant_moncha_internal';
  const mailer = createResendMailerFromEnv(process.env);
  if (!mailer) throw new Error('RESEND_API_KEY is not set');

  if (!coldEmailSendingEnabled(process.env)) {
    throw new Error('Set COLD_EMAIL_SENDING_ENABLED=true to send demo emails');
  }

  // Find a real deployed lead demo if available
  const candidate = await prisma.lead.findFirst({
    where: {
      tenantId,
      siteSnapshots: {
        some: {
          workerStatus: 'deployed',
          workerUrl: { not: null },
        },
      },
    },
    include: {
      company: { select: { name: true, domain: true, email: true } },
      siteSnapshots: {
        where: {
          workerStatus: 'deployed',
          workerUrl: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { workerUrl: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const companyName = candidate?.company?.name?.trim() || FALLBACK_COMPANY_NAME;
  const demoUrl = candidate?.siteSnapshots[0]?.workerUrl?.trim() || FALLBACK_DEMO_URL;

  console.log('Preparing MonCha follow-up reminder email...');
  console.log(`- Company Name: ${companyName}`);
  console.log(`- Demo URL: ${demoUrl}`);
  console.log(`- Lead ID: ${candidate?.id ?? 'N/A (fallback)'}`);

  const content = followUpEmailContent({
    companyName,
    demoUrl,
    logoUrl: 'https://moncha-console.vinothjv4-tech.workers.dev/brand/mark-email.png',
  });

  console.log(`- Subject: ${content.subject}`);

  const coldEmailRepo = new PrismaColdEmailRepository(prisma);

  // Check if there is an existing cold email record we can tie the follow-up to
  const existingColdEmail = candidate
    ? await prisma.coldEmail.findFirst({
        where: { tenantId, leadId: candidate.id, status: 'sent' },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  const results: Array<{ recipient: string; resendId: string }> = [];

  for (const recipient of DEVELOPER_INBOXES) {
    if (!isColdEmailRecipientAllowed(recipient, process.env)) {
      console.warn(`[Skip] ${recipient} is not in COLD_EMAIL_ALLOWLIST`);
      continue;
    }

    console.log(`Sending demo follow-up email to developer: ${recipient}...`);

    const result = await mailer.sendColdEmail(
      {
        to: [recipient],
        companyName,
        demoUrl,
        subject: content.subject,
        text: content.text,
        html: content.html,
      },
      process.env as Record<string, unknown>,
    );

    console.log(`✓ Sent to ${recipient} (Resend ID: ${result.id})`);
    results.push({ recipient, resendId: result.id });
  }

  if (existingColdEmail && results.length > 0) {
    const firstResendId = results[0]?.resendId ?? null;
    await coldEmailRepo.update(tenantId, existingColdEmail.id, {
      followUpStatus: 'sent',
      followUpSentAt: new Date(),
      followUpResendId: firstResendId,
      followUpError: null,
    });
    console.log(`✓ Linked follow-up status to ColdEmail record ${existingColdEmail.id}`);
  }

  console.log('\n--- Demo Follow-Up Summary ---');
  console.log(JSON.stringify({ success: true, results, companyName, demoUrl, subject: content.subject }, null, 2));
}

main()
  .catch((err) => {
    console.error('Failed to trigger demo follow-up email:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
