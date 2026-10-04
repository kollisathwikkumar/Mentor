import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createViemPort } from '@mandate/sdk';
import { IntentCompiler } from '@mandate/intent-compiler';
import { createGeminiAdapter } from '@mandate/model-adapter';
import { MandateGateway } from './gateway.js';
import { registerModelProposalTool } from './model-tool.js';

export type McpRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const hexId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);
const availableScopes = new Set(['mandate:read', 'mandate:balance', 'mandate:transfer', 'mandate:propose']);
export interface McpServerDependencies {
  readonly gateway?: MandateGateway;
}

export function mandateBelongsToPrincipal(mandatePrincipal: string, principalAddress: string | undefined): boolean {
  return principalAddress === undefined || mandatePrincipal.toLowerCase() === principalAddress.toLowerCase();
}

export function createMandateMcpServer(env: McpRuntimeEnvironment, dependencies: McpServerDependencies = {}): McpServer {
  const server = new McpServer({ name: 'mandate-gateway', version: '0.2.0' });
  const grantedScopes = new Set((env.MCP_GRANTED_SCOPES ?? [...availableScopes].join(' ')).split(/\s+/).filter((scope) => availableScopes.has(scope)));

  if (grantedScopes.has('mandate:propose') && env.GEMINI_API_KEY !== undefined && env.GEMINI_API_KEY.length > 0) {
    registerModelProposalTool(server, new IntentCompiler(createGeminiAdapter(env)));
  }

  const chainConfigured = ['MONAD_RPC_URL', 'MANDATE_CONTRACT_ADDRESS']
    .every((name) => env[name] !== undefined && env[name] !== '');
  if (chainConfigured) {
    const gateway = dependencies.gateway ?? new MandateGateway(createViemPort(env));

    if (grantedScopes.has('mandate:read')) {
      server.registerTool('get_mandate_status', {
        description: 'Read current mandate limits and state from Monad. This tool has no side effects.',
        inputSchema: { mandateId: hexId },
        annotations: { readOnlyHint: true, destructiveHint: false },
      }, async ({ mandateId }) => {
        try {
          const status = await gateway.getStatus(mandateId);
          if (!mandateBelongsToPrincipal(status.principal, env.MCP_PRINCIPAL_ADDRESS)) {
            return { isError: true, content: [{ type: 'text', text: 'Mandate not found or not owned by this wallet.' }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify(status) }] };
        } catch {
          return { isError: true, content: [{ type: 'text', text: 'Mandate status lookup failed.' }] };
        }
      });

    }

    if (grantedScopes.has('mandate:balance') && typeof env.MCP_PRINCIPAL_ADDRESS === 'string' && /^0x[0-9a-fA-F]{40}$/.test(env.MCP_PRINCIPAL_ADDRESS)) {
      server.registerTool('get_my_monad_balance', {
        description: 'Read the native MON balance for the EVM account authenticated to this MCP session on Monad Testnet. It reads only this account, exposes no other address as an input, and never sends a transaction.',
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false },
      }, async () => {
        try {
          const balance = await gateway.getNativeBalance(env.MCP_PRINCIPAL_ADDRESS!);
          return { content: [{ type: 'text', text: JSON.stringify(balance) }] };
        } catch {
          return { isError: true, content: [{ type: 'text', text: 'Could not read the connected account’s Monad Testnet balance.' }] };
        }
      });
    }

    if (grantedScopes.has('mandate:transfer') && env.MANDATE_AGENT_PRIVATE_KEY !== undefined && env.MANDATE_AGENT_PRIVATE_KEY !== '') {
      server.registerTool('request_bounded_transfer', {
        description: 'Request one native MON transfer to the recipient fixed by the mandate. Recipient and signer are never caller inputs.',
        inputSchema: { mandateId: hexId, amount },
        annotations: { readOnlyHint: false, destructiveHint: true },
      }, async ({ mandateId, amount: amountMon }) => {
        try {
          const status = await gateway.getStatus(mandateId);
          if (!mandateBelongsToPrincipal(status.principal, env.MCP_PRINCIPAL_ADDRESS)) {
            return { isError: true, content: [{ type: 'text', text: 'Mandate not found or not owned by this wallet.' }] };
          }
          const result = await gateway.requestTransfer({ mandateId, amount: amountMon });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch {
          return { isError: true, content: [{ type: 'text', text: 'Transfer request failed before a verified execution receipt.' }] };
        }
      });
    }
  }

  return server;
}
