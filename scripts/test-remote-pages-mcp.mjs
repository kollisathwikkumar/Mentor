import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, open, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const baseUrl = 'http://127.0.0.1:8788';
const endpoint = `${baseUrl}/mcp`;
const devVarsPath = new URL('../.dev.vars', import.meta.url);
const mandateId = '0x36a730095a8f287f71184280d67d91c37cc3dd9bc4eebb3cf90908da8067dd4e';
const required = ['MONAD_RPC_URL', 'MONAD_CHAIN_ID', 'MANDATE_CONTRACT_ADDRESS', 'MANDATE_AGENT_PRIVATE_KEY', 'NVIDIA_API_KEY', 'NVIDIA_MODEL'];

for (const key of required) assert.ok(process.env[key], `Missing required local variable: ${key}`);
let existed = true;
try { await readFile(devVarsPath); } catch { existed = false; }
assert.equal(existed, false, 'Refusing to overwrite existing .dev.vars. Move it aside and rerun the local integration test.');

const bearer = randomBytes(32).toString('hex');
const envKeys = [...required, 'NVIDIA_API_ENDPOINT', 'NVIDIA_REASONING_EFFORT'];
const vars = [`MCP_BEARER_TOKEN=${bearer}`, 'MCP_ALLOWED_ORIGINS=http://127.0.0.1:8788', ...envKeys.map((key) => `${key}=${process.env[key]}`)].join('\n') + '\n';
const handle = await open(devVarsPath, 'wx', 0o600);
await handle.writeFile(vars, 'utf8');
await handle.close();
await chmod(devVarsPath, 0o600);

let logs = '';
const server = spawn('npx', ['wrangler', 'pages', 'dev', 'apps/console/dist', '--ip', '127.0.0.1', '--port', '8788', '--log-level', 'error'], {
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
  const badOrigin = await fetch(endpoint, { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: '{}' });
  assert.equal(badOrigin.status, 403, 'Unapproved browser origin must be rejected.');
  const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:8788', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204, 'Allowed-origin CORS preflight must pass.');

  const client = new Client({ name: 'mandate-remote-mcp-local-check', version: '1.0.0' });
  clients.add(client);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
  await client.connect(transport);
  const toolList = await client.listTools();
  const toolNames = toolList.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ['get_mandate_status', 'propose_mandate', 'request_bounded_transfer']);

  const proposal = await client.callTool({ name: 'propose_mandate', arguments: { task: 'Create a review-only native MON permission for signer 0x1111111111111111111111111111111111111111 and recipient 0x2222222222222222222222222222222222222222. Maximum per transfer 0.25 MON, total maximum 1 MON, expiry 2030-01-01 00:00 UTC.' } });
  assert.equal(proposal.isError, undefined, 'Model outage should be represented as a safe clarification tool result, not an MCP protocol failure.');
  const proposalText = proposal.content.find((item) => item.type === 'text')?.text;
  assert.ok(proposalText, 'Model proposal tool must return JSON text.');
  const proposalResult = JSON.parse(proposalText);
  let inferenceResult = 'PASS: NVIDIA proposal validated as review-only.';
  if (proposalResult.status === 'ready_for_user_review') {
    assert.equal(proposalResult.preview.action, 'native_transfer');
    assert.equal(proposalResult.preview.perCallLimitWei, '250000000000000000');
    assert.equal(proposalResult.preview.totalLimitWei, '1000000000000000000');
    assert.equal(Object.hasOwn(proposalResult, 'transactionHash'), false, 'Proposal must not submit a chain transaction.');
  } else {
    assert.equal(proposalResult.status, 'needs_clarification');
    assert.deepEqual(proposalResult.missingFields, ['model_response'], 'Provider failures must not produce an unsafe proposal.');
    assert.match(proposalResult.question, /^The model provider (?:is unavailable \(HTTP \d{3}\)|request timed out|connection failed)\./);
    inferenceResult = `DEGRADED: MCP safely reported "${proposalResult.question}".`;
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

  console.log(`PASS: local Pages Function started; auth/CORS gates passed; authenticated Streamable HTTP initialized; all three tools listed; ${inferenceResult} live Monad status read; revoked mandate transfer denied without transaction.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => undefined);
  server.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(5000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await rm(devVarsPath, { force: true });
}
