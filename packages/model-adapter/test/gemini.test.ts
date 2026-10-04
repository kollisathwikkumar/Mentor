import { describe, expect, it, vi } from 'vitest';
import { createGeminiAdapter, GeminiAdapter, type GeminiAdapterConfig } from '../src/index.js';

const config: GeminiAdapterConfig = {
  apiKey: 'test-secret-not-for-logs',
  model: 'gemini-3.8-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
  timeoutMs: 1000,
  maxOutputTokens: 512,
};

describe('Gemini 3.8 Flash adapter', () => {
  it('sends bounded JSON requests with the API key in the header and extracts validated text', async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'test-secret-not-for-logs' });
      expect(_input).toBe(config.endpoint);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        contents: [{ role: 'user', parts: [{ text: 'Return one JSON object.' }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512, thinkingConfig: { thinkingLevel: 'low' } },
      });
      expect(JSON.stringify(body)).not.toContain(config.apiKey);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"action":"native_transfer"}' }] } }] }), { status: 200 });
    });
    const adapter = new GeminiAdapter(config, fetcher);
    await expect(adapter.complete('Return one JSON object.')).resolves.toBe('{"action":"native_transfer"}');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('invokes the runtime fetch with the global fetch receiver', async () => {
    const fetcher = vi.fn(function (this: unknown): Promise<Response> {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 }));
    });
    await expect(new GeminiAdapter(config, fetcher).complete('hello')).resolves.toBe('{"ok":true}');
  });

  it('sanitizes provider failures and never logs response bodies or credentials', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = new GeminiAdapter(config, async () => new Response('private payload test-secret-not-for-logs', { status: 401 }));
    await expect(adapter.complete('hello')).rejects.toThrow('Model provider returned HTTP 401');
    expect(errorSpy).toHaveBeenCalledWith('Gemini model provider returned HTTP 401');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(config.apiKey);
    errorSpy.mockRestore();
  });

  it('retries one transient provider 503 and returns the validated success', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('transient error detail', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 }));
    const adapter = new GeminiAdapter(config, fetcher);
    await expect(adapter.complete('hello')).resolves.toBe('{"ok":true}');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('logs only a safe error class when transport throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = new GeminiAdapter(config, async () => { throw new TypeError(`private transport details ${config.apiKey}`); });
    await expect(adapter.complete('hello')).rejects.toThrow(`private transport details ${config.apiKey}`);
    expect(errorSpy).toHaveBeenCalledWith('Gemini model transport failed (TypeError: unclassified transport error)');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(config.apiKey);
    errorSpy.mockRestore();
  });

  it('classifies common transport failures without logging provider or credential details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cases: ReadonlyArray<{ readonly error: unknown; readonly expected: string }> = [
      { error: new TypeError('fetch failed'), expected: 'TypeError: fetch failed' },
      { error: new Error('invalid header value private-key'), expected: 'Error: invalid request header' },
      { error: new Error('invalid url private-key'), expected: 'Error: invalid request URL' },
      { error: new Error('signal aborted private-key'), expected: 'Error: request aborted' },
      { error: Object.assign(new Error(`provider details ${config.apiKey}`), { name: 'Unknown Error' }), expected: 'Error: unclassified transport error' },
      { error: `private transport ${config.apiKey}`, expected: 'Error: unclassified transport error' },
    ];
    try {
      for (const [index, testCase] of cases.entries()) {
        const adapter = new GeminiAdapter(config, async () => { throw testCase.error; });
        await expect(adapter.complete(`case ${index}`)).rejects.toBe(testCase.error);
        expect(errorSpy).toHaveBeenLastCalledWith(`Gemini model transport failed (${testCase.expected})`);
      }
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(config.apiKey);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rejects malformed provider data without returning raw content', async () => {
    const adapter = new GeminiAdapter(config, async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    await expect(adapter.complete('hello')).rejects.toThrow('Model provider returned an invalid response');
    const emptyText = new GeminiAdapter(config, async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] }), { status: 200 }));
    await expect(emptyText.complete('hello')).rejects.toThrow('Model provider returned an invalid response');
    const missingText = new GeminiAdapter(config, async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{}] } }] }), { status: 200 }));
    await expect(missingText.complete('hello')).rejects.toThrow('Model provider returned an invalid response');
  });

  it('rejects non-official endpoints, other models, and unbounded requests', async () => {
    expect(() => new GeminiAdapter({ ...config, endpoint: 'https://attacker.example/generate' })).toThrow('official Gemini');
    expect(() => new GeminiAdapter({ ...config, model: 'gemini-3.7-flash' })).toThrow('supported model');
    const adapter = new GeminiAdapter(config, async () => { throw new Error('fetch should not be called'); });
    await expect(adapter.complete(' ')).rejects.toThrow('Prompt must contain');
    await expect(adapter.complete('x'.repeat(12_001))).rejects.toThrow('Prompt must contain');
  });

  it('rejects invalid timeout and output-token configuration', () => {
    expect(() => new GeminiAdapter({ ...config, timeoutMs: 0 })).toThrow('Timeout must be between');
    expect(() => new GeminiAdapter({ ...config, timeoutMs: 60_001 })).toThrow('Timeout must be between');
    expect(() => new GeminiAdapter({ ...config, maxOutputTokens: 0 })).toThrow('Output token limit must be between');
    expect(() => new GeminiAdapter({ ...config, maxOutputTokens: 4097 })).toThrow('Output token limit must be between');
    expect(() => new GeminiAdapter({ ...config, apiKey: ' ' })).toThrow('API key and supported model are required');
  });

  it('aborts a provider call at the configured timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = async (_input: string, init?: RequestInit): Promise<Response> => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
      });
      const adapter = new GeminiAdapter({ ...config, timeoutMs: 10 }, fetcher);
      const completion = adapter.complete('hello');
      const rejection = expect(completion).rejects.toThrow('request aborted');
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads the AI Studio key from backend env and pins the supported Flash model', () => {
    expect(() => createGeminiAdapter({})).toThrow('Set GEMINI_API_KEY');
    const adapter = createGeminiAdapter({ GEMINI_API_KEY: 'test-key' });
    expect(adapter).toBeInstanceOf(GeminiAdapter);
    expect(() => createGeminiAdapter({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'unapproved-model' })).toThrow('GEMINI_MODEL must be gemini-3.8-flash');
  });
});
