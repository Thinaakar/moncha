import type { LlmCompleteJsonInput, LlmProvider } from '@moncha/domain';

export type OpenRouterConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type JsonImageInput = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Uint8Array };

export type CompleteJsonWithImagesInput<T> = {
  model?: string;
  timeoutMs?: number;
  system: string;
  text: string;
  images?: JsonImageInput[];
  maxTokens?: number;
  parse: (raw: unknown) => T;
};

export type CompleteJsonResult<T> = {
  data: T;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
};

export interface MultimodalJsonClient {
  completeJsonWithImages<T>(input: CompleteJsonWithImagesInput<T>): Promise<CompleteJsonResult<T>>;
}

/** JSON in a ```json fence or with prose around it still parses. */
function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)?.[1];
    const candidate = fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw new Error('openrouter_invalid_json');
    }
  }
}

/**
 * OpenRouter chat completions → JSON object (Pass 3).
 */
export class OpenRouterLlmProvider implements LlmProvider, MultimodalJsonClient {
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

  /** Text plus images (data URLs) → JSON object, with a per-call model and timeout. */
  async completeJsonWithImages<T>(input: CompleteJsonWithImagesInput<T>): Promise<CompleteJsonResult<T>> {
    const model = input.model || this.model;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? this.timeoutMs);
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.text }];
    for (const image of input.images ?? []) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}` },
      });
    }
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
          model,
          temperature: 0.2,
          ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content },
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
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new Error('openrouter_empty_content');
      return {
        data: input.parse(parseJsonContent(text)),
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
        },
        model: json.model || model,
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('openrouter_timeout');
      throw error;
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
