import type { AssistantKind } from '@moncha/domain';

export type VendorSignature = {
  vendor: string;
  kind: AssistantKind;
  /** Case-insensitive substrings matched against HTML / script src / iframe src / network URLs. */
  patterns: string[];
  /** When true, a hit alone is not enough for HAS_ASSISTANT (→ UNCERTAIN). */
  generic?: boolean;
  /** Window global names to probe after render. */
  globals?: string[];
  /** CSS selectors that indicate a chat widget shell. */
  selectors?: string[];
};

/**
 * Known conversational assistant / live-chat vendors (assistants-v2).
 * Messaging-app links and buttons (WhatsApp, Facebook Messenger, Telegram, LINE, Viber)
 * are contact channels, never assistants — see channels.ts.
 */
export const ASSISTANT_SIGNATURES: VendorSignature[] = [
  {
    vendor: 'Intercom',
    kind: 'AI_CHATBOT',
    patterns: ['widget.intercom.io', 'intercomcdn.com', 'Intercom('],
    globals: ['Intercom', 'intercomSettings'],
    selectors: ['#intercom-frame', '.intercom-lightweight-app', '#intercom-container'],
  },
  {
    vendor: 'Drift',
    kind: 'AI_CHATBOT',
    patterns: ['js.driftt.com', 'drift.com/include'],
    globals: ['drift', 'driftt'],
    selectors: ['#drift-frame-controller', '.drift-conductor-item'],
  },
  {
    vendor: 'Zendesk',
    kind: 'LIVE_CHAT',
    // Chat/messaging only — plain static.zdassets.com also serves Help Center assets.
    patterns: ['static.zdassets.com/ekr/', 'zopim.com', 'ze-snippet', 'zendesk.com/embeddable', 'messenger-static.zopim'],
    globals: ['zE', 'zESettings'],
    selectors: ['#launcher', 'iframe#webWidget', 'iframe#launcher'],
  },
  {
    vendor: 'Tawk.to',
    kind: 'LIVE_CHAT',
    patterns: ['embed.tawk.to', 'tawk.to/chat'],
    globals: ['Tawk_API', 'Tawk_LoadStart'],
    selectors: ['iframe[src*="tawk.to"]', '.widget-visible'],
  },
  {
    vendor: 'Crisp',
    kind: 'LIVE_CHAT',
    patterns: ['client.crisp.chat', 'crisp.chat'],
    globals: ['$crisp', 'CRISP_WEBSITE_ID'],
    selectors: ['#crisp-chatbox', '.crisp-client'],
  },
  {
    vendor: 'HubSpot',
    kind: 'LIVE_CHAT',
    // Conversations only — js.hs-scripts.com / hscollectedforms load for tracking and forms too.
    patterns: ['js.usemessages.com', 'HubSpotConversations', 'hs-messages-iframe'],
    globals: ['HubSpotConversations', 'hsConversationsSettings'],
    selectors: ['#hubspot-messages-iframe-container'],
  },
  {
    vendor: 'LiveChat',
    kind: 'LIVE_CHAT',
    patterns: ['cdn.livechatinc.com', 'livechatinc.com'],
    globals: ['LC_API', '__lc'],
    selectors: ['#chat-widget-container', 'iframe#chat-widget'],
  },
  {
    vendor: 'Freshchat',
    kind: 'LIVE_CHAT',
    patterns: ['wchat.freshchat.com', 'freshchat.com'],
    globals: ['fcWidget'],
    selectors: ['#fc_frame', '.fc-widget-normal'],
  },
  {
    vendor: 'Olark',
    kind: 'LIVE_CHAT',
    patterns: ['static.olark.com'],
    globals: ['olark'],
    selectors: ['#olark-container'],
  },
  {
    vendor: 'Tidio',
    kind: 'LIVE_CHAT',
    patterns: ['code.tidio.co', 'tidiochat.com'],
    globals: ['tidioChatApi'],
    selectors: ['#tidio-chat', 'iframe#tidio-chat-iframe'],
  },
  {
    vendor: 'Chaport',
    kind: 'LIVE_CHAT',
    patterns: ['app.chaport.com'],
    globals: ['chaport'],
    selectors: ['.chaport-container'],
  },
  {
    vendor: 'Gorgias',
    kind: 'LIVE_CHAT',
    patterns: ['config.gorgias.chat', 'gorgias.chat'],
    globals: ['GorgiasChat'],
    selectors: ['#gorgias-chat-container'],
  },
  {
    vendor: 'Ada',
    kind: 'AI_CHATBOT',
    patterns: ['static.ada.support', 'ada-embed'],
    globals: ['adaEmbed', '__ada'],
    selectors: ['#ada-button-frame', '#ada-entry'],
  },
  {
    vendor: 'Forethought',
    kind: 'AI_CHATBOT',
    patterns: ['solve-widget.forethought.ai'],
    globals: ['Forethought'],
  },
  {
    vendor: 'Qualified',
    kind: 'AI_CHATBOT',
    patterns: ['js.qualified.com'],
    globals: ['qualified'],
  },
  {
    vendor: 'Salesforce Messaging',
    kind: 'LIVE_CHAT',
    patterns: ['service.force.com', 'embeddedMessaging'],
    globals: ['embeddedservice_bootstrap'],
  },
  {
    vendor: 'JivoChat',
    kind: 'LIVE_CHAT',
    patterns: ['code.jivosite.com', 'code.jivo.ru'],
    globals: ['jivo_api'],
    selectors: ['jdiv'],
  },
  {
    vendor: 'Smartsupp',
    kind: 'LIVE_CHAT',
    patterns: ['smartsuppchat.com', 'smartsupp-widget'],
    globals: ['smartsupp'],
  },
  {
    vendor: 'Chatra',
    kind: 'LIVE_CHAT',
    patterns: ['call.chatra.io', 'chatra.io/chatra.js'],
    globals: ['Chatra'],
    selectors: ['#chatra'],
  },
  {
    vendor: 'Userlike',
    kind: 'LIVE_CHAT',
    patterns: ['userlike-cdn-widgets', 'userlike-messenger', 'api.userlike.com'],
  },
  {
    vendor: 'LiveAgent',
    kind: 'LIVE_CHAT',
    patterns: ['ladesk.com', 'liveagent.com/scripts'],
    globals: ['LiveAgent'],
  },
  {
    vendor: 'Comm100',
    kind: 'LIVE_CHAT',
    patterns: ['comm100.com', 'comm100.io'],
    globals: ['Comm100API'],
  },
  {
    vendor: 'Help Scout',
    kind: 'LIVE_CHAT',
    patterns: ['beacon-v2.helpscout.net'],
    globals: ['Beacon'],
    selectors: ['#beacon-container'],
  },
  {
    vendor: 'Front',
    kind: 'LIVE_CHAT',
    patterns: ['chat-assets.frontapp.com', 'frontapp.com/chat'],
    globals: ['FrontChat'],
  },
  {
    vendor: 'Re:amaze',
    kind: 'LIVE_CHAT',
    patterns: ['cdn.reamaze.com'],
  },
  {
    vendor: 'Pure Chat',
    kind: 'LIVE_CHAT',
    patterns: ['app.purechat.com', 'purechat.com/visitorwidget'],
  },
  {
    vendor: 'Kayako',
    kind: 'LIVE_CHAT',
    patterns: ['kayako.com/embed', 'kayakocdn.com'],
    globals: ['kayako'],
  },
  {
    vendor: 'Microsoft Dynamics Omnichannel',
    kind: 'LIVE_CHAT',
    patterns: ['oc-cdn-ocprod', 'microsoft_omnichannel_lcwidget', 'livechatwidget/scripts/livechatbootstrapper'],
  },
  {
    vendor: 'Shopify Inbox',
    kind: 'LIVE_CHAT',
    patterns: ['shopifycloud/shopify-chat'],
  },
  {
    vendor: 'Wix Chat',
    kind: 'LIVE_CHAT',
    // Can appear in Wix bundles even when chat is disabled.
    generic: true,
    patterns: ['wix-chat', 'thunderbolt-chat'],
  },
  {
    vendor: 'Squarespace Chat',
    kind: 'LIVE_CHAT',
    generic: true,
    patterns: ['sqs-chat'],
  },
  {
    vendor: 'Pipedrive LeadBooster',
    kind: 'AI_CHATBOT',
    patterns: ['leadbooster-chat.pipedrive.com'],
    globals: ['LeadBooster'],
  },
  {
    vendor: 'Botpress',
    kind: 'AI_CHATBOT',
    patterns: ['cdn.botpress.cloud', 'mediafiles.botpress.cloud', 'botpress.io/webchat'],
    globals: ['botpress', 'botpressWebChat'],
  },
  {
    vendor: 'Landbot',
    kind: 'AI_CHATBOT',
    patterns: ['cdn.landbot.io', 'static.landbot.io', 'landbot.io/landbot'],
    globals: ['Landbot', 'myLandbot'],
  },
  {
    vendor: 'Chatbase',
    kind: 'AI_CHATBOT',
    patterns: ['chatbase.co/embed', 'www.chatbase.co/chatbot-iframe'],
    globals: ['chatbase'],
  },
  {
    vendor: 'Voiceflow',
    kind: 'AI_CHATBOT',
    patterns: ['cdn.voiceflow.com/widget'],
    globals: ['voiceflow'],
  },
  // Generic patterns — alone these yield UNCERTAIN, not HAS_ASSISTANT.
  {
    vendor: 'GenericChat',
    kind: 'LIVE_CHAT',
    generic: true,
    patterns: ['live-chat-widget', 'chat-widget.js', 'data-chat-widget'],
    selectors: ['[data-chat-widget]', '[class*="live-chat-button"]'],
  },
];

export type SignatureHit = {
  vendor: string;
  kind: AssistantKind;
  matched: string;
  type: 'script_src' | 'iframe_src' | 'dom_selector' | 'page_excerpt' | 'network_request' | 'window_global';
  generic?: boolean;
};

export function matchAssistantSignatures(html: string): SignatureHit[] {
  const lower = html.toLowerCase();
  const hits: SignatureHit[] = [];
  for (const sig of ASSISTANT_SIGNATURES) {
    for (const pattern of sig.patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        hits.push({
          vendor: sig.vendor,
          kind: sig.kind,
          matched: pattern,
          type: pattern.includes('<') || pattern.includes('(') ? 'page_excerpt' : 'script_src',
          generic: sig.generic,
        });
        break;
      }
    }
  }
  return hits;
}

/** All window global names we probe after Playwright render. */
export function assistantGlobalNames(): string[] {
  const names = new Set<string>();
  for (const sig of ASSISTANT_SIGNATURES) {
    for (const g of sig.globals ?? []) names.add(g);
  }
  return [...names];
}

export function hitFromGlobal(globalName: string): SignatureHit | null {
  for (const sig of ASSISTANT_SIGNATURES) {
    if (sig.globals?.includes(globalName)) {
      return {
        vendor: sig.vendor,
        kind: sig.kind,
        matched: globalName,
        type: 'window_global',
        generic: sig.generic,
      };
    }
  }
  return null;
}

export function hitFromSelector(selector: string): SignatureHit {
  for (const sig of ASSISTANT_SIGNATURES) {
    if (sig.selectors?.includes(selector)) {
      return {
        vendor: sig.vendor,
        kind: sig.kind,
        matched: selector,
        type: 'dom_selector',
        generic: sig.generic,
      };
    }
  }
  return {
    vendor: 'GenericChat',
    kind: 'LIVE_CHAT',
    matched: selector,
    type: 'dom_selector',
    generic: true,
  };
}

/** Vendor selectors to query in the rendered DOM. */
export function assistantSelectors(): string[] {
  const out: string[] = [];
  for (const sig of ASSISTANT_SIGNATURES) {
    for (const s of sig.selectors ?? []) out.push(s);
  }
  return out;
}

/** Prefer non-generic hits when deciding HAS_ASSISTANT vs UNCERTAIN. */
export function partitionHits(hits: SignatureHit[]): {
  definite: SignatureHit[];
  generic: SignatureHit[];
} {
  const definite: SignatureHit[] = [];
  const generic: SignatureHit[] = [];
  for (const hit of hits) {
    if (hit.generic) generic.push(hit);
    else definite.push(hit);
  }
  return { definite, generic };
}

const PARKED_PHRASES = [
  'this domain is for sale',
  'buy this domain',
  'parked free',
  'domain parking',
  'godaddy parking',
  'sedoparking',
  'hugedomains',
  'is expired',
  'renew now',
];

export function looksParked(html: string, title?: string): boolean {
  const blob = `${title ?? ''} ${html}`.toLowerCase();
  return PARKED_PHRASES.some((p) => blob.includes(p));
}

/** Thin SPA shell with almost no text — Pass 1 cannot confidently say no-assistant. */
export function looksLikeEmptySpa(html: string): boolean {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length < 80 && /<div[^>]+id=["'](?:root|app|__next)["']/i.test(html);
}
