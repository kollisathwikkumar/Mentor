import { describe, expect, it, vi } from 'vitest';
import { handleOAuthRequest, type OAuthDatabase } from '../src/oauth.js';

function authorizationDatabase(redirectUris: readonly string[] = ['https://claude.ai/api/mcp/auth_callback']): OAuthDatabase {
  return {
    prepare: (query) => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => query.includes('oauth_clients') ? {
          client_id: 'client-1',
          client_name: 'Claude',
          redirect_uris_json: JSON.stringify(redirectUris),
        } : null),
        run: vi.fn(async () => ({ success: true })),
      };
      return statement;
    },
    batch: vi.fn(async () => []),
  };
}

describe('OAuth account sign-in instructions', () => {
  it('offers passkey-first sign-in with a familiar-wallet fallback and explains limits', async () => {
    const params = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      scope: 'mandate:read mandate:balance mandate:propose mandate:transfer',
    });
    const response = await handleOAuthRequest(
      new Request(`https://mandate-console.pages.dev/oauth/authorize?${params}`),
      { MCP_ACTIVITY_DB: authorizationDatabase() },
    );

    const page = await response.text();
    const approvalFormStart = page.indexOf('<form id="wallet-approval"');
    const approvalFormEnd = page.indexOf('</form>', approvalFormStart);
    const checkedReadScope = page.indexOf('name="granted_scope" value="mandate:read" checked');
    expect(approvalFormStart).toBeGreaterThanOrEqual(0);
    expect(checkedReadScope).toBeGreaterThan(approvalFormStart);
    expect(checkedReadScope).toBeLessThan(approvalFormEnd);
    expect(page).toContain('Create a passkey');
    expect(page).toContain('Continue with my passkey');
    expect(page).toContain('Use an existing wallet instead');
    expect(page).toContain('same account that owns your Mandate permissions');
    expect(page).toContain('a new passkey creates a new Mandate account');
    expect(page).toContain('No address or API key to copy.');
    expect(page).toContain('Passkeys need an authenticator with WebAuthn PRF support');
    expect(page).toContain('Signing in is a free message signature.');
    expect(page).toContain('script type="module" src="/assets/oauth-approve.js"');
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(response.headers.get('Content-Security-Policy')).toContain("form-action 'self' https://claude.ai");
    expect(response.headers.get('Content-Security-Policy')).not.toContain('form-action *');
    expect(page).toContain('Mandate workspace');
    expect(page).toMatch(/name="granted_scope" value="mandate:read" checked/);
    expect(page).toMatch(/name="granted_scope" value="mandate:balance">/);
    expect(page).toMatch(/name="granted_scope" value="mandate:propose">/);
    expect(page).toMatch(/name="granted_scope" value="mandate:transfer">/);
    expect(page).toContain('Only permissions requested by this client appear here. Choose at least one. Mandate status is checked when requested; balance, proposal, and transfer always need your explicit selection.');
  });


  it('rejects a legacy registered callback that is not HTTPS or loopback before rendering consent', async () => {
    const params = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'javascript:alert(1)',
      response_type: 'code',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
    });
    const response = await handleOAuthRequest(
      new Request(`https://mandate-console.pages.dev/oauth/authorize?${params}`),
      { MCP_ACTIVITY_DB: authorizationDatabase(['javascript:alert(1)']) },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  });

});
