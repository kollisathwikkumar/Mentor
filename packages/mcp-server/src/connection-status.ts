export const MCP_CONNECTION_WINDOW_MS = 5 * 60 * 1000;

interface D1Result {
  readonly success: boolean;
  readonly meta?: { readonly changes?: number };
}

interface D1Statement {
  bind(...values: readonly (number | string)[]): D1Statement;
  first<Row>(): Promise<Row | null>;
  run(): Promise<D1Result>;
}

export interface McpActivityDatabase {
  prepare(query: string): D1Statement;
}

interface ActivityRow {
  readonly last_seen_ms: number;
  readonly authenticated_request_count: number;
}

export interface McpConnectionStatus {
  readonly connected: boolean;
  readonly activeWindowSeconds: number;
}

export async function recordAuthenticatedMcpRequest(database: McpActivityDatabase, nowMs = Date.now()): Promise<void> {
  const result = await database.prepare(
    'INSERT INTO mcp_activity (id, last_seen_ms, authenticated_request_count) VALUES (1, ?, 1) ON CONFLICT(id) DO UPDATE SET last_seen_ms = excluded.last_seen_ms, authenticated_request_count = mcp_activity.authenticated_request_count + 1',
  ).bind(nowMs).run();
  if (!result.success) throw new Error('MCP activity write failed.');
}

export async function readMcpConnectionStatus(database: McpActivityDatabase, nowMs = Date.now()): Promise<McpConnectionStatus> {
  const row = await database.prepare(
    'SELECT last_seen_ms, authenticated_request_count FROM mcp_activity WHERE id = 1',
  ).first<ActivityRow>();
  const lastSeenMs = row?.last_seen_ms;
  const validTimestamp = typeof lastSeenMs === 'number' && Number.isSafeInteger(lastSeenMs) && lastSeenMs >= 0 && lastSeenMs <= nowMs;
  const activeWindowSeconds = MCP_CONNECTION_WINDOW_MS / 1000;
  return {
    connected: validTimestamp && nowMs - lastSeenMs <= MCP_CONNECTION_WINDOW_MS,
    activeWindowSeconds,
  };
}
