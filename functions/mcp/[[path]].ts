import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMandateMcpServer } from '@mandate/mcp-server/server';
import { D1PolicyStore, type D1DatabaseLike } from '@mandate/connectors';
import { SUPPORTED_MCP_SCOPES, verifyOAuthAccessToken, type OAuthDatabase } from '@mandate/mcp-server/oauth';
import { readMcpConnectionStatus, recordAuthenticatedMcpRequest, type McpActivityDatabase } from '@mandate/mcp-server/connection-status';

interface RemoteMcpEnvironment {
  readonly MCP_BEARER_TOKEN?: string;
  readonly MCP_ALLOWED_ORIGINS?: string;
  readonly GEMINI_API_KEY?: string;
  readonly MCP_ACTIVITY_DB?: OAuthDatabase & McpActivityDatabase;
}

interface PagesRequestContext {
  readonly request: Request;
  readonly env: RemoteMcpEnvironment;
}

const defaultAllowedOrigin = 'https://mandate-console.pages.dev';
const allowedMethods = 'GET, POST, DELETE, OPTIONS';
const allowedHeaders = 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID';
const exposedHeaders = 'Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID';

function origins(env: RemoteMcpEnvironment): ReadonlySet<string> {
  return new Set((env.MCP_ALLOWED_ORIGINS ?? defaultAllowedOrigin).split(',').map((origin) => origin.trim()).filter(Boolean));
}

function matchesSecret(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function getBearerToken(header: string | null): string | undefined {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

function withHeaders(response: Response, requestOrigin: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Origin');
  if (requestOrigin) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
    headers.set('Access-Control-Expose-Headers', exposedHeaders);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(status: number, message: string, requestOrigin: string | null, serviceUrl?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  if (status === 401) headers.set('WWW-Authenticate', `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', serviceUrl ?? defaultAllowedOrigin).toString()}"`);
  return withHeaders(new Response(JSON.stringify({ error: message }), { status, headers }), requestOrigin);
}

function jsonResponse(status: number, body: unknown, requestOrigin: string | null): Response {
  return withHeaders(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }), requestOrigin);
}

export async function onRequest({ request, env }: PagesRequestContext): Promise<Response> {
  const requestOrigin = request.headers.get('Origin');
  const allowed = origins(env);
  if (requestOrigin && !allowed.has(requestOrigin)) {
    return jsonError(403, 'Origin is not allowed.', null);
  }

  if (request.method === 'OPTIONS') {
    const headers = new Headers({
      'Access-Control-Allow-Methods': allowedMethods,
      'Access-Control-Allow-Headers': allowedHeaders,
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    });
    if (requestOrigin) headers.set('Access-Control-Allow-Origin', requestOrigin);
    return new Response(null, { status: 204, headers });
  }

  const isStatusRequest = new URL(request.url).pathname.split('/').at(-1) === 'status';
  if (isStatusRequest) {
    if (request.method !== 'GET') return jsonError(405, 'Method not allowed.', requestOrigin);
    const operatorConfigured = Boolean(env.MCP_BEARER_TOKEN && env.MCP_BEARER_TOKEN.length >= 32);
    if (!env.MCP_ACTIVITY_DB) {
      return jsonResponse(200, { ready: operatorConfigured, connected: false, activityTracking: false, activeWindowSeconds: 300 }, requestOrigin);
    }
    try {
      const status = await readMcpConnectionStatus(env.MCP_ACTIVITY_DB);
      return jsonResponse(200, { ready: true, ...status, activityTracking: true }, requestOrigin);
    } catch {
      return jsonResponse(200, { ready: operatorConfigured, connected: false, activityTracking: false, activeWindowSeconds: 300 }, requestOrigin);
    }
  }

  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    return jsonError(405, 'Method not allowed.', requestOrigin);
  }

  const expected = env.MCP_BEARER_TOKEN;
  const supplied = getBearerToken(request.headers.get('Authorization'));
  if (!(expected && expected.length >= 32) && !env.MCP_ACTIVITY_DB) {
    return jsonError(503, 'Remote MCP authentication is not configured.', requestOrigin);
  }
  let grantedScopes: readonly string[] = [];
  let principalAddress: string | undefined;
  let clientId: string | undefined;
  const isMasterBearer = Boolean(expected && expected.length >= 32 && supplied && matchesSecret(supplied, expected));
  if (!isMasterBearer && supplied && env.MCP_ACTIVITY_DB) {
    const resource = `${new URL(request.url).origin}/mcp`;
    const verified = await verifyOAuthAccessToken(env.MCP_ACTIVITY_DB, supplied, resource).catch(() => undefined);
    if (verified) {
      grantedScopes = verified.scopes;
      principalAddress = verified.principalAddress;
      clientId = verified.clientId;
    }
    else return jsonError(401, 'A valid bearer token is required.', requestOrigin, request.url);
  } else if (!isMasterBearer) {
    return jsonError(401, 'A valid bearer token is required.', requestOrigin, request.url);
  }
  if (isMasterBearer) grantedScopes = SUPPORTED_MCP_SCOPES;

  if (env.MCP_ACTIVITY_DB) {
    try { await recordAuthenticatedMcpRequest(env.MCP_ACTIVITY_DB); }
    catch { /* Activity telemetry must not take down the MCP service. */ }
  }

  let server: ReturnType<typeof createMandateMcpServer> | undefined;
  let transport: WebStandardStreamableHTTPServerTransport | undefined;
  try {
    const runtimeEnv: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) if (typeof value === 'string') runtimeEnv[key] = value;
    server = createMandateMcpServer({
      ...runtimeEnv,
      MCP_GRANTED_SCOPES: grantedScopes.join(' '),
      MCP_PRINCIPAL_ADDRESS: principalAddress,
      MCP_CLIENT_ID: clientId,
      MCP_ALLOW_UNBOUND_PRINCIPAL: isMasterBearer ? 'true' : 'false',
    }, env.MCP_ACTIVITY_DB ? { policyStore: new D1PolicyStore(env.MCP_ACTIVITY_DB as unknown as D1DatabaseLike) } : {});
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withHeaders(response, requestOrigin);
  } catch {
    return jsonError(500, 'Remote MCP request failed.', requestOrigin);
  } finally {
    await transport?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}
