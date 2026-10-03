import type {
  Logger,
  LlmProvider,
  WebsiteAuditor,
  WebsiteAuditResult,
} from '@moncha/domain';
import { DEFAULT_AUDIT_CONFIG, combineLlmVerdict, type LlmClassifyOutput } from '@moncha/domain';
import { htmlPassToAuditResult, runHtmlPass, type HtmlPassResult } from './html-pass';
import { renderPassToAuditResult, runRenderPass } from './render-pass';

export type MonchaWebsiteAuditorOptions = {
  llm?: LlmProvider;
  logger?: Logger;
  /** When true and LLM is configured, still-ambiguous after render triggers Pass 3. */
  enableLlm?: boolean;
  /** When false, skip Playwright (tests / emergency). Default true. */
  enableRender?: boolean;
};

function needsRenderPass(pass: HtmlPassResult, htmlResult: WebsiteAuditResult): boolean {
  if (pass.websiteStatus !== 'ACTIVE') return false;
  // Already found a chatbot in static HTML — no need to render.
  if (htmlResult.verdict === 'HAS_ASSISTANT') return false;
  // Ambiguous SPA / incomplete HTML, or "no assistant" that must be confirmed after JS.
  return (
    pass.ambiguous ||
    htmlResult.verdict === 'UNCERTAIN' ||
    htmlResult.verdict === 'NO_ASSISTANT' ||
    htmlResult.failureReason === 'html_ambiguous'
  );
}

/**
 * Pass 1 HTML → Pass 2 Playwright (when needed) → Pass 3 OpenRouter (optional, ambiguous only).
 * Never emits NO_ASSISTANT from a failed/blocked/partial fetch or render.
 */
export class MonchaWebsiteAuditor implements WebsiteAuditor {
  constructor(private options: MonchaWebsiteAuditorOptions = {}) {}

  async audit(input: { tenantId: string; leadId: string; url: string }): Promise<WebsiteAuditResult> {
    this.options.logger?.info('audit_pass1_start', {
      tenantId: input.tenantId,
      leadId: input.leadId,
      url: input.url,
    });

    const pass = await runHtmlPass(input.url);
    let result = htmlPassToAuditResult(pass);
    let htmlForLlm = pass.html;

    const enableRender = this.options.enableRender !== false;
    if (enableRender && needsRenderPass(pass, result)) {
      this.options.logger?.info('audit_pass2_start', {
        tenantId: input.tenantId,
        leadId: input.leadId,
        url: pass.finalUrl || input.url,
        reason: pass.ambiguous ? 'html_ambiguous' : result.verdict,
      });
      const render = await runRenderPass(pass.finalUrl || input.url);
      result = renderPassToAuditResult(render, result);
      if (render.html) htmlForLlm = render.html;

      this.options.logger?.info('audit_pass2_done', {
        tenantId: input.tenantId,
        leadId: input.leadId,
        verdict: result.verdict,
        renderComplete: render.renderComplete,
        pagesVisited: render.pagesVisited.length,
        networkHits: render.networkHits.length,
        domHits: render.assistantHits.length,
        robotsAllowed: render.robotsAllowed,
      });
    }

    const shouldLlm =
      Boolean(this.options.enableLlm && this.options.llm) &&
      result.websiteStatus === 'ACTIVE' &&
      (result.verdict === 'UNCERTAIN' ||
        result.failureReason === 'html_ambiguous' ||
        result.failureReason === 'render_incomplete' ||
        result.failureReason?.startsWith('render_'));

    // Never send LLM if we already have a clear HAS_ASSISTANT / NO_ASSISTANT from HTML/render.
    if (
      shouldLlm &&
      this.options.llm &&
      htmlForLlm &&
      result.verdict === 'UNCERTAIN'
    ) {
      result = await this.runLlmPass(input, htmlForLlm, result);
    }

    this.options.logger?.info('audit_complete', {
      tenantId: input.tenantId,
      leadId: input.leadId,
      verdict: result.verdict,
      method: result.method,
      renderRan: result.renderRan,
      llmRan: result.llmRan,
      websiteStatus: result.websiteStatus,
    });

    return result;
  }

  private async runLlmPass(
    input: { tenantId: string; leadId: string; url: string },
    html: string,
    base: WebsiteAuditResult,
  ): Promise<WebsiteAuditResult> {
    const config = DEFAULT_AUDIT_CONFIG;
    const excerpt = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);

    const evidenceIds = base.evidence.map((_, i) => `e${i}`);
    const validRefs = new Set(evidenceIds.length ? evidenceIds : ['e0']);

    try {
      const completion = await this.options.llm!.completeJson<LlmClassifyOutput>({
        system:
          'You classify whether a business website has a conversational AI chatbot or live chat widget. ' +
          'Links or floating buttons to WhatsApp, Facebook/Messenger, Telegram, LINE or Viber are contact channels, ' +
          'NOT assistants: if those are the only chat-like elements, answer "no". Reply with JSON only.',
        user: JSON.stringify({
          url: input.url,
          title: base.title,
          pageExcerpt: excerpt,
          evidenceIds: [...validRefs],
          renderRan: base.renderRan,
          instructions:
            'Set hasConversationalAssistant to yes|no|unsure. kind one of AI_CHATBOT|LIVE_CHAT|NONE. ' +
            'vendor is the chatbot product name or null. ' +
            'confidence is a number from 0 to 1 for how sure you are of hasConversationalAssistant. ' +
            'reasons is 1 to 5 short strings explaining the answer. ' +
            'WhatsApp/Messenger/Telegram/LINE/Viber links alone mean "no" with kind NONE. ' +
            'evidenceRefs must only use provided evidenceIds.',
        }),
        schema: {
          type: 'object',
          required: ['hasConversationalAssistant', 'kind', 'confidence', 'reasons', 'evidenceRefs'],
        },
        promptVersion: config.llmPromptVersion,
        parse: (raw) => {
          const o = raw as Record<string, unknown>;
          return {
            hasConversationalAssistant: o.hasConversationalAssistant as LlmClassifyOutput['hasConversationalAssistant'],
            kind: (o.kind as LlmClassifyOutput['kind']) || 'NONE',
            vendor: (o.vendor as string) || null,
            confidence: Number(o.confidence) || 0,
            reasons: Array.isArray(o.reasons) ? (o.reasons as string[]) : [],
            evidenceRefs: Array.isArray(o.evidenceRefs)
              ? (o.evidenceRefs as string[])
              : [...validRefs],
          };
        },
      });

      const combined = combineLlmVerdict({
        llm: completion.data,
        validEvidenceRefs: validRefs,
        config,
      });

      let verdict = combined.verdict;
      if (verdict === 'NO_ASSISTANT' && !combined.canQualify) {
        verdict = 'UNCERTAIN';
      }

      return {
        ...base,
        verdict,
        kind: combined.kind,
        vendor: combined.vendor ?? undefined,
        confidence: combined.confidence,
        method: 'llm',
        renderRan: base.renderRan,
        llmRan: true,
        failureReason:
          combined.failureReason ??
          (verdict === 'UNCERTAIN' ? 'llm_no_assistant_pending_precision' : undefined),
        llmModel: completion.model,
        llmPromptVersion: config.llmPromptVersion,
        llmResult: completion.data,
        llmPromptTokens: completion.usage.promptTokens,
        llmCompletionTokens: completion.usage.completionTokens,
        evidence: [
          ...base.evidence,
          {
            type: 'llm_reason',
            excerpt: (completion.data.reasons || []).join('; ').slice(0, 500),
            vendor: completion.data.vendor ?? undefined,
            sourcePage: base.finalUrl,
          },
        ],
      };
    } catch (error) {
      this.options.logger?.error('audit_llm_failed', {
        tenantId: input.tenantId,
        leadId: input.leadId,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        ...base,
        verdict: 'UNCERTAIN',
        confidence: 0.3,
        method: base.renderRan ? 'render' : 'html',
        llmRan: true,
        failureReason: 'llm_error',
      };
    }
  }
}
