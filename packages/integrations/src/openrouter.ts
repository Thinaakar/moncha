import type { LlmCompleteJsonInput, LlmProvider } from '@moncha/domain';

export type OpenRouterConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

/**
 * OpenRouter chat completions → JSON object (Pass 3).
 */
export class OpenRouterLlmProvider implements LlmProvider {
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(private config: OpenRouterConfig) {
    if (!config.apiKey) throw new Error('OPENROUTER_API_KEY is required');
    this.model = config.model || 'openai/gpt-4o-mini';
    this.baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  async completeJson<T>(input: LlmCompleteJsonInput<T>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
          'http-referer': 'https://moncha.local',
          'x-title': 'MonCha Lead Engine',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`openrouter_http_${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error('openrouter_empty_content');
      const parsed = JSON.parse(content) as unknown;
      return {
        data: input.parse(parsed),
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
        },
        model: json.model || this.model,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createOpenRouterFromEnv(
  env: Record<string, string | undefined> = process.env,
): OpenRouterLlmProvider | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenRouterLlmProvider({
    apiKey,
    model: env.OPENROUTER_MODEL || undefined,
    baseUrl: env.OPENROUTER_BASE_URL || undefined,
    timeoutMs: env.LLM_TIMEOUT_MS ? Number(env.LLM_TIMEOUT_MS) : undefined,
  });
}
