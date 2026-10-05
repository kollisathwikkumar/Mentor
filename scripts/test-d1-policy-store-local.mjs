import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildPolicyApprovalMessage, canonicalPolicyHash } from '../packages/connectors/dist/index.js';
import { privateKeyToAccount } from 'viem/accounts';

const root = new URL('../', import.meta.url);
const persistDir = await mkdtemp(join(tmpdir(), 'mandate-d1-policy-'));
const baseUrl = 'http://127.0.0.1:8794';
const logs = [];
const env = { ...process.env, CI: '1', NO_COLOR: '1' };
let server;

function run(args, options = {}) {
  const child = spawn('npx', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.setEncoding('utf8').on('data', (data) => logs.push(String(data)));
  child.stderr.setEncoding('utf8').on('data', (data) => logs.push(String(data)));
  return child;
}

try {
  const migration = run(['wrangler', 'd1', 'migrations', 'apply', 'mandate-mcp-activity-test', '--local', '--config', 'scripts/wrangler-d1-test.jsonc', '--persist-to', persistDir]);
  const migrationExit = await new Promise((resolve, reject) => { migration.once('error', reject); migration.once('exit', resolve); });
  assert.equal(migrationExit, 0, `D1 migration failed:\n${logs.join('')}`);

  server = run(['wrangler', 'dev', '--config', 'scripts/wrangler-d1-test.jsonc', '--ip', '127.0.0.1', '--port', '8794', '--persist-to', persistDir, '--log-level', 'error']);
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Test Worker exited (${server.exitCode}).\n${logs.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(700) });
      if (response.status === 404) { ready = true; break; }
    } catch { /* local Worker is starting */ }
    await delay(200);
  }
  assert.ok(ready, `Local D1 Worker did not become ready.\n${logs.join('')}`);

  const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const body = {
    schemaVersion: 1,
    id: 'mandate-d1-integration',
    principalId: owner.address,
    agentId: 'agent:integration-test',
    version: 1,
    expiresAt: 1_900_000_000,
    grants: [{ connectorId: 'test.billing', actionId: 'invoice.pay', resourceId: 'invoice:42', argumentEquals: {}, maxCalls: 10, amountField: 'amount', maxAmount: 30, maxTotalAmount: 50 }],
  };
  const policy = { ...body, status: 'draft', policyHash: canonicalPolicyHash(body) };
  const post = async (path, payload) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const draftResponse = await post('/draft', policy);
  assert.equal(draftResponse.status, 200, await draftResponse.text());
  const approvalMessage = buildPolicyApprovalMessage({ origin: baseUrl, principalId: policy.principalId, mandateId: policy.id, version: policy.version, policyHash: policy.policyHash, expiresAt: policy.expiresAt });
  const ownerSignature = await owner.signMessage({ message: approvalMessage });
  const invalidSignature = await post('/approve', { mandateId: policy.id, principalId: policy.principalId, version: 1, policyHash: policy.policyHash, expiresAt: policy.expiresAt, signature: `0x${'00'.repeat(65)}` });
  assert.deepEqual(await invalidSignature.json(), { activated: false }, 'A policy cannot be activated with an invalid owner signature.');
  const approvedResponse = await post('/approve', { mandateId: policy.id, principalId: policy.principalId, version: 1, policyHash: policy.policyHash, expiresAt: policy.expiresAt, signature: ownerSignature });
  assert.deepEqual(await approvedResponse.json(), { activated: true });
  const otherAgent = await post('/execute', { principalId: policy.principalId, agentId: 'agent:unapproved', mandateId: policy.id, connectorId: 'test.billing', actionId: 'invoice.pay', arguments: { resourceId: 'invoice:42', amount: 20 }, idempotencyKey: 'wrong-agent-action-000001' }).then((response) => response.json());
  assert.deepEqual(otherAgent, { status: 'denied', reason: 'AGENT_MISMATCH' }, 'A different OAuth agent must not consume this mandate.');

  const requests = Array.from({ length: 4 }, (_, index) => post('/execute', {
    principalId: policy.principalId, agentId: policy.agentId, mandateId: policy.id, connectorId: 'test.billing', actionId: 'invoice.pay',
    arguments: { resourceId: 'invoice:42', amount: 20 }, idempotencyKey: `integration-call-${String(index).padStart(12, '0')}`,
  }));
  const concurrent = await Promise.all(requests);
  const outcomes = await Promise.all(concurrent.map((response) => response.json()));
  assert.equal(outcomes.filter((value) => value.status === 'allowed').length, 2, JSON.stringify(outcomes));
  assert.equal(outcomes.filter((value) => value.status === 'denied').length, 2, JSON.stringify(outcomes));

  const firstCall = { principalId: policy.principalId, agentId: policy.agentId, mandateId: policy.id, connectorId: 'test.billing', actionId: 'invoice.pay', arguments: { resourceId: 'invoice:42', amount: 20 }, idempotencyKey: 'integration-call-000000000000' };
  const replay = await post('/execute', firstCall).then((response) => response.json());
  assert.deepEqual(replay, outcomes[0], 'Same request/idempotency key must return the original outcome.');
  const keyReuse = await post('/execute', { ...firstCall, arguments: { resourceId: 'invoice:42', amount: 25 } }).then((response) => response.json());
  assert.deepEqual(keyReuse, { status: 'denied', reason: 'RESERVATION_CONFLICT' }, 'A reused key with changed arguments must not replay an old approval/result.');

  const createTask = await post('/task', { id: 'task-d1-integration', principalId: policy.principalId, lastEventId: 'event-0', task: { summary: 'integration task' } });
  assert.equal(createTask.status, 200);
  const createTaskTwo = await post('/task', { id: 'task-d1-integration-2', principalId: policy.principalId, lastEventId: 'event-0-2', task: { summary: 'second task' } });
  assert.equal(createTaskTwo.status, 200);
  const transition = await post('/transition', { taskId: 'task-d1-integration', principalId: policy.principalId, expectedVersion: 0, to: 'proposal_ready', eventId: 'event-1', occurredAt: 1_800_000_001, data: { proposal: 'fixed test policy' } }).then((response) => response.json());
  assert.equal(transition.ok, true, JSON.stringify(transition));
  const staleTransition = await post('/transition', { taskId: 'task-d1-integration', principalId: policy.principalId, expectedVersion: 0, to: 'approval_pending', eventId: 'event-2', occurredAt: 1_800_000_002 }).then((response) => response.json());
  assert.deepEqual(staleTransition, { ok: false, reason: 'VERSION_CONFLICT' });
  const foreignTask = await fetch(`${baseUrl}/task?id=task-d1-integration&principal=0x2222222222222222222222222222222222222222`).then((response) => response.json());
  assert.equal(foreignTask, null, 'Task reads must be principal-scoped.');
  const firstTaskPage = await fetch(`${baseUrl}/tasks?principal=${encodeURIComponent(policy.principalId)}&limit=1`).then((response) => response.json());
  assert.equal(firstTaskPage.length, 1);
  assert.equal(firstTaskPage[0].task.id, 'task-d1-integration-2', 'Stable descending cursor order must return the newest ID first for equal timestamps.');
  const secondTaskPage = await fetch(`${baseUrl}/tasks?principal=${encodeURIComponent(policy.principalId)}&limit=1&createdAt=${firstTaskPage[0].createdAt}&id=${firstTaskPage[0].task.id}`).then((response) => response.json());
  assert.equal(secondTaskPage.length, 1);
  assert.equal(secondTaskPage[0].task.id, 'task-d1-integration', 'Cursor pagination must not skip equal-timestamp records.');
  const foreignTaskPage = await fetch(`${baseUrl}/tasks?principal=0x2222222222222222222222222222222222222222`).then((response) => response.json());
  assert.deepEqual(foreignTaskPage, [], 'Task listing must not leak another principal’s records.');

  const audit = await fetch(`${baseUrl}/audit?id=${encodeURIComponent(policy.id)}`).then((response) => response.json());
  assert.equal(audit.filter((item) => item.type === 'action_reserved').length, 2);
  assert.equal(audit.filter((item) => item.type === 'action_completed').length, 2);
  assert.ok(audit.some((item) => item.type === 'action_denied' && item.detail.reason === 'BUDGET_LIMIT'));
  assert.ok(audit.some((item) => item.type === 'action_denied' && item.detail.reason === 'RESERVATION_CONFLICT'));
  assert.ok(audit.some((item) => item.type === 'action_denied' && item.detail.reason === 'AGENT_MISMATCH'));
  console.log('PASS: local D1 persisted mandate and verified owner signature over exact hash/ID/version/origin/expiry; OAuth-agent binding denied a different agent; atomic concurrent aggregate budget allowed exactly 2/4 actions; replay reused prior result; idempotency-key argument substitution denied; per-action allow/deny/outcome audit persisted; task event CAS, owner-isolated task listing, stable cursor pagination, and tenant isolation passed.');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}\n${logs.join('')}`);
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await rm(persistDir, { recursive: true, force: true });
}
