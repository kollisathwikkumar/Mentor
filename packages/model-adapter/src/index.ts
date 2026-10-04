import { z } from 'zod';

const completionSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1),
});

export interface GeminiAdapterConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GeminiAdapter {
  readonly #config: GeminiAdapterConfig;
  readonly #fetch: FetchLike;

  constructor(config: GeminiAdapterConfig, fetcher: FetchLike = fetch) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'generativelanguage.googleapis.com' || endpoint.pathname !== '/v1beta/models/gemini-3.8-flash:generateContent' || endpoint.search !== '' || endpoint.hash !== '') {
      throw new TypeError('Model endpoint must be the official Gemini 3.8 Flash generateContent endpoint');
    }
    if (config.apiKey.trim().length === 0 || config.model !== 'gemini-3.8-flash') {
      throw new TypeError('Gemini API key and supported model are required');
    }
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 60_000) {
      throw new RangeError('Timeout must be between 1 and 60000 milliseconds');
    }
    if (!Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 || config.maxOutputTokens > 4096) {
      throw new RangeError('Output token limit must be between 1 and 4096');
    }
    this.#config = config;
    this.#fetch = fetcher;
  }

  async complete(prompt: string): Promise<string> {
    if (prompt.trim().length === 0 || prompt.length > 12_000) {
      throw new RangeError('Prompt must contain 1 to 12000 characters');
    }
    const retryableStatuses = new Set([429, 500, 502, 503, 504]);
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
      try {
        response = await Reflect.apply(this.#fetch, globalThis, [this.#config.endpoint, {
          method: 'POST',
          headers: {
            'x-goog-api-key': this.#config.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: this.#config.maxOutputTokens,
              thinkingConfig: { thinkingLevel: 'low' },
            },
          }),
          signal: controller.signal,
        }]);
      } catch (error) {
        if (attempt === 0 && error instanceof TypeError && !controller.signal.aborted) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          continue;
        }
        const errorName = error instanceof Error && /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'Error';
        const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
        const safeReason = errorMessage === 'fetch failed' ? 'fetch failed'
          : errorMessage.includes('header') ? 'invalid request header'
            : errorMessage.includes('url') ? 'invalid request URL'
              : errorMessage.includes('abort') || errorMessage.includes('signal') ? 'request aborted'
                : 'unclassified transport error';
        console.error(`Gemini model transport failed (${errorName}: ${safeReason})`);
        throw error;
      } finally {
        clearTimeout(timer);
      }
      if (response.ok || attempt === 1 || !retryableStatuses.has(response.status)) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    if (response === undefined) throw new Error('Model provider returned an invalid response');
    if (!response.ok) {
      console.error(`Gemini model provider returned HTTP ${response.status}`);
      throw new Error(`Model provider returned HTTP ${response.status}`);
    }
    let body: z.infer<typeof completionSchema>;
    try {
      body = completionSchema.parse(await response.json());
    } catch {
      throw new Error('Model provider returned an invalid response');
    }
    const content = body.candidates[0]?.content.parts.map((part) => part.text ?? '').join('').trim();
    if (content === undefined || content.length === 0) {
      throw new Error('Model provider returned an invalid response');
    }
    return content;
  }
}

export function createGeminiAdapter(env: Readonly<Record<string, string | undefined>>, fetcher: FetchLike = fetch): GeminiAdapter {
  const apiKey = env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('Set GEMINI_API_KEY in the backend environment');
  }
  const model = env.GEMINI_MODEL ?? 'gemini-3.8-flash';
  if (model !== 'gemini-3.8-flash') throw new Error('GEMINI_MODEL must be gemini-3.8-flash');
  return new GeminiAdapter({
    apiKey,
    model,
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    timeoutMs: 45_000,
    maxOutputTokens: 512,
  }, fetcher);
}
