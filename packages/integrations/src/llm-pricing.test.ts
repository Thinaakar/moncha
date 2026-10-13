import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterPriceBook, parsePriceOverrides } from './llm-pricing';
import { OpenRouterLlmProvider } from './openrouter';

const modelList = {
  data: [
    { id: 'openai/gpt-4o-mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
    { id: 'google/gemini-3.5-flash', pricing: { prompt: '0.0000015', completion: '0.000009' } },
    { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
  ],
};

const okFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('parsePriceOverrides', () => {
  it('reads model=input/output pairs in USD per million tokens', () => {
    const prices = parsePriceOverrides('google/gemini-3.5-flash=1.5/9, bad entry, openai/gpt-4o-mini = 0.15 / 0.6');
    expect(prices.get('google/gemini-3.5-flash')).toEqual({ input: 1.5e-6, output: 9e-6 });
    expect(prices.get('openai/gpt-4o-mini')?.output).toBeCloseTo(0.6e-6);
    expect(prices.size).toBe(2);
  });
});

describe('OpenRouterPriceBook', () => {
  it('lists per-token prices and skips variable-price models', async () => {
    const fetchImpl = okFetch(modelList);
    const book = new OpenRouterPriceBook({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const list = await book.list();
    expect(list.source).toBe('openrouter');
    expect(list.prices.get('google/gemini-3.5-flash')).toEqual({ input: 0.0000015, output: 0.000009 });
    expect(list.prices.has('openrouter/auto')).toBe(false);
  });

  it('caches the list and lets overrides win', async () => {
    const fetchImpl = okFetch(modelList);
    const book = new OpenRouterPriceBook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      overrides: new Map([['openai/gpt-4o-mini', { input: 1e-6, output: 2e-6 }]]),
    });
    await book.list();
    const list = await book.list();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(list.prices.get('openai/gpt-4o-mini')).toEqual({ input: 1e-6, output: 2e-6 });
  });

  it('falls back to overrides when the list cannot be fetched', async () => {
    const fetchImpl = vi.fn(async () => new Response('down', { status: 503 }));
    const book = new OpenRouterPriceBook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      overrides: new Map([['m', { input: 1e-6, output: 1e-6 }]]),
    });
    const list = await book.list();
    expect(list.source).toBe('overrides');
    expect(list.fetchedAt).toBeNull();
    expect([...list.prices.keys()]).toEqual(['m']);
  });
});

describe('OpenRouterLlmProvider usage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for usage accounting and returns the reported cost', async () => {
    const fetchMock = okFetch({
      model: 'openai/gpt-4o-mini',
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000027 },
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterLlmProvider({ apiKey: 'test-key' });
    const result = await provider.completeJson({ system: 's', user: 'u', schema: {}, promptVersion: 'v1', parse: (raw) => raw });
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 20, costUsd: 0.000027 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.usage).toEqual({ include: true });
  });

  it('leaves the cost out when OpenRouter does not report it', async () => {
    vi.stubGlobal(
      'fetch',
      okFetch({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }),
    );
    const provider = new OpenRouterLlmProvider({ apiKey: 'test-key' });
    const result = await provider.completeJson({ system: 's', user: 'u', schema: {}, promptVersion: 'v1', parse: (raw) => raw });
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 1 });
  });
});
