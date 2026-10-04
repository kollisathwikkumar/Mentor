CREATE TABLE IF NOT EXISTS mcp_activity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_seen_ms INTEGER NOT NULL,
  authenticated_request_count INTEGER NOT NULL DEFAULT 0
);
