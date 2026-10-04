import { describe, expect, it, vi } from 'vitest';
import { MCP_CONNECTION_WINDOW_MS, readMcpConnectionStatus, recordAuthenticatedMcpRequest, type McpActivityDatabase } from '../src/connection-status.js';

function databaseFor(options: { row?: { last_seen_ms: number; authenticated_request_count: number } | null; success?: boolean } = {}): { database: McpActivityDatabase; run: ReturnType<typeof vi.fn>; first: ReturnType<typeof vi.fn>; bind: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({ success: options.success ?? true }));
  const first = vi.fn(async () => options.row ?? null);
  const statement = { bind: vi.fn(() => statement), first, run };
  return { database: { prepare: vi.fn(() => statement) }, run, first, bind: statement.bind };
}

describe('MCP connection activity', () => {
  it('records only authenticated traffic and increments activity atomically', async () => {
    const fake = databaseFor();
    await recordAuthenticatedMcpRequest(fake.database, 1_800_000_000_000);
    expect(fake.database.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(id) DO UPDATE'));
    expect(fake.bind).toHaveBeenCalledWith(1_800_000_000_000);
    expect(fake.run).toHaveBeenCalledOnce();
  });

  it('uses the current time when callers omit the timestamp', async () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const fake = databaseFor({ row: { last_seen_ms: now, authenticated_request_count: 1 } });
      await recordAuthenticatedMcpRequest(fake.database);
      expect(fake.bind).toHaveBeenCalledWith(now);
      await expect(readMcpConnectionStatus(fake.database)).resolves.toMatchObject({ connected: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the request path when the activity write is not durable', async () => {
    const fake = databaseFor({ success: false });
    await expect(recordAuthenticatedMcpRequest(fake.database, 1_800_000_000_000)).rejects.toThrow('MCP activity write failed.');
  });

  it('reports an authenticated request inside the five-minute activity window', async () => {
    const now = 1_800_000_000_000;
    const fake = databaseFor({ row: { last_seen_ms: now - MCP_CONNECTION_WINDOW_MS, authenticated_request_count: 7 } });
    await expect(readMcpConnectionStatus(fake.database, now)).resolves.toEqual({
      connected: true,
      activeWindowSeconds: 300,
    });
  });

  it('reports disconnected when no client activity exists or its activity is stale', async () => {
    const noActivity = databaseFor();
    await expect(readMcpConnectionStatus(noActivity.database, 1_800_000_000_000)).resolves.toMatchObject({ connected: false });
    const stale = databaseFor({ row: { last_seen_ms: 1_799_999_699_999, authenticated_request_count: 2 } });
    await expect(readMcpConnectionStatus(stale.database, 1_800_000_000_000)).resolves.toMatchObject({ connected: false });
  });

  it('rejects invalid and future timestamps as connected', async () => {
    const now = 1_800_000_000_000;
    const invalid = databaseFor({ row: { last_seen_ms: Number.NaN, authenticated_request_count: -2 } });
    await expect(readMcpConnectionStatus(invalid.database, now)).resolves.toMatchObject({ connected: false });
    const future = databaseFor({ row: { last_seen_ms: now + 1, authenticated_request_count: 3 } });
    await expect(readMcpConnectionStatus(future.database, now)).resolves.toMatchObject({ connected: false });
  });
});
