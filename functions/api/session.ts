import { verifyOAuthAccessToken, type OAuthDatabase } from '@mandate/mcp-server/oauth';

interface SessionEnvironment { readonly MCP_ACTIVITY_DB?: OAuthDatabase; }
interface PagesRequestContext { readonly request: Request; readonly env: SessionEnvironment; }

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}

export async function onRequest({ request, env }: PagesRequestContext): Promise<Response> {
  if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
  if (!env.MCP_ACTIVITY_DB) return response({ error: 'session_storage_unavailable' }, 503);
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token) return response({ error: 'unauthorized' }, 401);
  const resource = `${new URL(request.url).origin}/mcp`;
  const verified = await verifyOAuthAccessToken(env.MCP_ACTIVITY_DB, token, resource).catch(() => undefined);
  if (!verified || !verified.scopes.includes('mandate:policy')) return response({ error: 'forbidden' }, 403);
  return response({ principalId: verified.principalAddress, clientId: verified.clientId, scopes: verified.scopes });
}
