import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { privateKeyToAccount } from 'viem/accounts';
import { buildWalletSignInMessage } from '../packages/mcp-server/dist/oauth.js';

const baseUrl = 'http://127.0.0.1:8788';
const endpoint = `${baseUrl}/mcp`;
const devVarsPath = new URL('../.dev.vars', import.meta.url);
const mandateId = '0x36a730095a8f287f71184280d67d91c37cc3dd9bc4eebb3cf90908da8067dd4e';
const required = ['MONAD_RPC_URL', 'MONAD_CHAIN_ID', 'MANDATE_CONTRACT_ADDRESS', 'MANDATE_AGENT_PRIVATE_KEY', 'GEMINI_API_KEY', 'GEMINI_MODEL'];

for (const key of required) assert.ok(process.env[key], `Missing required local variable: ${key}`);
let existed = true;
try { await readFile(devVarsPath); } catch { existed = false; }
assert.equal(existed, false, 'Refusing to overwrite existing .dev.vars. Move it aside and rerun the local integration test.');

const persistDir = await mkdtemp(join(tmpdir(), 'mandate-pages-mcp-test-'));
const migration = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'mandate-mcp-activity', '--local', '--persist-to', persistDir], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, CI: '1' },
  encoding: 'utf8',
});
if (migration.status !== 0) {
  await rm(persistDir, { recursive: true, force: true });
  throw new Error(`Local MCP activity migration failed: ${migration.stderr || migration.stdout}`);
}

const bearer = randomBytes(32).toString('hex');
const envKeys = required;
const vars = [`MCP_BEARER_TOKEN=${bearer}`, 'MCP_ALLOWED_ORIGINS=http://127.0.0.1:8788', ...envKeys.map((key) => `${key}=${process.env[key]}`)].join('\n') + '\n';
const handle = await open(devVarsPath, 'wx', 0o600);
await handle.writeFile(vars, 'utf8');
await handle.close();
await chmod(devVarsPath, 0o600);

let logs = '';
const server = spawn('npx', ['wrangler', 'pages', 'dev', 'apps/console/dist', '--ip', '127.0.0.1', '--port', '8788', '--persist-to', persistDir, '--log-level', 'error'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.setEncoding('utf8').on('data', (chunk) => { logs = (logs + chunk).slice(-6000); });
server.stderr.setEncoding('utf8').on('data', (chunk) => { logs = (logs + chunk).slice(-6000); });

const clients = new Set();
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Wrangler exited before readiness (${server.exitCode}). ${logs}`);
    try {
      const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
    await delay(500);
  }
  assert.ok(ready, `Pages local server did not become ready. ${logs}`);

  const unauthenticated = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauthenticated.status, 401, 'Unauthenticated MCP request must be rejected.');
  assert.match(unauthenticated.headers.get('www-authenticate') ?? '', /oauth-protected-resource/);
  const badOrigin = await fetch(endpoint, { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: '{}' });
  assert.equal(badOrigin.status, 403, 'Unapproved browser origin must be rejected.');
  const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:8788', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204, 'Allowed-origin CORS preflight must pass.');

  const statusResponse = await fetch(`${endpoint}/status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { ready: true, connected: false, activityTracking: true, activeWindowSeconds: 300 });

  const redirectUri = 'http://127.0.0.1/callback';
  const registrationResponse = await fetch(`${baseUrl}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'MCP OAuth integration test', redirect_uris: [redirectUri] }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'mandate:read mandate:policy mandate:transfer offline_access', state,
    resource: endpoint,
  }).toString();
  const authorizeResponse = await fetch(authorizeUrl);
  assert.equal(authorizeResponse.status, 200);
  const authorizeHtml = await authorizeResponse.text();
  const approvalFormStart = authorizeHtml.indexOf('<form id="wallet-approval"');
  const approvalFormEnd = authorizeHtml.indexOf('</form>', approvalFormStart);
  const checkedReadScope = authorizeHtml.indexOf('name="granted_scope" value="mandate:read" checked');
  assert.ok(approvalFormStart >= 0 && checkedReadScope > approvalFormStart && checkedReadScope < approvalFormEnd,
    'The checked OAuth permission must be inside the approval form so the consent buttons can submit it.');
  const passkeyBundleResponse = await fetch(`${baseUrl}/assets/oauth-approve.js`);
  assert.equal(passkeyBundleResponse.status, 200, 'OAuth consent must load its same-origin passkey/wallet bundle.');
  assert.match(passkeyBundleResponse.headers.get('content-type') ?? '', /javascript/);
  const requestId = authorizeHtml.match(/name="request_id" value="([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(requestId, 'OAuth authorize page should issue a short-lived request identifier.');
  assert.match(authorizeHtml, /Create a passkey/);
  assert.match(authorizeHtml, /Continue with my passkey/);
  assert.match(authorizeHtml, /Use an existing wallet instead/);
  assert.match(authorizeHtml, /Passkeys need an authenticator with WebAuthn PRF support/);
  assert.match(authorizeHtml, /Mandate workspace/);
  assert.match(authorizeHtml, /Create, inspect, approve, or revoke an offchain policy/);
  assert.match(authorizeHtml, /Only permissions requested by this client appear here/);
  assert.doesNotMatch(authorizeHtml, /Mandate access token/);
  const field = (name) => authorizeHtml.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  const walletNonce = field('wallet_nonce');
  const issuedAtMs = Number(field('issued_at_ms'));
  const expiresAtMs = Number(field('expires_at_ms'));
  assert.ok(walletNonce && Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs));
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const walletMessage = buildWalletSignInMessage({
    address: account.address,
    clientName: 'MCP OAuth integration test',
    expiresAtMs,
    issuedAtMs,
    origin: baseUrl,
    resource: endpoint,
    walletNonce,
  });
  const walletSignature = await account.signMessage({ message: walletMessage });
  const excessScopeResponse = await fetch(`${baseUrl}/oauth/authorize`, {
    method: 'POST', headers: { origin: 'https://claude.ai', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([['request_id', requestId], ['wallet_address', account.address], ['wallet_signature', walletSignature], ['granted_scope', 'mandate:balance']]), redirect: 'manual',
  });
  assert.equal(excessScopeResponse.status, 400, 'OAuth approval must reject any scope the client did not request.');
  const approvalResponse = await fetch(`${baseUrl}/oauth/authorize`, {
    method: 'POST', headers: { origin: 'https://claude.ai', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([['request_id', requestId], ['wallet_address', account.address], ['wallet_signature', walletSignature], ['granted_scope', 'mandate:read'], ['granted_scope', 'mandate:policy'], ['granted_scope', 'mandate:transfer']]), redirect: 'manual',
  });
  assert.equal(approvalResponse.status, 302, 'Wallet approval should redirect despite a client-origin header.');
  const callback = new URL(approvalResponse.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), state);
  const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registration.client_id,
      redirect_uri: redirectUri, code: callback.searchParams.get('code'), code_verifier: verifier, resource: endpoint }),
  });
  assert.equal(tokenResponse.status, 200, 'PKCE authorization code should exchange for tokens.');
  const oauthTokens = await tokenResponse.json();
  assert.equal(oauthTokens.scope, 'mandate:read mandate:policy mandate:transfer offline_access');
  const workspaceIdentity = await fetch(`${baseUrl}/api/session`, { headers: { authorization: `Bearer ${oauthTokens.access_token}` } });
  assert.equal(workspaceIdentity.status, 200);
  assert.deepEqual(await workspaceIdentity.json(), { principalId: account.address.toLowerCase(), clientId: registration.client_id, scopes: ['mandate:read', 'mandate:policy', 'mandate:transfer'] });

  const policyExpiry = Math.floor(Date.now() / 1000) + 3600;
  const policyDraftResponse = await fetch(`${baseUrl}/api/mandates`, {
    method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresAt: policyExpiry, grants: [{ connectorId: 'monad.native', actionId: 'native.transfer', resourceId: mandateId, argumentEquals: {}, maxCalls: 2, amountField: 'amountNanoMon', maxAmount: 25_000_000, maxTotalAmount: 50_000_000 }] }),
  });
  const policyDraftText = await policyDraftResponse.text();
  assert.equal(policyDraftResponse.status, 201, policyDraftText);
  const policyDraftPayload = JSON.parse(policyDraftText);
  assert.equal(policyDraftPayload.mandate.principalId.toLowerCase(), account.address.toLowerCase());
  assert.equal(policyDraftPayload.mandate.agentId, registration.client_id, 'The approved agent identity is derived from the registered OAuth client, never from request input.');
  assert.equal(policyDraftPayload.mandate.status, 'draft');
  const alteredSignature = await account.signMessage({ message: `${policyDraftPayload.approvalMessage}\nchanged` });
  const badPolicyApproval = await fetch(`${baseUrl}/api/mandates/${policyDraftPayload.mandate.id}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ signature: alteredSignature }),
  });
  assert.equal(badPolicyApproval.status, 403, 'Altered approval messages must not activate policies.');
  const policySignature = await account.signMessage({ message: policyDraftPayload.approvalMessage });
  const policyApproval = await fetch(`${baseUrl}/api/mandates/${policyDraftPayload.mandate.id}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ signature: policySignature }),
  });
  const policyApprovalText = await policyApproval.text();
  assert.equal(policyApproval.status, 200, policyApprovalText);
  const activePolicy = await fetch(`${baseUrl}/api/mandates/${policyDraftPayload.mandate.id}`, { headers: { authorization: `Bearer ${oauthTokens.access_token}` } });
  assert.equal((await activePolicy.json()).mandate.status, 'active');
  const taskCreate = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ summary: 'Prepare a verified plan for the integration test.' }),
  });
  const taskCreateText = await taskCreate.text();
  assert.equal(taskCreate.status, 201, taskCreateText);
  const task = JSON.parse(taskCreateText);
  const taskEvent = await fetch(`${baseUrl}/api/tasks/${task.id}/events`, {
    method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 0, to: 'proposal_ready', data: { result: 'review-only proposal persisted' } }),
  });
  const taskEventText = await taskEvent.text();
  assert.equal(taskEvent.status, 201, taskEventText);
  const staleTaskEvent = await fetch(`${baseUrl}/api/tasks/${task.id}/events`, {
    method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 0, to: 'clarification_required', data: {} }),
  });
  assert.equal(staleTaskEvent.status, 409, 'Stale task revisions must not overwrite the event log.');
  const taskDetail = await fetch(`${baseUrl}/api/tasks/${task.id}`, { headers: { authorization: `Bearer ${oauthTokens.access_token}` } });
  const taskDetailBody = await taskDetail.json();
  assert.equal(taskDetailBody.task.state, 'proposal_ready');
  assert.equal(taskDetailBody.events.length, 2, 'The task creation and proposal transition must both be durable events.');
  const secondTaskCreate = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ summary: 'A second persisted workspace task for pagination.' }),
  });
  assert.equal(secondTaskCreate.status, 201, await secondTaskCreate.text());
  const taskPageOneResponse = await fetch(`${baseUrl}/api/tasks?limit=1`, { headers: { authorization: `Bearer ${oauthTokens.access_token}` } });
  const taskPageOne = await taskPageOneResponse.json();
  assert.equal(taskPageOneResponse.status, 200);
  assert.equal(taskPageOne.tasks.length, 1);
  assert.ok(taskPageOne.nextCursor, 'Additional saved tasks must produce a pagination cursor.');
  const taskPageTwo = await fetch(`${baseUrl}/api/tasks?limit=1&cursor=${encodeURIComponent(taskPageOne.nextCursor)}`, { headers: { authorization: `Bearer ${oauthTokens.access_token}` } }).then((response) => response.json());
  assert.equal(taskPageTwo.tasks.length, 1);
  assert.notEqual(taskPageTwo.tasks[0].task.id, taskPageOne.tasks[0].task.id, 'Cursor pages must not repeat tasks.');
  assert.equal(taskPageTwo.nextCursor, null);
  assert.equal((await fetch(`${baseUrl}/api/tasks?limit=101`, { headers: { authorization: `Bearer ${oauthTokens.access_token}` } })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/tasks?cursor=bad%20cursor`, { headers: { authorization: `Bearer ${oauthTokens.access_token}` } })).status, 400);

  const client = new Client({ name: 'mandate-remote-mcp-local-check', version: '1.0.0' });
  clients.add(client);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
  await client.connect(transport);
  const toolList = await client.listTools();
  const toolNames = toolList.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ['get_mandate_status', 'propose_mandate', 'request_bounded_transfer']);

  let modelResult = 'provider call not requested';
  if (process.env.VERIFY_GEMINI_MODEL === '1') {
    const modelCall = await client.callTool({ name: 'propose_mandate', arguments: { task: 'Return a review-only native MON policy: signer 0x1111111111111111111111111111111111111111, recipient 0x2222222222222222222222222222222222222222, cap 0.01 MON, total 0.02 MON, expiry 2030-01-01 UTC.' } });
    assert.equal(modelCall.isError, undefined, 'Provider error should be converted into a safe clarification result.');
    const modelText = modelCall.content.find((item) => item.type === 'text')?.text;
    assert.ok(modelText);
    const parsedModel = JSON.parse(modelText);
    if (parsedModel.status === 'ready_for_user_review') {
      assert.equal(parsedModel.preview.perCallLimitWei, '10000000000000000');
      assert.equal(parsedModel.preview.totalLimitWei, '20000000000000000');
      modelResult = 'PASS: live model returned a schema-validated preview.';
    } else {
      assert.equal(parsedModel.status, 'needs_clarification');
      assert.equal(Object.hasOwn(parsedModel, 'preview'), false, 'Provider failures must not expose an unvalidated policy preview.');
      assert.match(parsedModel.question, /provider|model|retry|connection|policy fields/i);
      modelResult = 'GATED: live Gemini call returned a sanitized no-proposal response; no policy preview was exposed.';
    }
  }

  const status = await client.callTool({ name: 'get_mandate_status', arguments: { mandateId } });
  assert.equal(status.isError, undefined);
  const statusText = status.content.find((item) => item.type === 'text')?.text;
  assert.ok(statusText, 'Status tool must return a text result.');
  const parsedStatus = JSON.parse(statusText);
  assert.equal(parsedStatus.active, false, 'Test fixture should be revoked before attempting a request.');
  assert.equal(parsedStatus.deposited, '0', 'Test fixture should be drained before attempting a request.');

  const denied = await client.callTool({ name: 'request_bounded_transfer', arguments: { mandateId, amount: '0.001' } });
  assert.equal(denied.isError, undefined, 'Policy denial should be a valid tool result, not a transport error.');
  const denialText = denied.content.find((item) => item.type === 'text')?.text;
  assert.ok(denialText, 'Transfer request must return a structured denial result.');
  const denial = JSON.parse(denialText);
  assert.deepEqual(denial, { status: 'denied', reason: 'MANDATE_INACTIVE' }, 'Revoked authority must deny transfer without sending a transaction.');

  const oauthClient = new Client({ name: 'mandate-oauth-scope-check', version: '1.0.0' });
  clients.add(oauthClient);
  await oauthClient.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${oauthTokens.access_token}` } } }));
  const oauthToolNames = (await oauthClient.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(oauthToolNames, ['get_mandate_status', 'request_bounded_transfer'], 'Only user-approved read, policy, and bounded-transfer scopes may expose these tools.');
  const missingPolicyExecution = await oauthClient.callTool({ name: 'request_bounded_transfer', arguments: { policyId: 'missing-policy-000000000000000', mandateId, amountNanoMon: 1, idempotencyKey: 'missing-policy-execution-0001' } });
  assert.equal(missingPolicyExecution.isError, true, 'OAuth transfer must pass the persisted authorization gateway before chain execution.');
  assert.deepEqual(JSON.parse(missingPolicyExecution.content.find((item) => item.type === 'text')?.text ?? '{}'), { status: 'denied', reason: 'MANDATE_INACTIVE' });
  const guardedContractDenial = await oauthClient.callTool({ name: 'request_bounded_transfer', arguments: { policyId: policyDraftPayload.mandate.id, mandateId, amountNanoMon: 1, idempotencyKey: 'guarded-contract-check-0001' } });
  assert.equal(guardedContractDenial.isError, true, 'An owner-approved D1 policy still cannot bypass a revoked onchain mandate.');
  assert.deepEqual(JSON.parse(guardedContractDenial.content.find((item) => item.type === 'text')?.text ?? '{}'), { status: 'failed', message: 'Onchain mandate owner does not match the authenticated principal.' });
  const policyRevoke = await fetch(`${baseUrl}/api/mandates/${policyDraftPayload.mandate.id}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${oauthTokens.access_token}` } });
  assert.equal(policyRevoke.status, 200);
  const refreshed = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: registration.client_id, refresh_token: oauthTokens.refresh_token, resource: endpoint }),
  });
  assert.equal(refreshed.status, 200, 'Refresh token rotation should succeed.');
  const rotatedTokens = await refreshed.json();
  assert.equal(rotatedTokens.scope, 'mandate:read mandate:policy mandate:transfer offline_access');
  const replay = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: registration.client_id, refresh_token: oauthTokens.refresh_token, resource: endpoint }),
  });
  assert.equal(replay.status, 400, 'A rotated refresh token cannot be replayed.');

  console.log(`PASS: local Pages Function started; OAuth/PKCE consent passed; signed policy create/approve/revoke and persisted owner task/event CAS passed; policy bound to OAuth client ID; generic gateway denied a missing policy before chain RPC; valid policy reached adapter, then mismatched onchain owner was rejected before transaction; revoked Monad contract denial also passed; ${modelResult}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const safeProviderDiagnostics = logs.split('\n').filter((line) => line.includes('Gemini model transport failed') || line.includes('Gemini model provider returned HTTP'));
  console.error(`FAIL: ${message}${safeProviderDiagnostics.length > 0 ? `\n${safeProviderDiagnostics.join('\n')}` : ''}`);
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => undefined);
  server.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(5000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await rm(devVarsPath, { force: true });
  await rm(persistDir, { recursive: true, force: true });
}
