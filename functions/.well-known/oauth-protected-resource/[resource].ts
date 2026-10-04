interface ResourceMetadataContext {
  readonly request: Request;
  readonly params: { readonly resource: string };
}

export function onRequest({ request, params }: ResourceMetadataContext): Response {
  const issuer = new URL(request.url).origin;
  if (params.resource !== 'mcp') return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  return new Response(JSON.stringify({
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mandate:read', 'mandate:transfer', 'mandate:propose'],
    resource_name: 'Mandate MCP',
  }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}
