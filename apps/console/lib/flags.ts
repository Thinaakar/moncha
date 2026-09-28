import { omitChatbotSitesEnabled } from '@moncha/domain';

/** Server-side read of OMIT_CHATBOT_SITES / omit_chatbot_sites. */
export function omitChatbotSites(): boolean {
  return omitChatbotSitesEnabled(process.env);
}
