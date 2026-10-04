import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createViemPort } from '@mandate/sdk';
import { MandateGateway } from './gateway.js';

export type McpRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const hexId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);

export function createMandateMcpServer(env: McpRuntimeEnvironment): McpServer {
  const server = new McpServer({ name: 'mandate-gateway', version: '0.2.0' });

  const chainConfigured = ['MONAD_RPC_URL', 'MANDATE_CONTRACT_ADDRESS', 'MANDATE_AGENT_PRIVATE_KEY']
    .every((name) => env[name] !== undefined && env[name] !== '');
  if (chainConfigured) {
    const gateway = new MandateGateway(createViemPort(env));

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

  return server;
}
