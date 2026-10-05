import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { PolicyStore } from '@mandate/connectors';
import { createMandateMcpServer, mandateBelongsToPrincipal } from '../src/create-server.js';
import { MandateGateway } from '../src/gateway.js';

describe('OAuth wallet ownership', () => {
  it('requires an authenticated owner and only permits an unbound operator when explicitly enabled', () => {
    expect(mandateBelongsToPrincipal('0xAa00000000000000000000000000000000000001', '0xaa00000000000000000000000000000000000001')).toBe(true);
    expect(mandateBelongsToPrincipal('0xbb00000000000000000000000000000000000002', '0xaa00000000000000000000000000000000000001')).toBe(false);
    expect(mandateBelongsToPrincipal('0xbb00000000000000000000000000000000000002', undefined)).toBe(false);
    expect(mandateBelongsToPrincipal('0xbb00000000000000000000000000000000000002', undefined, true)).toBe(true);
  });
});

describe('MCP server provider configuration', () => {
  it('exposes no tools when authorization scopes are omitted', async () => {
    const server = createMandateMcpServer({
      GEMINI_API_KEY: 'test-backend-key',
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MONAD_CHAIN_ID: '10143',
      MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      MANDATE_AGENT_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'default-deny-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      await expect(client.listTools()).rejects.toMatchObject({ code: -32601 });
    } finally {
      await client.close();
      await server.close();
    }
  });

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

  it('uses only explicitly configured scopes rather than granting all scopes by default', async () => {
    const server = createMandateMcpServer({
      MCP_GRANTED_SCOPES: 'mandate:read mandate:transfer',
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
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(['get_mandate_status']);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('requires a durable policy store and authenticated principal before exposing OAuth transfer execution', async () => {
    const policyStore: PolicyStore = {
      get: async () => undefined,
      reserve: async () => 'conflict',
      complete: async () => undefined,
    };
    const server = createMandateMcpServer({
      MCP_GRANTED_SCOPES: 'mandate:transfer',
      MCP_PRINCIPAL_ADDRESS: '0x0000000000000000000000000000000000000001',
      MCP_CLIENT_ID: 'test-oauth-client',
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      MANDATE_AGENT_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    }, {
      policyStore,
      gateway: new MandateGateway({
        getMandate: async () => { throw new Error('not called during tool discovery'); },
        getNativeBalance: async () => 0n,
        executeTransfer: async () => ({ transactionHash: `0x${'0'.repeat(64)}` }),
      }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'durable-policy-tool-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['request_bounded_transfer']);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('keeps unbound mandate access disabled unless operator mode is explicitly enabled', async () => {
    const owner = '0x0000000000000000000000000000000000000001';
    const gateway = new MandateGateway({
      getMandate: async () => ({
        id: `0x${'a'.repeat(64)}`, principal: owner, agentSigner: owner, approvedRecipient: owner,
        perCallLimit: 1n, totalLimit: 1n, spent: 0n, deposited: 1n, expiresAt: 2_000_000_000,
        nextNonce: 0n, active: true,
      }),
      executeTransfer: async () => ({ transactionHash: `0x${'c'.repeat(64)}` }),
      getNativeBalance: async () => 0n,
    });
    const server = createMandateMcpServer({
      MCP_GRANTED_SCOPES: 'mandate:read',
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MANDATE_CONTRACT_ADDRESS: owner,
    }, { gateway });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'unbound-deny-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: 'get_mandate_status', arguments: { mandateId: `0x${'a'.repeat(64)}` } });
      expect(result.isError).toBe(true);
      expect(result.content).toMatchObject([{ text: 'Mandate not found or not owned by this wallet.' }]);
    } finally {
      await client.close();
      await server.close();
    }

    const operatorServer = createMandateMcpServer({
      MCP_GRANTED_SCOPES: 'mandate:read',
      MCP_ALLOW_UNBOUND_PRINCIPAL: 'true',
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MANDATE_CONTRACT_ADDRESS: owner,
    }, { gateway });
    const [operatorClientTransport, operatorServerTransport] = InMemoryTransport.createLinkedPair();
    const operatorClient = new Client({ name: 'explicit-operator-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await operatorServer.connect(operatorServerTransport);
      await operatorClient.connect(operatorClientTransport);
      const result = await operatorClient.callTool({ name: 'get_mandate_status', arguments: { mandateId: `0x${'a'.repeat(64)}` } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content.find((part) => part.type === 'text')?.text ?? '{}')).toMatchObject({ principal: owner });
    } finally {
      await operatorClient.close();
      await operatorServer.close();
    }
  });

  it('adds the review-only proposal tool when the Gemini backend key is configured', async () => {
    const server = createMandateMcpServer({ GEMINI_API_KEY: 'test-backend-key', MCP_GRANTED_SCOPES: 'mandate:propose' });
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
