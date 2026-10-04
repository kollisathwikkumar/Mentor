import { describe, expect, it, vi } from 'vitest';
import { buildMcpStatusUrl, fetchMcpConnectionStatus } from './mcp-status.js';

describe('MCP status client', () => {
  it('derives a status URL without forwarding endpoint query or fragment data', () => {
    expect(buildMcpStatusUrl('https://example.test/mcp')).toBe('https://example.test/mcp/status');
  });

  it('rejects non-HTTPS URLs and embedded credentials', () => {
    expect(() => buildMcpStatusUrl('http://example.test/mcp')).toThrow('HTTPS');
    expect(() => buildMcpStatusUrl('https://user:pass@example.test/mcp')).toThrow('credentials');
    expect(() => buildMcpStatusUrl('https://:secret@example.test/mcp')).toThrow('credentials');
    expect(() => buildMcpStatusUrl('https://example.test/mcp?token=secret')).toThrow('query');
    expect(() => buildMcpStatusUrl('https://example.test/mcp#status')).toThrow('fragment');
    expect(() => buildMcpStatusUrl('not a URL')).toThrow('valid');
  });

  it('fetches an uncached status and returns the server-observed state', async () => {
    const response = { ready: true, connected: true, activityTracking: true, activeWindowSeconds: 300 };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(fetchMcpConnectionStatus('https://example.test/mcp', fetcher)).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith('https://example.test/mcp/status', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  });

  it('surfaces unavailable endpoints and rejects malformed status bodies', async () => {
    const unavailable = vi.fn<typeof fetch>(async () => new Response('down', { status: 503 }));
    await expect(fetchMcpConnectionStatus('https://example.test/mcp', unavailable)).rejects.toThrow('503');
    const malformed = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ connected: 'yes' }), { status: 200 }));
    await expect(fetchMcpConnectionStatus('https://example.test/mcp', malformed)).rejects.toThrow('invalid');
    const nullBody = vi.fn<typeof fetch>(async () => new Response('null', { status: 200 }));
    await expect(fetchMcpConnectionStatus('https://example.test/mcp', nullBody)).rejects.toThrow('invalid');
    const missingWindow = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ready: true, connected: false, activityTracking: false }), { status: 200 }));
    await expect(fetchMcpConnectionStatus('https://example.test/mcp', missingWindow)).rejects.toThrow('invalid');
    const invalidWindow = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ready: true, connected: false, activityTracking: false, activeWindowSeconds: 0 }), { status: 200 }));
    await expect(fetchMcpConnectionStatus('https://example.test/mcp', invalidWindow)).rejects.toThrow('invalid');
  });
});
