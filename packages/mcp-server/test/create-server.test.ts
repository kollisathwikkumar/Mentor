import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMandateMcpServer, mandateBelongsToPrincipal } from '../src/create-server.js';

describe('OAuth wallet ownership', () => {
  it('restricts OAuth access to the connected wallet while preserving operator bearer behavior', () => {
    expect(mandateBelongsToPrincipal('0xAa00000000000000000000000000000000000001', '0xaa00000000000000000000000000000000000001')).toBe(true);
    expect(mandateBelongsToPrincipal('0xbb00000000000000000000000000000000000002', '0xaa00000000000000000000000000000000000001')).toBe(false);
    expect(mandateBelongsToPrincipal('0xbb00000000000000000000000000000000000002', undefined)).toBe(true);
  });
});

describe('MCP server provider configuration', () => {
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
