import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMandateMcpServer } from '../src/create-server.js';

describe('MCP server provider configuration', () => {
  it('does not activate a model proposal tool from legacy NVIDIA environment values', async () => {
    const server = createMandateMcpServer({
      NVIDIA_API_KEY: 'legacy-test-key',
      NVIDIA_MODEL: 'legacy/test-model',
      NVIDIA_API_ENDPOINT: 'https://example.invalid/v1/chat/completions',
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
});
