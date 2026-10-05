import { recoverMessageAddress, type Hex } from 'viem';
import {
  canonicalActionRequestHash,
  canonicalPolicyHash,
  mandatePolicySchema,
  transitionTask,
  type ActionOutcome,
  type ActionRequest,
  type AuthorizationDenialReason,
  type MandatePolicy,
  type PolicySnapshot,
  type PolicyStore,
  type TaskEvent,
  type TaskRecord,
  type TaskState,
} from './index.js';

interface D1Meta { readonly changes: number; }
interface D1Result<Row> { readonly results: readonly Row[]; readonly meta: D1Meta; }
interface D1Statement {
  bind(...values: readonly (string | number | null)[]): D1Statement;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<D1Result<Row>>;
  run(): Promise<D1Result<never>>;
}
export interface D1DatabaseLike {
  prepare(query: string): D1Statement;
  batch(statements: readonly D1Statement[]): Promise<readonly D1Result<never>[]>;
}

interface MandateRow {
  readonly policy_json: string;
}
interface UsageRow {
  readonly grant_key: string;
  readonly calls_reserved: number;
}
interface AttemptRow {
  readonly idempotency_key: string;
  readonly state: 'reserved' | 'ok' | 'failed' | 'unknown';
  readonly outcome_json: string | null;
}
interface GrantRow {
  readonly calls_reserved: number;
  readonly amount_reserved: number;
}
interface TaskRow extends TaskRecord { readonly task_json: string; }
export interface TaskListCursor { readonly createdAt: number; readonly id: string; }
export interface TaskListItem {
  readonly task: TaskRecord;
  readonly data: Readonly<Record<string, string | number | boolean>>;
  readonly createdAt: number;
  readonly updatedAt: number;
}
interface TaskEventRow {
  readonly id: string;
  readonly task_id: string;
  readonly principal_id: string;
  readonly from_state: TaskState;
  readonly to_state: TaskState;
  readonly version: number;
  readonly occurred_at: number;
  readonly data_json: string;
}

export interface DecisionAudit {
  readonly request: ActionRequest;
  readonly reason: AuthorizationDenialReason;
  readonly policyVersion?: number;
  readonly occurredAt: number;
}

export interface PolicyApprovalPayload {
  readonly origin: string;
  readonly principalId: string;
  readonly mandateId: string;
  readonly version: number;
  readonly policyHash: string;
  readonly expiresAt: number;
}

export function buildPolicyApprovalMessage(input: PolicyApprovalPayload): string {
  const origin = new URL(input.origin);
  if (origin.protocol !== 'https:' && origin.hostname !== 'localhost' && origin.hostname !== '127.0.0.1') {
    throw new TypeError('Policy approval origin must be HTTPS or loopback.');
  }
  return [
    'Mandate Offchain Policy Approval',
    `URI: ${origin.origin}`,
    'Version: 1',
    `Principal: ${input.principalId.toLowerCase()}`,
    `Mandate ID: ${input.mandateId}`,
    `Policy Version: ${input.version}`,
    `Policy Hash: ${input.policyHash}`,
    `Expires At: ${input.expiresAt}`,
    'Purpose: Activate the exact offchain action grants in this mandate.',
  ].join('\n');
}

/**
 * D1-backed production implementation. Every quota reservation is one D1 batch;
 * D1 documents batches as sequential transactional statements, so a partially
 * applied usage increment cannot be committed without its idempotency row.
 */
export class D1PolicyStore implements PolicyStore {
  readonly #db: D1DatabaseLike;
  readonly #id: () => string;

  constructor(db: D1DatabaseLike, id: () => string = () => crypto.randomUUID()) {
    this.#db = db;
    this.#id = id;
  }

  async createDraft(policy: MandatePolicy, now: number): Promise<void> {
    const parsed = mandatePolicySchema.parse(policy);
    if (parsed.status !== 'draft' || parsed.approvedPolicyHash !== undefined) throw new TypeError('Only unapproved draft mandates can be persisted as drafts.');
    const { policyHash, status: _status, approvedPolicyHash: _approved, ...body } = parsed;
    if (canonicalPolicyHash(body) !== policyHash) throw new TypeError('Policy hash does not match canonical policy content.');
    const statements = [
      this.#db.prepare(`INSERT INTO mandates (id, principal_id, agent_id, version, status, expires_at, policy_hash, approved_policy_hash, policy_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, ?)`)
        .bind(parsed.id, parsed.principalId, parsed.agentId, parsed.version, parsed.expiresAt, parsed.policyHash, JSON.stringify(parsed), now, now),
      ...parsed.grants.map((grant) => this.#db.prepare(`INSERT INTO mandate_grant_usage (mandate_id, grant_key, calls_reserved, amount_reserved)
        VALUES (?, ?, 0, 0)`).bind(parsed.id, `${grant.connectorId}:${grant.actionId}`)),
      this.#db.prepare(`INSERT INTO mandate_audit_events (event_id, mandate_id, principal_id, agent_id, policy_version, event_type, detail_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, 'draft_created', ?, ?)`)
        .bind(this.#id(), parsed.id, parsed.principalId, parsed.agentId, parsed.version, JSON.stringify({ policyHash: parsed.policyHash }), now),
    ];
    await this.#db.batch(statements);
  }

  /** Verifies the wallet signature itself before the compare-and-swap activation. */
  async activateOwnerApprovedDraft(input: PolicyApprovalPayload & { readonly signature: Hex; readonly now: number }): Promise<boolean> {
    const owner = await this.#db.prepare(`SELECT principal_id, version, policy_hash, expires_at FROM mandates
      WHERE id = ? AND principal_id = ? AND version = ? AND status = 'draft'`)
      .bind(input.mandateId, input.principalId, input.version)
      .first<{ readonly principal_id: string; readonly version: number; readonly policy_hash: string; readonly expires_at: number }>();
    if (!owner || owner.policy_hash !== input.policyHash || owner.expires_at !== input.expiresAt || input.now >= owner.expires_at) return false;
    let signer: string;
    try {
      signer = await recoverMessageAddress({ message: buildPolicyApprovalMessage(input), signature: input.signature });
    } catch { return false; }
    if (signer.toLowerCase() !== input.principalId.toLowerCase()) return false;
    const [update, event] = await this.#db.batch([
      this.#db.prepare(`UPDATE mandates SET status = 'active', approved_policy_hash = policy_hash,
          policy_json = json_set(policy_json, '$.status', 'active', '$.approvedPolicyHash', policy_hash), updated_at = ?
        WHERE id = ? AND principal_id = ? AND version = ? AND status = 'draft' AND policy_hash = ?`)
        .bind(input.now, input.mandateId, input.principalId, input.version, input.policyHash),
      this.#db.prepare(`INSERT INTO mandate_audit_events (event_id, mandate_id, principal_id, agent_id, policy_version, event_type, detail_json, occurred_at)
        SELECT ?, id, principal_id, agent_id, version, 'approved', ?, ? FROM mandates
        WHERE id = ? AND principal_id = ? AND version = ? AND status = 'active' AND policy_hash = ? AND changes() = 1`)
        .bind(this.#id(), JSON.stringify({ policyHash: input.policyHash }), input.now, input.mandateId, input.principalId, input.version, input.policyHash),
    ]);
    return update?.meta.changes === 1 && event?.meta.changes === 1;
  }

  async revoke(mandateId: string, principalId: string, now: number): Promise<boolean> {
    const [update, event] = await this.#db.batch([
      this.#db.prepare(`UPDATE mandates SET status = 'revoked', policy_json = json_set(policy_json, '$.status', 'revoked'), updated_at = ? WHERE id = ? AND principal_id = ? AND status = 'active'`)
        .bind(now, mandateId, principalId),
      this.#db.prepare(`INSERT INTO mandate_audit_events (event_id, mandate_id, principal_id, agent_id, policy_version, event_type, detail_json, occurred_at)
        SELECT ?, id, principal_id, agent_id, version, 'revoked', '{}', ? FROM mandates WHERE id = ? AND principal_id = ? AND status = 'revoked' AND changes() = 1`)
        .bind(this.#id(), now, mandateId, principalId),
    ]);
    return update?.meta.changes === 1 && event?.meta.changes === 1;
  }

  async get(mandateId: string): Promise<PolicySnapshot | undefined> {
    const row = await this.#db.prepare('SELECT policy_json FROM mandates WHERE id = ?').bind(mandateId).first<MandateRow>();
    if (!row) return undefined;
    const mandate = mandatePolicySchema.parse(JSON.parse(row.policy_json));
    const [usage, attempts] = await Promise.all([
      this.#db.prepare('SELECT grant_key, calls_reserved FROM mandate_grant_usage WHERE mandate_id = ?').bind(mandateId).all<UsageRow>(),
      this.#db.prepare(`SELECT idempotency_key, state, outcome_json FROM mandate_action_attempts
        WHERE mandate_id = ? AND state IN ('ok', 'failed', 'unknown')`).bind(mandateId).all<AttemptRow>(),
    ]);
    const callsUsed = Object.fromEntries(usage.results.map((item) => [item.grant_key, item.calls_reserved]));
    const idempotency: Record<string, ActionOutcome> = {};
    for (const attempt of attempts.results) {
      if (attempt.outcome_json) idempotency[attempt.idempotency_key] = JSON.parse(attempt.outcome_json) as ActionOutcome;
    }
    return { mandate, callsUsed, idempotency };
  }

  async reserve(input: Parameters<PolicyStore['reserve']>[0]): ReturnType<PolicyStore['reserve']> {
    if (input.amountUnits !== undefined && (!Number.isSafeInteger(input.amountUnits) || input.amountUnits < 0)) return 'conflict';
    if (input.maxTotalAmount !== undefined && (!Number.isSafeInteger(input.maxTotalAmount) || input.maxTotalAmount < 1)) return 'conflict';
    const [usage, inserted, audit] = await this.#db.batch([
      this.#db.prepare(`UPDATE mandate_grant_usage SET calls_reserved = calls_reserved + 1,
          amount_reserved = amount_reserved + ?
        WHERE mandate_id = ? AND grant_key = ? AND calls_reserved < ?
          AND (? IS NULL OR (? IS NOT NULL AND amount_reserved + ? <= ?))
          AND EXISTS (SELECT 1 FROM mandates WHERE id = ? AND principal_id = ? AND agent_id = ? AND version = ? AND status = 'active' AND expires_at > ? AND policy_hash = approved_policy_hash)
          AND NOT EXISTS (SELECT 1 FROM mandate_action_attempts WHERE mandate_id = ? AND idempotency_key = ?)`)
        .bind(input.amountUnits ?? 0, input.mandateId, input.grantKey, input.maxCalls,
          input.maxTotalAmount ?? null, input.amountUnits ?? null, input.amountUnits ?? null, input.maxTotalAmount ?? null,
          input.mandateId, input.principalId, input.agentId, input.expectedVersion, input.now, input.mandateId, input.idempotencyKey),
      this.#db.prepare(`INSERT INTO mandate_action_attempts (mandate_id, idempotency_key, principal_id, agent_id, policy_version, grant_key, request_hash, state, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, 'reserved', ? WHERE changes() = 1`)
        .bind(input.mandateId, input.idempotencyKey, input.principalId, input.agentId, input.expectedVersion, input.grantKey, input.requestHash, input.now),
      this.#db.prepare(`INSERT INTO mandate_audit_events (event_id, mandate_id, principal_id, agent_id, policy_version, event_type, idempotency_key, detail_json, occurred_at)
        SELECT ?, ?, ?, ?, ?, 'action_reserved', ?, ?, ? WHERE changes() = 1`)
        .bind(this.#id(), input.mandateId, input.principalId, input.agentId, input.expectedVersion, input.idempotencyKey,
          JSON.stringify({ grantKey: input.grantKey, requestHash: input.requestHash }), input.now),
    ]);
    if (usage?.meta.changes === 1 && inserted?.meta.changes === 1 && audit?.meta.changes === 1) {
      return 'reserved';
    }
    const existing = await this.#db.prepare(`SELECT principal_id, agent_id, policy_version, grant_key, request_hash, state, outcome_json
      FROM mandate_action_attempts WHERE mandate_id = ? AND idempotency_key = ?`).bind(input.mandateId, input.idempotencyKey)
      .first<AttemptRow & { readonly principal_id: string; readonly agent_id: string; readonly policy_version: number; readonly grant_key: string; readonly request_hash: string }>();
    if (existing) {
      if (existing.principal_id !== input.principalId || existing.agent_id !== input.agentId || existing.policy_version !== input.expectedVersion || existing.grant_key !== input.grantKey || existing.request_hash !== input.requestHash) return 'conflict';
      if (existing.outcome_json) return JSON.parse(existing.outcome_json) as ActionOutcome;
      return 'duplicate';
    }
    const policy = await this.#db.prepare(`SELECT 1 AS active FROM mandates WHERE id = ? AND principal_id = ? AND agent_id = ? AND version = ? AND status = 'active' AND expires_at > ? AND policy_hash = approved_policy_hash`)
      .bind(input.mandateId, input.principalId, input.agentId, input.expectedVersion, input.now).first<{ readonly active: number }>();
    if (!policy) return 'conflict';
    const grant = await this.#db.prepare('SELECT calls_reserved, amount_reserved FROM mandate_grant_usage WHERE mandate_id = ? AND grant_key = ?')
      .bind(input.mandateId, input.grantKey).first<GrantRow>();
    if (!grant || grant.calls_reserved >= input.maxCalls) return 'limit';
    if (input.maxTotalAmount !== undefined && input.amountUnits !== undefined && grant.amount_reserved + input.amountUnits > input.maxTotalAmount) return 'budget';
    return 'conflict';
  }

  async complete(mandateId: string, idempotencyKey: string, outcome: ActionOutcome): Promise<void> {
    const encoded = JSON.stringify(outcome);
    const row = await this.#db.prepare(`SELECT principal_id, agent_id, policy_version FROM mandate_action_attempts WHERE mandate_id = ? AND idempotency_key = ? AND state = 'reserved'`)
      .bind(mandateId, idempotencyKey).first<{ readonly principal_id: string; readonly agent_id: string; readonly policy_version: number }>();
    if (!row) {
      const existing = await this.#db.prepare(`SELECT outcome_json FROM mandate_action_attempts WHERE mandate_id = ? AND idempotency_key = ?`)
        .bind(mandateId, idempotencyKey).first<{ readonly outcome_json: string | null }>();
      if (existing?.outcome_json === encoded) return;
      throw new Error('Action reservation is missing or already completed with a different outcome.');
    }
    const [updated, event] = await this.#db.batch([
      this.#db.prepare(`UPDATE mandate_action_attempts SET state = ?, outcome_json = ?, completed_at = ?
        WHERE mandate_id = ? AND idempotency_key = ? AND state = 'reserved'`)
        .bind(outcome.status, encoded, Math.floor(Date.now() / 1000), mandateId, idempotencyKey),
      this.#db.prepare(`INSERT INTO mandate_audit_events (event_id, mandate_id, principal_id, agent_id, policy_version, event_type, idempotency_key, detail_json, occurred_at)
        SELECT ?, ?, ?, ?, ?, 'action_completed', ?, ?, ? WHERE changes() = 1`)
        .bind(this.#id(), mandateId, row.principal_id, row.agent_id, row.policy_version, idempotencyKey, encoded, Math.floor(Date.now() / 1000)),
    ]);
    if (updated?.meta.changes !== 1 || event?.meta.changes !== 1) throw new Error('Action completion was not atomically recorded.');
  }

  async recordDenial(input: DecisionAudit): Promise<void> {
    const { request } = input;
    await this.#db.prepare(`INSERT INTO authorization_decisions
      (decision_id, mandate_id, principal_id, agent_id, policy_version, decision, reason_code, connector_id, action_id, idempotency_key, request_hash, occurred_at)
      VALUES (?, ?, ?, ?, ?, 'deny', ?, ?, ?, ?, ?, ?)`)
      .bind(this.#id(), request.mandateId, request.principalId, request.agentId, input.policyVersion ?? 0, input.reason, request.connectorId,
        request.actionId, request.idempotencyKey || null, canonicalActionRequestHash(request), input.occurredAt).run();
  }

  async createTask(record: TaskRecord, taskData: Readonly<Record<string, string | number | boolean>>, now: number): Promise<void> {
    await this.#db.batch([
      this.#db.prepare(`INSERT INTO mandate_tasks (id, principal_id, state, version, last_event_id, task_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(record.id, record.principalId, record.state, record.version, record.lastEventId, JSON.stringify(taskData), now, now),
      this.#db.prepare(`INSERT INTO mandate_task_events (id, task_id, principal_id, from_state, to_state, version, occurred_at, data_json)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(record.lastEventId, record.id, record.principalId, record.state, record.state, record.version, now, JSON.stringify(taskData)),
    ]);
  }

  async getTask(taskId: string, principalId: string): Promise<TaskRecord | undefined> {
    const row = await this.#db.prepare('SELECT id, principal_id, state, version, last_event_id FROM mandate_tasks WHERE id = ? AND principal_id = ?')
      .bind(taskId, principalId).first<{ readonly id: string; readonly principal_id: string; readonly state: TaskState; readonly version: number; readonly last_event_id: string }>();
    return row ? { id: row.id, principalId: row.principal_id, state: row.state, version: row.version, lastEventId: row.last_event_id } : undefined;
  }

  async getTaskData(taskId: string, principalId: string): Promise<Readonly<Record<string, string | number | boolean>> | undefined> {
    const row = await this.#db.prepare('SELECT task_json FROM mandate_tasks WHERE id = ? AND principal_id = ?').bind(taskId, principalId).first<{ readonly task_json: string }>();
    return row ? JSON.parse(row.task_json) as Readonly<Record<string, string | number | boolean>> : undefined;
  }

  async listTasks(principalId: string, limit = 20, cursor?: TaskListCursor): Promise<readonly TaskListItem[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await this.#db.prepare(`SELECT id, principal_id, state, version, last_event_id, task_json, created_at, updated_at
      FROM mandate_tasks WHERE principal_id = ?
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(principalId, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.id ?? '', boundedLimit)
      .all<{ readonly id: string; readonly principal_id: string; readonly state: TaskState; readonly version: number; readonly last_event_id: string;
        readonly task_json: string; readonly created_at: number; readonly updated_at: number }>();
    return rows.results.map((row) => ({
      task: { id: row.id, principalId: row.principal_id, state: row.state, version: row.version, lastEventId: row.last_event_id },
      data: JSON.parse(row.task_json) as Readonly<Record<string, string | number | boolean>>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async listTaskEvents(taskId: string, principalId: string, limit = 100): Promise<readonly TaskEvent[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await this.#db.prepare(`SELECT e.id, e.task_id, e.principal_id, e.from_state, e.to_state, e.version, e.occurred_at, e.data_json
      FROM mandate_task_events e JOIN mandate_tasks t ON t.id = e.task_id
      WHERE e.task_id = ? AND t.principal_id = ? ORDER BY e.version LIMIT ?`)
      .bind(taskId, principalId, boundedLimit).all<TaskEventRow>();
    return result.results.map((row) => ({ id: row.id, taskId: row.task_id, principalId: row.principal_id, from: row.from_state,
      to: row.to_state, version: row.version, occurredAt: row.occurred_at,
      data: JSON.parse(row.data_json) as Readonly<Record<string, string | number | boolean>> }));
  }

  async transitionTask(input: { readonly taskId: string; readonly principalId: string; readonly expectedVersion: number; readonly to: TaskState; readonly eventId: string; readonly occurredAt: number; readonly data?: Readonly<Record<string, string | number | boolean>> }): Promise<{ readonly ok: true; readonly record: TaskRecord; readonly event: TaskEvent } | { readonly ok: false; readonly reason: 'NOT_OWNER' | 'ILLEGAL_TRANSITION' | 'VERSION_CONFLICT' }> {
    const current = await this.getTask(input.taskId, input.principalId);
    if (!current) {
      const exists = await this.#db.prepare('SELECT 1 AS present FROM mandate_tasks WHERE id = ?').bind(input.taskId).first<{ readonly present: number }>();
      return { ok: false, reason: exists ? 'NOT_OWNER' : 'VERSION_CONFLICT' };
    }
    const transition = transitionTask(current, input.principalId, input.to, input.eventId, input.occurredAt, input.data, input.expectedVersion);
    if (!transition.ok) return transition;
    const [updated, event] = await this.#db.batch([
      this.#db.prepare(`UPDATE mandate_tasks SET state = ?, version = ?, last_event_id = ?, updated_at = ? WHERE id = ? AND principal_id = ? AND version = ?`)
        .bind(transition.record.state, transition.record.version, transition.record.lastEventId, input.occurredAt, input.taskId, input.principalId, input.expectedVersion),
      this.#db.prepare(`INSERT INTO mandate_task_events (id, task_id, principal_id, from_state, to_state, version, occurred_at, data_json)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(transition.event.id, transition.event.taskId, transition.event.principalId, transition.event.from, transition.event.to,
          transition.event.version, transition.event.occurredAt, JSON.stringify(transition.event.data)),
    ]);
    if (updated?.meta.changes !== 1 || event?.meta.changes !== 1) return { ok: false, reason: 'VERSION_CONFLICT' };
    return transition;
  }
}
