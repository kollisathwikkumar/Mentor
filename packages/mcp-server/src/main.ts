import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createViemPort } from '@mandate/sdk';
import { IntentCompiler } from '@mandate/intent-compiler';
import { createNvidiaAdapter } from '@mandate/model-adapter';
import { MandateGateway } from './gateway.js';
import { registerModelProposalTool } from './model-tool.js';

const hexId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);

async function main(): Promise<void> {
  const server = new McpServer({ name: 'mandate-gateway', version: '0.1.0' });

  if (process.env.NVIDIA_API_KEY !== undefined && process.env.NVIDIA_MODEL !== undefined) {
    registerModelProposalTool(server, new IntentCompiler(createNvidiaAdapter(process.env)));
  }

  const chainConfigured = ['MONAD_RPC_URL', 'MANDATE_CONTRACT_ADDRESS', 'MANDATE_AGENT_PRIVATE_KEY']
    .every((name) => process.env[name] !== undefined && process.env[name] !== '');
  if (chainConfigured) {
    const gateway = new MandateGateway(createViemPort(process.env));

    server.registerTool('get_mandate_status', {
      description: 'Read current mandate limits and state from Monad. This tool has no side effects.',
      inputSchema: { mandateId: hexId },
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async ({ mandateId }) => {
      try {
        const status = await gateway.getStatus(mandateId);
        return { content: [{ type: 'text', text: JSON.stringify(status) }] };
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Mandate status lookup failed.' }] };
      }
    });

    server.registerTool('request_bounded_transfer', {
      description: 'Request one native MON transfer to the recipient fixed by the mandate. Recipient and signer are never caller inputs.',
      inputSchema: { mandateId: hexId, amount },
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, async ({ mandateId, amount: amountMon }) => {
      try {
        const result = await gateway.requestTransfer({ mandateId, amount: amountMon });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Transfer request failed before a verified execution receipt.' }] };
      }
    });
  }

  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  process.stderr.write('Mandate MCP server failed to start. Check local configuration.\n');
  process.exitCode = 1;
});
