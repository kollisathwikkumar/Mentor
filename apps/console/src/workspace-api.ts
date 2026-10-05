export interface WorkspaceSession {
  readonly clientId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly principal: string;
}

export interface WorkspaceTask {
  readonly id: string;
  readonly principalId: string;
  readonly state: 'received' | 'clarification_required' | 'proposal_ready' | 'approval_pending' | 'active' | 'action_allowed' | 'action_denied' | 'execution_started' | 'succeeded' | 'failed' | 'unknown_reconciliation' | 'cancelled' | 'revoked' | 'expired' | 'unsupported';
  readonly version: number;
  readonly lastEventId: string;
}

export interface WorkspaceTaskEvent {
  readonly id: string;
  readonly taskId: string;
  readonly principalId: string;
  readonly version: number;
  readonly from: WorkspaceTask['state'];
  readonly to: WorkspaceTask['state'];
  readonly occurredAt: number;
  readonly data: Readonly<Record<string, string | number | boolean>>;
}

export interface WorkspaceTaskRecord {
  readonly task: WorkspaceTask;
  readonly data: Readonly<Record<string, unknown>>;
  readonly events: readonly WorkspaceTaskEvent[];
}

export interface WorkspaceTaskListItem {
  readonly task: WorkspaceTask;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkspaceTaskPage {
  readonly tasks: readonly WorkspaceTaskListItem[];
  readonly nextCursor: string | null;
}

export interface WorkspaceTaskTransition {
  readonly ok: true;
  readonly record: WorkspaceTask;
  readonly event: WorkspaceTaskEvent;
}

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const sessionKey = 'mandate.workspace.oauth.v1';
const flowKey = 'mandate.workspace.oauth.flow.v1';
const lastTaskKey = 'mandate.workspace.last-task.v1';
const apiScope = 'mandate:policy';
const taskStates = new Set<WorkspaceTask['state']>(['received', 'clarification_required', 'proposal_ready', 'approval_pending', 'active', 'action_allowed', 'action_denied', 'execution_started', 'succeeded', 'failed', 'unknown_reconciliation', 'cancelled', 'revoked', 'expired', 'unsupported']);
const refreshInFlight = new Map<string, Promise<WorkspaceSession>>();

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTask(value: unknown): WorkspaceTask {
  if (!objectRecord(value) || typeof value.id !== 'string' || typeof value.principalId !== 'string' || typeof value.state !== 'string'
    || !taskStates.has(value.state as WorkspaceTask['state']) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version)
    || typeof value.lastEventId !== 'string') throw new Error('Workspace API returned an invalid task record.');
  return value as unknown as WorkspaceTask;
}

function parseTaskEvent(value: unknown): WorkspaceTaskEvent {
  if (!objectRecord(value) || typeof value.id !== 'string' || typeof value.taskId !== 'string' || typeof value.principalId !== 'string'
    || typeof value.from !== 'string' || !taskStates.has(value.from as WorkspaceTask['state']) || typeof value.to !== 'string'
    || !taskStates.has(value.to as WorkspaceTask['state']) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version)
    || typeof value.occurredAt !== 'number' || !Number.isFinite(value.occurredAt) || !objectRecord(value.data)) {
    throw new Error('Workspace API returned an invalid task event.');
  }
  return value as unknown as WorkspaceTaskEvent;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256Base64Url(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function validSession(value: unknown): value is WorkspaceSession {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.clientId === 'string' && row.clientId.length >= 32
    && typeof row.accessToken === 'string' && row.accessToken.length >= 32
    && typeof row.refreshToken === 'string' && row.refreshToken.length >= 32
    && typeof row.expiresAt === 'number' && Number.isFinite(row.expiresAt)
    && typeof row.principal === 'string' && /^0x[0-9a-f]{40}$/.test(row.principal);
}

export function readWorkspaceSession(storage: WorkspaceStorage): WorkspaceSession | undefined {
  const serialized = storage.getItem(sessionKey);
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (validSession(value)) return value;
  } catch { /* discard malformed session data */ }
  storage.removeItem(sessionKey);
  return undefined;
}

export async function beginWorkspaceOAuth(input: {
  readonly origin: string;
  readonly principal: string;
  readonly storage: WorkspaceStorage;
  readonly fetcher?: typeof fetch;
}): Promise<string> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.principal)) throw new Error('Connect a Mandate account before enabling workspace APIs.');
  const fetcher = input.fetcher ?? fetch;
  const origin = new URL(input.origin).origin;
  const redirectUri = new URL('/', origin).toString();
  const registration = await fetcher(new URL('/oauth/register', origin), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Mandate Workspace', redirect_uris: [redirectUri] }),
  });
  if (!registration.ok) throw new Error(`Workspace sign-in setup failed (${registration.status}).`);
  const clientPayload: unknown = await registration.json();
  if (typeof clientPayload !== 'object' || clientPayload === null || typeof (clientPayload as Record<string, unknown>).client_id !== 'string') {
    throw new Error('Workspace sign-in setup returned an invalid client.');
  }
  const rawClientId = (clientPayload as Record<string, unknown>).client_id;
  if (typeof rawClientId !== 'string' || rawClientId.length < 32) throw new Error('Workspace sign-in setup returned an invalid client.');
  const clientId = rawClientId;
  const verifier = randomToken(48);
  const state = randomToken(32);
  const challenge = await sha256Base64Url(verifier);
  input.storage.setItem(flowKey, JSON.stringify({ clientId, verifier, state, redirectUri, origin }));
  input.storage.setItem('mandate.workspace.oauth.pending-principal.v1', input.principal.toLowerCase());
  const authorize = new URL('/oauth/authorize', origin);
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', state,
    scope: `${apiScope} offline_access`, resource: new URL('/mcp', origin).toString(),
  }).toString();
  return authorize.toString();
}

interface OAuthFlow {
  readonly clientId: string;
  readonly verifier: string;
  readonly state: string;
  readonly redirectUri: string;
  readonly origin: string;
}

export async function completeWorkspaceOAuth(input: {
  readonly url: URL;
  readonly storage: WorkspaceStorage;
  readonly fetcher?: typeof fetch;
}): Promise<WorkspaceSession | undefined> {
  const code = input.url.searchParams.get('code');
  const returnedState = input.url.searchParams.get('state');
  if (!code && !returnedState) return undefined;
  const serialized = input.storage.getItem(flowKey);
  input.storage.removeItem(flowKey);
  if (!serialized) throw new Error('Workspace sign-in state is missing. Start sign-in again.');
  let flow: OAuthFlow;
  try {
    const candidate: unknown = JSON.parse(serialized);
    if (!objectRecord(candidate) || typeof candidate.clientId !== 'string' || candidate.clientId.length < 32
      || typeof candidate.verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(candidate.verifier)
      || typeof candidate.state !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(candidate.state)
      || typeof candidate.origin !== 'string' || typeof candidate.redirectUri !== 'string') throw new Error('invalid');
    flow = candidate as unknown as OAuthFlow;
    const flowOrigin = new URL(flow.origin).origin;
    if (flowOrigin !== flow.origin || flow.redirectUri !== new URL('/', flowOrigin).toString()) throw new Error('invalid');
  } catch { throw new Error('Workspace sign-in state is invalid. Start sign-in again.'); }
  if (!code || returnedState !== flow.state || new URL(input.url.origin).origin !== flow.origin) {
    throw new Error('Workspace sign-in response did not match this browser session. Start sign-in again.');
  }
  const response = await (input.fetcher ?? fetch)(new URL('/oauth/token', flow.origin), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: flow.clientId, redirect_uri: flow.redirectUri,
      code, code_verifier: flow.verifier, resource: new URL('/mcp', flow.origin).toString() }),
  });
  if (!response.ok) throw new Error(`Workspace sign-in token exchange failed (${response.status}).`);
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null) throw new Error('Workspace sign-in returned an invalid token response.');
  const tokens = payload as Record<string, unknown>;
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || typeof tokens.expires_in !== 'number'
    || typeof tokens.scope !== 'string' || !tokens.scope.split(' ').includes(apiScope)) {
    throw new Error('Workspace sign-in did not grant the required policy-management scope.');
  }
  const principal = input.storage.getItem('mandate.workspace.oauth.pending-principal.v1');
  if (!principal || !/^0x[0-9a-f]{40}$/.test(principal)) throw new Error('Connect your Mandate account before completing sign-in.');
  const candidateSession: WorkspaceSession = { clientId: flow.clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000, principal: principal.toLowerCase() };
  try {
    const identityResponse = await (input.fetcher ?? fetch)(new URL('/api/session', flow.origin), {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!identityResponse.ok) throw new Error('Workspace could not verify the signed-in account against its API.');
    const identity: unknown = await identityResponse.json();
    if (!objectRecord(identity)) throw new Error('Workspace API returned an invalid account identity.');
    if (typeof identity.principalId !== 'string' || identity.principalId.toLowerCase() !== principal
      || identity.clientId !== flow.clientId || !Array.isArray(identity.scopes) || !identity.scopes.includes(apiScope)) {
      throw new Error('Signed-in account or OAuth client did not match the workspace request.');
    }
    input.storage.setItem(sessionKey, JSON.stringify(candidateSession));
  } catch (error) {
    await Promise.allSettled([candidateSession.accessToken, candidateSession.refreshToken].map((token) =>
      (input.fetcher ?? fetch)(new URL('/oauth/revoke', flow.origin), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: flow.clientId, token }) })));
    throw error;
  }
  input.storage.removeItem('mandate.workspace.oauth.pending-principal.v1');
  return candidateSession;
}

export async function getWorkspaceAccessToken(input: {
  readonly session: WorkspaceSession;
  readonly storage: WorkspaceStorage;
  readonly origin: string;
  readonly fetcher?: typeof fetch;
  readonly now?: number;
}): Promise<WorkspaceSession> {
  const current = readWorkspaceSession(input.storage) ?? input.session;
  if (current.expiresAt > (input.now ?? Date.now()) + 30_000) return current;
  const inflight = refreshInFlight.get(current.refreshToken);
  if (inflight) return inflight;
  const refreshOperation = (async (): Promise<WorkspaceSession> => {
  const origin = new URL(input.origin).origin;
  const response = await (input.fetcher ?? fetch)(new URL('/oauth/token', origin), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: current.clientId,
      refresh_token: current.refreshToken, resource: new URL('/mcp', origin).toString() }),
  });
  if (!response.ok) {
    input.storage.removeItem(sessionKey);
    throw new Error('Workspace session expired. Connect the workspace again.');
  }
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null) throw new Error('Workspace session refresh returned an invalid response.');
  const tokens = payload as Record<string, unknown>;
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || typeof tokens.expires_in !== 'number') {
    throw new Error('Workspace session refresh returned invalid tokens.');
  }
  const refreshed: WorkspaceSession = { ...current, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  input.storage.setItem(sessionKey, JSON.stringify(refreshed));
  return refreshed;
  })();
  refreshInFlight.set(current.refreshToken, refreshOperation);
  try { return await refreshOperation; }
  finally { if (refreshInFlight.get(current.refreshToken) === refreshOperation) refreshInFlight.delete(current.refreshToken); }
}

async function apiRequest<T>(path: string, session: WorkspaceSession, storage: WorkspaceStorage, origin: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const current = await getWorkspaceAccessToken({ session, storage, origin, fetcher });
  const response = await fetcher(new URL(path, origin), {
    ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${current.accessToken}` },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}));
    const code = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
      ? (payload as Record<string, string>).error : `http_${response.status}`;
    throw new Error(`Workspace API request failed: ${code}.`);
  }
  return await response.json() as T;
}

export async function createWorkspaceTask(summary: string, session: WorkspaceSession, storage: WorkspaceStorage, fetcher?: typeof fetch, origin = window.location.origin): Promise<WorkspaceTask> {
  const task = parseTask(await apiRequest<unknown>('/api/tasks', session, storage, origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary }) }, fetcher));
  if (task.principalId.toLowerCase() !== session.principal.toLowerCase()) throw new Error('Workspace API returned a task for a different owner.');
  return task;
}

export async function getWorkspaceTask(taskId: string, session: WorkspaceSession, storage: WorkspaceStorage, fetcher?: typeof fetch, origin = window.location.origin): Promise<WorkspaceTaskRecord> {
  const response = await apiRequest<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`, session, storage, origin, undefined, fetcher);
  if (!objectRecord(response) || !objectRecord(response.data) || !Array.isArray(response.events)) throw new Error('Workspace API returned an invalid task detail.');
  const task = parseTask(response.task);
  if (task.id !== taskId || task.principalId.toLowerCase() !== session.principal.toLowerCase()) throw new Error('Workspace API task identity did not match the requested record.');
  const events = response.events.map(parseTaskEvent);
  if (events.some((event) => event.taskId !== taskId || event.principalId.toLowerCase() !== session.principal.toLowerCase())) throw new Error('Workspace API returned task events for a different record or owner.');
  return { task, data: response.data, events };
}

export async function listWorkspaceTasks(session: WorkspaceSession, storage: WorkspaceStorage, cursor?: string, origin = window.location.origin, fetcher: typeof fetch = fetch): Promise<WorkspaceTaskPage> {
  const url = new URL('/api/tasks', origin);
  url.searchParams.set('limit', '20');
  if (cursor !== undefined) url.searchParams.set('cursor', cursor);
  const result = await apiRequest<unknown>(`${url.pathname}${url.search}`, session, storage, origin, undefined, fetcher);
  if (!objectRecord(result) || !Array.isArray(result.tasks) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) {
    throw new Error('Workspace API returned an invalid task list.');
  }
  const tasks = result.tasks.map((value): WorkspaceTaskListItem => {
    if (!objectRecord(value) || !objectRecord(value.data) || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt)
      || typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt)) throw new Error('Workspace API returned an invalid task list item.');
    const task = parseTask(value.task);
    if (task.principalId.toLowerCase() !== session.principal.toLowerCase()) throw new Error('Workspace API returned a task for a different owner.');
    return { task, data: value.data, createdAt: value.createdAt, updatedAt: value.updatedAt };
  });
  return { tasks, nextCursor: result.nextCursor };
}

export function canCancelWorkspaceTask(state: WorkspaceTask['state']): boolean {
  return !['succeeded', 'failed', 'cancelled', 'revoked', 'expired', 'unsupported'].includes(state);
}

export function cancelWorkspaceTask(task: WorkspaceTask, session: WorkspaceSession, storage: WorkspaceStorage, fetcher?: typeof fetch, origin = window.location.origin): Promise<WorkspaceTaskTransition> {
  return apiRequest<unknown>(`/api/tasks/${encodeURIComponent(task.id)}/events`, session, storage, origin, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: task.version, to: 'cancelled', data: { source: 'workspace', note: 'User cancelled this tracked task; no connector action was executed.' } }),
  }, fetcher).then((result) => {
    if (!objectRecord(result) || result.ok !== true) throw new Error('Workspace API did not confirm the task transition.');
    const record = parseTask(result.record);
    const event = parseTaskEvent(result.event);
    if (record.id !== task.id || event.taskId !== task.id || event.to !== 'cancelled' || record.state !== 'cancelled'
      || record.version !== task.version + 1 || event.version !== record.version) throw new Error('Workspace API returned a mismatched cancellation transition.');
    return { ok: true, record, event };
  });
}

export function clearWorkspaceSession(storage: WorkspaceStorage): void {
  storage.removeItem(sessionKey);
  storage.removeItem(flowKey);
  storage.removeItem('mandate.workspace.oauth.pending-principal.v1');
}

export function saveLastWorkspaceTaskId(storage: WorkspaceStorage, taskId: string): void {
  storage.setItem(lastTaskKey, taskId);
}

export function readLastWorkspaceTaskId(storage: WorkspaceStorage): string | undefined {
  return storage.getItem(lastTaskKey) ?? undefined;
}

export async function disconnectWorkspaceSession(session: WorkspaceSession, storage: WorkspaceStorage, fetcher: typeof fetch = fetch, origin = window.location.origin): Promise<void> {
  const current = readWorkspaceSession(storage) ?? session;
  const endpoint = new URL('/oauth/revoke', origin);
  await Promise.all([current.accessToken, current.refreshToken].map(async (token) => {
    const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: current.clientId, token }) });
    if (!response.ok) throw new Error(`Workspace token revocation failed (${response.status}).`);
  }));
  clearWorkspaceSession(storage);
  storage.removeItem(lastTaskKey);
}
