# Mandate

Mandate is an onchain authorization primitive for bounded agent actions. This workspace contains a Solidity vault, deterministic TypeScript policy/compiler packages, stdio and authenticated Streamable HTTP MCP transports, a viem chain adapter, and a wallet-connected React/Vite console.

The model is an untrusted proposer. The policy compiler validates and normalizes model output; a person reviews the exact preview; the wallet creates the policy; and the contract independently rechecks scope, budget, expiry, nonce, and revocation before a native MON transfer.

## Implemented

- `contracts/MandateVault.sol`: fixed-recipient native MON escrow, EIP-712 agent signature, monotonic nonce, budget/expiry enforcement, revocation, and post-revocation withdrawal.
- `packages/policy`: strict MCP request schema, exact decimal-MON-to-wei conversion, pure policy decisions, and stable denial reasons.
- `packages/intent-compiler`: untrusted model proposal parsing, deterministic normalization, explicit missing-field questions, and review-only policy commitment.
- `packages/model-adapter`: NVIDIA NIM chat completions adapter with HTTPS validation, input/output bounds, timeout, server-only key handling, and response schema validation.
- `packages/mandate-sdk`: Monad Testnet viem reader and EIP-712 signing/submission path.
- `packages/mcp-server`: shared server factory for stdio and Streamable HTTP transports. Tools expose a review-only proposal, chain status, and bounded transfer; chain tools register only when server chain configuration is present.
- `functions/mcp/[[path]].ts`: Cloudflare Pages Function for stateless Streamable HTTP at `/mcp`, bearer authentication, strict origin allowlisting, method validation, and no-store responses.
- `apps/console`: wallet connect, create/fund/revoke actions, records read from contract state, and a Codex remote-MCP setup guide. The browser bundle contains no MCP bearer or provider/agent key.

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

With `NVIDIA_API_KEY` and `NVIDIA_MODEL` set in ignored `.env.local`, run `npm run test:model-mcp:live` to build and call the review-only proposal tool over MCP stdio using NVIDIA inference. This live test exposes only `propose_mandate`; it does not submit a chain transaction.

### Connect Codex to the remote MCP endpoint

The console's **MCP Connection** page generates a Codex Streamable HTTP command for `https://mandate-console.pages.dev/mcp` (override with public build variable `VITE_MANDATE_MCP_URL`). Production was deployed through Wrangler on 2026-10-04 and the Cloudflare runtime settings are provisioned. To connect Codex on this machine, load only the client bearer from ignored `.env.local` into the shell that starts Codex, then run the generated `codex mcp add` command and verify with `codex mcp list`:

```sh
export MANDATE_MCP_TOKEN="$(sed -n 's/^MANDATE_MCP_TOKEN=//p' /Users/chipichipi/Documents/METROPOLIS/.env.local)"
codex mcp add mandate-cloud --url 'https://mandate-console.pages.dev/mcp' --bearer-token-env-var MANDATE_MCP_TOKEN
```

The bearer value is never embedded in the webpage or generated command. Production MCP calls are bearer-protected; requests without a token return HTTP 401.

For a Cloudflare Pages deployment, configure **runtime secrets**, not `VITE_` build variables: `MCP_BEARER_TOKEN` (32+ random bytes), `MANDATE_AGENT_PRIVATE_KEY` (a dedicated testnet signer), `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, and `MANDATE_CONTRACT_ADDRESS`. Set `MCP_ALLOWED_ORIGINS` to the exact trusted browser origins when additional browser clients are used. Never add secrets to GitHub, a Pages build variable, the public Vite bundle, or a copied MCP config. A single shared bearer token is for a controlled testnet MVP; it is not per-user authentication or tenant isolation. Configure Cloudflare rate limiting/monitoring before broader use.

Run `npm run test:remote-mcp:local` to build the Pages bundle and exercise the actual Pages Function locally with an ephemeral bearer token: unauthenticated denial, rejected origin, allowed preflight, Streamable HTTP initialization, tool discovery, proposal handling, live Monad read, and a revoked-mandate transfer denial. It does not send a transaction. The endpoint code and local Cloudflare-runtime test are implemented; publishing the Function and provisioning its server-side secrets are separate deployment steps.

The current test deployment is on Monad Testnet (chain ID `10143`) at `0x77065a818481ceebba93e79988bef9fd646f457d` (deployment block `68065182`). `npm run deploy:testnet` checks the RPC chain ID, refuses non-10143 networks and pre-existing contract addresses, verifies deployed bytecode, and writes the contract address back to `.env.local`. Test-only deployer and agent keys are stored in ignored `.env.local`; do not send private keys in chat.

To open the console without chain configuration:

```sh
npm run dev --workspace @mandate/console
```

With the console running locally, `npm run test:browser` uses Scrapling with `--ai-targeted` to smoke-check its rendered title and primary form. `.env.local` contains the testnet contract address and frontend deployment block. For chain MCP tools, configure `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, `MANDATE_CONTRACT_ADDRESS`, and a dedicated test-only `MANDATE_AGENT_PRIVATE_KEY` in ignored `.env.local`. The server can start in model-only mode without a contract; in that mode only the proposal tool is registered. Keep all actual keys in ignored local environment files; never place them in the console or model prompt.

NVIDIA calls require a backend `NVIDIA_API_KEY` and an explicit `NVIDIA_MODEL`. The deterministic suite does not call the provider; the separate live smoke test exercises the configured `nvidia/nemotron-3-ultra-550b-a55b` through the MCP `propose_mandate` tool and returns only a schema-validated review preview. Codex is configured to allow the proposal and read-only status tools with prompt approval; transfer is not allowed there. Restart Codex to load the current MCP configuration. Keep the key in ignored `.env.local`; `.env.example` contains placeholders only.

The production remote-MCP proposal path has now been verified end to end through NVIDIA inference. The adapter uses a runtime-portable abort controller with a bounded timeout and one retry for transient transport/provider failures; errors return a sanitized no-proposal result. The validated model output remains review-only and never submits a transaction.

## Contract test configuration

Foundry is pinned through the project-local `@foundry-rs/forge` and `@foundry-rs/anvil` packages. OpenZeppelin Contracts is pinned in `package-lock.json`; Foundry remaps imports to the installed package. Contract unit tests use a local EVM and do not contact Monad Testnet.

## Architecture and review

- [Architecture plan](ARCHITECTURE.md)
- [Tech stack plan](TECH_STACK.md)
- [Internal security review](docs/audits/security-review-2026-10-04.md)
- [Architecture and invariants audit](docs/audits/architecture-audit-2026-10-04.md)
- [Dependency and secret audit](docs/audits/dependency-audit-2026-10-04.md)

## Current release state

Local unit tests, Solidity tests, strict TypeScript checks, local MCP/Anvil end-to-end tests, and a live MCP-to-NVIDIA proposal smoke test pass. Monad Testnet acceptance now verifies a capped 0.01 MON transfer, above-cap and post-revocation denials, principal revocation, and withdrawal of the remaining 0.01 MON; see [`docs/testnet-acceptance-2026-10-04.md`](docs/testnet-acceptance-2026-10-04.md). The browser-wallet path remains unaccepted because Chrome has no EIP-1193 provider. This remains a testnet prototype, not production-ready or third-party audited.
