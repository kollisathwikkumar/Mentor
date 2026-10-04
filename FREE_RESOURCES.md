# Mandate — Resource Kit and API Cost Plan

**Project:** Track 04 agent-authority gateway on Monad  
**Research checked:** 4 October 2026  
**Cost model:** Monad Testnet, public GitHub, and local development keep infrastructure costs low; intent compilation and live agent reasoning use a hosted model API and may incur token charges. Provider and maximum spend are pending confirmation. Testnet MON has no real-world value.

> Free resources below cover chain/test tooling and public project infrastructure, not hosted model inference. Model API calls can be metered; do not enable billing until the provider, expected usage, and hard spend cap are recorded. Keep deterministic tests free of API calls. Recheck linked official pricing and quota pages before use.

## 1. Recommended low-cost, API-backed setup

| Need | Use | Why it fits | Cost boundary |
|---|---|---|---|
| Chain | Monad **Testnet** | Deploy and call our guard/vault contract with test MON. | Public testnet and faucet are free to use; tokens have no monetary value. Do not use Mainnet. |
| RPC | Official Monad Testnet RPC | Connect Foundry and viem directly; no vendor API key needed for basic use. | Public endpoints are rate-limited; keep calls low and cache reads. |
| Intent compiler/model API | Hosted LLM API through provider-neutral adapter | Proposes typed policy fields from natural language and structured tool calls without loading model weights on the M2 laptop; all output remains untrusted. | Variable token billing or provider quotas may apply. Choose provider/model only after testing tool calling, latency, current pricing, account limits, and data-retention terms. Keep usage capped; provider/budget pending. |
| Agent integration | MCP TypeScript SDK, stdio transport | Gives the agent a narrow set of Mandate tools locally. | Open-source package; no hosted MCP service required. |
| Contracts | Foundry + OpenZeppelin | Build/test/deploy Solidity and reuse established contract primitives. | Local tools/libraries are free to install. Testnet deploy uses faucet MON. |
| Web client | React + TypeScript + Vite + viem | Static wallet control panel for mandate creation/revocation and contract reads/writes; no server-rendering requirement in the MVP. | Run locally and export static assets for public GitHub Pages; the local MCP server remains the agent backend. |
| Data/indexing | Direct contract event reads + local SQLite/JSON | Avoid paid indexers and hosted database plans. | Local only. |
| Source/CI | Public GitHub repo; standard GitHub Actions runner | Code, issues, PRs, README, CI, release artifacts. | GitHub documents public repos and standard Actions runners as free; larger runners and private-repo overages are not part of this plan. |

## 2. Monad: essential network links

- [Monad Metropolis official brief](https://monad.xyz/developers/hackathons/metropolis) — Track 04, event rules, build requirements, deadline.
- [Monad developer docs — Testnet](https://docs.monad.xyz/developer-essentials/testnet) — chain/RPC/explorer/faucet information. Testnet Chain ID: `10143`; native test currency: `MON`.
- [Monad Testnet Faucet](https://faucet.monad.xyz/) — request test MON for deploys and demo calls.
- [Monad Testnet Hub](https://testnet.monad.xyz/) — testnet application/resources entry point.
- [Monad Testnet Explorer](https://testnet.monadscan.com/) — inspect deployments and transactions (the docs also link MonadVision).
- [Monad deployment summary](https://docs.monad.xyz/developer-essentials/summary) — deployment and developer checklist.
- [Monad developer community on GitHub](https://github.com/monad-developers) — organization projects and sample repos.
- [Monad community-curated resources](https://github.com/monad-developers/community-resources) — community tutorials and learning links.

The official docs expose public testnet RPC endpoints, with rate limits. For the MVP use the documented RPC directly; do not sign up for a paid or metered RPC plan. If public RPC limits become inconvenient, use a local Anvil instance for unit/integration tests and reserve the public Monad testnet for final deployment and the demo.

## 3. Most relevant starter repos and examples

1. **[Monad-configured Foundry starter](https://github.com/monad-developers/foundry-monad)** — Monad’s developer org says the template defaults to `monadTestnet`; useful base for the guard/vault contracts. Check the current `foundry.toml` before deploying.
2. **[Monad MCP tutorial](https://github.com/monad-developers/monad-mcp-tutorial)** — demonstrates a local MCP server reading Monad testnet balances with a tool. Use it to understand the chain/MCP connection, then implement Mandate’s policy check; its example is read-only and is not the enforcement layer we need.
3. **[MCP TypeScript SDK source](https://github.com/modelcontextprotocol/typescript-sdk)** — server/client implementation and examples.
4. **[MCP Inspector](https://github.com/modelcontextprotocol/inspector)** — local UI for listing/calling tools on our MCP server while building; package can be run with `npx @modelcontextprotocol/inspector ...`.
5. **[Foundry source](https://github.com/foundry-rs/foundry)** — Forge tests/builds, Cast RPC/contract interactions, and Anvil local EVM.
6. **[Official ERC-8004 contracts/reference repo](https://github.com/erc-8004/erc-8004-contracts)** — optional agent identity adapter. Its deployment list includes Monad Mainnet and Testnet registries; recheck the current address/network in the repo before using it. ERC-8004 identifies agents; it does not replace Mandate’s authorization checks.

### Optional ERC-8004 Monad Testnet registry references

The scraped registry deployment list reported:

- Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`

Treat these as optional/read-only until checked against the current ERC-8004 repository and Monad Testnet explorer. The MVP must still work without ERC-8004.

## 4. Solidity, signing, and testing

- [Foundry Book](https://getfoundry.sh/) — `forge build`, `forge test`, fuzz tests, `cast`, and `anvil`.
- [Monad Foundry starter](https://github.com/monad-developers/foundry-monad) — network config and deploy flow.
- [Solidity documentation](https://docs.soliditylang.org/en/latest/) — language reference.
- [OpenZeppelin Contracts 5.x](https://docs.openzeppelin.com/contracts/5.x/) — reusable Solidity primitives; install the package instead of copying snippets.
- [OpenZeppelin contract testing/deployment guides](https://docs.openzeppelin.com/contracts/5.x/learn) — test/deploy interactions.
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712) — typed-data signatures for user-approved mandates; bind the domain to Monad’s chain ID and the verifying contract.
- [Monad Solidity/Foundry quickstart](https://github.com/monad-developers/foundry-monad) — repo-based quickstart; the community resources repo links additional guides.

**Test cases to write first:** valid bounded call; wrong agent signature; wrong target/function; per-call limit; total spend limit; expiry; revoked mandate; replayed nonce; failed downstream call; and state rollback after a reverted execution.

## 5. Intent compiler, MCP gateway, and hosted AI runtime

- [MCP TypeScript SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/) — register typed tools, choose stdio/HTTP transport, validate tool input schemas. For our local demo use **stdio** so no public server or hosting is needed.
- [MCP server guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html) — tool design and server APIs.
- [MCP first-server tutorial](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server) — setup and minimal server.
- [MCP Inspector source](https://github.com/modelcontextprotocol/inspector) — manually test tools without needing to attach a full AI client.
- [Monad MCP example repo](https://github.com/monad-developers/monad-mcp-tutorial) — chain-reading tool example.
- [NVIDIA NIM API Catalog quickstart](https://docs.api.nvidia.com/nim/re/docs/api-quickstart) — create a developer API key and call an NVIDIA-hosted model endpoint.
- [NVIDIA NIM FAQ](https://docs.api.nvidia.com/nim/docs/product) — free Developer Program access is for prototyping/research/development/testing; request limits vary, and production requires a separate NVIDIA AI Enterprise license.
- [NVIDIA NIM pricing/usage](https://docs.api.nvidia.com/nim/docs/run-anywhere) — confirms free prototype access and explains production licensing.

**Intent compiler and hosted API rules:**

- Natural-language policy extraction is a proposal only. Deterministic code validates supported action, agent, target, amounts, currency/units, date/timezone, expiry, caps, and required fields.
- Missing or ambiguous details must produce a clarification question. No defaulted/guessed policy can reach wallet signing. Show the canonical preview; only explicit principal confirmation creates the Mandate.
- Keep raw prompts offchain; send only the minimal necessary request to the provider and disclose/inspect provider retention terms. API keys stay in the local backend environment.

**Hosted API and deterministic test choices:**

- **Live AI path:** call the selected hosted model API using a backend-only secret and structured tool schemas. Validate every response locally; model/API output cannot sign, choose policy, or bypass the gateway/contract.
- **NVIDIA NIM candidate:** official docs describe free Developer Program access to hosted API endpoints for prototyping; this is not a published per-token top-up plan. NVIDIA states that production use requires AI Enterprise licensing, with pricing beginning at $4,500 per GPU/year. Treat NIM as a free prototype candidate, not the assumption for buying hackathon token credits. [NVIDIA API quickstart](https://docs.api.nvidia.com/nim/re/docs/api-quickstart) · [NVIDIA access and pricing FAQ](https://docs.api.nvidia.com/nim/docs/product)
- **Paid usage candidate:** a provider with transparent pay-as-you-go token pricing and account-level usage controls. Compare current official prices and tool/function calling behavior using a representative prompt before selecting; OpenAI publishes token rates and usage guidance at [API pricing](https://developers.openai.com/api/docs/pricing).
- **Deterministic integration test:** scripted calls via MCP Inspector or a local harness. It costs nothing and reproduces adversarial cases, but it is not the live reasoning model.
- **Architecture rule:** provider choice is replaceable; put an `AgentModelAdapter` behind the MCP host, never let the frontend call a paid model directly, cap tokens/calls/retries/time, log usage, and stop at a configured hard spend limit.

## 6. API provider decision and token budget

The project architecture requires hosted inference for the interactive natural-language policy proposal and live agent path; the user selects the account/provider and authorizes a maximum spend before any purchase or billing change. Do not pre-buy an arbitrary large token balance. Prefer pay-as-you-go with a hard account/project budget or prepaid credit capped at the requested amount. Start with a small test budget, run a measured evaluation (e.g. 20 representative policy-extraction and tool-selection requests), record average input/output tokens and cost, then estimate the full demo/test usage. Multiply measured per-run cost by planned runs and add a modest reserve; set the provider limit no higher than the approved cap.

**Current procurement status:** no provider or spending cap is specified, so no credits have been purchased. NVIDIA NIM's official documentation describes Developer Program prototype access rather than per-token credit purchase; its production licensing model is distinct. If NVIDIA is preferred, first test whether free prototype quota meets the hackathon workload. If paid token credits are required, choose a pay-as-you-go API provider and amount explicitly.

## 7. Frontend and wallet libraries

- [Vite guide](https://vite.dev/guide/) — build/dev tooling for the static React console; compatible with a GitHub Pages deployment.
- [React Learn](https://react.dev/learn) — UI components for create/review/revoke and receipts.
- [Next.js docs](https://nextjs.org/docs) — an optional future upgrade if the product needs server rendering or server-side APIs; not selected for the MVP.
- [TypeScript docs](https://www.typescriptlang.org/docs/) — typed UI/gateway code.
- [viem docs](https://viem.sh/) — EVM RPC, typed contract reads/writes, event logs, and browser-wallet clients.
- [Zod docs](https://zod.dev/) — runtime validation for MCP tool arguments and mandate input.
- Use a browser wallet already installed by the developer for testnet signing; do not build custody or require a paid embedded-wallet provider for the hackathon MVP.

## 8. GitHub resources and free infrastructure workflow

- [GitHub Free plan](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) — unlimited public repositories and GitHub Pages in public repos on Free; the page lists free quotas for some metered products.
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) — standard hosted runners are free for public repositories. Keep the repository public and use `ubuntu-latest`; do not select larger runners.
- [GitHub Pages docs](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages) — free static public project/demo site on GitHub Free.
- [GitHub CLI manual](https://cli.github.com/manual/) — free `gh` commands for repos, issues, PRs, releases, and workflow runs.
- [Monad developer organization](https://github.com/monad-developers) — starter repositories and examples.
- [Model Context Protocol GitHub organization](https://github.com/modelcontextprotocol) — SDK, Inspector, protocol examples.
- [Foundry GitHub organization](https://github.com/foundry-rs) — contract tooling and book.

Suggested public repo layout:

```text
mandate/
  apps/console/       # React + Vite static mandate creation/revocation/receipt UI
  packages/policy/    # deterministic checks + schemas
  packages/mcp-server/# narrow tools; stdio for local demo
  contracts/          # Monad MandateVault/guard + Foundry tests
  scripts/            # deploy, seed test vendor, reproduce demo
  docs/               # architecture, threat model, screenshots, demo
```

Free GitHub plan footnote: GitHub documents 2,000 Actions minutes/month for private repos on Free (with billing above quotas) but **public standard-runner Actions are free**. To keep non-model infrastructure free, make the hackathon repo public, use standard runners only, avoid Codespaces/paid runners/paid Marketplace Actions, and never enable metered overage. GitHub Pages is for a static site; run the MCP gateway locally for the live demo. A public GitHub URL and short demo video can still make the work easy to inspect.

## 9. Problem/threat-model sources

- [OWASP LLM06:2025 — Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) — excessive permissions/functionality/autonomy; downstream enforcement, least privilege, approvals, logging, rate limiting.
- [NIST NCCoE — Software and AI Agent Identity and Authorization](https://www.nccoe.nist.gov/projects/software-and-ai-agent-identity-and-authorization) — standards-based agent identity/authorization challenge.
- [NIST AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative) — interoperability, authentication, identity research.
- [ERC-8004 builder resources](https://www.8004.org/build) — identity/reputation/validation reference. Use identity as a pointer, not as proof that an action is authorized.

## 10. Deployment and data flow with bounded API spend

1. `forge test` and `anvil` run locally for fast repeatable contract testing.
2. Request test MON from the official Monad faucet and deploy the contract to Monad Testnet using its public RPC.
3. Run `npm run dev` and the local MCP server on the development machine; configure the hosted model provider key only in the backend environment and use a browser wallet connected to Testnet.
4. Read contract state and events directly through viem/RPC; store offchain UI/audit conveniences in local SQLite or JSON.
5. Optionally publish a static UI/README/video through a **public GitHub repo and GitHub Pages**. The model API is the planned metered service; keep other infrastructure free and do not add paid RPC, database, indexer, domain, or server dependencies.

## 11. Keep the total bill bounded

- Monad Mainnet transactions/deployment (they require real MON).
- Unbounded model API usage, unattended agent loops, or API keys exposed to client code.
- NVIDIA AI Enterprise/production licensing for this hackathon MVP; the NIM Developer Program documents free prototyping access, while production terms differ.
- Paid or metered RPC plans (Alchemy/QuickNode/etc. are optional, not required).
- Paid deployment/database providers; no domain purchase needed.
- GitHub Codespaces if you could exceed its included allowance; local VS Code/editor is enough.
- Private-repo Actions overages, larger GitHub runners, paid Actions, or usage-based GitHub add-ons.
- Embedded wallet/paymaster vendors unless the current terms have been checked and a free tier is sufficient; a browser wallet is enough for the MVP.
- Paid analytics/indexers; read events from the Monad RPC.

## 12. Scrapling verification record

Fetched with Scrapling 0.4.14+ CLI and `--ai-targeted` (HTTP 200 unless noted):

- Monad Metropolis official page: `https://monad.xyz/developers/hackathons/metropolis` — HTTP 200.
- Monad Testnet developer docs: `https://docs.monad.xyz/developer-essentials/testnet` — redirected to canonical `/developer-essentials/testnet` and HTTP 200.
- Monad MCP tutorial: `https://github.com/monad-developers/monad-mcp-tutorial` — HTTP 200.
- Monad Foundry template: `https://github.com/monad-developers/foundry-monad` — HTTP 200.
- MCP SDK v2 docs: `https://ts.sdk.modelcontextprotocol.io/v2/` — HTTP 200.
- MCP Inspector: `https://github.com/modelcontextprotocol/inspector` — HTTP 200.
- Foundry, OpenZeppelin, Solidity, viem, Vite, React, Next.js, hosted model API/NVIDIA NIM, GitHub pricing/Actions/Pages/CLI, ERC-8004 resources — Scrapling `extract get --ai-targeted`, HTTP 200.
