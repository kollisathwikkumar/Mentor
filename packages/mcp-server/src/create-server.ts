import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatUnits } from 'viem';
import { createViemPort } from '@mandate/sdk';
import { AuthorizationGateway, CapabilityRegistry, defineCapability, type PolicyStore } from '@mandate/connectors';
import { IntentCompiler } from '@mandate/intent-compiler';
import { createGeminiAdapter } from '@mandate/model-adapter';
import { MandateGateway } from './gateway.js';
import { registerModelProposalTool } from './model-tool.js';

export type McpRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const hexId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);
const availableScopes = new Set(['mandate:read', 'mandate:balance', 'mandate:transfer', 'mandate:propose', 'mandate:policy']);
export interface McpServerDependencies {
  readonly gateway?: MandateGateway;
  readonly policyStore?: PolicyStore;
}

export function mandateBelongsToPrincipal(
  mandatePrincipal: string,
  principalAddress: string | undefined,
  allowUnboundPrincipal = false,
): boolean {
  if (principalAddress === undefined) return allowUnboundPrincipal;
  return mandatePrincipal.toLowerCase() === principalAddress.toLowerCase();
}

export function createMandateMcpServer(env: McpRuntimeEnvironment, dependencies: McpServerDependencies = {}): McpServer {
  const server = new McpServer({ name: 'mandate-gateway', version: '0.2.0' });
  const grantedScopes = new Set((env.MCP_GRANTED_SCOPES ?? '').split(/\s+/).filter((scope) => availableScopes.has(scope)));
  const allowUnboundPrincipal = env.MCP_ALLOW_UNBOUND_PRINCIPAL === 'true';

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
          if (!mandateBelongsToPrincipal(status.principal, env.MCP_PRINCIPAL_ADDRESS, allowUnboundPrincipal)) {
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
      if (allowUnboundPrincipal) {
        // Explicit operator-only compatibility path. OAuth callers use the persisted generic policy below.
        server.registerTool('request_bounded_transfer', {
          description: 'Operator-only direct request for one native MON transfer bounded by the onchain mandate.',
          inputSchema: { mandateId: hexId, amount },
          annotations: { readOnlyHint: false, destructiveHint: true },
        }, async ({ mandateId, amount: amountMon }) => {
          try {
            const status = await gateway.getStatus(mandateId);
            if (!mandateBelongsToPrincipal(status.principal, env.MCP_PRINCIPAL_ADDRESS, allowUnboundPrincipal)) {
              return { isError: true, content: [{ type: 'text', text: 'Mandate not found or not owned by this wallet.' }] };
            }
            const result = await gateway.requestTransfer({ mandateId, amount: amountMon });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          } catch {
            return { isError: true, content: [{ type: 'text', text: 'Transfer request failed before a verified execution receipt.' }] };
          }
        });
      } else if (dependencies.policyStore && typeof env.MCP_PRINCIPAL_ADDRESS === 'string' && /^0x[0-9a-fA-F]{40}$/.test(env.MCP_PRINCIPAL_ADDRESS) && typeof env.MCP_CLIENT_ID === 'string' && env.MCP_CLIENT_ID.length > 0) {
        const nativeTransfer = defineCapability({
          connectorId: 'monad.native', connectorVersion: '1.0.0', actionId: 'native.transfer',
          description: 'Transfer native MON to the recipient fixed in an existing Monad contract mandate.',
          effect: 'irreversible', risk: 'high',
          inputSchema: z.object({ resourceId: hexId, amountNanoMon: z.number().int().positive().safe() }).strict(),
          resourceField: 'resourceId', constraints: ['resourceId', 'amountNanoMon'],
          limits: { maxCalls: 10_000, supportsIdempotency: true, supportsVerification: true, supportsCancellation: false },
          adapter: { execute: async (input, context) => {
            const status = await gateway.getStatus(input.resourceId);
            if (status.principal.toLowerCase() !== context.principalId.toLowerCase()) {
              return { status: 'failed', message: 'Onchain mandate owner does not match the authenticated principal.' };
            }
            const amountWei = BigInt(input.amountNanoMon) * 1_000_000_000n;
            const result = await gateway.requestTransfer({ mandateId: input.resourceId, amount: formatUnits(amountWei, 18) });
            return result.status === 'submitted'
              ? { status: 'ok', receipt: result.transactionHash }
              : { status: 'failed', message: result.reason };
          } },
        });
        const authorizationGateway = new AuthorizationGateway(new CapabilityRegistry([nativeTransfer]), dependencies.policyStore);
        server.registerTool('request_bounded_transfer', {
          description: 'Execute a Monad transfer only when the authenticated owner has separately approved an active D1 policy for this exact onchain mandate, target, expiry, call count, per-call cap, and aggregate cap. Amount uses integer nanoMON (1 MON = 1,000,000,000 units). The contract remains the independent final check.',
          inputSchema: {
            policyId: z.string().min(1).max(128), mandateId: hexId,
            amountNanoMon: z.number().int().positive().safe(),
            idempotencyKey: z.string().regex(/^[a-zA-Z0-9:_-]{16,128}$/),
          },
          annotations: { readOnlyHint: false, destructiveHint: true },
        }, async ({ policyId, mandateId, amountNanoMon, idempotencyKey }) => {
          try {
            const result = await authorizationGateway.execute({
              principalId: env.MCP_PRINCIPAL_ADDRESS!, agentId: env.MCP_CLIENT_ID!, mandateId: policyId,
              connectorId: 'monad.native', actionId: 'native.transfer',
              arguments: { resourceId: mandateId, amountNanoMon }, idempotencyKey,
            });
            if (result.status === 'denied') return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
            if (result.outcome.status !== 'ok') return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: result.outcome.status, message: result.outcome.message }) }] };
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          } catch {
            return { isError: true, content: [{ type: 'text', text: 'Authorized transfer failed closed; query the policy audit record before retrying.' }] };
          }
        });
      }
    }
  }

  return server;
}
