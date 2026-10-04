import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

assert.ok(process.env.GEMINI_API_KEY, 'Missing GEMINI_API_KEY in ignored .env.local');
assert.equal(process.env.GEMINI_MODEL ?? 'gemini-3.8-flash', 'gemini-3.8-flash', 'This integration test targets Gemini 3.8 Flash.');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['packages/mcp-server/dist/main.js'],
  cwd: process.cwd(),
  env: process.env,
});
const client = new Client({ name: 'mandate-gemini-live-check', version: '1.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);
  const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ['get_mandate_status', 'propose_mandate', 'request_bounded_transfer']);

  const result = await client.callTool({
    name: 'propose_mandate',
    arguments: {
      task: 'Return a review-only native MON transfer policy. agentSigner must be 0x1111111111111111111111111111111111111111. recipient must be 0x2222222222222222222222222222222222222222. Maximum per transfer is exactly 0.01 MON; total budget is exactly 0.02 MON. Expire at 2030-01-01 00:00 UTC. Return a policy preview only; do not execute anything.',
    },
  });
  assert.equal(result.isError, undefined, 'MCP proposal call should return a structured result.');
  const raw = result.content.find((item) => item.type === 'text')?.text;
  assert.ok(raw, 'MCP proposal tool returned no result text.');
  const proposal = JSON.parse(raw);
  assert.equal(proposal.status, 'ready_for_user_review', `Live model proposal was not ready (missing fields: ${(proposal.missingFields ?? []).join(', ') || 'none reported'}).`);
  assert.equal(proposal.preview?.action, 'native_transfer');
  assert.equal(proposal.preview?.agentSigner?.toLowerCase(), '0x1111111111111111111111111111111111111111');
  assert.equal(proposal.preview?.recipient?.toLowerCase(), '0x2222222222222222222222222222222222222222');
  assert.equal(proposal.preview?.perCallLimitWei, '10000000000000000');
  assert.equal(proposal.preview?.totalLimitWei, '20000000000000000');
  assert.equal(proposal.preview?.timezone, 'UTC');
  assert.equal(Object.hasOwn(proposal, 'transactionHash'), false, 'Model proposal must never submit a transaction.');
  process.stdout.write('PASS: Gemini 3.8 Flash reached through MCP stdio; exact bounded policy was schema-validated; tool remained review-only; no transaction was submitted.\n');
} finally {
  await client.close().catch(() => undefined);
}
