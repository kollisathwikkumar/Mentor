import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './[[path]].js';

const testToken = 'mcp-test-token-that-is-long-enough-1234567890';
const context = (request: Request, env: Readonly<Record<string, string | undefined>> = { MCP_BEARER_TOKEN: testToken }) => ({ request, env });

function activityDatabase(lastSeen = 1_800_000_000_000): { prepare: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn>; first: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({ success: true }));
  const first = vi.fn(async () => ({ last_seen_ms: lastSeen, authenticated_request_count: 1 }));
  const statement = { bind: vi.fn(() => statement), run, first };
  return { prepare: vi.fn(() => statement), run, first };
}

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

  it('exposes readiness even when activity storage is absent or unavailable', async () => {
    const missingDb = await onRequest(context(new Request('https://example.test/mcp/status')));
    expect(missingDb.status).toBe(200);
    expect(await missingDb.json()).toMatchObject({ ready: true, connected: false, activityTracking: false });
    const database = activityDatabase(Date.now());
    const response = await onRequest({ request: new Request('https://example.test/mcp/status'), env: { MCP_ACTIVITY_DB: database } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ connected: true, activeWindowSeconds: 300 });
    expect(database.run).not.toHaveBeenCalled();
    const wrongMethod = await onRequest({ request: new Request('https://example.test/mcp/status', { method: 'POST' }), env: { MCP_ACTIVITY_DB: database } });
    expect(wrongMethod.status).toBe(405);
    database.first.mockRejectedValue(new Error('database unavailable'));
    const unavailable = await onRequest({ request: new Request('https://example.test/mcp/status'), env: { MCP_ACTIVITY_DB: database } });
    expect(unavailable.status).toBe(200);
    expect(await unavailable.json()).toMatchObject({ ready: false, connected: false, activityTracking: false });
  });

  it('records authenticated MCP traffic before serving it and never records rejected traffic', async () => {
    const database = activityDatabase();
    const env = { MCP_BEARER_TOKEN: testToken, MCP_ACTIVITY_DB: database };
    const rejected = await onRequest({ request: new Request('https://example.test/mcp', { method: 'POST' }), env });
    expect(rejected.status).toBe(401);
    expect(database.run).not.toHaveBeenCalled();
    const initialized = await onRequest({ request: new Request('https://example.test/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'Mcp-Protocol-Version': '2025-03-26' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } } }),
    }), env });
    expect(database.run).toHaveBeenCalledOnce();
    expect(initialized.status).toBe(200);
  });

  it('serves authenticated MCP requests if best-effort activity recording fails', async () => {
    const database = activityDatabase();
    database.run.mockResolvedValue({ success: false });
    const response = await onRequest({ request: new Request('https://example.test/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } } }),
    }), env: { MCP_BEARER_TOKEN: testToken, MCP_ACTIVITY_DB: database } });
    expect(response.status).toBe(200);
  });
});
