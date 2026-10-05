import { z } from 'zod';
import { D1PolicyStore, type D1DatabaseLike, type TaskListCursor, type TaskState } from '@mandate/connectors';
import { verifyOAuthAccessToken, type OAuthDatabase } from '@mandate/mcp-server/oauth';

interface TaskApiEnvironment {
  readonly MCP_ACTIVITY_DB?: OAuthDatabase & D1DatabaseLike;
  readonly MCP_ALLOWED_ORIGINS?: string;
}
interface PagesRequestContext { readonly request: Request; readonly env: TaskApiEnvironment; }

const MAX_BODY_BYTES = 16_384;
const createSchema = z.object({ summary: z.string().trim().min(1).max(8_000) }).strict();
const transitionSchema = z.object({
  expectedVersion: z.number().int().nonnegative().safe(),
  to: z.enum(['clarification_required', 'proposal_ready', 'unsupported', 'cancelled']),
  data: z.record(z.string().min(1).max(64), z.union([z.string().max(4_000), z.number().finite(), z.boolean()])).default({}),
}).strict();
const cursorSchema = z.object({ createdAt: z.number().int().nonnegative().safe(), id: z.string().min(1).max(128) }).strict();

function decodeCursor(value: string | null): TaskListCursor | undefined {
  if (!value) return undefined;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new RangeError('Invalid task cursor');
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const parsed: unknown = JSON.parse(atob(base64));
    return cursorSchema.parse(parsed);
  } catch { throw new RangeError('Invalid task cursor'); }
}

function encodeCursor(value: TaskListCursor): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new RangeError('Request body too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new RangeError('Request body too large');
  return JSON.parse(text) as unknown;
}

export async function onRequest({ request, env }: PagesRequestContext): Promise<Response> {
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin) {
    const origins = new Set((env.MCP_ALLOWED_ORIGINS ?? 'https://mandate-console.pages.dev').split(',').map((origin) => origin.trim()).filter(Boolean));
    if (!origins.has(requestOrigin)) return response({ error: 'origin_not_allowed' }, 403);
  }
  if (!['GET', 'POST'].includes(request.method)) return response({ error: 'method_not_allowed' }, 405);
  if (!env.MCP_ACTIVITY_DB) return response({ error: 'task_storage_unavailable' }, 503);
  const accessToken = request.headers.get('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!accessToken) return response({ error: 'unauthorized' }, 401);
  const resource = `${new URL(request.url).origin}/mcp`;
  const verified = await verifyOAuthAccessToken(env.MCP_ACTIVITY_DB, accessToken, resource).catch(() => undefined);
  if (!verified || !verified.scopes.includes('mandate:policy')) return response({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/tasks\/?/, '');
  const parts = rest ? rest.split('/').filter(Boolean) : [];
  const store = new D1PolicyStore(env.MCP_ACTIVITY_DB);
  const principalId = verified.principalAddress;
  const now = Math.floor(Date.now() / 1000);
  try {
    if (parts.length === 0 && request.method === 'GET') {
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 20 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return response({ error: 'invalid_limit' }, 400);
      const cursor = decodeCursor(url.searchParams.get('cursor'));
      const result = await store.listTasks(principalId, limit + 1, cursor);
      const hasMore = result.length > limit;
      const tasks = hasMore ? result.slice(0, limit) : result;
      const last = tasks.at(-1);
      return response({ tasks, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.task.id }) : null });
    }
    if (parts.length === 0 && request.method === 'POST') {
      const input = createSchema.parse(await readJson(request));
      const id = crypto.randomUUID();
      const initialEventId = crypto.randomUUID();
      await store.createTask({ id, principalId, state: 'received', version: 0, lastEventId: initialEventId }, { summary: input.summary }, now);
      return response({ id, principalId, state: 'received', version: 0, lastEventId: initialEventId }, 201);
    }

    if (parts.length === 1 && request.method === 'GET') {
      const id = parts[0]!;
      const record = await store.getTask(id, principalId);
      if (!record) return response({ error: 'not_found' }, 404);
      return response({ task: record, data: await store.getTaskData(id, principalId), events: await store.listTaskEvents(id, principalId) });
    }

    if (parts.length === 2 && parts[1] === 'events' && request.method === 'POST') {
      const id = parts[0]!;
      if (!await store.getTask(id, principalId)) return response({ error: 'not_found' }, 404);
      const input = transitionSchema.parse(await readJson(request));
      const result = await store.transitionTask({ taskId: id, principalId, expectedVersion: input.expectedVersion,
        to: input.to as TaskState, eventId: crypto.randomUUID(), occurredAt: now, data: input.data });
      if (!result.ok) return response(result, result.reason === 'NOT_OWNER' ? 404 : 409);
      return response(result, 201);
    }
    return response({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) return response({ error: 'invalid_request' }, 400);
    return response({ error: 'task_operation_failed' }, 500);
  }
}
