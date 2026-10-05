import { z } from 'zod';
import {
  AuthorizationGateway,
  CapabilityRegistry,
  D1PolicyStore,
  canonicalPolicyHash,
  buildPolicyApprovalMessage,
  defineCapability,
  type ActionArguments,
  type MandatePolicy,
} from '../packages/connectors/src/index.js';
import type { D1DatabaseLike } from '../packages/connectors/src/d1-policy-store.js';

interface TestEnvironment { readonly MCP_ACTIVITY_DB: D1DatabaseLike; }
const schema = z.object({ resourceId: z.string().min(1), amount: z.number().int().nonnegative() }).strict();
const capability = defineCapability({
  connectorId: 'test.billing', connectorVersion: '1.0.0', actionId: 'invoice.pay', description: 'Test-only controlled side effect.',
  effect: 'write', risk: 'high', inputSchema: schema, resourceField: 'resourceId', constraints: ['resourceId', 'amount'],
  limits: { maxCalls: 100, supportsIdempotency: true, supportsVerification: true, supportsCancellation: false },
  adapter: { execute: async (_input: ActionArguments, context) => ({ status: 'ok', receipt: context.idempotencyKey }) },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request: Request, env: TestEnvironment): Promise<Response> {
    const store = new D1PolicyStore(env.MCP_ACTIVITY_DB);
    const registry = new CapabilityRegistry([capability]);
    const gateway = new AuthorizationGateway(registry, store, () => 1_800_000_000);
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/draft') {
        const policy = await request.json() as MandatePolicy;
        await store.createDraft(policy, 1_800_000_000);
        return json({ created: true });
      }
      if (request.method === 'POST' && url.pathname === '/approve') {
        const input = await request.json() as { mandateId: string; principalId: string; version: number; policyHash: string; expiresAt: number; signature: `0x${string}` };
        return json({ activated: await store.activateOwnerApprovedDraft({ ...input, origin: url.origin, now: 1_800_000_000 }) });
      }
      if (request.method === 'POST' && url.pathname === '/execute') {
        return json(await gateway.execute(await request.json() as Parameters<AuthorizationGateway['execute']>[0]));
      }
      if (request.method === 'POST' && url.pathname === '/task') {
        const input = await request.json() as { id: string; principalId: string; lastEventId: string; task: Readonly<Record<string, string | number | boolean>> };
        await store.createTask({ id: input.id, principalId: input.principalId, state: 'received', version: 0, lastEventId: input.lastEventId }, input.task, 1_800_000_000);
        return json({ created: true });
      }
      if (request.method === 'POST' && url.pathname === '/transition') {
        return json(await store.transitionTask(await request.json() as Parameters<D1PolicyStore['transitionTask']>[0]));
      }
      if (request.method === 'GET' && url.pathname === '/task') {
        return json(await store.getTask(url.searchParams.get('id') ?? '', url.searchParams.get('principal') ?? '') ?? null);
      }
      if (request.method === 'GET' && url.pathname === '/tasks') {
        const rawLimit = Number(url.searchParams.get('limit') ?? '20');
        const createdAt = url.searchParams.has('createdAt') ? Number(url.searchParams.get('createdAt')) : undefined;
        const id = url.searchParams.get('id') ?? undefined;
        return json(await store.listTasks(url.searchParams.get('principal') ?? '', rawLimit,
          createdAt === undefined || id === undefined ? undefined : { createdAt, id }));
      }
      if (request.method === 'GET' && url.pathname === '/audit') {
        const [events, decisions] = await Promise.all([
          env.MCP_ACTIVITY_DB.prepare('SELECT event_type, detail_json FROM mandate_audit_events WHERE mandate_id = ? ORDER BY occurred_at, event_id')
            .bind(url.searchParams.get('id') ?? '').all<{ readonly event_type: string; readonly detail_json: string }>(),
          env.MCP_ACTIVITY_DB.prepare('SELECT reason_code, request_hash FROM authorization_decisions WHERE mandate_id = ? ORDER BY occurred_at, decision_id')
            .bind(url.searchParams.get('id') ?? '').all<{ readonly reason_code: string; readonly request_hash: string }>(),
        ]);
        return json([
          ...events.results.map((event) => ({ type: event.event_type, detail: JSON.parse(event.detail_json) as unknown })),
          ...decisions.results.map((decision) => ({ type: 'action_denied', detail: { reason: decision.reason_code, requestHash: decision.request_hash } })),
        ]);
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  },
};

export { buildPolicyApprovalMessage, canonicalPolicyHash };
