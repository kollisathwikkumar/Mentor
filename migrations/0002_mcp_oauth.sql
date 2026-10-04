CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
  request_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  state TEXT,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_authorization_requests_expiry ON oauth_authorization_requests(expires_at_ms);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expiry ON oauth_authorization_codes(expires_at_ms);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS oauth_tokens_expiry ON oauth_tokens(expires_at_ms);
