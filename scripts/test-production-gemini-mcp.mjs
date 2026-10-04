import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = process.env.VITE_MANDATE_MCP_URL ?? 'https://mandate-console.pages.dev/mcp';
const bearer = process.env.MANDATE_MCP_TOKEN;
assert.ok(bearer, 'Missing MANDATE_MCP_TOKEN in ignored .env.local');
const mandateId = '0x36a730095a8f287f71184280d67d91c37cc3dd9bc4eebb3cf90908da8067dd4e';
const client = new Client({ name: 'mandate-gemini-production-check', version: '1.0.0' }, { capabilities: {} });

try {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
  await client.connect(transport);
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['get_mandate_status', 'propose_mandate', 'request_bounded_transfer']);

  let modelCheck = 'PASS: Gemini returned a schema-validated proposal.';
  const proposalResult = await client.callTool({ name: 'propose_mandate', arguments: { task: 'Return a review-only native MON transfer policy with signer 0x1111111111111111111111111111111111111111, fixed recipient 0x2222222222222222222222222222222222222222, per-transfer cap 0.01 MON, total budget 0.02 MON, expiry 2030-01-01 00:00 UTC. Do not execute.' } });
  assert.equal(proposalResult.isError, undefined, 'Production proposal tool should return a structured result.');
  const proposalText = proposalResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(proposalText, 'Production proposal tool returned no text.');
  const proposal = JSON.parse(proposalText);
  if (proposal.status === 'ready_for_user_review') {
    assert.equal(proposal.preview?.perCallLimitWei, '10000000000000000');
    assert.equal(proposal.preview?.totalLimitWei, '20000000000000000');
    assert.equal(Object.hasOwn(proposal, 'transactionHash'), false);
  } else {
    assert.equal(proposal.status, 'needs_clarification');
    assert.equal(Object.hasOwn(proposal, 'preview'), false, 'Provider failure must not expose an unvalidated preview.');
    const question = typeof proposal.question === 'string' ? proposal.question.slice(0, 160) : 'no provider detail';
    modelCheck = `GATED: production Gemini proposal returned a safe no-proposal result (${question}).`;
  }

  const statusResult = await client.callTool({ name: 'get_mandate_status', arguments: { mandateId } });
  const statusText = statusResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(statusText);
  const status = JSON.parse(statusText);
  assert.equal(status.active, false);
  assert.equal(status.deposited, '0');

  const denialResult = await client.callTool({ name: 'request_bounded_transfer', arguments: { mandateId, amount: '0.001' } });
  const denialText = denialResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(denialText);
  assert.deepEqual(JSON.parse(denialText), { status: 'denied', reason: 'MANDATE_INACTIVE' });
  process.stdout.write(`PASS: production Pages MCP authenticated; ${modelCheck} mandate status read succeeded; inactive transfer denied; no transaction submitted.\n`);
  if (proposal.status !== 'ready_for_user_review') process.exitCode = 2;
} finally {
  await client.close().catch(() => undefined);
}
