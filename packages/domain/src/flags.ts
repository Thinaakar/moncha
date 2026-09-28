/**
 * Product flag (senior review): when true, surfaces only leads without chatbots.
 * false = show all websites / queues (default).
 * true  = omit HAS_ASSISTANT from lists and APIs.
 *
 * Env: OMIT_CHATBOT_SITES or omit_chatbot_sites = true|false
 */
export function omitChatbotSitesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.OMIT_CHATBOT_SITES ?? env.omit_chatbot_sites ?? 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** Queues hidden when omit_chatbot_sites=true. */
export const CHATBOT_QUEUES = ['HAS_ASSISTANT'] as const;
