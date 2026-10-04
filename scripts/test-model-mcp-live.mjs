import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('NVIDIA_')));
const transport = new StdioClientTransport({
  command: 'npm',
  args: ['--prefix', root, 'run', 'start', '--workspace', '@mandate/mcp-server'],
  env: inheritedEnv,
});
const client = new Client({ name: 'mandate-live-model-smoke', version: '0.1.0' }, { capabilities: {} });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['propose_mandate'], 'model-only configuration must not expose on-chain write tools');

  const task = 'Create a review-only native MON mandate for signer 0x1111111111111111111111111111111111111111 and recipient 0x2222222222222222222222222222222222222222. Maximum per transfer 0.25 MON, total maximum 1 MON, expiry 2030-01-01 00:00 UTC.';
  const response = await client.callTool({ name: 'propose_mandate', arguments: { task } });
  assert.equal(response.isError, undefined);
  const content = response.content.find((item) => item.type === 'text');
  assert.ok(content && content.type === 'text', 'proposal tool must return text JSON');
  const result = JSON.parse(content.text);
  assert.equal(result.status, 'ready_for_user_review');
  assert.equal(result.preview.action, 'native_transfer');
  assert.equal(result.preview.agentSigner.toLowerCase(), '0x1111111111111111111111111111111111111111');
  assert.equal(result.preview.recipient.toLowerCase(), '0x2222222222222222222222222222222222222222');
  assert.equal(result.preview.perCallLimitWei, '250000000000000000');
  assert.equal(result.preview.totalLimitWei, '1000000000000000000');
  assert.ok(result.preview.expiresAt > Math.floor(Date.now() / 1000));
  assert.equal(Object.hasOwn(result, 'transactionHash'), false);
  process.stdout.write(`Live MCP model test passed: ${process.env.NVIDIA_MODEL} returned a validated review-only preview; tools=${names.join(',')}; no chain-write tool exposed.\n`);
} finally {
  await client.close().catch(() => undefined);
}
