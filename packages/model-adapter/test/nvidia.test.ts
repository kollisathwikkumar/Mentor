import { describe, expect, it } from 'vitest';
import { NvidiaModelAdapter, type ModelAdapterConfig } from '../src/index.js';

const config: ModelAdapterConfig = {
  apiKey: 'test-token',
  model: 'nvidia/test-model',
  endpoint: 'https://example.test/v1/chat/completions',
  timeoutMs: 2000,
  maxOutputTokens: 128,
};

describe('NVIDIA model adapter', () => {
  it('sends a bounded non-streaming request and parses generated content', async () => {
    const calls: RequestInit[] = [];
    const adapter = new NvidiaModelAdapter(config, async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"clarify"}' } }] }), { status: 200 });
    });
    await expect(adapter.complete('propose typed policy')).resolves.toBe('{"action":"clarify"}');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer test-token' }));
    expect(calls[0]?.body).toContain('"max_tokens":128');
    expect(calls[0]?.body).toContain('"reasoning_effort":"none"');
    expect(calls[0]?.body).toContain('"stream":false');
  });

  it('fails closed on a non-success response without exposing provider body', async () => {
    const adapter = new NvidiaModelAdapter(config, async () => new Response('secret response text', { status: 401 }));
    await expect(adapter.complete('hello')).rejects.toThrow('Model provider returned HTTP 401');
  });

  it('rejects malformed provider content', async () => {
    const adapter = new NvidiaModelAdapter(config, async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(adapter.complete('hello')).rejects.toThrow('Model provider returned an invalid response');
  });
});

it('rejects missing environment configuration and invalid destinations', async () => {
  const { createNvidiaAdapter } = await import('../src/index.js');
  expect(() => createNvidiaAdapter({})).toThrow('Set NVIDIA_API_KEY and NVIDIA_MODEL');
  expect(() => new NvidiaModelAdapter({ ...config, endpoint: 'http://remote.test/chat' })).toThrow('must use HTTPS');
  expect(() => new NvidiaModelAdapter({ ...config, timeoutMs: 0 })).toThrow('Timeout must be between');
  expect(() => new NvidiaModelAdapter({ ...config, maxOutputTokens: 5000 })).toThrow('Output token limit must be between');
});

it('rejects empty or oversized model input before sending a request', async () => {
  const adapter = new NvidiaModelAdapter(config, async () => { throw new Error('fetch must not run'); });
  await expect(adapter.complete('   ')).rejects.toThrow('Prompt must contain');
  await expect(adapter.complete('x'.repeat(12001))).rejects.toThrow('Prompt must contain');
});

it('normalizes invalid JSON provider bodies to a bounded error', async () => {
  const adapter = new NvidiaModelAdapter(config, async () => new Response('private provider payload', { status: 200 }));
  await expect(adapter.complete('hello')).rejects.toThrow('Model provider returned an invalid response');
});

it('requires non-empty API key and model identifiers', () => {
  expect(() => new NvidiaModelAdapter({ ...config, apiKey: '' })).toThrow('API key and model are required');
  expect(() => new NvidiaModelAdapter({ ...config, model: '' })).toThrow('API key and model are required');
});

it('creates the provider adapter from explicit NVIDIA environment fields', async () => {
  const { createNvidiaAdapter } = await import('../src/index.js');
  const adapter = createNvidiaAdapter({ NVIDIA_API_KEY: 'local-test-key', NVIDIA_MODEL: 'nvidia/test-model' }, async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
  await expect(adapter.complete('bounded')).resolves.toBe('ok');
});
