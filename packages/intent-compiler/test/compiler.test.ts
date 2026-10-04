import { describe, expect, it } from 'vitest';
import { IntentCompiler, type TextModel } from '../src/index.js';

function model(response: string): TextModel { return { complete: async () => response }; }
const complete = JSON.stringify({ action: 'native_transfer', agentSigner: '0x0000000000000000000000000000000000000002', recipient: '0x0000000000000000000000000000000000000003', perCallMon: '4', totalMon: '10', expiresAt: '2000000000', timezone: 'UTC' });

describe('intent compiler', () => {
  it('returns a normalized preview only when all fields are explicit and valid', async () => {
    const result = await new IntentCompiler(model(complete)).propose('send up to 10 MON to a recipient');
    expect(result.status).toBe('ready_for_user_review');
    if (result.status === 'ready_for_user_review') {
      expect(result.preview.perCallLimitWei).toBe('4000000000000000000');
      expect(result.preview.totalLimitWei).toBe('10000000000000000000');
      expect(result.preview.expiresAt).toBe(2_000_000_000);
      expect(result.preview.policyHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it('accepts a JSON number for a Unix expiry timestamp', async () => {
    const numericExpiry = JSON.stringify({ ...JSON.parse(complete), expiresAt: 2_000_000_000 });
    await expect(new IntentCompiler(model(numericExpiry)).propose('valid task')).resolves.toMatchObject({
      status: 'ready_for_user_review',
      preview: { expiresAt: 2_000_000_000 },
    });
  });

  it('asks for required clarifications instead of filling missing policy fields', async () => {
    const result = await new IntentCompiler(model('{"action":"native_transfer","perCallMon":"10"}')).propose('send money');
    expect(result.status).toBe('needs_clarification');
    if (result.status === 'needs_clarification') expect(result.missingFields).toContain('recipient');
  });

  it('treats malformed model text and invalid limits as untrusted', async () => {
    await expect(new IntentCompiler(model('not json')).propose('hello')).resolves.toMatchObject({ status: 'needs_clarification', missingFields: ['valid_model_output'] });
    await expect(new IntentCompiler(model(complete.replace('"totalMon":"10"', '"totalMon":"2"'))).propose('hello')).resolves.toMatchObject({ status: 'needs_clarification', missingFields: ['totalMon'] });
  });
});

it('requests clarification on empty prompts and provider failures', async () => {
  const compiler = new IntentCompiler({ complete: async () => { throw new Error('offline'); } });
  await expect(compiler.propose('')).resolves.toMatchObject({ status: 'needs_clarification', missingFields: ['task'] });
  await expect(compiler.propose('valid task')).resolves.toMatchObject({ status: 'needs_clarification', missingFields: ['model_response'] });
});

it('rejects invalid amount precision and unknown timezones', async () => {
  const invalid = complete.replace('"perCallMon":"4"', '"perCallMon":"4.0000000000000000001"').replace('"timezone":"UTC"', '"timezone":"Mars/Olympus"');
  await expect(new IntentCompiler(model(invalid)).propose('valid task')).resolves.toMatchObject({ status: 'needs_clarification' });
});

it('rejects object shapes with extra fields', async () => {
  const response = JSON.stringify({ ...JSON.parse(complete), privateKey: '0xignored' });
  await expect(new IntentCompiler(model(response)).propose('valid task')).resolves.toMatchObject({ status: 'needs_clarification', missingFields: ['valid_model_output'] });
});

it('asks for clarification when the proposed action is unsupported', async () => {
  const response = complete.replace('native_transfer', 'arbitrary_call');
  await expect(new IntentCompiler(model(response)).propose('valid task')).resolves.toMatchObject({ status: 'needs_clarification', missingFields: ['action'] });
});
