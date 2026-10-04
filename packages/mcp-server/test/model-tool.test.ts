import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { registerModelProposalTool } from '../src/model-tool.js';

describe('model proposal MCP tool', () => {
  it('exposes the validated preview as read-only MCP output', async () => {
    const compiler = {
      propose: vi.fn(async () => ({
        status: 'ready_for_user_review' as const,
        preview: {
          version: 1 as const,
          action: 'native_transfer' as const,
          asset: 'MON' as const,
          agentSigner: '0x1111111111111111111111111111111111111111',
          recipient: '0x2222222222222222222222222222222222222222',
          perCallLimitWei: '250000000000000000',
          totalLimitWei: '1000000000000000000',
          expiresAt: 2_208_988_800,
          timezone: 'UTC',
          policyHash: `0x${'a'.repeat(64)}`,
        },
      })),
    };
    const server = new McpServer({ name: 'test-mandate', version: '0.0.1' });
    registerModelProposalTool(server, compiler);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(1);
      expect(listed.tools[0]).toMatchObject({ name: 'propose_mandate', annotations: { readOnlyHint: true, destructiveHint: false } });

      const result = await client.callTool({ name: 'propose_mandate', arguments: { task: 'Allow 0.25 MON transfers to the fixed recipient' } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content[0]!.text)).toMatchObject({ status: 'ready_for_user_review', preview: { action: 'native_transfer' } });
      expect(compiler.propose).toHaveBeenCalledWith('Allow 0.25 MON transfers to the fixed recipient');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
