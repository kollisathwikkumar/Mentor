import { describe, expect, it, vi } from 'vitest';
import { beginWorkspaceOAuth, canCancelWorkspaceTask, cancelWorkspaceTask, completeWorkspaceOAuth, createWorkspaceTask, disconnectWorkspaceSession, getWorkspaceAccessToken, getWorkspaceTask, listWorkspaceTasks, readWorkspaceSession, type WorkspaceStorage } from './workspace-api.js';

class MemoryStorage implements WorkspaceStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const principal = '0x1111111111111111111111111111111111111111';
const accessToken = 'a'.repeat(48);
const refreshToken = 'r'.repeat(48);

describe('workspace OAuth and task API', () => {
  it('lists owner-verified persisted tasks with a server pagination cursor', async () => {
    const storage = new MemoryStorage();
    const session = { clientId: 'c'.repeat(48), accessToken, refreshToken, expiresAt: Date.now() + 3_600_000, principal };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      tasks: [{ task: { id: 'task-2', principalId: principal, state: 'received', version: 0, lastEventId: 'event-0' }, data: { summary: 'Review task' }, createdAt: 100, updatedAt: 100 }],
      nextCursor: 'eyJjcmVhdGVkQXQiOjEwMCwiaWQiOiJ0YXNrLTIifQ',
    }), { status: 200 }));
    const page = await listWorkspaceTasks(session, storage, undefined, 'https://mandate.example', fetcher);
    expect(page.tasks[0]?.task.id).toBe('task-2');
    expect(page.tasks[0]?.data.summary).toBe('Review task');
    expect(page.nextCursor).toBe('eyJjcmVhdGVkQXQiOjEwMCwiaWQiOiJ0YXNrLTIifQ');
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/api/tasks');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(`Bearer ${accessToken}`);
  });

  it('rejects a task list response containing another owner task', async () => {
    const storage = new MemoryStorage();
    const session = { clientId: 'c'.repeat(48), accessToken, refreshToken, expiresAt: Date.now() + 3_600_000, principal };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      tasks: [{ task: { id: 'task-foreign', principalId: '0x2222222222222222222222222222222222222222', state: 'received', version: 0, lastEventId: 'e' }, data: { summary: 'secret' }, createdAt: 100, updatedAt: 100 }],
      nextCursor: null,
    }), { status: 200 }));
    await expect(listWorkspaceTasks(session, storage, undefined, 'https://mandate.example', fetcher)).rejects.toThrow(/different owner/);
  });

  it('registers a PKCE public client and validates callback state before exchanging code', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'c'.repeat(48) }), { status: 201 }));
    const authorizeUrl = new URL(await beginWorkspaceOAuth({ origin: 'https://mandate.example', principal, storage, fetcher }));
    expect(authorizeUrl.pathname).toBe('/oauth/authorize');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('scope')).toBe('mandate:policy offline_access');
    const state = authorizeUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(new URL('/oauth/register', 'https://mandate.example'), expect.objectContaining({ method: 'POST' }));
    const wrongState = new URL(`https://mandate.example/?code=one-time&state=wrong`);
    await expect(completeWorkspaceOAuth({ url: wrongState, storage, fetcher })).rejects.toThrow(/did not match/);
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'd'.repeat(48) }), { status: 201 }));
    const secondAuthorizeUrl = new URL(await beginWorkspaceOAuth({ origin: 'https://mandate.example', principal, storage, fetcher }));
    const pending = new URL(`https://mandate.example/?code=one-time&state=${secondAuthorizeUrl.searchParams.get('state')}`);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, scope: 'mandate:policy offline_access' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ principalId: principal, clientId: secondAuthorizeUrl.searchParams.get('client_id'), scopes: ['mandate:policy'] }), { status: 200 }));
    const session = await completeWorkspaceOAuth({ url: pending, storage, fetcher });
    expect(session?.clientId).toBe(secondAuthorizeUrl.searchParams.get('client_id'));
    expect(session?.principal).toBe(principal);
    expect(readWorkspaceSession(storage)).toEqual(session);
    const tokenCall = fetcher.mock.calls[2];
    expect(tokenCall?.[0]).toEqual(new URL('/oauth/token', 'https://mandate.example'));
    const tokenBody = new URLSearchParams(String((tokenCall?.[1] as RequestInit).body));
    expect(tokenBody.get('code_verifier')).toBeTruthy();
    expect(fetcher.mock.calls[3]?.[0]).toEqual(new URL('/api/session', 'https://mandate.example'));
  });

  it('uses persisted task endpoints and sends cancellation with the latest CAS version', async () => {
    const storage = new MemoryStorage();
    const session = { clientId: 'c'.repeat(48), accessToken, refreshToken, expiresAt: Date.now() + 3_600_000, principal };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-1', principalId: principal, state: 'received', version: 0, lastEventId: 'event-0' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: { id: 'task-1', principalId: principal, state: 'received', version: 0, lastEventId: 'event-0' }, data: { summary: 'Review work' }, events: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, record: { id: 'task-1', principalId: principal, state: 'cancelled', version: 5, lastEventId: 'event-1' }, event: { id: 'event-1', taskId: 'task-1', principalId: principal, from: 'received', to: 'cancelled', version: 5, occurredAt: 100, data: {} } }), { status: 201 }));
    const task = await createWorkspaceTask('Review work', session, storage, fetcher, 'https://mandate.example');
    expect(task.state).toBe('received');
    const detail = await getWorkspaceTask(task.id, session, storage, fetcher, 'https://mandate.example');
    expect(detail.data).toEqual({ summary: 'Review work' });
    const cancelled = await cancelWorkspaceTask({ ...task, version: 4 }, session, storage, fetcher, 'https://mandate.example');
    expect(cancelled.record.state).toBe('cancelled');
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/api/tasks', '/api/tasks/task-1', '/api/tasks/task-1/events']);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(`Bearer ${accessToken}`);
    const body = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)) as { expectedVersion: number; to: string };
    expect(body).toEqual(expect.objectContaining({ expectedVersion: 4, to: 'cancelled' }));
  });

  it('does not silently accept a task failure or malformed stored token session', async () => {
    const storage = new MemoryStorage();
    const session = { clientId: 'c'.repeat(48), accessToken, refreshToken, expiresAt: Date.now() + 3_600_000, principal };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
    await expect(getWorkspaceTask('missing', session, storage, fetcher, 'https://mandate.example')).rejects.toThrow('not_found');
    storage.setItem('mandate.workspace.oauth.v1', '{broken');
    expect(readWorkspaceSession(storage)).toBeUndefined();
    expect(storage.getItem('mandate.workspace.oauth.v1')).toBeNull();
  });

  it('revokes both OAuth tokens before clearing the workspace session', async () => {
    const storage = new MemoryStorage();
    storage.setItem('mandate.workspace.oauth.v1', 'present');
    const session = { clientId: 'c'.repeat(48), accessToken, refreshToken, expiresAt: Date.now() + 3_600_000, principal };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await disconnectWorkspaceSession(session, storage, fetcher, 'https://mandate.example');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(storage.getItem('mandate.workspace.oauth.v1')).toBeNull();
  });

  it('rotates refresh tokens and uses the rotated token on later requests', async () => {
    const storage = new MemoryStorage();
    const initial = { clientId: 'c'.repeat(48), accessToken, refreshToken, expiresAt: 0, principal };
    storage.setItem('mandate.workspace.oauth.v1', JSON.stringify(initial));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'b'.repeat(48), refresh_token: 's'.repeat(48), expires_in: 3600 }), { status: 200 }));
    const refreshed = await getWorkspaceAccessToken({ session: initial, storage, origin: 'https://mandate.example', fetcher, now: 10_000 });
    expect(refreshed.refreshToken).toBe('s'.repeat(48));
    const stored = readWorkspaceSession(storage);
    expect(stored?.accessToken).toBe('b'.repeat(48));
    expect(stored?.refreshToken).toBe('s'.repeat(48));
  });

  it('only offers cancellation for states that have a backend cancellation transition', () => {
    expect(canCancelWorkspaceTask('received')).toBe(true);
    expect(canCancelWorkspaceTask('execution_started')).toBe(true);
    expect(canCancelWorkspaceTask('succeeded')).toBe(false);
    expect(canCancelWorkspaceTask('unsupported')).toBe(false);
  });

  it('revokes a newly exchanged token pair when the API identity does not match the owner', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'c'.repeat(48) }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, scope: 'mandate:policy offline_access' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ principalId: '0x2222222222222222222222222222222222222222', clientId: 'c'.repeat(48), scopes: ['mandate:policy'] }), { status: 200 }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const authorize = new URL(await beginWorkspaceOAuth({ origin: 'https://mandate.example', principal, storage, fetcher }));
    const callback = new URL(`https://mandate.example/?code=one&state=${authorize.searchParams.get('state')}`);
    await expect(completeWorkspaceOAuth({ url: callback, storage, fetcher })).rejects.toThrow(/did not match/);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(storage.getItem('mandate.workspace.oauth.v1')).toBeNull();
    expect(fetcher.mock.calls.slice(3).map(([, init]) => new URLSearchParams(String(init?.body)).get('token'))).toEqual([accessToken, refreshToken]);
  });

  it('coalesces concurrent refreshes for the same rotating refresh token', async () => {
    const storage = new MemoryStorage();
    const session = { clientId: 'c'.repeat(48), accessToken, refreshToken, expiresAt: 0, principal };
    storage.setItem('mandate.workspace.oauth.v1', JSON.stringify(session));
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    const first = getWorkspaceAccessToken({ session, storage, origin: 'https://mandate.example', fetcher, now: 100_000 });
    const second = getWorkspaceAccessToken({ session, storage, origin: 'https://mandate.example', fetcher, now: 100_000 });
    await Promise.resolve();
    resolveResponse?.(new Response(JSON.stringify({ access_token: 'b'.repeat(48), refresh_token: 's'.repeat(48), expires_in: 3600 }), { status: 200 }));
    const [one, two] = await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(one.refreshToken).toBe(two.refreshToken);
    expect(two.refreshToken).toBe('s'.repeat(48));
  });
});
