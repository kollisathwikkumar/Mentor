# Mandate

Mandate is an onchain authorization primitive for bounded agent actions. This workspace contains a Solidity vault, deterministic TypeScript policy/compiler packages, stdio and authenticated Streamable HTTP MCP transports, a viem chain adapter, and a wallet-connected React/Vite console.

The conversational interface is currently a local-only draft surface. The backend has a review-only proposal tool configured for Gemini 3.8 Flash through the Gemini API; model output is validated and never authorizes an action. The contract independently rechecks scope, budget, expiry, nonce, and revocation before any native MON transfer.

## Implemented

- `contracts/MandateVault.sol`: fixed-recipient native MON escrow, EIP-712 agent signature, monotonic nonce, budget/expiry enforcement, revocation, and post-revocation withdrawal.
- `packages/policy`: strict MCP request schema, exact decimal-MON-to-wei conversion, pure policy decisions, and stable denial reasons.
- `packages/intent-compiler`: deterministic validation and normalization of untrusted model proposals, with explicit missing-field questions and review-only policy commitment.
- `packages/model-adapter`: bounded, fixed-host Gemini 3.8 Flash adapter; API key remains backend-only.
- `packages/mandate-sdk`: Monad Testnet viem reader and EIP-712 signing/submission path.
- `packages/mcp-server`: shared server factory for stdio and Streamable HTTP transports. It exposes a review-only proposal when the Gemini key is configured, and chain status/transfer when chain configuration is present.
- `functions/mcp/[[path]].ts`: Cloudflare Pages Function for stateless Streamable HTTP at `/mcp`, bearer or scoped OAuth access tokens, strict origin allowlisting, and best-effort activity recording.
- `packages/mcp-server/src/oauth.ts` and `functions/oauth/[[path]].ts`: OAuth 2.1 authorization-code + PKCE, dynamic client registration, refresh rotation, revocation, scope-gated tools, and protected-resource discovery. The owner approves a client by entering the server-side bearer token in the hosted authorization screen; the MCP client receives only its short-lived, scoped OAuth token.
- `migrations/0001_mcp_activity.sql` and `migrations/0002_mcp_oauth.sql`: D1 activity indicator plus OAuth client/request/code/token storage. Token values are hashed before storage; request telemetry contains only an aggregate timestamp/count.
- `apps/console`: wallet connect, create/fund/revoke actions, records read from contract state, and a minimal MCP URL-copy/setup page. The browser bundle contains no MCP bearer or provider/agent key.

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

The console's **MCP** page gives the hosted endpoint, `https://mandate-console.pages.dev/mcp` (override with public build variable `VITE_MANDATE_MCP_URL`). Add it as a **remote Streamable HTTP** server. Clients with OAuth use the hosted OAuth sign-in; clients configured with an HTTP bearer header can use `MCP_BEARER_TOKEN` in their private client settings. The connection check reports service readiness and whether an authenticated request arrived in the last five minutes—MCP is request/response, so it cannot detect a client that merely saved the URL.

The MCP endpoint is protocol-level and not tied to a model vendor. Codex CLI and Gemini CLI support remote HTTP with headers; Kimi Code supports HTTP/OAuth; Claude Code supports remote HTTP MCP; ChatGPT custom MCP apps use OAuth and require the eligible workspace developer-mode/app setup described in OpenAI’s documentation. Exact setup and feature availability depend on each client and plan. No vendor-specific extension is required by the server.

For Codex CLI, provide the client bearer from ignored `.env.local` to the shell that starts Codex, then register the remote server:

```sh
export MANDATE_MCP_TOKEN="$(sed -n 's/^MANDATE_MCP_TOKEN=//p' /Users/chipichipi/Documents/METROPOLIS/.env.local)"
codex mcp add mandate-cloud --url 'https://mandate-console.pages.dev/mcp' --bearer-token-env-var MANDATE_MCP_TOKEN
```

The bearer value is never embedded in the webpage or generated command. OAuth clients are redirected to the hosted approval page; the shared server bearer is entered there and never delivered to the MCP client. OAuth grants are scoped, access tokens expire after one hour, refresh tokens rotate, and revoked/replayed tokens are rejected. This is owner-managed access for the current single-operator testnet service, not multi-user identity or tenant isolation.

For a Cloudflare Pages deployment, configure **runtime secrets**, not `VITE_` build variables: `MCP_BEARER_TOKEN` (32+ random bytes), `MANDATE_AGENT_PRIVATE_KEY` (a dedicated testnet signer), `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`, `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, and `MANDATE_CONTRACT_ADDRESS`. The D1 binding `MCP_ACTIVITY_DB` is defined in `wrangler.jsonc`; apply schema changes with `npx wrangler d1 migrations apply mandate-mcp-activity --remote`. Set `MCP_ALLOWED_ORIGINS` to exact trusted browser origins when additional browser clients are used. Never add secrets to GitHub, a Pages build variable, the public Vite bundle, or a copied MCP config. A single shared bearer token is for a controlled testnet MVP; it is not per-user authentication or tenant isolation. Configure Cloudflare rate limiting/monitoring before broader use.

Every Pages build now runs the release gate first: secret scan, strict TypeScript checks, unit/coverage tests, Foundry contract tests, and production dependency audit. The console build itself follows those checks. `.github/workflows/quality-gates.yml` runs the same build for pull requests and pushes to `main`; Pages Git integration still independently builds each deployment, and the same gates run inside its configured `npm run build --workspace @mandate/console` command.

Run `npm run test:remote-mcp:local` to build the Pages bundle and exercise the actual Pages Functions locally with an ephemeral bearer token: readiness, unauthenticated denial, rejected origin, allowed preflight, Streamable HTTP initialization, OAuth discovery/DCR/PKCE, scope-gated tool discovery, refresh rotation and replay rejection, chain-tool discovery, live Monad read, and a revoked-mandate transfer denial. It does not send a transaction.

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

The workspace brief no longer offers four fixed task categories. It accepts a general task description and lists registered actions; only the Monad fixed-recipient native-MON capability is currently listed/enforced. A typed capability registry, authorization-gateway/store ports, idempotency reservation contract, and task-state reducer now live in `packages/connectors`.

This is a local backend foundation, not a completed generic remote workflow: the current Pages project has no checked-in D1/Durable Object bindings or task API route, no validated multi-user identity provider, and no production `PolicyStore` implementation. Generic tasks are not persisted, model-proposed, or executed. The existing shared-bearer MCP and Monad transfer path remain separate and retain their current boundaries. See [ARCHITECTURE.md](ARCHITECTURE.md#generic-capability-authorization-foundation-2026-10) for the integration gate and trust boundaries.
