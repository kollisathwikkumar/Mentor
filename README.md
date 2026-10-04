# Mandate

Mandate is an onchain authorization primitive for bounded agent actions. This workspace now contains the first local vertical slice: a Solidity vault, deterministic TypeScript policy/compiler packages, a stdio MCP gateway, a viem chain adapter, and a wallet-connected React/Vite console.

The model is an untrusted proposer. The policy compiler validates and normalizes model output; a person reviews the exact preview; the wallet creates the policy; and the contract independently rechecks scope, budget, expiry, nonce, and revocation before a native MON transfer.

## Implemented

- `contracts/MandateVault.sol`: fixed-recipient native MON escrow, EIP-712 agent signature, monotonic nonce, budget/expiry enforcement, revocation, and post-revocation withdrawal.
- `packages/policy`: strict MCP request schema, exact decimal-MON-to-wei conversion, pure policy decisions, and stable denial reasons.
- `packages/intent-compiler`: untrusted model proposal parsing, deterministic normalization, explicit missing-field questions, and review-only policy commitment.
- `packages/model-adapter`: NVIDIA NIM chat completions adapter with HTTPS validation, input/output bounds, timeout, server-only key handling, and response schema validation.
- `packages/mandate-sdk`: Monad Testnet viem reader and EIP-712 signing/submission path.
- `packages/mcp-server`: stdio tools `get_mandate_status` and `request_bounded_transfer`; tool inputs cannot select recipient, signer, URL, or calldata.
- `apps/console`: wallet connect, create/fund/revoke actions, and records read from contract state.

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

To open the console without chain configuration:

```sh
npm run dev --workspace @mandate/console
```

With the console running locally, `npm run test:browser` uses Scrapling with `--ai-targeted` to smoke-check its rendered title and primary form. The console build is static. Copy `.env.example` to a root `.env` (the Vite config reads only `VITE_`-prefixed values into the static app) and set `VITE_MONAD_CONTRACT_ADDRESS` before connecting to deployed contract state. For a local MCP server, configure `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, `MANDATE_CONTRACT_ADDRESS`, and a dedicated test-only `MANDATE_AGENT_PRIVATE_KEY`. Keep all actual keys in ignored local environment files; never place them in the console or model prompt.

NVIDIA calls require a backend `NVIDIA_API_KEY` and an explicit `NVIDIA_MODEL`. The adapter is not called by the deterministic test suite. A live smoke test has been run against the configured `nvidia/nemotron-3-ultra-550b-a55b` model and produced a review-only policy preview; it did not authorize or submit a transfer. The proposal path remains a library integration and is not exposed as an MCP tool yet. Keep the key in an ignored `.env.local` file; `.env.example` contains placeholders only.

## Contract test configuration

Foundry is pinned through the project-local `@foundry-rs/forge` and `@foundry-rs/anvil` packages. OpenZeppelin Contracts is pinned in `package-lock.json`; Foundry remaps imports to the installed package. Contract unit tests use a local EVM and do not contact Monad Testnet.

## Architecture and review

- [Architecture plan](ARCHITECTURE.md)
- [Tech stack plan](TECH_STACK.md)
- [Internal security review](docs/audits/security-review-2026-10-04.md)
- [Architecture and invariants audit](docs/audits/architecture-audit-2026-10-04.md)
- [Dependency and secret audit](docs/audits/dependency-audit-2026-10-04.md)

## Current release state

Local unit tests, Solidity tests, strict TypeScript checks, a local MCP/Anvil end-to-end run, and static console build are in place. One live NVIDIA inference successfully produced a review-only policy preview. No contract has been deployed and no wallet transaction has been submitted; model proposals are not yet exposed through the MCP tool surface. This is a verified prototype, not a production-ready or third-party-audited service.
