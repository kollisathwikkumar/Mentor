# Mandate MCP Connection Guide

This guide explains how an AI client connects to Mandate, how user identity and consent are established, what the server exposes, and how to diagnose a failed connection.

## 1. What is being connected

Mandate exposes an MCP server over **remote Streamable HTTP**. A client such as a supported agent host connects to the service endpoint, discovers tools, and invokes only the capabilities granted to its authenticated identity.

- **Hosted MCP endpoint:** `https://mandate-console.pages.dev/mcp`
- **MCP service status:** `https://mandate-console.pages.dev/mcp/status`
- **Authorization-server metadata:** `https://mandate-console.pages.dev/.well-known/oauth-authorization-server`
- **Protected-resource metadata:** `https://mandate-console.pages.dev/.well-known/oauth-protected-resource/mcp`
- **MCP page in the console:** `https://mandate-console.pages.dev/#/connections`

The server is transport- and model-vendor-neutral. A client must support remote Streamable HTTP MCP. For the normal user flow it must also support OAuth authorization with PKCE, open the authorization page in a browser, and return the authorization code to the client.

> **Important distinction:** the console's Workspace conversation is currently a local draft UI. It is not the remote AI agent and does not itself send tasks to an agent. The actual remote connection is made by adding the hosted MCP URL in an MCP-capable client.

## 2. Recommended user flow: OAuth

OAuth is the normal per-user connection path. It binds the MCP client to the Mandate account the user signs into and lets the user approve individual capabilities. It does not require copying a server-wide MCP secret into an AI client.

### Step A — prepare the account and permission

1. Open the Mandate console and go to **Workspace** (`/#/workspace`).
2. Create or unlock a passkey, or connect the existing EVM wallet that owns the Mandate permission.
3. If the agent will execute a transfer, create and authorize the onchain permission separately. The current contract permission specifies an agent signer, one fixed recipient, a per-action MON limit, a total MON limit, and an expiry. Funding the permission is a separate transaction.
4. Use the same account in the later MCP sign-in. A new passkey creates a new account; it will not automatically own permissions created by a different wallet/passkey account.

Creating an MCP connection does not create, fund, or execute a mandate. The user still controls the onchain permission and can revoke it.

### Step B — add the endpoint to the AI client

1. Open the console's **MCP** page (`/#/connections`) and copy the hosted MCP URL.
2. In the AI client, add a **remote MCP server** and select **Streamable HTTP** (or the client's equivalent remote HTTP MCP transport).
3. Paste `https://mandate-console.pages.dev/mcp` as the server URL. Do not paste a token into the URL.
4. Save/connect the server. The client discovers Mandate's protected-resource and authorization-server metadata and starts OAuth. If the client asks for a manual authentication mode, use its OAuth/authorization-code-with-PKCE flow; do not use an end-user shared bearer token.

### Step C — review and approve the requested capabilities

Mandate opens its consent page in the client's browser. The page identifies the requesting client and lists only scopes that client requested. The user must select at least one capability; transfer, balance, and proposal are not silently added by Mandate.

Sign in with either:

- **Create a passkey:** creates a new Mandate EVM identity. Use this identity for any permission that should be owned by this account.
- **Continue with my passkey:** unlocks the existing Mandate identity on the authenticator.
- **Use an existing wallet instead:** connects an EVM wallet and requests a free message signature.

The signature is a nonce-bound sign-in proof for the client, Mandate origin, and `/mcp` resource on Monad Testnet (chain ID `10143`). It is **not a blockchain transaction** and does not send MON. Passkeys require a browser/authenticator that supports the WebAuthn PRF flow used by this app; use the wallet option if the passkey flow is unavailable.

After consent, the browser returns a short-lived authorization code to the client. The client exchanges it using PKCE and receives an access token. The client then sends MCP requests with `Authorization: Bearer <access-token>`. Mandate validates the token, resource, expiry, revocation state, scopes, and account before serving the tool call.

### Step D — verify the connection

- In the client, inspect its MCP/server panel and confirm Mandate is connected and tools are listed.
- In Codex CLI, use `/mcp verbose` to inspect live connections and exposed tools.
- On the console MCP page, click **Check service**. `ready: true` means the service is configured. `connected: true` means the service observed an authenticated MCP request during the recent activity window (`activeWindowSeconds`, normally 300 seconds).

The status indicator is based on **recent authenticated request activity**, not a persistent socket and not proof that a client merely saved the URL. A freshly configured client may show the service as ready but waiting until it completes a handshake/request.

## 3. Codex CLI setup

### OAuth connection (recommended)

Use a fresh name if `mandate-cloud` is already configured with a direct bearer token:

```sh
codex mcp add mandate-oauth --url 'https://mandate-console.pages.dev/mcp'
codex mcp login mandate-oauth
codex mcp list
```

`codex mcp login` starts the OAuth sign-in. Finish the Mandate consent and identity steps in the browser, then return to Codex. Restart Codex if it was already open before adding the server. Verify the remote entry is enabled and inspect the tools with `/mcp verbose`.

If you prefer the existing name, remove or rename the old entry first; do not configure two entries with the same name. A previous `mandate-cloud` registration using `--bearer-token-env-var` is the operator-token path below, not the recommended per-user OAuth path.

### Local stdio connection for development

The repository also has a local stdio MCP server. It is useful for development and local tests; it is separate from the Cloudflare-hosted OAuth service.

```sh
npm install
cp .env.example .env.local
npm run build --workspace @mandate/mcp-server
codex mcp add mandate-local -- npm --prefix "$PWD" run start --workspace @mandate/mcp-server
codex mcp list
```

Populate only the local `.env.local` values required by the capabilities you want to test. The local server reads that file through its start script. Do not commit `.env.local`. To remove the local entry later, run `codex mcp remove mandate-local`.

## 4. Operator bearer-token connection (advanced/testing only)

The hosted server also accepts a long, server-configured `MCP_BEARER_TOKEN`. This is an operator credential for controlled testing or administration, not an end-user OAuth identity. It does not bind requests to a user's Mandate account; the server grants all supported scopes to this credential. If a transfer signer is configured, the operator credential can expose the transfer tool. Keep it out of browser code, source control, screenshots, chat, and shared agent configuration.

To use this path in a trusted local Codex CLI process, provision the operator token into the environment as `MANDATE_MCP_TOKEN`, then register it by variable name so the literal value is not written into the MCP command:

```sh
export MANDATE_MCP_TOKEN='<operator token supplied through your secret manager>'
codex mcp add mandate-admin --url 'https://mandate-console.pages.dev/mcp' --bearer-token-env-var MANDATE_MCP_TOKEN
codex mcp list
```

The environment variable must be available to the Codex process whenever it starts. Do not put the token value in the command line, a committed config file, a `VITE_` variable, or a client used by other people. Prefer OAuth for normal use.

## 5. OAuth and storage behavior

The current OAuth implementation uses public-client dynamic registration and authorization code with PKCE S256. Registered redirect URIs must be HTTPS or loopback HTTP. The consent request is short-lived; the sign-in proof is nonce-bound and tied to the selected account and `/mcp` resource.

- Access tokens last **one hour**.
- Refresh tokens last **30 days** and are rotated when used.
- The server stores hashes of issued token values, not plaintext bearer tokens.
- Tokens are scoped to the registered client, the Mandate MCP resource, the user's principal address, and the approved scopes.
- Revocation invalidates the matching token. Expired, revoked, wrong-resource, or otherwise invalid access tokens are rejected.
- OAuth client records, short-lived authorization state, hashed codes/tokens, scopes, and principal addresses are held in D1. The separate `mcp_activity` row stores only an aggregate last-seen timestamp and authenticated-request count; it does not store prompts, tool arguments, or client fingerprints.

OAuth service routes are under `/oauth/` (`register`, `authorize`, `token`, and `revoke`). Discovery is provided by the two `/.well-known/` endpoints listed above.

## 6. Capabilities and what each one means

The client sees only tools allowed by its consent scopes and the server's runtime configuration. A missing tool can therefore mean the relevant scope was not granted or its backend dependency is not configured.

| Consent scope | Tool | Behavior and boundary |
|---|---|---|
| `mandate:read` | `get_mandate_status` | Reads the requested mandate's current Monad state. For OAuth, the authenticated account must own that mandate. Read-only; no signer key needed. |
| `mandate:balance` | `get_my_monad_balance` | Reads only the authenticated account's public native-MON balance. The caller cannot supply a different address. Read-only; optional consent; needs the chain reader configuration. |
| `mandate:propose` | `propose_mandate` | Uses the configured Gemini model adapter to produce a schema-validated proposal or clarification. It is review-only: it cannot create/sign/fund a mandate or submit a transaction. Requires `GEMINI_API_KEY`. |
| `mandate:transfer` | `request_bounded_transfer` | Requests one native-MON transfer under an existing mandate. The caller supplies the mandate ID and amount, not a recipient or signer. The onchain contract independently enforces the fixed recipient, per-call and total limits, expiry, nonce, and revocation. Requires the transfer scope, chain configuration, and backend agent signer; the MCP client may also request its own confirmation. |

The current onchain execution path is specifically a **fixed-recipient native MON transfer on Monad Testnet**. The generic Workspace conversation does not make arbitrary tools or offchain APIs enforceable.

**Metadata note for maintainers:** the OAuth implementation accepts `mandate:balance`, but the current `/.well-known/` scope-advertisement arrays do not list it. Clients that rely only on advertised scopes may not request it. Keep the two discovery documents synchronized with `SUPPORTED_MCP_SCOPES` before relying on automatic balance-scope discovery.

## 7. Cloudflare deployment requirements

For a self-managed or refreshed Cloudflare Pages deployment:

1. Build the console using `npm run build --workspace @mandate/console`. Its `prebuild` runs the release gates before output is produced.
2. Bind D1 as `MCP_ACTIVITY_DB` using `wrangler.jsonc` and apply the repository migrations:
   ```sh
   npx wrangler d1 migrations apply mandate-mcp-activity --remote
   ```
3. Configure server-side Pages runtime secrets/variables as needed:
   - `MCP_BEARER_TOKEN` — optional operator credential; 32+ characters. OAuth works with D1 without enabling this credential.
   - `MANDATE_AGENT_PRIVATE_KEY` — dedicated testnet signer, only if transfer should be available.
   - `GEMINI_API_KEY` — only if review-only proposals should be available.
   - `MONAD_RPC_URL` and `MANDATE_CONTRACT_ADDRESS` — required for onchain status/balance/transfer tools.
   - `MCP_ALLOWED_ORIGINS` — comma-separated exact allowed browser origins when adding origins beyond the default console origin.
4. Set public build-time configuration only for non-secret values, such as `VITE_MANDATE_MCP_URL` and `VITE_MANDATE_DEPLOYMENT_BLOCK`. Never put provider keys, signer keys, or bearer tokens in `VITE_` variables.
5. Deploy and verify `/mcp/status`, the metadata endpoints, a real OAuth consent/login from a test client, and only the intended tools/scopes. Do not validate transfer by sending a real transaction unless that test is explicitly intended and uses a disposable testnet mandate.

The checked-in GitHub workflow runs the console build and its release gates on pull requests and pushes to `main`. A successful Git push alone does not prove a Cloudflare production deployment completed; confirm the Pages deployment and then verify the hosted endpoints.

## 8. Troubleshooting

| Symptom | Checks and next action |
|---|---|
| Client reports `401` / authorization required | Confirm it is configured for OAuth, not an expired direct bearer. Retry `codex mcp login <name>` or reconnect and complete consent. Check `/.well-known/oauth-protected-resource/mcp` and the authorization-server metadata. |
| Browser consent says no capability selected | Select at least one scope requested by the client. The read scope is normally selected initially; optional balance, proposal, or transfer requires explicit selection. |
| Consent succeeds but mandate status says not found/not owned | Sign in with the same wallet/passkey identity that owns the onchain permission. A newly created passkey is a different account from an older wallet. Verify the mandate ID and Monad Testnet network. |
| `mandate:balance` or another tool is missing | Confirm that the client requested and the user approved the scope. Also verify runtime requirements: chain reader for status/balance/transfer, `GEMINI_API_KEY` for proposal, and signer key for transfer. Reconnect after changing scopes/configuration. |
| Service is ready but shows no recent connection | Complete the client's OAuth flow and issue an MCP request, then click **Check service** again. Saving an endpoint does not count as authenticated activity. |
| Service reports not ready or status tracking unavailable | Check the Pages deployment, `MCP_ACTIVITY_DB` binding, D1 migrations, and runtime configuration. Check Pages logs without copying secrets into the report. |
| Local stdio server exits at startup | Build `@mandate/mcp-server`, verify `.env.local` exists and contains only the needed values, and inspect stderr. Keep stdout reserved for MCP protocol traffic. |
| Codex says the MCP server name already exists | Run `codex mcp list`; choose a new name such as `mandate-oauth`, or remove the old registration before adding the OAuth entry. |
| Only `refero` or another unrelated server fails | Inspect `/mcp verbose` for the server name. A separate server's login failure is not evidence that `mandate-cloud` failed; verify Mandate's own connected state and its tool list. |

## 9. Useful verification commands

```sh
# Inspect configured Codex MCP serversI can't open `/Users/chipichipi/Documents/METROPOLIS`. My sandbox is a separate Linux container, not your Mac. Everything below comes from the Mandate MCP guide you attached, so treat it as a ranked list of what to check in the folder, not a code review. If you paste the OAuth and MCP route files, I can review the actual code.

## Most likely reasons Claude or other agents fail to connect

1. **Missing or wrong `WWW-Authenticate` header on 401.** Remote MCP clients, Claude included, discover OAuth from the 401 response. It should carry a `resource_metadata` pointer to `/.well-known/oauth-protected-resource/mcp`. The guide only lists the metadata URLs and never says the 401 points to them. Some clients also probe the non-path-suffixed form `/.well-known/oauth-protected-resource`, which isn't listed.

2. **The `mandate:balance` scope isn't advertised.** The guide admits this. Clients that request only the advertised scopes never ask for it, so the tool never appears. The same bug can break consent: if a client sends no `scope` parameter, the consent page may list nothing, and the guide says at least one capability must be selected. The fix is to sync both discovery documents with `SUPPORTED_MCP_SCOPES` and default to the read scope when none is requested.

3. **Strict resource matching.** Tokens are bound to the `/mcp` resource. If a client sends `resource=https://…/mcp/` with a trailing slash, or the host in a different form, the token can be rejected as "wrong-resource". Normalize the comparison.

4. **Dynamic client registration and redirect URIs.** Only HTTPS or loopback redirects are accepted. Check that registration allows the redirect URIs Claude uses (the claude.ai/claude.com callback, localhost for Claude Code and Desktop). Also confirm the metadata advertises `registration_endpoint`, `S256`, and `token_endpoint_auth_methods_supported: ["none"]`.

5. **Origin checks.** `MCP_ALLOWED_ORIGINS` defaults to the console origin only. Hosted connectors call from the provider's servers rather than a browser, so make sure the origin check doesn't reject requests that have a different Origin header or none at all.

6. **Passkey sign-in may fail in the OAuth browser.** The WebAuthn PRF flow isn't supported everywhere, including in-app browsers on mobile. The wallet fallback needs an injected wallet, which in-app browsers often lack. This can leave users stuck on the consent page, so test on the actual client's browser path.

7. **Everything depends on D1.** OAuth clients, codes and tokens all live in `MCP_ACTIVITY_DB`. A missing binding or an unapplied migration breaks login entirely. A git push doesn't prove the Pages deployment finished.

8. **Refresh-token rotation.** Rotation with 30-day tokens can break clients that retry or refresh concurrently, because the old token is already dead. Consider a short grace window.

## Setup and diagnostic traps

- **`MANDATE_MCP_TOKEN` and macOS.** An `export` in your shell doesn't reach Codex or Claude Desktop launched from the Dock or Finder, so the bearer path fails silently with a 401.
- **Duplicate names.** The old `mandate-cloud` entry with a direct bearer token conflicts with the OAuth setup. Use `mandate-oauth`, or remove the old entry first.
- **Misleading status.** "Connected" in `/mcp/status` means an authenticated request in the last 300 seconds. A saved URL, or a client stuck at login, looks like "ready but not connected".
- **Unrelated failures.** A failing `refero` server doesn't tell you anything about Mandate.
- **No Claude-specific instructions.** The guide is Codex-centric, with no steps for claude.ai custom connectors, Claude Desktop or Claude Code.
- **The Workspace chat isn't an agent.** It is a local draft UI, which can mislead people into expecting it to talk to Claude.
- **Gemini-only proposals.** `propose_mandate` needs `GEMINI_API_KEY`, which sits oddly with the "vendor-neutral" claim.

## Security flaws to fix

- The operator bearer token grants all scopes with no user binding. If a signer key is configured, it exposes `request_bounded_transfer`. Consider removing it from production.
- The transfer path relies on the agent signer key being in the Pages environment. Keep it a disposable testnet key.

## Quick tests from your Mac

```sh
curl -i https://mandate-console.pages.dev/mcp          # expect 401 + WWW-Authenticate with resource_metadata
curl -s https://mandate-console.pages.dev/.well-known/oauth-protected-resource/mcp
curl -s https://mandate-console.pages.dev/.well-known/oauth-authorization-server
curl -s https://mandate-console.pages.dev/mcp/status
npx @modelcontextprotocol/inspector                    # test the OAuth flow end to end
```

In the authorization-server metadata, check for `registration_endpoint`, `code_challenge_methods_supported`, and a complete `scopes_supported` list. If you share the output of those commands, or the folder's OAuth and MCP route files, I can pinpoint which of these is actually breaking your connection.
codex mcp list

# In an interactive Codex session, inspect live connections and tools
/mcp verbose

# Run release checks, including typecheck, tests, contracts, local D1/MCP integration, and dependency audit
npm run verify:release

# Exercise Pages MCP/OAuth flows locally (uses the repository's local test setup)
npm run test:remote-mcp:local
```

Treat the client's displayed tool list as the final confirmation of its granted capabilities. The server's `/mcp/status` endpoint is a service-readiness/recent-activity indicator, not a substitute for the client's own authenticated tool discovery.
