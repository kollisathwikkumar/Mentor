export interface McpConnectionStatus {
  readonly connected: boolean;
  readonly activeWindowSeconds: number;
}

export function buildMcpStatusUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Enter a valid MCP endpoint URL.');
  }
  if (url.protocol !== 'https:') throw new Error('The MCP endpoint must use HTTPS.');
  if (url.username || url.password) throw new Error('The MCP endpoint must not contain credentials.');
  if (url.search) throw new Error('The MCP endpoint must not contain a query string.');
  if (url.hash) throw new Error('The MCP endpoint must not contain a fragment.');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/status`;
  return url.toString();
}

function isConnectionStatus(value: unknown): value is McpConnectionStatus {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.connected === 'boolean'
    && Number.isSafeInteger(record.activeWindowSeconds) && (record.activeWindowSeconds as number) > 0;
}

export async function fetchMcpConnectionStatus(endpoint: string, fetcher: typeof fetch = fetch): Promise<McpConnectionStatus> {
  const response = await fetcher(buildMcpStatusUrl(endpoint), { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`MCP status check failed (${response.status}).`);
  const body: unknown = await response.json();
  if (!isConnectionStatus(body)) throw new Error('The MCP status response is invalid.');
  return body;
}
