import { SUPPORTED_MCP_SCOPES } from '@mandate/mcp-server/oauth';

interface MetadataRequestContext {
  readonly request: Request;
}

export function onRequest({ request }: MetadataRequestContext): Response {
  const issuer = new URL(request.url).origin;
  return new Response(JSON.stringify({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...SUPPORTED_MCP_SCOPES, 'offline_access'],
    client_id_metadata_document_supported: false,
  }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}
