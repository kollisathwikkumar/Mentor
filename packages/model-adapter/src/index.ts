import { z } from 'zod';

const providerResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export interface ModelAdapterConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly reasoningEffort?: 'none' | 'medium' | 'high';
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class NvidiaModelAdapter {
  readonly #config: ModelAdapterConfig;
  readonly #fetch: FetchLike;

  constructor(config: ModelAdapterConfig, fetcher: FetchLike = fetch) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost') {
      throw new TypeError('Model endpoint must use HTTPS');
    }
    if (config.apiKey.length === 0 || config.model.length === 0) {
      throw new TypeError('Model API key and model are required');
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
    const response = await this.#fetch(this.#config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: this.#config.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: this.#config.maxOutputTokens,
        reasoning_effort: this.#config.reasoningEffort ?? 'none',
        stream: false,
      }),
      signal: AbortSignal.timeout(this.#config.timeoutMs),
    });
    if (!response.ok) throw new Error(`Model provider returned HTTP ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Model provider returned an invalid response');
    }
    const parsed = providerResponseSchema.safeParse(body);
    const content = parsed.data?.choices[0]?.message.content;
    if (!parsed.success || content === undefined) {
      throw new Error('Model provider returned an invalid response');
    }
    return content;
  }
}

export function createNvidiaAdapter(env: NodeJS.ProcessEnv, fetcher: FetchLike = fetch): NvidiaModelAdapter {
  const apiKey = env.NVIDIA_API_KEY;
  const model = env.NVIDIA_MODEL;
  if (apiKey === undefined || model === undefined) {
    throw new Error('Set NVIDIA_API_KEY and NVIDIA_MODEL in the backend environment');
  }
  const reasoningEffort = z.enum(['none', 'medium', 'high']).default('none').parse(env.NVIDIA_REASONING_EFFORT);
  return new NvidiaModelAdapter({
    apiKey,
    model,
    endpoint: env.NVIDIA_API_ENDPOINT ?? 'https://integrate.api.nvidia.com/v1/chat/completions',
    timeoutMs: 20_000,
    maxOutputTokens: 512,
    reasoningEffort,
  }, fetcher);
}
