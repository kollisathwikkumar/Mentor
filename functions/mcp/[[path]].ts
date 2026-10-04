import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMandateMcpServer } from '@mandate/mcp-server/server';

interface RemoteMcpEnvironment extends Readonly<Record<string, string | undefined>> {
  readonly MCP_BEARER_TOKEN?: string;
  readonly MCP_ALLOWED_ORIGINS?: string;
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

function jsonError(status: number, message: string, requestOrigin: string | null): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  if (status === 401) headers.set('WWW-Authenticate', 'Bearer realm="Mandate MCP"');
  return withHeaders(new Response(JSON.stringify({ error: message }), { status, headers }), requestOrigin);
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

  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    return jsonError(405, 'Method not allowed.', requestOrigin);
  }

  const expected = env.MCP_BEARER_TOKEN;
  if (!expected || expected.length < 32) {
    return jsonError(503, 'Remote MCP authentication is not configured.', requestOrigin);
  }
  const supplied = getBearerToken(request.headers.get('Authorization'));
  if (!supplied || !matchesSecret(supplied, expected)) {
    return jsonError(401, 'A valid bearer token is required.', requestOrigin);
  }

  let server: ReturnType<typeof createMandateMcpServer> | undefined;
  let transport: WebStandardStreamableHTTPServerTransport | undefined;
  try {
    server = createMandateMcpServer(env);
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
