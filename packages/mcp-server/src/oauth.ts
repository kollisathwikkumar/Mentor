import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_ISSUER = 'https://mandate-console.pages.dev';
export const OAUTH_RESOURCE = `${OAUTH_ISSUER}/mcp`;
export const SUPPORTED_MCP_SCOPES = ['mandate:read', 'mandate:transfer', 'mandate:propose'] as const;
export type McpScope = typeof SUPPORTED_MCP_SCOPES[number];
type OAuthScope = McpScope | 'offline_access';

interface SqlResult {
  readonly success: boolean;
  readonly meta?: { readonly changes?: number };
}

interface SqlStatement {
  bind(...values: readonly (number | string)[]): SqlStatement;
  first<Row>(): Promise<Row | null>;
  run(): Promise<SqlResult>;
}

export interface OAuthDatabase {
  prepare(query: string): SqlStatement;
  batch(statements: readonly SqlStatement[]): Promise<readonly SqlResult[]>;
}

export interface OAuthEnvironment {
  readonly MCP_BEARER_TOKEN?: string;
  readonly MCP_ACTIVITY_DB?: OAuthDatabase;
}

interface ClientRow {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris_json: string;
}

interface AuthorizationRow {
  readonly id: string;
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly scopes_json: string;
  readonly resource: string;
  readonly state: string | null;
  readonly expires_at_ms: number;
}

interface TokenRow {
  readonly client_id: string;
  readonly token_type: 'access' | 'refresh';
  readonly scopes_json: string;
  readonly resource: string;
  readonly expires_at_ms: number;
  readonly revoked_at_ms: number | null;
}

export interface VerifiedMcpToken {
  readonly clientId: string;
  readonly scopes: readonly McpScope[];
  readonly resource: string;
}

const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 16_384;
const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomSecret(byteLength = 32): string {
  return encodeBase64Url(randomBytes(byteLength));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  try {
    const actual = new URL(requested);
    const allowed = new URL(registered);
    const loopback = (url: URL): boolean => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return loopback(actual) && loopback(allowed)
      && actual.protocol === allowed.protocol && actual.hostname === allowed.hostname
      && actual.pathname === allowed.pathname && actual.search === allowed.search
      && actual.username === '' && actual.password === '' && actual.hash === '';
  } catch {
    return false;
  }
}

function htmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function response(body: BodyInit | null, status = 200, headers: HeadersInit = {}): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set('Cache-Control', 'no-store');
  resultHeaders.set('Pragma', 'no-cache');
  resultHeaders.set('X-Content-Type-Options', 'nosniff');
  resultHeaders.set('Referrer-Policy', 'no-referrer');
  return new Response(body, { status, headers: resultHeaders });
}

function json(body: unknown, status = 200): Response {
  return response(JSON.stringify(body), status, { 'Content-Type': 'application/json; charset=utf-8' });
}

function oauthError(error: string, status = 400, description?: string): Response {
  return json({ error, ...(description ? { error_description: description } : {}) }, status);
}

function html(title: string, content: string, status = 200): Response {
  const doc = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>body{margin:0;background:#090b0a;color:#e7ebe5;font:16px system-ui,sans-serif}.wrap{max-width:560px;margin:8vh auto;padding:28px;border:1px solid #363d38;background:#111412}h1{font-size:23px}p,li{color:#b3bab4;line-height:1.55}label{display:block;margin:22px 0 8px}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #555;background:#090b0a;color:#fff}button{margin-top:16px;padding:12px 18px;border:0;background:#d4ff72;color:#10120e;font-weight:700;cursor:pointer}.muted{font-size:13px;color:#949b94}code{overflow-wrap:anywhere}</style><main class="wrap"><h1>${htmlEscape(title)}</h1>${content}</main></html>`;
  return response(doc, status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
  });
}

async function readBody(request: Request): Promise<string | undefined> {
  const text = await request.text();
  return encoder.encode(text).length <= MAX_BODY_BYTES ? text : undefined;
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const text = await readBody(request);
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function formBody(request: Request): Promise<URLSearchParams | undefined> {
  const text = await readBody(request);
  return text === undefined ? undefined : new URLSearchParams(text);
}

function parseScopes(value: string | undefined, defaults: readonly OAuthScope[] = ['mandate:read', 'mandate:transfer', 'mandate:propose']): OAuthScope[] | undefined {
  const scopes = value === undefined || value.trim() === '' ? [...defaults] : [...new Set(value.trim().split(/\s+/))];
  if (scopes.some((scope) => scope !== 'offline_access' && !SUPPORTED_MCP_SCOPES.includes(scope as McpScope))) return undefined;
  return scopes as OAuthScope[];
}

function scopesFromJson(value: string): McpScope[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((scope): scope is string => typeof scope === 'string')) return undefined;
    const scopes = parseScopes(parsed.join(' '), []);
    return scopes ? scopes.filter((scope): scope is McpScope => scope !== 'offline_access') : undefined;
  } catch {
    return undefined;
  }
}

function tokenScopeString(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((scope): scope is string => typeof scope === 'string')) return undefined;
    const scopes = parseScopes(parsed.join(' '), []);
    return scopes?.join(' ');
  } catch {
    return undefined;
  }
}

function toClient(row: ClientRow): { clientId: string; clientName: string; redirectUris: string[] } | undefined {
  try {
    const redirectUris: unknown = JSON.parse(row.redirect_uris_json);
    if (!Array.isArray(redirectUris) || !redirectUris.every((uri): uri is string => typeof uri === 'string')) return undefined;
    return { clientId: row.client_id, clientName: row.client_name, redirectUris };
  } catch {
    return undefined;
  }
}

async function findClient(database: OAuthDatabase, clientId: string): Promise<ReturnType<typeof toClient>> {
  const row = await database.prepare('SELECT client_id, client_name, redirect_uris_json FROM oauth_clients WHERE client_id = ?')
    .bind(clientId).first<ClientRow>();
  return row ? toClient(row) : undefined;
}

function hasChanges(result: SqlResult | undefined): boolean {
  return result?.success === true && result.meta?.changes === 1;
}

function issuerFor(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function resourceFor(url: URL): string {
  return `${issuerFor(url)}/mcp`;
}

function htmlForm(requestUrl: URL, requestId: string, clientName: string, redirectUri: string, scopes: readonly McpScope[]): string {
  const scopeLabels: Record<McpScope, string> = {
    'mandate:read': 'Read mandate status on Monad Testnet',
    'mandate:transfer': 'Request transfers within a mandate’s onchain limits (MCP client confirmation may be required)',
    'mandate:propose': 'Generate a review-only mandate proposal with the configured model provider',
  };
  const scopeItems = scopes.map((scope) => `<li>${htmlEscape(scopeLabels[scope])}</li>`).join('');
  return `<p><b>${htmlEscape(clientName)}</b> is requesting access to Mandate.</p><p>Redirect after approval: <code>${htmlEscape(redirectUri)}</code></p><ul>${scopeItems}</ul><form method="post" action="${htmlEscape(`${requestUrl.origin}/oauth/authorize`)}"><input type="hidden" name="request_id" value="${htmlEscape(requestId)}"><label for="access-token">Mandate access token</label><input id="access-token" name="access_token" type="password" autocomplete="current-password" required minlength="32"><p class="muted">This token is sent only to mandate-console.pages.dev over HTTPS. It is not sent to the MCP client.</p><button type="submit">Approve client access</button></form>`;
}

export async function handleOAuthRequest(request: Request, env: OAuthEnvironment): Promise<Response> {
  const database = env.MCP_ACTIVITY_DB;
  if (!database) return oauthError('temporarily_unavailable', 503, 'OAuth storage is not configured.');
  const url = new URL(request.url);
  const path = url.pathname;
  const expectedResource = resourceFor(url);

  if (request.method === 'OPTIONS') {
    return response(null, 204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
  }

  if (path === '/oauth/register' && request.method === 'POST') {
    const body = await jsonBody(request);
    if (!body) return oauthError('invalid_client_metadata', 400, 'A small JSON client-registration document is required.');
    const name = typeof body.client_name === 'string' ? body.client_name.trim() : '';
    const redirectUris = body.redirect_uris;
    if (name.length < 1 || name.length > 128 || !Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 10
      || !redirectUris.every((uri): uri is string => typeof uri === 'string' && uri.length <= 2048 && validRedirectUri(uri))) {
      return oauthError('invalid_client_metadata', 400, 'Use a client name and one to ten HTTPS or loopback redirect URIs.');
    }
    if (new Set(redirectUris).size !== redirectUris.length) return oauthError('invalid_client_metadata', 400, 'Redirect URIs must be unique.');
    const clientId = randomSecret();
    const now = Date.now();
    const result = await database.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris_json, created_at_ms) VALUES (?, ?, ?, ?)')
      .bind(clientId, name, JSON.stringify(redirectUris), now).run();
    if (!result.success) return oauthError('server_error', 500);
    return json({
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201);
  }

  if (path === '/oauth/authorize' && request.method === 'GET') {
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const challenge = url.searchParams.get('code_challenge') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const client = await findClient(database, clientId);
    const requestedScopes = parseScopes(url.searchParams.get('scope') ?? undefined);
    const scopes = requestedScopes?.filter((scope): scope is McpScope => scope !== 'offline_access');
    const resource = url.searchParams.get('resource') ?? expectedResource;
    if (!client || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256'
      || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || state.length > 1024 || !requestedScopes || !scopes
      || !client.redirectUris.some((registered) => redirectUriMatches(redirectUri, registered)) || resource !== expectedResource) {
      return html('Mandate sign-in could not start', '<p>The client registration or authorization request is invalid. Reconnect the client and try again.</p>', 400);
    }
    const requestId = randomSecret();
    const expiresAt = Date.now() + AUTHORIZATION_TTL_MS;
    const result = await database.prepare('INSERT INTO oauth_authorization_requests (request_id, client_id, redirect_uri, code_challenge, scopes_json, resource, state, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sha256(requestId), client.clientId, redirectUri, challenge, JSON.stringify(requestedScopes), resource, state || '', expiresAt).run();
    if (!result.success) return oauthError('temporarily_unavailable', 503);
    return html('Connect to Mandate', htmlForm(url, requestId, client.clientName, redirectUri, scopes));
  }

  if (path === '/oauth/authorize' && request.method === 'POST') {
    const form = await formBody(request);
    const requestId = form?.get('request_id') ?? '';
    const accessToken = form?.get('access_token') ?? '';
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return html('Sign-in failed', '<p>Authorization form origin did not match Mandate.</p>', 403);
    if (!form || !requestId || !accessToken || !env.MCP_BEARER_TOKEN || !safeEquals(accessToken, env.MCP_BEARER_TOKEN)) {
      return html('Sign-in failed', '<p>That token was not accepted. Close this tab and retry from your MCP client.</p>', 401);
    }
    const row = await database.prepare('SELECT request_id AS id, client_id, redirect_uri, code_challenge, scopes_json, resource, state, expires_at_ms FROM oauth_authorization_requests WHERE request_id = ? AND expires_at_ms > ?')
      .bind(sha256(requestId), Date.now()).first<AuthorizationRow>();
    if (!row || row.resource !== expectedResource) return html('Authorization request expired', '<p>Return to your MCP client and start the connection again.</p>', 400);
    const clientRow = await database.prepare('SELECT client_id, client_name, redirect_uris_json FROM oauth_clients WHERE client_id = ?').bind(row.client_id).first<ClientRow>();
    const client = clientRow ? toClient(clientRow) : undefined;
    if (!client || !client.redirectUris.some((registered) => redirectUriMatches(row.redirect_uri, registered))) {
      return html('Authorization request expired', '<p>The registered client is no longer valid. Reconnect the client.</p>', 400);
    }
    const code = randomSecret();
    const codeExpires = Date.now() + AUTHORIZATION_TTL_MS;
    const results = await database.batch([
      database.prepare('DELETE FROM oauth_authorization_requests WHERE request_id = ? AND expires_at_ms > ?').bind(sha256(requestId), Date.now()),
      database.prepare('INSERT INTO oauth_authorization_codes (code_hash, client_id, redirect_uri, code_challenge, scopes_json, resource, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(sha256(code), row.client_id, row.redirect_uri, row.code_challenge, row.scopes_json, row.resource, codeExpires),
    ]);
    if (!hasChanges(results[0]) || !results[1]?.success) return html('Authorization request expired', '<p>Return to your MCP client and start the connection again.</p>', 400);
    const destination = new URL(row.redirect_uri);
    destination.searchParams.set('code', code);
    if (row.state) destination.searchParams.set('state', row.state);
    return response(null, 302, { Location: destination.toString() });
  }

  if (path === '/oauth/token' && request.method === 'POST') {
    const form = await formBody(request);
    if (!form) return oauthError('invalid_request', 400);
    const grantType = form.get('grant_type');
    const clientId = form.get('client_id') ?? '';
    const requestedResource = form.get('resource');
    const client = await findClient(database, clientId);
    if (!client) return oauthError('invalid_client', 401);
    if (requestedResource !== null && requestedResource !== expectedResource) return oauthError('invalid_target', 400);
    const now = Date.now();
    if (grantType === 'authorization_code') {
      const code = form.get('code') ?? '';
      const redirectUri = form.get('redirect_uri') ?? '';
      const verifier = form.get('code_verifier') ?? '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError('invalid_grant', 400);
      const row = await database.prepare('SELECT code_hash, client_id, redirect_uri, code_challenge, scopes_json, resource, expires_at_ms FROM oauth_authorization_codes WHERE code_hash = ? AND expires_at_ms > ?')
        .bind(sha256(code), now).first<AuthorizationRow>();
      if (!row || row.client_id !== clientId || !redirectUriMatches(redirectUri, row.redirect_uri) || row.resource !== expectedResource) return oauthError('invalid_grant', 400);
      if (encodeBase64Url(createHash('sha256').update(verifier, 'utf8').digest()) !== row.code_challenge) return oauthError('invalid_grant', 400);
      const scopes = scopesFromJson(row.scopes_json);
      const responseScope = tokenScopeString(row.scopes_json);
      if (!scopes || responseScope === undefined) return oauthError('invalid_scope', 400);
      const tokenScopes = responseScope ? responseScope.split(' ') : [];
      const accessToken = randomSecret();
      const refreshToken = randomSecret(48);
      const results = await database.batch([
        database.prepare('DELETE FROM oauth_authorization_codes WHERE code_hash = ? AND expires_at_ms > ?').bind(sha256(code), now),
        database.prepare("INSERT INTO oauth_tokens (token_hash, client_id, token_type, scopes_json, resource, expires_at_ms, revoked_at_ms) VALUES (?, ?, 'access', ?, ?, ?, NULL)")
          .bind(sha256(accessToken), clientId, JSON.stringify(tokenScopes), expectedResource, now + ACCESS_TTL_SECONDS * 1000),
        database.prepare("INSERT INTO oauth_tokens (token_hash, client_id, token_type, scopes_json, resource, expires_at_ms, revoked_at_ms) VALUES (?, ?, 'refresh', ?, ?, ?, NULL)")
          .bind(sha256(refreshToken), clientId, JSON.stringify(tokenScopes), expectedResource, now + REFRESH_TTL_SECONDS * 1000),
      ]);
      if (!hasChanges(results[0]) || !results[1]?.success || !results[2]?.success) return oauthError('invalid_grant', 400);
      return json({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: refreshToken, scope: responseScope });
    }
    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? '';
      const row = await database.prepare("SELECT client_id, token_type, scopes_json, resource, expires_at_ms, revoked_at_ms FROM oauth_tokens WHERE token_hash = ? AND token_type = 'refresh'")
        .bind(sha256(refreshToken)).first<TokenRow>();
      if (!row || row.client_id !== clientId || row.revoked_at_ms !== null || row.expires_at_ms <= now || row.resource !== expectedResource) return oauthError('invalid_grant', 400);
      const oldScopes = tokenScopeString(row.scopes_json)?.split(' ');
      if (!oldScopes) return oauthError('invalid_scope', 400);
      const scopeParam = form.get('scope');
      const scopes = scopeParam ? parseScopes(scopeParam, []) : oldScopes;
      if (!scopes || scopes.some((scope) => !oldScopes.includes(scope))) return oauthError('invalid_scope', 400);
      const accessToken = randomSecret();
      const nextRefreshToken = randomSecret(48);
      const results = await database.batch([
        database.prepare("UPDATE oauth_tokens SET revoked_at_ms = ? WHERE token_hash = ? AND token_type = 'refresh' AND revoked_at_ms IS NULL AND expires_at_ms > ?")
          .bind(now, sha256(refreshToken), now),
        database.prepare("INSERT INTO oauth_tokens (token_hash, client_id, token_type, scopes_json, resource, expires_at_ms, revoked_at_ms) VALUES (?, ?, 'access', ?, ?, ?, NULL)")
          .bind(sha256(accessToken), clientId, JSON.stringify(scopes), expectedResource, now + ACCESS_TTL_SECONDS * 1000),
        database.prepare("INSERT INTO oauth_tokens (token_hash, client_id, token_type, scopes_json, resource, expires_at_ms, revoked_at_ms) VALUES (?, ?, 'refresh', ?, ?, ?, NULL)")
          .bind(sha256(nextRefreshToken), clientId, JSON.stringify(scopes), expectedResource, now + REFRESH_TTL_SECONDS * 1000),
      ]);
      if (!hasChanges(results[0]) || !results[1]?.success || !results[2]?.success) return oauthError('invalid_grant', 400);
      return json({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: nextRefreshToken, scope: scopes.join(' ') });
    }
    return oauthError('unsupported_grant_type', 400);
  }

  if (path === '/oauth/revoke' && request.method === 'POST') {
    const form = await formBody(request);
    if (!form) return oauthError('invalid_request', 400);
    const client = await findClient(database, form.get('client_id') ?? '');
    if (!client) return oauthError('invalid_client', 401);
    const token = form.get('token') ?? '';
    await database.prepare('UPDATE oauth_tokens SET revoked_at_ms = ? WHERE token_hash = ? AND client_id = ?')
      .bind(Date.now(), sha256(token), client.clientId).run();
    return response(null, 200);
  }

  return oauthError('not_found', 404);
}

export async function verifyOAuthAccessToken(database: OAuthDatabase, token: string, expectedResource = OAUTH_RESOURCE): Promise<VerifiedMcpToken | undefined> {
  if (token.length < 32 || token.length > 256) return undefined;
  const row = await database.prepare("SELECT client_id, token_type, scopes_json, resource, expires_at_ms, revoked_at_ms FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access'")
    .bind(sha256(token)).first<TokenRow>();
  if (!row || row.revoked_at_ms !== null || row.expires_at_ms <= Date.now() || row.resource !== expectedResource) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(row.scopes_json); } catch { return undefined; }
  if (!Array.isArray(parsed) || !parsed.every((scope): scope is string => typeof scope === 'string')) return undefined;
  const scopes = parseScopes(parsed.join(' '), []);
  if (!scopes) return undefined;
  return { clientId: row.client_id, scopes: scopes.filter((scope): scope is McpScope => scope !== 'offline_access'), resource: row.resource };
}
