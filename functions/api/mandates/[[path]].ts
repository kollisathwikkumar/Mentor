import { recoverMessageAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { D1PolicyStore, buildPolicyApprovalMessage, canonicalPolicyHash, mandatePolicySchema, type D1DatabaseLike, type MandatePolicy } from '@mandate/connectors';
import { verifyOAuthAccessToken, type OAuthDatabase } from '@mandate/mcp-server/oauth';

interface MandateApiEnvironment {
  readonly MCP_ACTIVITY_DB?: OAuthDatabase & D1DatabaseLike;
  readonly MCP_ALLOWED_ORIGINS?: string;
}

interface PagesRequestContext { readonly request: Request; readonly env: MandateApiEnvironment; }
const MAX_BODY_BYTES = 16_384;
const grantSchema = mandatePolicySchema.shape.grants;
const draftSchema = z.object({
  expiresAt: z.number().int().positive().safe(),
  grants: grantSchema,
}).strict();
const approveSchema = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();
const supportedConnectorActions = new Set(['monad.native:native.transfer']);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new RangeError('Request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new RangeError('Request body is too large.');
  return JSON.parse(text) as unknown;
}

function bearer(request: Request): string | undefined {
  return request.headers.get('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
}

function originAllowed(request: Request, env: MandateApiEnvironment): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const allowed = new Set((env.MCP_ALLOWED_ORIGINS ?? 'https://mandate-console.pages.dev').split(',').map((item) => item.trim()).filter(Boolean));
  return allowed.has(origin);
}

function address(value: string): value is Address { return /^0x[0-9a-fA-F]{40}$/.test(value); }

export async function onRequest({ request, env }: PagesRequestContext): Promise<Response> {
  if (!originAllowed(request, env)) return response({ error: 'origin_not_allowed' }, 403);
  if (!['GET', 'POST'].includes(request.method)) return response({ error: 'method_not_allowed' }, 405);
  if (!env.MCP_ACTIVITY_DB) return response({ error: 'policy_storage_unavailable' }, 503);
  const accessToken = bearer(request);
  if (!accessToken) return response({ error: 'unauthorized' }, 401);
  const resource = `${new URL(request.url).origin}/mcp`;
  const verified = await verifyOAuthAccessToken(env.MCP_ACTIVITY_DB, accessToken, resource).catch(() => undefined);
  if (!verified || !verified.scopes.includes('mandate:policy') || !address(verified.principalAddress)) return response({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/mandates\/?/, '');
  const parts = rest ? rest.split('/').filter(Boolean) : [];
  const store = new D1PolicyStore(env.MCP_ACTIVITY_DB);
  const now = Math.floor(Date.now() / 1000);
  const principalId = verified.principalAddress;

  try {
    if (parts.length === 0 && request.method === 'POST') {
      const input = draftSchema.parse(await readJson(request));
      if (input.expiresAt <= now + 60 || input.expiresAt > now + 365 * 24 * 60 * 60) return response({ error: 'expiry_out_of_range' }, 400);
      if (input.grants.some((grant) => !supportedConnectorActions.has(`${grant.connectorId}:${grant.actionId}`)
        || !/^0x[0-9a-fA-F]{64}$/.test(grant.resourceId)
        || grant.amountField !== 'amountNanoMon'
        || grant.maxAmount === undefined
        || grant.maxTotalAmount === undefined)) return response({ error: 'unsupported_or_unbounded_capability' }, 400);
      const body = {
        schemaVersion: 1 as const,
        id: crypto.randomUUID(),
        principalId,
        agentId: verified.clientId,
        version: 1,
        expiresAt: input.expiresAt,
        grants: input.grants,
      };
      const draft: MandatePolicy = { ...body, status: 'draft', policyHash: canonicalPolicyHash(body) };
      await store.createDraft(draft, now);
      const approvalMessage = buildPolicyApprovalMessage({ origin: url.origin, principalId, mandateId: draft.id, version: draft.version, policyHash: draft.policyHash, expiresAt: draft.expiresAt });
      return response({ mandate: draft, approvalMessage }, 201);
    }

    if (parts.length === 1 && request.method === 'GET') {
      const snapshot = await store.get(parts[0]!);
      if (!snapshot || snapshot.mandate.principalId.toLowerCase() !== principalId.toLowerCase()) return response({ error: 'not_found' }, 404);
      return response(snapshot);
    }

    if (parts.length === 2 && parts[1] === 'approve' && request.method === 'POST') {
      const mandateId = parts[0]!;
      const snapshot = await store.get(mandateId);
      if (!snapshot || snapshot.mandate.principalId.toLowerCase() !== principalId.toLowerCase() || snapshot.mandate.status !== 'draft') return response({ error: 'not_found' }, 404);
      const { signature } = approveSchema.parse(await readJson(request));
      const message = buildPolicyApprovalMessage({ origin: url.origin, principalId, mandateId, version: snapshot.mandate.version, policyHash: snapshot.mandate.policyHash, expiresAt: snapshot.mandate.expiresAt });
      const recovered = await recoverMessageAddress({ message, signature: signature as Hex }).catch(() => undefined);
      if (!recovered || recovered.toLowerCase() !== principalId.toLowerCase()) return response({ error: 'invalid_owner_signature' }, 403);
      const activated = await store.activateOwnerApprovedDraft({ origin: url.origin, principalId, mandateId, version: snapshot.mandate.version, policyHash: snapshot.mandate.policyHash, expiresAt: snapshot.mandate.expiresAt, signature: signature as Hex, now });
      if (!activated) return response({ error: 'policy_changed_or_expired' }, 409);
      return response({ activated: true, mandateId, policyHash: snapshot.mandate.policyHash });
    }

    if (parts.length === 2 && parts[1] === 'revoke' && request.method === 'POST') {
      const revoked = await store.revoke(parts[0]!, principalId, now);
      return revoked ? response({ revoked: true, mandateId: parts[0] }) : response({ error: 'not_found_or_inactive' }, 404);
    }
    return response({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) return response({ error: 'invalid_request' }, 400);
    return response({ error: 'policy_operation_failed' }, 500);
  }
}
