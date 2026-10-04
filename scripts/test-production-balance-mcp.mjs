import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { privateKeyToAccount } from 'viem/accounts';
import { buildWalletSignInMessage } from '../packages/mcp-server/dist/oauth.js';

const endpoint = process.env.VITE_MANDATE_MCP_URL ?? 'https://mandate-console.pages.dev/mcp';
const endpointUrl = new URL(endpoint);
const baseUrl = endpointUrl.origin;
const redirectUri = 'https://mandate.invalid/oauth/callback';
const resource = endpoint;
const testAccount = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');
const client = new Client({ name: 'mandate-hosted-balance-read-verification', version: '1.0.0' }, { capabilities: {} });
let registration;
let tokens;

async function postForm(path, fields) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

try {
  const registrationResponse = await fetch(`${baseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Mandate hosted balance-read verification', redirect_uris: [redirectUri] }),
  });
  assert.equal(registrationResponse.status, 201, 'Hosted OAuth dynamic registration must work.');
  registration = await registrationResponse.json();

  const authorizeUrl = new URL('/oauth/authorize', baseUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code', client_id: registration.client_id, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256',
    scope: 'mandate:balance offline_access', state, resource,
  }).toString();
  const pageResponse = await fetch(authorizeUrl);
  assert.equal(pageResponse.status, 200, 'Hosted OAuth authorization page must load.');
  const page = await pageResponse.text();
  assert.match(page, /Read your native MON balance on Monad Testnet/);
  assert.match(page, /balance, proposal, and transfer stay off unless you select them/);
  const field = (name) => page.match(new RegExp(`name="${name}" value="([A-Za-z0-9_-]+)"`))?.[1];
  const requestId = field('request_id');
  const walletNonce = field('wallet_nonce');
  const issuedAtMs = Number(field('issued_at_ms'));
  const expiresAtMs = Number(field('expires_at_ms'));
  assert.ok(requestId && walletNonce && Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs));
  const message = buildWalletSignInMessage({
    address: testAccount.address, clientName: registration.client_name,
    expiresAtMs, issuedAtMs, origin: baseUrl, resource, walletNonce,
  });
  const signature = await testAccount.signMessage({ message });
  const approvalResponse = await postForm('/oauth/authorize', {
    request_id: requestId, wallet_address: testAccount.address,
    wallet_signature: signature, granted_scope: 'mandate:balance',
  });
  assert.equal(approvalResponse.status, 302, 'Hosted owner login should accept a nonce-bound balance-only signature.');
  const callback = new URL(approvalResponse.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), state);

  const tokenResponse = await postForm('/oauth/token', {
    grant_type: 'authorization_code', client_id: registration.client_id,
    redirect_uri: redirectUri, code: callback.searchParams.get('code') ?? '', code_verifier: verifier, resource,
  });
  assert.equal(tokenResponse.status, 200, 'Hosted PKCE exchange should issue the balance-only test token.');
  tokens = await tokenResponse.json();
  assert.equal(tokens.scope, 'mandate:balance offline_access');

  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
  }));
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  assert.deepEqual(tools, ['get_my_monad_balance'], 'Balance-only consent must not expose mandate status, proposal, or transfer tools.');
  const balanceResult = await client.callTool({ name: 'get_my_monad_balance', arguments: {} });
  assert.equal(balanceResult.isError, undefined, 'Hosted owner balance tool should complete through live Monad RPC.');
  const balanceText = balanceResult.content.find((part) => part.type === 'text')?.text;
  assert.ok(balanceText, 'Hosted balance tool should return structured data.');
  const balance = JSON.parse(balanceText);
  assert.equal(balance.address.toLowerCase(), testAccount.address.toLowerCase());
  assert.ok(/^\d+$/.test(balance.balanceWei));
  assert.ok(/^\d+(?:\.\d+)?$/.test(balance.balanceMon));
  process.stdout.write('PASS: production OAuth, owner signature, PKCE, balance-only scope, isolated tool discovery, and live Monad balance read completed; no transaction requested.\n');
} finally {
  await client.close().catch(() => undefined);
  if (registration && tokens?.access_token) {
    await postForm('/oauth/revoke', { client_id: registration.client_id, token: tokens.access_token, token_type_hint: 'access_token' }).catch(() => undefined);
  }
  if (registration && tokens?.refresh_token) {
    await postForm('/oauth/revoke', { client_id: registration.client_id, token: tokens.refresh_token, token_type_hint: 'refresh_token' }).catch(() => undefined);
  }
}
