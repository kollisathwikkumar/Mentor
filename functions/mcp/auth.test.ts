import { describe, expect, it } from 'vitest';
import { onRequest } from './[[path]].js';

const testToken = 'mcp-test-token-that-is-long-enough-1234567890';
const context = (request: Request, env: Readonly<Record<string, string | undefined>> = { MCP_BEARER_TOKEN: testToken }) => ({ request, env });

describe('remote Pages MCP endpoint guard', () => {
  it('rejects missing or incorrect bearer tokens before starting MCP', async () => {
    const missing = await onRequest(context(new Request('https://example.test/mcp', { method: 'POST' })));
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');
    const wrong = await onRequest(context(new Request('https://example.test/mcp', { method: 'POST', headers: { Authorization: `Bearer ${testToken}x` } })));
    expect(wrong.status).toBe(401);
  });

  it('fails closed when the remote bearer secret is absent or too short', async () => {
    const absent = await onRequest(context(new Request('https://example.test/mcp', { method: 'POST' }), {}));
    expect(absent.status).toBe(503);
    const short = await onRequest(context(new Request('https://example.test/mcp', { method: 'POST', headers: { Authorization: 'Bearer short' } }), { MCP_BEARER_TOKEN: 'short' }));
    expect(short.status).toBe(503);
  });

  it('rejects unapproved browser origins and reflects only the configured site origin', async () => {
    const rejected = await onRequest(context(new Request('https://example.test/mcp', { method: 'OPTIONS', headers: { Origin: 'https://attacker.invalid' } })));
    expect(rejected.status).toBe(403);
    const accepted = await onRequest(context(new Request('https://example.test/mcp', { method: 'OPTIONS', headers: { Origin: 'https://mandate-console.pages.dev' } })));
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get('access-control-allow-origin')).toBe('https://mandate-console.pages.dev');
    expect(accepted.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('returns a no-store 405 for unsupported HTTP methods', async () => {
    const response = await onRequest(context(new Request('https://example.test/mcp', { method: 'PUT' })));
    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
