import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CapabilityRegistry, canonicalPolicyHash, defineCapability, mandatePolicySchema, type ConnectorAdapter } from '../src/index.js';

const inputSchema = z.object({ resourceId: z.string().min(1), value: z.string().min(1) }).strict();
const adapter: ConnectorAdapter<typeof inputSchema> = {
  execute: async (_input, context) => ({ status: 'ok', receipt: context.idempotencyKey }),
};

const capability = defineCapability({
  connectorId: 'test.records', connectorVersion: '1.0.0', actionId: 'records.update',
  description: 'Update one registered record.', effect: 'write', risk: 'high',
  inputSchema, resourceField: 'resourceId', constraints: ['resourceId', 'value'],
  limits: { maxCalls: 3, supportsIdempotency: true, supportsVerification: true, supportsCancellation: false },
  adapter,
});

describe('canonical policy hash', () => {
  it('is independent of grant and argument insertion order but changes when scope changes', () => {
    const first = { schemaVersion: 1 as const, id: 'm', principalId: 'p', agentId: 'a', version: 1, expiresAt: 10, grants: [
      { connectorId: 'x', actionId: 'write', resourceId: 'r', argumentEquals: { z: '2', a: '1' }, maxCalls: 2 },
      { connectorId: 'y', actionId: 'read', resourceId: 'q', argumentEquals: {}, maxCalls: 1 },
    ] };
    const second = { ...first, grants: [...first.grants].reverse().map((grant) => ({ ...grant, argumentEquals: Object.fromEntries(Object.entries(grant.argumentEquals).reverse()) })) };
    expect(canonicalPolicyHash(first)).toBe(canonicalPolicyHash(second));
    expect(canonicalPolicyHash(first)).not.toBe(canonicalPolicyHash({ ...first, expiresAt: 11 }));
  });
});

describe('strict mandate policy schema', () => {
  it('rejects unknown authority fields and mismatched amount constraints', () => {
    const valid = policy().mandate;
    expect(mandatePolicySchema.safeParse({ ...valid, hiddenApproval: true }).success).toBe(false);
    expect(mandatePolicySchema.safeParse({ ...valid, grants: [{ ...valid.grants[0], maxAmount: 1 }] }).success).toBe(false);
  });
});

describe('capability registry', () => {
  it('publishes registered capabilities and validates strict input', async () => {
    const registry = new CapabilityRegistry([capability]);
    expect(registry.list()).toEqual([expect.objectContaining({ connectorId: 'test.records', actionId: 'records.update', effect: 'write' })]);
    expect(await registry.resolve('test.records', 'records.update')?.parseInput({ resourceId: 'r-1', value: 'ok' })).toEqual({ resourceId: 'r-1', value: 'ok' });
    expect(() => registry.resolve('test.records', 'records.update')?.parseInput({ resourceId: 'r-1', value: 'ok', url: 'https://example.test' })).toThrow();
  });

  it('fails closed for unknown connector and action', () => {
    const registry = new CapabilityRegistry([capability]);
    expect(registry.resolve('invented', 'records.update')).toBeUndefined();
    expect(registry.resolve('test.records', 'arbitrary.proxy')).toBeUndefined();
  });

  it('rejects duplicate registrations and manifests that cannot enforce their resource selector', () => {
    expect(() => new CapabilityRegistry([capability, capability])).toThrow('Duplicate capability');
    expect(() => defineCapability({ ...capability, constraints: ['value'] })).toThrow('Resource field must be declared as an enforceable constraint');
  });
});

import { AuthorizationGateway, transitionTask, type ActionOutcome, type PolicySnapshot, type PolicyStore, type TaskRecord } from '../src/index.js';

class MemoryPolicyStore implements PolicyStore {
  readonly snapshot: PolicySnapshot;
  readonly #used = new Map<string, number>();
  readonly #results = new Map<string, ActionOutcome>();
  constructor(snapshot: PolicySnapshot) { this.snapshot = snapshot; }
  async get(mandateId: string): Promise<PolicySnapshot | undefined> {
    if (mandateId !== this.snapshot.mandate.id) return undefined;
    return { ...this.snapshot, callsUsed: Object.fromEntries(this.#used), idempotency: Object.fromEntries(this.#results) };
  }
  async reserve(input: { readonly mandateId: string; readonly principalId: string; readonly expectedVersion: number; readonly now: number; readonly grantKey: string; readonly idempotencyKey: string; readonly maxCalls: number }): Promise<'reserved' | 'duplicate' | 'conflict' | 'limit' | ActionOutcome> {
    const { mandateId, principalId, expectedVersion, now, grantKey, idempotencyKey, maxCalls } = input;
    if (mandateId !== this.snapshot.mandate.id || expectedVersion !== this.snapshot.mandate.version || principalId !== this.snapshot.mandate.principalId || this.snapshot.mandate.status !== 'active' || now >= this.snapshot.mandate.expiresAt) return 'conflict';
    if (this.#results.has(idempotencyKey)) return this.#results.get(idempotencyKey) ?? 'duplicate';
    const used = this.#used.get(grantKey) ?? 0;
    const grant = this.snapshot.mandate.grants.find((item) => `${item.connectorId}:${item.actionId}` === grantKey);
    if (!grant) return 'conflict';
    if (used >= Math.min(grant.maxCalls, maxCalls)) return 'limit';
    this.#used.set(grantKey, used + 1);
    return 'reserved';
  }
  async complete(_mandateId: string, idempotencyKey: string, outcome: ActionOutcome): Promise<void> { this.#results.set(idempotencyKey, outcome); }
}

const policy = (patch: Partial<PolicySnapshot['mandate']> = {}): PolicySnapshot => {
  const body = {
    schemaVersion: 1 as const, id: 'm-1', principalId: 'user-1', agentId: 'agent-1', version: 1, expiresAt: 2_000,
    grants: [{ connectorId: 'test.records', actionId: 'records.update', resourceId: 'r-1', argumentEquals: {}, maxCalls: 1 }],
    ...patch,
  };
  const policyHash = canonicalPolicyHash(body);
  return {
    mandate: { ...body, policyHash, approvedPolicyHash: patch.approvedPolicyHash === undefined ? policyHash : patch.approvedPolicyHash, status: patch.status ?? 'active' },
    callsUsed: {}, idempotency: {},
  };
};
const action = (patch: Partial<Parameters<AuthorizationGateway['execute']>[0]> = {}) => ({
  principalId: 'user-1', mandateId: 'm-1', connectorId: 'test.records', actionId: 'records.update',
  arguments: { resourceId: 'r-1', value: 'ok' }, idempotencyKey: 'idem-key-00000001', ...patch,
});

describe('authorization gateway', () => {
  it('returns the stored response for an idempotent duplicate', async () => {
    let reads = 0;
    const original = policy();
    const result = { status: 'ok' as const, receipt: 'provider-receipt-1' };
    const store: PolicyStore = {
      get: async () => { reads += 1; return reads === 1 ? original : { ...original, idempotency: { 'idem-key-00000001': result } }; },
      reserve: async () => 'duplicate', complete: async () => undefined,
    };
    const gateway = new AuthorizationGateway(new CapabilityRegistry([capability]), store, () => 1_000);
    expect(await gateway.execute(action())).toEqual({ status: 'allowed', outcome: result });
  });

  it('uses the server clock by default', async () => {
    const gateway = new AuthorizationGateway(new CapabilityRegistry([capability]), new MemoryPolicyStore(policy()));
    expect(await gateway.execute(action())).toMatchObject({ status: 'denied', reason: 'MANDATE_EXPIRED' });
  });

  it('fails closed when the mandate or atomic reservation is unavailable/conflicted', async () => {
    const missing: PolicyStore = { get: async () => undefined, reserve: async () => 'conflict', complete: async () => undefined };
    const missingGateway = new AuthorizationGateway(new CapabilityRegistry([capability]), missing, () => 1_000);
    expect(await missingGateway.execute(action())).toMatchObject({ status: 'denied', reason: 'MANDATE_INACTIVE' });
    const duplicateWithoutResult: PolicyStore = { get: async () => policy(), reserve: async () => 'duplicate', complete: async () => undefined };
    const duplicateGateway = new AuthorizationGateway(new CapabilityRegistry([capability]), duplicateWithoutResult, () => 1_000);
    expect(await duplicateGateway.execute(action())).toMatchObject({ status: 'denied', reason: 'RESERVATION_CONFLICT' });
    const conflict: PolicyStore = { get: async () => policy(), reserve: async () => 'conflict', complete: async () => undefined };
    expect(await new AuthorizationGateway(new CapabilityRegistry([capability]), conflict, () => 1_000).execute(action())).toMatchObject({ status: 'denied', reason: 'RESERVATION_CONFLICT' });
    const limit: PolicyStore = { get: async () => policy(), reserve: async () => 'limit', complete: async () => undefined };
    expect(await new AuthorizationGateway(new CapabilityRegistry([capability]), limit, () => 1_000).execute(action())).toMatchObject({ status: 'denied', reason: 'CALL_LIMIT' });
  });

  it('enforces typed amount constraints before adapter execution', async () => {
    const amountSchema = z.object({ resourceId: z.string(), amount: z.union([z.string(), z.number()]) }).strict();
    const amountCapability = defineCapability({ ...capability, inputSchema: amountSchema, adapter: { execute: async () => ({ status: 'ok' }) } });
    const snapshot = policy({ grants: [{ connectorId: 'test.records', actionId: 'records.update', resourceId: 'r-1', argumentEquals: {}, maxCalls: 2, amountField: 'amount', maxAmount: 5 }] });
    const gateway = new AuthorizationGateway(new CapabilityRegistry([amountCapability]), new MemoryPolicyStore(snapshot), () => 1_000);
    expect(await gateway.execute(action({ arguments: { resourceId: 'r-1', amount: 4 } }))).toMatchObject({ status: 'allowed' });
    expect(await gateway.execute(action({ arguments: { resourceId: 'r-1', amount: '4' }, idempotencyKey: 'idem-key-00000002' }))).toMatchObject({ status: 'allowed' });
    expect(await gateway.execute(action({ arguments: { resourceId: 'r-1', amount: 6 }, idempotencyKey: 'idem-key-00000003' }))).toMatchObject({ status: 'denied', reason: 'CONSTRAINT_MISMATCH' });
    const missingAmountPolicy = policy({ grants: [{ connectorId: 'test.records', actionId: 'records.update', resourceId: 'r-1', argumentEquals: {}, maxCalls: 1, amountField: 'absent', maxAmount: 5 }] });
    expect(await new AuthorizationGateway(new CapabilityRegistry([capability]), new MemoryPolicyStore(missingAmountPolicy), () => 1_000).execute(action())).toMatchObject({ status: 'denied', reason: 'CONSTRAINT_MISMATCH' });
  });

  it('rejects malformed policy state from the store', async () => {
    const store: PolicyStore = { get: async () => ({ ...policy(), mandate: { ...policy().mandate, grants: [] } }), reserve: async () => 'conflict', complete: async () => undefined };
    expect(await new AuthorizationGateway(new CapabilityRegistry([capability]), store, () => 1_000).execute(action())).toMatchObject({ status: 'denied', reason: 'INVALID_POLICY' });
  });

  it('authorizes only approved scoped actions and rejects cross-principal attempts', async () => {
    const gateway = new AuthorizationGateway(new CapabilityRegistry([capability]), new MemoryPolicyStore(policy()), () => 1_000);
    await expect(gateway.execute(action())).resolves.toEqual({ status: 'allowed', outcome: { status: 'ok', receipt: 'idem-key-00000001' } });
    await expect(gateway.execute(action({ principalId: 'user-2', idempotencyKey: 'idem-key-00000002' }))).resolves.toEqual({ status: 'denied', reason: 'PRINCIPAL_MISMATCH' });
  });

  it('denies unknown capabilities and malformed idempotency keys', async () => {
    const gateway = new AuthorizationGateway(new CapabilityRegistry([capability]), new MemoryPolicyStore(policy()), () => 1_000);
    expect(await gateway.execute(action({ connectorId: 'unknown.connector' }))).toMatchObject({ status: 'denied', reason: 'UNKNOWN_CAPABILITY' });
    expect(await gateway.execute(action({ idempotencyKey: 'short' }))).toMatchObject({ status: 'denied', reason: 'INVALID_IDEMPOTENCY_KEY' });
  });

  it('denies unapproved, revoked, expired, ungranted, wrong-resource, malformed and duplicate calls', async () => {
    const run = async (snapshot: PolicySnapshot, request = action()) => new AuthorizationGateway(new CapabilityRegistry([capability]), new MemoryPolicyStore(snapshot), () => 2_001).execute(request);
    expect(await run(policy())).toMatchObject({ status: 'denied', reason: 'MANDATE_EXPIRED' });
    const nowRun = async (snapshot: PolicySnapshot, request = action()) => new AuthorizationGateway(new CapabilityRegistry([capability]), new MemoryPolicyStore(snapshot), () => 1_000).execute(request);
    expect(await nowRun(policy({ approvedPolicyHash: `0x${'0'.repeat(64)}` }))).toMatchObject({ status: 'denied', reason: 'UNAPPROVED_POLICY' });
    expect(await nowRun(policy({ approvedPolicyHash: `0x${'1'.repeat(64)}` }))).toMatchObject({ status: 'denied', reason: 'UNAPPROVED_POLICY' });
    expect(await nowRun(policy({ status: 'revoked' }))).toMatchObject({ status: 'denied', reason: 'MANDATE_INACTIVE' });
    expect(await nowRun(policy({ grants: [{ connectorId: 'test.records', actionId: 'records.read', resourceId: 'r-1', argumentEquals: {}, maxCalls: 1 }] }))).toMatchObject({ status: 'denied', reason: 'NO_GRANT' });
    expect(await nowRun(policy(), action({ arguments: { resourceId: 'r-2', value: 'ok' } }))).toMatchObject({ status: 'denied', reason: 'RESOURCE_MISMATCH' });
    expect(await nowRun(policy({ grants: [{ connectorId: 'test.records', actionId: 'records.update', resourceId: 'r-1', argumentEquals: { url: 'https://example.test' }, maxCalls: 1 }] }))).toMatchObject({ status: 'denied', reason: 'CONSTRAINT_MISMATCH' });
    expect(await nowRun(policy({ grants: [{ connectorId: 'test.records', actionId: 'records.update', resourceId: 'r-1', argumentEquals: { value: 'different' }, maxCalls: 1 }] }))).toMatchObject({ status: 'denied', reason: 'CONSTRAINT_MISMATCH' });
    expect(await nowRun(policy({ grants: [{ connectorId: 'test.records', actionId: 'records.update', resourceId: 'r-1', argumentEquals: { value: 'ok' }, maxCalls: 1 }] }))).toMatchObject({ status: 'allowed' });
    expect(await nowRun(policy(), action({ arguments: { resourceId: 'r-1', value: 'ok', extra: 'x' } }))).toMatchObject({ status: 'denied', reason: 'INVALID_ARGUMENTS' });
    const store = new MemoryPolicyStore(policy());
    const gateway = new AuthorizationGateway(new CapabilityRegistry([capability]), store, () => 1_000);
    expect((await gateway.execute(action())).status).toBe('allowed');
    expect(await gateway.execute(action({ idempotencyKey: 'idem-key-00000002' }))).toMatchObject({ status: 'denied', reason: 'CALL_LIMIT' });
    expect(await gateway.execute(action())).toMatchObject({ status: 'allowed', outcome: { status: 'ok', receipt: 'idem-key-00000001' } });
  });
});

describe('uncertain adapter results', () => {
  it('records an unknown outcome and does not repeat the side effect on duplicate execution', async () => {
    let calls = 0;
    const failingCapability = defineCapability({ ...capability, adapter: { execute: async () => { calls += 1; throw new Error('provider timed out'); } } });
    const store = new MemoryPolicyStore(policy());
    const gateway = new AuthorizationGateway(new CapabilityRegistry([failingCapability]), store, () => 1_000);
    const first = await gateway.execute(action());
    const retry = await gateway.execute(action());
    expect(first).toMatchObject({ status: 'allowed', outcome: { status: 'unknown' } });
    expect(retry).toEqual(first);
    expect(calls).toBe(1);
  });
});

describe('task event transitions', () => {
  const received: TaskRecord = { id: 'task-1', principalId: 'user-1', state: 'received', version: 0, lastEventId: 'event-0' };
  it('records versioned owner-scoped legal transitions and rejects invalid edges', () => {
    const result = transitionTask(received, 'user-1', 'clarification_required', 'event-1', 10, { question: 'Which record?' });
    expect(result).toMatchObject({ ok: true, record: { state: 'clarification_required', version: 1, lastEventId: 'event-1' }, event: { from: 'received', to: 'clarification_required', version: 1 } });
    expect(transitionTask(received, 'user-2', 'proposal_ready', 'event-2', 11)).toEqual({ ok: false, reason: 'NOT_OWNER' });
    expect(transitionTask(received, 'user-1', 'succeeded', 'event-3', 11)).toEqual({ ok: false, reason: 'ILLEGAL_TRANSITION' });
    expect(transitionTask(received, 'user-1', 'proposal_ready', 'event-4', 11, {}, 4)).toEqual({ ok: false, reason: 'VERSION_CONFLICT' });
  });
});
