# Internal security review — 2026-10-04

**Scope:** Solidity vault, TypeScript policy/compiler, NVIDIA adapter, MCP tool boundary, viem signer adapter, and static wallet console. This is a local engineering review, not a third-party contract audit.

## Review outcome

No Critical or High issue was identified in the reviewed local path. The local Anvil end-to-end run proved that an allowed transfer delivered exactly the requested value, while over-limit and revoked calls caused no additional recipient balance change. Fifteen Foundry tests cover key contract invariants; the deterministic TypeScript core has 100% line coverage for included files.

| OWASP area | Review result | Evidence / residual |
|---|---|---|
| A01 Broken access control | Pass | Principal-only create/fund/revoke/withdraw; transfer requires registered EIP-712 agent; gateway does not accept recipient/signer overrides. |
| A02 Cryptographic failures | Pass with residual | OpenZeppelin EIP-712/ECDSA and ReentrancyGuard; `.env.example` is placeholder-only and the local NVIDIA key is in ignored `.env.local`; local signer remains an environment-held EOA and needs operational key rotation before any non-test deployment. |
| A03 Injection | Pass | Zod strict MCP arguments, exact decimal parsing, no shell or arbitrary calldata tools; live Nemotron output is JSON-parsed, schema-checked, normalized, and returned as review-only data. |
| A04 Insecure design | Pass with release gate | Contract performs atomic checks and transfer; user wallet confirms creation. No model output itself grants authority. |
| A05 Security misconfiguration | Pass with environment caveat | Static UI CSP is present; server-only credentials; public RPC and contract address are explicit config. Deployment headers and RPC rate/availability remain release checks. |
| A06 Vulnerable components | Pass | `npm audit` reports 0 vulnerabilities; package versions are lockfile-pinned. |
| A07 Identification/authentication | Pass for MVP | Wallet transaction is principal authorization; EIP-712 signature is agent authorization. No hosted-user session system exists in this single-user local gateway. |
| A08 Software/data integrity | Pass | TypeScript strict mode and runtime parsing; transaction receipt is awaited before the gateway reports submission. |
| A09 Logging/monitoring | Pass with limitation | Provider/credential values and task prompts are not logged by the adapter or MCP handlers. Persistent security-event telemetry is not implemented. |
| A10 SSRF | Pass for tool surface | No caller-selected URL; endpoint and RPC are backend configuration, HTTPS-validated except localhost. |

## Release blockers / follow-up

1. One live proposal smoke test succeeded, but model inference is not yet exposed through the MCP path. Before enabling it there, define a hard spend ceiling and per-run call cap, verify provider usage accounting, and retain `NVIDIA_API_KEY` only in an ignored backend environment file. The current adapter has bounded prompts/output, disabled reasoning tokens for this extraction use, and a timeout, but does not meter provider cost.
2. Deploy only to Monad Testnet with a dedicated throwaway signer after contract review and wallet handoff. No deployment or live wallet transaction was performed here.
3. Run a third-party Solidity audit before any production value or production signer is used.

## Validation commands

- `npm run audit:secrets` → pass, no credentials in scanned project files; ignored `.env.local` is excluded.
- `npm audit` → pass, 0 vulnerabilities.
- `npm test` → pass, 33 TypeScript tests; 100% statements/branches/functions/lines over deterministic policy, compiler, provider adapter, and gateway modules.
- Live NVIDIA adapter + intent compiler smoke → pass, `ready_for_user_review`; numeric Unix expiry normalized to `1893456000`; no transaction submitted.
- `npm run test:contracts` → pass, 15 Foundry tests.
- `npm run test:e2e` → pass, local MCP process + Anvil end-to-end allow/over-limit/revoke path.
