import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMandateMcpServer, mandateBelongsToPrincipal } from '../src/create-server.js';
import { MandateGateway } from '../src/gateway.js';

describe('OAuth wallet ownership', () => {
  it('restricts OAuth access to the connected wallet while preserving operator bearer behavior', () => {
    expect(mandateBelongsToPrincipal('0xAa00000000000000000000000000000000000001', '0xaa00000000000000000000000000000000000001')).toBe(true);
    expect(mandateBelongsToPrincipal('0xbb00000000000000000000000000000000000002', '0xaa00000000000000000000000000000000000001')).toBe(false);
    expect(mandateBelongsToPrincipal('0xbb00000000000000000000000000000000000002', undefined)).toBe(true);
  });
});

describe('MCP server provider configuration', () => {
  it('exposes a separately scoped balance reader bound to the OAuth principal', async () => {
    const owner = '0x0000000000000000000000000000000000000001';
    const gateway = new MandateGateway({
      getMandate: async () => { throw new Error('balance-only token must not look up mandates'); },
      executeTransfer: async () => ({ transactionHash: `0x${'c'.repeat(64)}` }),
      getNativeBalance: async (principal) => principal.toLowerCase() === owner.toLowerCase() ? 1_250_000_000_000_000_000n : 0n,
    });
    const server = createMandateMcpServer({
      MCP_GRANTED_SCOPES: 'mandate:balance', MCP_PRINCIPAL_ADDRESS: owner,
      MONAD_RPC_URL: 'https://rpc.example.invalid', MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000002',
    }, { gateway });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'owner-read-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(names).toEqual(['get_my_monad_balance']);
      const result = await client.callTool({ name: 'get_my_monad_balance', arguments: {} });
      const body = JSON.parse(result.content.find((part) => part.type === 'text')?.text ?? '{}');
      expect(body).toEqual({ address: owner, balanceWei: '1250000000000000000', balanceMon: '1.25' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not expose a proposal tool from leftover provider environment values', async () => {
    const server = createMandateMcpServer({
      MODEL_API_KEY: 'legacy-test-key',
      MODEL_NAME: 'legacy/test-model',
      MODEL_ENDPOINT: 'https://example.invalid/v1/chat/completions',
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MONAD_CHAIN_ID: '10143',
      MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      MANDATE_AGENT_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'provider-disabled-test', version: '1.0.0' }, { capabilities: {} });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
        'get_mandate_status',
        'request_bounded_transfer',
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('adds the review-only proposal tool when the Gemini backend key is configured', async () => {
    const server = createMandateMcpServer({ GEMINI_API_KEY: 'test-backend-key' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'deepseek-config-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['propose_mandate']);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
