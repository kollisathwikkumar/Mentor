-- Durable generic authorization state. D1 batches are the atomic reservation boundary.
CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'revoked', 'expired')),
  expires_at INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  approved_policy_hash TEXT,
  policy_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS mandates_principal_status ON mandates(principal_id, status, expires_at);

CREATE TABLE IF NOT EXISTS mandate_grant_usage (
  mandate_id TEXT NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  grant_key TEXT NOT NULL,
  calls_reserved INTEGER NOT NULL DEFAULT 0 CHECK (calls_reserved >= 0),
  amount_reserved INTEGER NOT NULL DEFAULT 0 CHECK (amount_reserved >= 0),
  PRIMARY KEY (mandate_id, grant_key)
);

CREATE TABLE IF NOT EXISTS mandate_action_attempts (
  mandate_id TEXT NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  grant_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'ok', 'failed', 'unknown')),
  outcome_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (mandate_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS mandate_action_attempts_state ON mandate_action_attempts(mandate_id, state, created_at);

CREATE TABLE IF NOT EXISTS mandate_audit_events (
  event_id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('draft_created', 'approved', 'revoked', 'action_reserved', 'action_denied', 'action_completed')),
  idempotency_key TEXT,
  detail_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS mandate_audit_events_mandate ON mandate_audit_events(mandate_id, occurred_at);

-- Denials must also be recorded when the referenced mandate is missing or invalid,
-- so this decision ledger intentionally has no mandate foreign key.
CREATE TABLE IF NOT EXISTS authorization_decisions (
  decision_id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('deny')),
  reason_code TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  idempotency_key TEXT,
  request_hash TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS authorization_decisions_mandate ON authorization_decisions(mandate_id, occurred_at);
CREATE INDEX IF NOT EXISTS authorization_decisions_principal ON authorization_decisions(principal_id, occurred_at);

CREATE TABLE IF NOT EXISTS mandate_tasks (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  last_event_id TEXT NOT NULL,
  task_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS mandate_tasks_principal_updated ON mandate_tasks(principal_id, updated_at);
CREATE INDEX IF NOT EXISTS mandate_tasks_principal_created_id ON mandate_tasks(principal_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS mandate_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES mandate_tasks(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  occurred_at INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE (task_id, version)
);

CREATE INDEX IF NOT EXISTS mandate_task_events_task ON mandate_task_events(task_id, version);
