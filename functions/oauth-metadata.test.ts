import { describe, expect, it } from 'vitest';
import { onRequest as authorizationMetadata } from './.well-known/oauth-authorization-server.js';
import { onRequest as resourceMetadata } from './.well-known/oauth-protected-resource/[resource].js';
import { SUPPORTED_MCP_SCOPES } from '@mandate/mcp-server/oauth';

describe('OAuth discovery scopes', () => {
  it('advertises every supported MCP scope plus offline access to OAuth clients', async () => {
    const response = authorizationMetadata({ request: new Request('https://mandate-console.pages.dev/.well-known/oauth-authorization-server') });
    const metadata = await response.json() as { scopes_supported: string[] };

    expect(metadata.scopes_supported).toEqual([...SUPPORTED_MCP_SCOPES, 'offline_access']);
  });

  it('advertises every supported MCP scope to resource clients', async () => {
    const response = resourceMetadata({
      request: new Request('https://mandate-console.pages.dev/.well-known/oauth-protected-resource/mcp'),
      params: { resource: 'mcp' },
    });
    const metadata = await response.json() as { scopes_supported: string[] };

    expect(metadata.scopes_supported).toEqual([...SUPPORTED_MCP_SCOPES]);
  });
});
