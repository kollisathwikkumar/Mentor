# Mandate — Tech Stack Plan

**Decision goal:** choose components because they match Mandate's trust boundaries, the hosted-inference choice and cost controls, the hackathon's working-product requirements, and the actual development machine—not because a tool is fashionable.  
**Current machine checked:** Apple Silicon M2, 16 GB RAM; Node `v26.7.0` and npm `11.19.0` are installed; Foundry (`forge`) is not installed.  
**Implementation status (2026-10-04):** The vertical slice uses Solidity/Foundry, TypeScript/npm workspaces, viem/Zod, MCP stdio/Streamable HTTP, and React/Vite. A backend-only Google Gemini API adapter targets Gemini 3.8 Flash through `gemini-3.8-flash`; its credential is backend-only.

## Recommendation in one line

**Solidity + Foundry for the enforcement contract; TypeScript on Node 24 LTS for the MCP backend and SDK; viem + Zod for typed chain/policy boundaries; React + Vite for a static wallet UI; a natural-language intent compiler plus hosted model API adapter with deterministic model-free tests; Monad Testnet for deployed proof; npm workspaces and GitHub Actions for the repo/CI.**

## Why these choices fit this project

Mandate's unique technical risk is not rendering pages or running an LLM. It is whether a bounded policy is checked consistently before a real action. The stack therefore makes the contract and typed policy/SDK the core, keeps the model provider replaceable, avoids a paid always-on application backend, and lets judges run deterministic policy and contract tests locally without API usage.

## Stack by responsibility

| Responsibility | Recommended choice | Why it fits Mandate and this machine | Adaptation path |
|---|---|---|---|
| Smart contract | Solidity, with one `MandateVault` contract | Monad is EVM-compatible; the MVP needs atomic checks and a native MON transfer, not a large contract framework. | Keep the public contract API small and versioned; split registry/executor only when another integration requires it. |
| Contract toolchain | Foundry: Forge, Cast, Anvil | Local Solidity build, unit/fuzz/invariant tests, deploys, and a local EVM; separates fast tests from testnet. `forge` is currently absent on this Mac and must be installed. | Same commands and tests run in a standard Linux CI runner; pin Foundry version in CI/docs. |
| Contract primitives | OpenZeppelin Contracts 5.x, exact version pinned in lock/build config | Use audited library building blocks for EIP-712, ECDSA recovery, and reentrancy protection rather than hand-writing cryptography. Pin compiler and dependency versions; no floating `latest`. | Change only through reviewed dependency updates with signature test vectors and full Foundry suite. |
| Backend/runtime language | TypeScript on Node.js 24 LTS | The MCP process is local for the hackathon demo; it calls a hosted model API through a server-side adapter. Node is already installed; Node 24 LTS is the reproducible project target. The machine currently has Node 26.7, so use a project-local version manager/pin rather than changing global Node. | One TypeScript language across MCP, SDK, policy, and UI; keep Solidity as the single onchain language. |
| Package management | npm workspaces with a committed `package-lock.json`; `npm ci` in CI | npm and Node are already present. Workspaces organize the small monorepo without another mandatory package manager or build orchestrator. | Move to pnpm/Turborepo only if build size/workspace needs justify the added tool. |
| Chain client | viem | Typed ABI calls, EIP-712 typed data, contract reads/writes, wallet-provider integration, and direct public RPC without a paid indexer. | Hide chain reads/submission behind `MandateClient`; keep Monad as the only supported network in the MVP. Add another network only after the policy interface is stable. |
| Runtime validation/policy | Zod schemas + pure TypeScript decision functions | Validate MCP input at runtime, normalize addresses, and parse amounts to `bigint` wei. Pure policy code is easy to unit-test without a chain or model. | Version schema and stable reason codes; add a compatible parser when a new MCP/client version is introduced. |
| Agent interface | Official MCP TypeScript SDK v2, stdio transport | This is a local tool server launched by an agent host, which needs no hosted MCP account or public endpoint. The current SDK docs show `serveStdio` and runtime schema validation. | Define transport-neutral tool handlers; add Streamable HTTP only for a real remote multi-user need, with auth and separate key-isolation design. |
| Intent compiler/model API | Typed intent compiler + provider-neutral `AgentModelAdapter` | Hosted model proposes policy fields; deterministic validation normalizes supported fields and flags ambiguity; user sees an exact preview and wallet-confirms it before authority exists. The model never signs, holds credentials, or decides policy. | Keep extraction/provider code replaceable. Validate schema, address, amount, date/timezone, scope, and budget semantics locally; missing/ambiguous values must enter a clarification loop rather than being guessed. Evaluate tool-call and structured-output reliability, latency, price, and spend controls; tests remain API-free. |
| User interface | React + TypeScript + Vite, exported as static files | The console needs wallet connect, form state, and onchain reads—not server rendering, SEO, server actions, or a Next.js API. Vite produces a static site suited to public GitHub Pages; the model key stays in the MCP backend and never ships to the browser. | Add a server framework only if an actual server-side requirement appears; keep UI client code calling the typed SDK. |
| Wallet interface | EIP-1193 browser wallet provider, accessed through viem | User wallet keeps custody; the browser wallet signs create/fund/revoke calls. No new custodial/embedded-wallet service is needed. | Support another wallet using the same provider interface; no change to contract policy. |
| Agent signer | Dedicated local demo EOA held only by the MCP process | Gives contract-verifiable action intents while keeping the private key away from the model and browser. Use a throwaway Testnet key and keep it out of Git. | Production key custody, key rotation, delegated account, or relayer must be a separate audited design; do not silently swap the signer. |
| State/indexing | Contract storage + events; direct viem/RPC reads; local cache only if needed | The onchain contract is the source of truth. A hosted database or indexer is unnecessary for a single-user/single-mandate hackathon vertical slice. | Add a self-hosted indexer only when chain event volume or user count makes direct reads impractical. |
| Tests | Foundry unit/fuzz/invariant; Vitest for TS; Anvil end-to-end; Playwright for UI smoke checks | Separates contract invariants, policy/MCP behavior, and the integrated workflow. All core tests run locally without model/API/network access. | Add a deployed Testnet smoke suite as a separately triggered release check. |
| CI and delivery | GitHub Actions, public repo, standard hosted runners | Required hackathon evidence includes public source and build-window commits; the free resources plan uses public-repo CI and avoids paid runners. | Keep deploy jobs manual; do not expose private deployment keys to pull-request workflows. |

Official references: [Monad Testnet docs](https://docs.monad.xyz/developer-essentials/testnet), [Foundry Book](https://getfoundry.sh/), [OpenZeppelin cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography), [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [Next.js static export docs](https://nextjs.org/docs/pages/guides/static-exports) (evaluated, but not selected), [Node release schedule](https://github.com/nodejs/Release/blob/main/README.md).

## Why not just use the names in the resource list?

- **Vite over Next.js for this console:** a wallet-connected client that reads/writes Monad directly has no server-rendering or server-action requirement. Vite is a smaller operational fit and produces static files for the free deployment path. Next.js remains a valid upgrade if Mandate later needs authenticated server rendering, server-side APIs, or search-indexed public content.
- **No separate Express/Fastify backend for the MVP:** the MCP server process is the backend. Adding a web API would create another service, deployment problem, auth surface, and hosting dependency without improving contract enforcement.
- **No database/indexer at first:** the contract stores the small authoritative policy state; transaction receipts and events provide the execution evidence. A cache may improve UI speed, but it cannot authorize.
- **No model SDK inside the policy engine:** model-provider code belongs behind an adapter. The deterministic harness covers unit and acceptance tests without API usage; the interactive natural-language flow and live agent reasoning call the hosted API under explicit usage limits.
- **No arbitrary tool framework:** one narrow transfer is enough to prove the hard part. Each future tool needs an explicit scope and an enforcement mechanism for its actual downstream side effect.
- **No package monorepo build orchestrator yet:** npm workspaces suffice for this few-package project. Avoid adding Turbo/Nx until there is a measured build bottleneck.

## Workstation-specific setup plan

This is a planning note, not a command to install tools yet.

1. **Runtime pin:** add `.nvmrc` or `.node-version` with Node 24 and document the chosen version manager. The local Node 26 installation can remain global; the project should build on Node 24 in CI and developer setup. At the checked date, the official schedule listed Node 24 as Active LTS through 20 October 2026, then Maintenance.
2. **Foundry:** install the official macOS arm64 toolchain, then verify `forge`, `cast`, and `anvil` run. Keep Anvil for local tests and use Monad Testnet only for the release/demo flow.
3. **Hosted model API:** implement a provider-neutral adapter for structured tool calling. Keep the API key server-side in an ignored environment file; never expose it to the static UI, model context, tool arguments, logs, or Git. Define a request timeout, bounded retries, input/output token limits, per-run call cap, and configurable hard-spend stop before enabling calls.
4. **Keep API use bounded:** unit/contract tests use deterministic fixtures. The interactive intent-compiler/live-agent path requires a configured hosted API key and approved spend ceiling; record token usage and cost from provider responses where available.
5. **No global project install:** use repo lockfiles and project scripts; do not depend on globally installed TypeScript, Foundry libraries, or `npx` resolving an unpinned package during release.

## Adaptability without overbuilding

### Stable interfaces now

- `MandateClient`: typed create/read/fund/revoke/execute calls, with a single Monad Testnet chain config in the first release.
- `PolicyEngine`: pure `evaluate(intent, mandateSnapshot)` returning a stable allow/deny result and reason.
- `IntentCompiler`: `proposePolicy(naturalLanguageRequest)` → typed candidate + unresolved fields; never signs or creates authority.
- `AgentModelAdapter`: provider-neutral structured output/tool-call interface; the adapter has no signer interface.
- `McpToolHandlers`: transport-independent handlers shared by stdio now and a later transport.
- `AgentSigner`: a narrow interface with one method to sign the exact `TransferIntent`; no raw-key getter.
- `ReceiptReader`: decode only Mandate events and transaction status; keep the explorer link as convenience, not a dependency.

### Upgrade triggers

| Trigger | Change only if this becomes true | Candidate next step |
|---|---|---|
| External developers need a hosted shared MCP endpoint | Stdio cannot serve the integration setting | Add MCP Streamable HTTP behind authentication, per-user isolation, rate limits, and server-side secret storage. |
| Users need many supported providers | One chain-specific client becomes awkward | Add chain/provider adapters while keeping the policy schema chain-neutral; retain Monad as the primary supported chain. |
| Users need identity discovery | Agent addresses become difficult to verify | Add ERC-8004 as an optional identity adapter; never let identity/reputation bypass mandate checks. |
| Passkey requirement improves UX | EOA wallet friction is proven to block adoption | Add a P256/WebAuthn signer path with chain-precompile tests; do not replace the working EIP-712 path before it passes. |
| Offchain tools become a proven use case | Developers ask for API actions, not only transfers | Build one credential-owning connector with just-in-time auth and downstream enforcement; explicitly define the limits for the target API. |
| Event volume exceeds direct reads | RPC range limits make the UI unreliable | Add a local/self-hosted indexer; keep contract state authoritative. |

## Suggested monorepo

```text
mandate/
├── apps/
│   └── console/             # React + Vite static wallet/control surface
├── packages/
│   ├── policy/              # Zod schemas, canonicalization, pure decisions/reasons
│   ├── intent-compiler/     # Candidate extraction, ambiguity detection, preview data; no authority
│   ├── mandate-client/      # viem contract client, typed-data, event decoder
│   ├── mcp-server/          # Node-only stdio handlers + isolated agent signer
├── contracts/               # Foundry + Solidity + OpenZeppelin
├── scripts/                 # local, Anvil, Testnet deploy and demo fixtures
├── docs/                    # threat model, API, architecture, integration guide
├── .nvmrc                   # Node 24
├── package.json             # npm workspaces + pinned package manager
└── package-lock.json        # reproducible dependency tree
```

Do not scaffold every folder before the first tests. Start with `contracts/` and `packages/policy/`; create the remaining packages when the first vertical slice needs them.

## Build gates

1. **Contract gate:** Foundry unit/fuzz/invariant tests prove allow, cap, expiry, replay, revoke, transfer failure rollback, and no unauthorized transfer.
2. **Schema/policy gate:** TypeScript tests prove malformed/ambiguous inputs reject and every decision has a reason code.
3. **MCP gate:** MCP Inspector runs the local server; schemas expose no recipient override, arbitrary calldata, or key input; stdout is reserved for protocol messages.
4. **Integrated gate:** deterministic test agent succeeds/gets denied against Anvil, then the exact same path is exercised on Monad Testnet.
5. **Model gate:** hosted API output proposes only the same narrow tools; invalid or malformed outputs still fail schema/policy/contract checks, and a deterministic path covers the same cases without API calls.
6. **Reviewer gate:** static live console is reachable, contract is deployed, setup docs reproduce the agent path, and a second developer can run it from a clean clone.

## Decision summary

Use **Solidity + Foundry, TypeScript + Node 24 LTS + npm workspaces, viem + Zod, MCP SDK v2 over stdio, a deterministic intent compiler backed by a provider-neutral hosted model API adapter, and React/Vite static UI**. Keep the MCP gateway local and thin; keep the API secret backend-only; put durable authorization in the Monad contract. Deterministic tests must remain usable without API calls. The provider and initial spend ceiling remain to be confirmed before purchasing credits or enabling billing. User confirmation is required before any candidate policy creates a Mandate.
