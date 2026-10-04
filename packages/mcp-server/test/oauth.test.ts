import { describe, expect, it, vi } from 'vitest';
import { handleOAuthRequest, type OAuthDatabase } from '../src/oauth.js';

function authorizationDatabase(): OAuthDatabase {
  return {
    prepare: (query) => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => query.includes('oauth_clients') ? {
          client_id: 'client-1',
          client_name: 'Claude',
          redirect_uris_json: JSON.stringify(['https://claude.ai/api/mcp/auth_callback']),
        } : null),
        run: vi.fn(async () => ({ success: true })),
      };
      return statement;
    },
    batch: vi.fn(async () => []),
  };
}

describe('OAuth wallet sign-in instructions', () => {
  it('explains wallet ownership, automatic address selection, and first-time setup', async () => {
    const params = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      scope: 'mandate:read',
    });
    const response = await handleOAuthRequest(
      new Request(`https://mandate-console.pages.dev/oauth/authorize?${params}`),
      { MCP_ACTIVITY_DB: authorizationDatabase() },
    );

    const page = await response.text();
    expect(page).toContain('You do not need to know or type your wallet address');
    expect(page).toContain('Use the wallet account you used when you created your Mandate permission');
    expect(page).toContain('If you are new to Mandate, set up a wallet and create a permission first');
    expect(page).toContain('Mandate workspace');
  });
});
