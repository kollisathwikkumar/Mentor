# Mandate

Mandate is an onchain authorization primitive for bounded agent actions. This workspace contains a Solidity vault, deterministic TypeScript policy/compiler packages, stdio and authenticated Streamable HTTP MCP transports, a viem chain adapter, and a wallet-connected React/Vite console.

The conversational interface is currently a local-only draft surface. The backend has a review-only proposal tool configured for Gemini 3.8 Flash through the Gemini API; model output is validated and never authorizes an action. The contract independently rechecks scope, budget, expiry, nonce, and revocation before any native MON transfer.

## Implemented

- `contracts/MandateVault.sol`: fixed-recipient native MON escrow, EIP-712 agent signature, monotonic nonce, budget/expiry enforcement, revocation, and post-revocation withdrawal.
- `packages/policy`: strict MCP request schema, exact decimal-MON-to-wei conversion, pure policy decisions, and stable denial reasons.
- `packages/intent-compiler`: deterministic validation and normalization of untrusted model proposals, with explicit missing-field questions and review-only policy commitment.
- `packages/model-adapter`: bounded, fixed-host Gemini 3.8 Flash adapter; API key remains backend-only.
- `packages/mandate-sdk`: Monad Testnet viem reader, native-balance lookup, and optional EIP-712 signing/submission path.
- `packages/mcp-server`: shared server factory for stdio and Streamable HTTP transports. OAuth can grant status lookup by mandate ID, a separately opt-in native MON balance read bound to the authenticated principal, review-only proposal generation, and bounded transfers as distinct capabilities. Read-only paths need no signer key; transfer appears only when separately scoped and a signer is configured.
- `functions/mcp/[[path]].ts`: Cloudflare Pages Function for stateless Streamable HTTP at `/mcp`, bearer or scoped OAuth access tokens, strict origin allowlisting, and best-effort activity recording.
- `packages/mcp-server/src/oauth.ts` and `functions/oauth/[[path]].ts`: OAuth 2.1 authorization-code + PKCE, dynamic client registration, refresh rotation, revocation, scope-gated tools, protected-resource discovery, and passkey/wallet message-signature identity. Passkey accounts use WebAuthn PRF through Mera and are bound to the same EVM address used for Mandate policies. EVM wallet sign-in remains available as a compatibility path.
- `migrations/0001_mcp_activity.sql`, `migrations/0002_mcp_oauth.sql`, and `migrations/0003_oauth_wallet_identity.sql`: D1 activity and OAuth client/request/code/token storage, including the wallet principal. Token values are hashed before storage; request telemetry contains only an aggregate timestamp/count.
- `apps/console`: passkey-first account creation/sign-in, compatible-wallet fallback, create/fund/revoke actions, owner-verified records read from contract state, and a focused MCP URL-copy/setup page. New permission IDs are saved in the current browser and can be copied/imported across devices. Because the public Monad RPC limits `eth_getLogs` to 100 blocks per query, automatic discovery is limited to recent events; older permissions need their ID imported. Passkey-derived signing material stays in page memory and is cleared on session end; only the public credential ID/transports are stored locally. The browser bundle contains no MCP bearer or provider/agent key.

## Local setup

Requirements: Node 24+, npm, and Foundry. The local browser QA helper is Scrapling 0.4.15 (Python 3.12+); install it with `python3 -m venv .venv-scrapling && .venv-scrapling/bin/pip install -r requirements-scrapling.txt && .venv-scrapling/bin/scrapling install --force`.

```sh
npm ci
npm run typecheck
npm test
npm run test:contracts
npm run test:e2e
npm run build
npm run audit:secrets
npm audit
```

The model proposal integration uses `GEMINI_API_KEY` with `GEMINI_MODEL=gemini-3.8-flash`; run `npm run test:gemini-mcp:live` for local stdio acceptance and `npm run test:gemini-mcp:production` for authenticated hosted acceptance. Both now return a schema-validated review proposal. The chat UI remains local-only; the MCP proposal is review-only and does not submit transactions.

### Connect an MCP-compatible client

The console's **MCP** page gives the hosted endpoint, `https://mandate-console.pages.dev/mcp` (override with public build variable `VITE_MANDATE_MCP_URL`). Add it as a **remote Streamable HTTP** server. OAuth-capable clients discover the server automatically and open Mandate's sign-in page. Users can create or unlock a passkey (device Face ID, fingerprint, or PIN) and sign a free message without copying an API key, address, or installing a wallet extension. A compatible existing EVM wallet remains a fallback. Passkey support depends on the authenticator's WebAuthn PRF support; the page identifies this and keeps the fallback visible. The connection check reports service readiness and whether an authenticated request arrived in the last five minutes—MCP is request/response, so it cannot detect a client that merely saved the URL.

The MCP endpoint is protocol-level and not tied to a model vendor. Codex CLI and Gemini CLI support remote HTTP with headers; Kimi Code supports HTTP/OAuth; Claude Code supports remote HTTP MCP; ChatGPT custom MCP apps use OAuth and require the eligible workspace developer-mode/app setup described in OpenAI’s documentation. Exact setup and feature availability depend on each client and plan. No vendor-specific extension is required by the server.

For Codex CLI, provide the client bearer from ignored `.env.local` to the shell that starts Codex, then register the remote server:

```sh
export MANDATE_MCP_TOKEN="$(sed -n 's/^MANDATE_MCP_TOKEN=//p' /Users/chipichipi/Documents/METROPOLIS/.env.local)"
codex mcp add mandate-cloud --url 'https://mandate-console.pages.dev/mcp' --bearer-token-env-var MANDATE_MCP_TOKEN
```

OAuth approval is bound to the passkey-derived or wallet account by a one-time nonce signature and PKCE. OAuth bearer tokens are hashed at rest, scoped, audience-bound, expire after one hour, refresh-rotate, and support revocation. The `mandate:read` scope exposes `get_mandate_status` for a caller-supplied mandate ID, with the authenticated principal checked against the mandate owner. The separately opt-in `mandate:balance` scope exposes only `get_my_monad_balance`; the account address is bound from OAuth identity and is not a tool argument. Both reads are read-only and need no agent signer key. Proposal generation is review-only; bounded transfer requires its own scope and a configured backend signer and remains bounded by onchain policy. The direct server bearer remains an operator credential for service administration/testing and must never be shared with end users.

For a Cloudflare Pages deployment, configure **runtime secrets**, not `VITE_` build variables: `MCP_BEARER_TOKEN` (32+ random bytes, operator-only and optional for OAuth), `MANDATE_AGENT_PRIVATE_KEY` (a dedicated testnet signer; needed only to expose transfer), `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`, `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, and `MANDATE_CONTRACT_ADDRESS`. Set public build variable `VITE_MANDATE_DEPLOYMENT_BLOCK` to the vault's deployment block; it bounds the recent-event search but does not remove the RPC's 100-block range cap. OAuth availability requires the D1 binding `MCP_ACTIVITY_DB` defined in `wrangler.jsonc`; apply schema changes with `npx wrangler d1 migrations apply mandate-mcp-activity --remote`. Set `MCP_ALLOWED_ORIGINS` to exact trusted browser origins when additional browser clients are used. Never add secrets to GitHub, a Pages build variable, the public Vite bundle, or a copied MCP config. Configure Cloudflare rate limiting/monitoring before broader use.

Every Pages build now runs the release gate first: secret scan, strict TypeScript checks, unit/coverage tests, Foundry contract tests, and production dependency audit. The console build itself follows those checks. `.github/workflows/quality-gates.yml` runs the same build for pull requests and pushes to `main`; Pages Git integration still independently builds each deployment, and the same gates run inside its configured `npm run build --workspace @mandate/console` command.

Run `npm run test:remote-mcp:local` to build the Pages bundle and exercise the Pages Functions locally with an ephemeral operator bearer: readiness, unauthenticated denial, rejected MCP origin, allowed preflight, Streamable HTTP initialization, OAuth DCR/PKCE, nonce-bound signature approval, scope isolation, refresh rotation and replay rejection, live Monad status read, and revoked-mandate transfer denial. It does not send a transaction. After deployment, `npm run test:balance-mcp:production` performs a live production OAuth/PKCE handshake using a disposable deterministic test identity, requests only the optional owner-bound balance capability, calls the hosted MCP tool against live Monad RPC, then revokes access/refresh tokens; the OAuth client registration remains as a named test client in D1.

The current test deployment is on Monad Testnet (chain ID `10143`) at `0x77065a818481ceebba93e79988bef9fd646f457d` (deployment block `68065182`). `npm run deploy:testnet` checks the RPC chain ID, refuses non-10143 networks and pre-existing contract addresses, verifies deployed bytecode, and writes the contract address back to `.env.local`. Test-only deployer and agent keys are stored in ignored `.env.local`; do not send private keys in chat.

To open the console without chain configuration:

```sh
npm run dev --workspace @mandate/console
```

With the console running locally, `npm run test:browser` uses Scrapling with `--ai-targeted` to smoke-check its rendered title and primary form. `.env.local` contains testnet settings and the backend-only Gemini API key. For chain MCP tools, configure `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, `MANDATE_CONTRACT_ADDRESS`, and a dedicated test-only `MANDATE_AGENT_PRIVATE_KEY` in ignored `.env.local`.

## Contract test configuration

Foundry is pinned through the project-local `@foundry-rs/forge` and `@foundry-rs/anvil` packages. OpenZeppelin Contracts is pinned in `package-lock.json`; Foundry remaps imports to the installed package. Contract unit tests use a local EVM and do not contact Monad Testnet.

## Architecture and review

- [Architecture plan](ARCHITECTURE.md)
- [Tech stack plan](TECH_STACK.md)
- [Internal security review](docs/audits/security-review-2026-10-04.md)
- [Architecture and invariants audit](docs/audits/architecture-audit-2026-10-04.md)
- [Dependency and secret audit](docs/audits/dependency-audit-2026-10-04.md)
- [Gemini model integration security review](docs/audits/gemini-model-integration-review.md)

## Current release state

Local unit tests, Solidity tests, strict TypeScript checks, local MCP/Anvil end-to-end tests, Monad Testnet transfer/denial/revocation checks, and local plus hosted Gemini 3.8 Flash proposal acceptance pass. See [`docs/testnet-acceptance-2026-10-04.md`](docs/testnet-acceptance-2026-10-04.md). This remains a testnet prototype, not production-ready or third-party audited.

## Generic backend foundation status

The workspace brief accepts general task descriptions rather than four fixed task categories. The generic connector package now includes a D1-backed policy store, owner-signature activation, atomic integer-unit call and aggregate-budget reservations, per-action decision/outcome records, and persisted task/event transitions. The Pages API exposes owner-scoped policy and task endpoints using verified wallet OAuth identity. OAuth `request_bounded_transfer` calls now pass through the generic authorization gateway and D1 policy before the existing Monad contract performs its independent check. The workspace can establish its own OAuth PKCE session and create/read/cancel persisted task records, but recording a task is not task execution. Only `monad.native:native.transfer` is registered for consequential execution today; other tools and arbitrary offchain tasks remain unsupported.

The local backend has a working guarded transfer vertical, not a universal agent execution platform. Workspace chat saves task records only after explicit backend sign-in and otherwise remains a local draft. The generic mandate create/approve/revoke API is not yet wired into the console because the signed agent identity must match the actual MCP OAuth client that will execute; a console OAuth client is not the connected external AI client. No offchain GitHub/email/filesystem connectors or general task planner are registered. The master bearer remains an explicitly separate operator compatibility path. See [the persisted policy/task API](docs/GENERIC_AUTHORIZATION_API.md), [workspace/backend UI connection](docs/WORKSPACE_BACKEND_CONNECTION.md), and [the architecture trust boundaries](ARCHITECTURE.md#generic-capability-authorization-foundation-2026-10).
