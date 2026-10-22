/**
 * One-shot demo: send a single cold email to the allowlisted address only.
 *
 *   pnpm --filter @moncha/worker cold-email:demo
 *
 * Requires RESEND_API_KEY, COLD_EMAIL_SENDING_ENABLED=true, and
 * COLD_EMAIL_ALLOWLIST including the demo inbox. Never sends to company emails.
 */
import './env';
import { prisma, PrismaColdEmailRepository } from '@moncha/db';
import { sendColdEmailNow } from '@moncha/domain';
import {
  coldEmailContent,
  coldEmailSendingEnabled,
  createResendMailerFromEnv,
  isColdEmailRecipientAllowed,
  parseColdEmailAllowlist,
} from '@moncha/integrations';

const DEMO_TO = 'vinothjv4.tech@gmail.com';
const DEMO_FALLBACK_URL = 'https://moncha.co/docs/quickstart/';

async function main() {
  const deliverTo = (process.env.COLD_EMAIL_DEMO_TO || DEMO_TO).trim().toLowerCase();
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) throw new Error('DEFAULT_TENANT_ID is required');

  const mailer = createResendMailerFromEnv(process.env);
  if (!mailer) throw new Error('RESEND_API_KEY is not set');

  if (!coldEmailSendingEnabled(process.env)) {
    throw new Error('Set COLD_EMAIL_SENDING_ENABLED=true to send the demo');
  }
  if (!isColdEmailRecipientAllowed(deliverTo, process.env)) {
    throw new Error(`Add ${deliverTo} to COLD_EMAIL_ALLOWLIST (or set allowlist to that address only)`);
  }

  // Prefer a fully finished demo: live Worker URL + chatbot embed installed + bot trained.
  const candidate = await prisma.lead.findFirst({
    where: {
      tenantId,
      bot: { status: 'created', knowledgeStatus: 'trained' },
      siteSnapshots: {
        some: {
          workerStatus: 'deployed',
          workerUrl: { not: null },
          chatbotStatus: 'installed',
        },
      },
    },
    include: {
      company: { select: { name: true, email: true, domain: true } },
      bot: { select: { knowledgeStatus: true } },
      siteSnapshots: {
        where: {
          workerStatus: 'deployed',
          workerUrl: { not: null },
          chatbotStatus: 'installed',
        },
        orderBy: { chatbotInstalledAt: 'desc' },
        take: 1,
        select: { workerUrl: true, chatbotStatus: true, chatbotInstalledAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!candidate?.siteSnapshots[0]?.workerUrl) {
    throw new Error('No finished demo found (need trained bot + installed chatbot + live Worker URL)');
  }

  const companyName = candidate.company.name;
  const demoUrl = candidate.siteSnapshots[0].workerUrl;
  const intended = candidate.company.email?.trim().toLowerCase() || deliverTo;

  console.log(
    JSON.stringify(
      {
        deliverTo,
        intendedCompanyEmail: intended === deliverTo ? null : intended,
        companyName,
        demoUrl,
        leadId: candidate.id,
        chatbotStatus: candidate.siteSnapshots[0].chatbotStatus,
        knowledgeStatus: candidate.bot?.knowledgeStatus ?? null,
      },
      null,
      2,
    ),
  );

  const deps = {
    coldEmails: new PrismaColdEmailRepository(prisma),
    mailer,
    env: process.env as Record<string, unknown>,
    isAllowed: isColdEmailRecipientAllowed,
    sendingEnabled: coldEmailSendingEnabled,
    parseAllowlist: parseColdEmailAllowlist,
    buildContent: coldEmailContent,
  };

  const row = await sendColdEmailNow(deps, {
    tenantId,
    leadId: candidate?.id ?? null,
    companyName,
    toEmail: intended,
    deliverTo,
    demoUrl,
    origin: 'test',
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: row.id,
        status: row.status,
        resendId: row.resendId,
        deliveredTo: row.deliveredTo,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
