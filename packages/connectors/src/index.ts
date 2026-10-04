import { z } from 'zod';
import { keccak256, stringToHex } from 'viem';

export type ActionArguments = Readonly<Record<string, string | number | boolean>>;
export type ActionEffect = 'read' | 'write' | 'irreversible';
export type RiskClass = 'low' | 'medium' | 'high' | 'critical';
export interface CapabilityLimits {
  readonly maxCalls: number;
  readonly supportsIdempotency: boolean;
  readonly supportsVerification: boolean;
  readonly supportsCancellation: boolean;
}
export interface ActionContext {
  readonly principalId: string;
  readonly mandateId: string;
  readonly policyVersion: number;
  readonly idempotencyKey: string;
}
export interface ActionOutcome {
  readonly status: 'ok' | 'failed' | 'unknown';
  readonly receipt?: string;
  readonly message?: string;
}
export interface ConnectorAdapter<Schema extends z.ZodType<ActionArguments>> {
  execute(input: z.output<Schema>, context: ActionContext): Promise<ActionOutcome>;
}
export interface CapabilityDefinition<Schema extends z.ZodType<ActionArguments>> {
  readonly connectorId: string;
  readonly connectorVersion: string;
  readonly actionId: string;
  readonly description: string;
  readonly effect: ActionEffect;
  readonly risk: RiskClass;
  readonly inputSchema: Schema;
  readonly resourceField: string;
  readonly constraints: readonly string[];
  readonly limits: CapabilityLimits;
  readonly adapter: ConnectorAdapter<Schema>;
}
export interface ResolvedCapability extends CapabilityManifestEntry {
  parseInput(input: ActionArguments): ActionArguments;
  execute(input: ActionArguments, context: ActionContext): Promise<ActionOutcome>;
}
export interface CapabilityManifestEntry {
  readonly connectorId: string;
  readonly connectorVersion: string;
  readonly actionId: string;
  readonly description: string;
  readonly effect: ActionEffect;
  readonly risk: RiskClass;
  readonly resourceField: string;
  readonly constraints: readonly string[];
  readonly limits: CapabilityLimits;
}

const capabilityBaseSchema = z.object({
  connectorId: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/),
  connectorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  actionId: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  description: z.string().min(1).max(300),
  effect: z.enum(['read', 'write', 'irreversible']),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  resourceField: z.string().min(1).max(64),
  constraints: z.array(z.string().min(1).max(64)).min(1).max(32),
  limits: z.object({
    maxCalls: z.number().int().min(1).max(10_000),
    supportsIdempotency: z.boolean(),
    supportsVerification: z.boolean(),
    supportsCancellation: z.boolean(),
  }).strict(),
}).strict();

export function defineCapability<Schema extends z.ZodType<ActionArguments>>(
  capability: CapabilityDefinition<Schema>,
): CapabilityDefinition<Schema> {
  capabilityBaseSchema.parse({
    connectorId: capability.connectorId,
    connectorVersion: capability.connectorVersion,
    actionId: capability.actionId,
    description: capability.description,
    effect: capability.effect,
    risk: capability.risk,
    resourceField: capability.resourceField,
    constraints: capability.constraints,
    limits: capability.limits,
  });
  if (!capability.constraints.includes(capability.resourceField)) {
    throw new TypeError('Resource field must be declared as an enforceable constraint');
  }
  return capability;
}

export class CapabilityRegistry {
  readonly #capabilities = new Map<string, ResolvedCapability>();

  constructor(capabilities: readonly CapabilityDefinition<z.ZodType<ActionArguments>>[]) {
    for (const capability of capabilities) {
      const key = this.#key(capability.connectorId, capability.actionId);
      if (this.#capabilities.has(key)) throw new TypeError(`Duplicate capability: ${key}`);
      this.#capabilities.set(key, {
        connectorId: capability.connectorId, connectorVersion: capability.connectorVersion, actionId: capability.actionId,
        description: capability.description, effect: capability.effect, risk: capability.risk,
        resourceField: capability.resourceField, constraints: capability.constraints, limits: capability.limits,
        parseInput: (input) => capability.inputSchema.parse(input),
        execute: (input, context) => capability.adapter.execute(capability.inputSchema.parse(input), context),
      });
    }
  }

  list(): readonly CapabilityManifestEntry[] {
    return [...this.#capabilities.values()].map(({ parseInput: _parseInput, execute: _execute, ...entry }) => entry);
  }

  resolve(connectorId: string, actionId: string): ResolvedCapability | undefined {
    return this.#capabilities.get(this.#key(connectorId, actionId));
  }

  #key(connectorId: string, actionId: string): string {
    return `${connectorId}:${actionId}`;
  }
}

export interface CapabilityGrant {
  readonly connectorId: string;
  readonly actionId: string;
  readonly resourceId: string;
  readonly argumentEquals: Readonly<Record<string, string | number | boolean>>;
  readonly maxCalls: number;
  readonly maxAmount?: number;
  readonly amountField?: string;
}
export interface MandatePolicy {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly principalId: string;
  readonly agentId: string;
  readonly version: number;
  readonly status: 'draft' | 'active' | 'revoked' | 'expired';
  readonly expiresAt: number;
  readonly policyHash: string;
  readonly approvedPolicyHash?: string;
  readonly grants: readonly CapabilityGrant[];
}
const capabilityGrantSchema = z.object({
  connectorId: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/),
  actionId: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  resourceId: z.string().min(1).max(512),
  argumentEquals: z.record(z.string().min(1).max(64), z.union([z.string().max(512), z.number().finite(), z.boolean()])),
  maxCalls: z.number().int().min(1).max(10_000),
  maxAmount: z.number().finite().nonnegative().optional(),
  amountField: z.string().min(1).max(64).optional(),
}).strict().refine((grant) => (grant.maxAmount === undefined) === (grant.amountField === undefined), 'maxAmount and amountField must be provided together');

export const mandatePolicySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(128),
  principalId: z.string().min(1).max(256),
  agentId: z.string().min(1).max(256),
  version: z.number().int().min(1),
  status: z.enum(['draft', 'active', 'revoked', 'expired']),
  expiresAt: z.number().int().positive().safe(),
  policyHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  approvedPolicyHash: z.string().regex(/^0x[0-9a-f]{64}$/).optional(),
  grants: z.array(capabilityGrantSchema).min(1).max(64),
}).strict();

export function canonicalPolicyHash(policy: Omit<MandatePolicy, 'policyHash' | 'approvedPolicyHash' | 'status'>): string {
  const grants = [...policy.grants]
    .map((grant) => ({
      connectorId: grant.connectorId,
      actionId: grant.actionId,
      resourceId: grant.resourceId,
      argumentEquals: Object.fromEntries(Object.entries(grant.argumentEquals).sort(([left], [right]) => left.localeCompare(right))),
      maxCalls: grant.maxCalls,
      ...(grant.maxAmount === undefined ? {} : { maxAmount: grant.maxAmount }),
      ...(grant.amountField === undefined ? {} : { amountField: grant.amountField }),
    }))
    .sort((left, right) => `${left.connectorId}:${left.actionId}:${left.resourceId}`.localeCompare(`${right.connectorId}:${right.actionId}:${right.resourceId}`));
  const canonical = JSON.stringify({
    schemaVersion: policy.schemaVersion,
    id: policy.id,
    principalId: policy.principalId,
    agentId: policy.agentId,
    version: policy.version,
    expiresAt: policy.expiresAt,
    grants,
  });
  return keccak256(stringToHex(canonical));
}

export interface PolicySnapshot {
  readonly mandate: MandatePolicy;
  readonly callsUsed: Readonly<Record<string, number>>;
  readonly idempotency: Readonly<Record<string, ActionOutcome>>;
}
export interface PolicyStore {
  get(mandateId: string): Promise<PolicySnapshot | undefined>;
  reserve(input: { readonly mandateId: string; readonly principalId: string; readonly expectedVersion: number; readonly now: number; readonly grantKey: string; readonly idempotencyKey: string; readonly maxCalls: number }): Promise<'reserved' | 'duplicate' | 'conflict' | 'limit' | ActionOutcome>;
  complete(mandateId: string, idempotencyKey: string, outcome: ActionOutcome): Promise<void>;
}
export interface ActionRequest {
  readonly principalId: string;
  readonly mandateId: string;
  readonly connectorId: string;
  readonly actionId: string;
  readonly arguments: ActionArguments;
  readonly idempotencyKey: string;
}
export type AuthorizationResult =
  | { readonly status: 'allowed'; readonly outcome: ActionOutcome }
  | { readonly status: 'denied'; readonly reason: 'INVALID_POLICY' | 'UNKNOWN_CAPABILITY' | 'INVALID_ARGUMENTS' | 'PRINCIPAL_MISMATCH' | 'MANDATE_INACTIVE' | 'MANDATE_EXPIRED' | 'UNAPPROVED_POLICY' | 'NO_GRANT' | 'RESOURCE_MISMATCH' | 'CONSTRAINT_MISMATCH' | 'CALL_LIMIT' | 'INVALID_IDEMPOTENCY_KEY' | 'RESERVATION_CONFLICT' };

export class AuthorizationGateway {
  readonly #registry: CapabilityRegistry;
  readonly #store: PolicyStore;
  readonly #now: () => number;

  constructor(registry: CapabilityRegistry, store: PolicyStore, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.#registry = registry;
    this.#store = store;
    this.#now = now;
  }

  async execute(request: ActionRequest): Promise<AuthorizationResult> {
    if (!/^[a-zA-Z0-9:_-]{16,128}$/.test(request.idempotencyKey)) return { status: 'denied', reason: 'INVALID_IDEMPOTENCY_KEY' };
    const capability = this.#registry.resolve(request.connectorId, request.actionId);
    if (!capability) return { status: 'denied', reason: 'UNKNOWN_CAPABILITY' };
    let parsed: ActionArguments;
    try { parsed = capability.parseInput(request.arguments); }
    catch { return { status: 'denied', reason: 'INVALID_ARGUMENTS' }; }

    const snapshot = await this.#store.get(request.mandateId);
    if (!snapshot) return { status: 'denied', reason: 'MANDATE_INACTIVE' };
    const checkedPolicy = mandatePolicySchema.safeParse(snapshot.mandate);
    if (!checkedPolicy.success) return { status: 'denied', reason: 'INVALID_POLICY' };
    const mandate = checkedPolicy.data;
    if (mandate.principalId !== request.principalId) return { status: 'denied', reason: 'PRINCIPAL_MISMATCH' };
    if (mandate.status !== 'active') return { status: 'denied', reason: 'MANDATE_INACTIVE' };
    if (this.#now() >= mandate.expiresAt) return { status: 'denied', reason: 'MANDATE_EXPIRED' };
    const { policyHash, approvedPolicyHash: _approved, status: _status, ...policyBody } = mandate;
    const canonicalHash = canonicalPolicyHash(policyBody);
    if (policyHash !== canonicalHash || mandate.approvedPolicyHash !== canonicalHash) return { status: 'denied', reason: 'UNAPPROVED_POLICY' };

    const grant = mandate.grants.find((item) => item.connectorId === request.connectorId && item.actionId === request.actionId);
    if (!grant) return { status: 'denied', reason: 'NO_GRANT' };
    if (parsed[capability.resourceField] !== grant.resourceId) return { status: 'denied', reason: 'RESOURCE_MISMATCH' };
    for (const [key, expected] of Object.entries(grant.argumentEquals)) {
      if (!capability.constraints.includes(key)) return { status: 'denied', reason: 'CONSTRAINT_MISMATCH' };
      if (parsed[key] !== expected) return { status: 'denied', reason: 'CONSTRAINT_MISMATCH' };
    }
    if (grant.amountField && grant.maxAmount !== undefined) {
      const amount = parsed[grant.amountField];
      const numericAmount = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : Number.NaN;
      if (!Number.isFinite(numericAmount) || numericAmount < 0 || numericAmount > grant.maxAmount) return { status: 'denied', reason: 'CONSTRAINT_MISMATCH' };
    }
    const grantKey = `${grant.connectorId}:${grant.actionId}`;
    const reservation = await this.#store.reserve({ mandateId: request.mandateId, principalId: request.principalId, expectedVersion: mandate.version, now: this.#now(), grantKey, idempotencyKey: request.idempotencyKey, maxCalls: Math.min(grant.maxCalls, capability.limits.maxCalls) });
    if (reservation === 'duplicate') {
      const latest = await this.#store.get(request.mandateId);
      const cached = latest?.idempotency[request.idempotencyKey];
      if (cached) return { status: 'allowed', outcome: cached };
      return { status: 'denied', reason: 'RESERVATION_CONFLICT' };
    }
    if (reservation === 'conflict') return { status: 'denied', reason: 'RESERVATION_CONFLICT' };
    if (reservation === 'limit') return { status: 'denied', reason: 'CALL_LIMIT' };
    if (typeof reservation === 'object') return { status: 'allowed', outcome: reservation };
    let outcome: ActionOutcome;
    try {
      outcome = await capability.execute(parsed, {
        principalId: request.principalId,
        mandateId: request.mandateId,
        policyVersion: mandate.version,
        idempotencyKey: request.idempotencyKey,
      });
    } catch {
      outcome = { status: 'unknown', message: 'External outcome requires reconciliation; automatic retry is blocked.' };
    }
    await this.#store.complete(request.mandateId, request.idempotencyKey, outcome);
    return { status: 'allowed', outcome };
  }
}

export type TaskState = 'received' | 'clarification_required' | 'proposal_ready' | 'approval_pending' | 'active' | 'action_allowed' | 'action_denied' | 'execution_started' | 'succeeded' | 'failed' | 'unknown_reconciliation' | 'cancelled' | 'revoked' | 'expired' | 'unsupported';
export interface TaskRecord {
  readonly id: string;
  readonly principalId: string;
  readonly state: TaskState;
  readonly version: number;
  readonly lastEventId: string;
}
export interface TaskEvent {
  readonly id: string;
  readonly taskId: string;
  readonly principalId: string;
  readonly from: TaskState;
  readonly to: TaskState;
  readonly version: number;
  readonly occurredAt: number;
  readonly data: Readonly<Record<string, string | number | boolean>>;
}
export type TaskTransitionResult =
  | { readonly ok: true; readonly record: TaskRecord; readonly event: TaskEvent }
  | { readonly ok: false; readonly reason: 'NOT_OWNER' | 'ILLEGAL_TRANSITION' | 'VERSION_CONFLICT' };

const taskTransitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  received: ['clarification_required', 'proposal_ready', 'unsupported', 'cancelled'],
  clarification_required: ['clarification_required', 'proposal_ready', 'unsupported', 'cancelled'],
  proposal_ready: ['approval_pending', 'clarification_required', 'unsupported', 'cancelled'],
  approval_pending: ['active', 'cancelled', 'expired'],
  active: ['action_allowed', 'action_denied', 'revoked', 'expired', 'cancelled'],
  action_allowed: ['execution_started', 'cancelled', 'revoked', 'expired'],
  action_denied: ['clarification_required', 'cancelled', 'revoked', 'expired'],
  execution_started: ['succeeded', 'failed', 'unknown_reconciliation', 'cancelled', 'revoked'],
  unknown_reconciliation: ['succeeded', 'failed', 'cancelled', 'revoked'],
  succeeded: [], failed: [], cancelled: [], revoked: [], expired: [], unsupported: [],
};

export function transitionTask(
  current: TaskRecord,
  actorPrincipalId: string,
  to: TaskState,
  eventId: string,
  occurredAt: number,
  data: Readonly<Record<string, string | number | boolean>> = {},
  expectedVersion: number = current.version,
): TaskTransitionResult {
  if (current.principalId !== actorPrincipalId) return { ok: false, reason: 'NOT_OWNER' };
  if (current.version !== expectedVersion) return { ok: false, reason: 'VERSION_CONFLICT' };
  if (!taskTransitions[current.state].includes(to)) return { ok: false, reason: 'ILLEGAL_TRANSITION' };
  const version = current.version + 1;
  const record: TaskRecord = { ...current, state: to, version, lastEventId: eventId };
  return { ok: true, record, event: { id: eventId, taskId: current.id, principalId: current.principalId, from: current.state, to, version, occurredAt, data } };
}
