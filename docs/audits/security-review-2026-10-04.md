# Internal security review — 2026-10-04

**Scope:** Solidity vault, TypeScript policy/compiler, NVIDIA adapter, MCP tool boundary, viem signer adapter, and static wallet console. This is a local engineering review, not a third-party contract audit.

## Review outcome

No Critical or High issue was identified in the reviewed local path. The local Anvil end-to-end run proved that an allowed transfer delivered exactly the requested value, while over-limit and revoked calls caused no additional recipient balance change. Fifteen Foundry tests cover key contract invariants; the deterministic TypeScript core has 100% line coverage for included files.

| OWASP area | Review result | Evidence / residual |
|---|---|---|
| A01 Broken access control | Pass | Principal-only create/fund/revoke/withdraw; transfer requires registered EIP-712 agent; gateway does not accept recipient/signer overrides. |
| A02 Cryptographic failures | Pass with residual | OpenZeppelin EIP-712/ECDSA and ReentrancyGuard; `.env.example` is placeholder-only and the local NVIDIA key is in ignored `.env.local`; local signer remains an environment-held EOA and needs operational key rotation before any non-test deployment. |
| A03 Injection | Pass | Zod strict MCP arguments, exact decimal parsing, no arbitrary calldata tools; `propose_mandate` passes live Nemotron output through JSON/schema validation and normalization, returning review-only data. |
| A04 Insecure design | Pass with release gate | Contract performs atomic checks and transfer; user wallet confirms creation. No model output itself grants authority. |
| A05 Security misconfiguration | Pass with environment caveat | Static UI CSP is present; server-only credentials; public RPC and contract address are explicit config. Deployment headers and RPC rate/availability remain release checks. |
| A06 Vulnerable components | Pass | `npm audit` reports 0 vulnerabilities; package versions are lockfile-pinned. |
| A07 Identification/authentication | Pass for MVP | Wallet transaction is principal authorization; EIP-712 signature is agent authorization. No hosted-user session system exists in this single-user local gateway. |
| A08 Software/data integrity | Pass | TypeScript strict mode and runtime parsing; transaction receipt is awaited before the gateway reports submission. |
| A09 Logging/monitoring | Pass with limitation | Provider/credential values and task prompts are not logged by the adapter or MCP handlers. Persistent security-event telemetry is not implemented. |
| A10 SSRF | Pass for tool surface | No caller-selected URL; endpoint and RPC are backend configuration, HTTPS-validated except localhost. |

## Release blockers / follow-up

1. The live proposal, read-only status, and bounded transfer tools are allowlisted in Codex with prompt approval. The bounded live flow passed for the disposable test mandate; browser-wallet acceptance still needs an EIP-1193 provider and an active Codex restart. Add a hard provider spend ceiling, a per-run call cap, and usage monitoring; the adapter bounds prompt/output size and timeout but does not meter provider cost.
2. The Testnet deployment script pins chain ID 10143, requires HTTPS and a separate deployer key, refuses a nonzero existing address, verifies deployed bytecode, and keeps the deployer key out of output. The contract is deployed at `0x77065a818481ceebba93e79988bef9fd646f457d` (deployment block `68065182`, 5,910 bytes of code). A test mandate was created and funded with 0.02 MON; live MCP `get_mandate_status` returned the expected active state, limits, deposit, and nonce. No bounded transfer has been submitted on the live testnet.
3. The Chrome console reports no EIP-1193 wallet provider; browser wallet create/fund/revoke acceptance remains pending. Restart Codex to load the updated MCP allowlist. Run a third-party Solidity audit and complete key-management, monitoring, and provider-cost controls before any production value or production signer is used.

## Validation commands

- `npm run audit:secrets` → pass, no credentials in scanned project files; ignored `.env.local` is excluded.
- `npm audit` → pass, 0 vulnerabilities.
- `npm test` → pass, 43 TypeScript tests; 100% reported coverage over the included deterministic core modules.
- `npm run test:model-mcp:live` → pass, live MCP stdio call to NVIDIA returned `ready_for_user_review`; only the proposal tool was exposed; no transaction submitted.
- `npx vitest run scripts/deployment-config.test.js` → pass, 4 deployment preflight cases.
- `npm run deploy:testnet` → pass; Monad Testnet chain ID 10143; deployment receipt successful; deployed code verified (5,910 bytes).
- Live testnet create/fund → pass; 0.02 MON deposited into the test mandate with 0.01 MON per-call cap.
- `npm run test:testnet-flow` → pass; live MCP transfer of 0.01 MON, gas-adjusted recipient balance and contract event verified; above-cap request denied with `PER_CALL_LIMIT`; principal revocation succeeded; post-revocation request denied with `MANDATE_INACTIVE`; remaining 0.01 MON withdrawal verified; final status inactive, spent 0.01, deposited 0, nonce 1.
- `npm run test:contracts` → pass, 15 Foundry tests.
- `npm run test:e2e` → pass, local MCP process + Anvil end-to-end allow/over-limit/revoke path.

## Hosted MCP OAuth and connectivity review — 2026-10-05

**Security-sensitive:** Yes. **Reviewed:** Pages MCP auth, OAuth endpoints/token storage, D1 migration, server scope gates, and console MCP setup. This is an engineering review, not an external penetration test or identity-provider certification.

| OWASP category | Result | Evidence / residual |
|---|---|---|
| A01 Broken access control | Pass with residual | MCP requires master bearer or verified OAuth access token; OAuth scopes gate registered tools; code/token resources, client id, redirect URI, expiry, PKCE, and revocation are checked. Owner bootstrap is shared-service, not per-user/tenant isolation. |
| A02 Cryptographic failures | Pass | 32-byte random client/code/access secrets; token and authorization-request values are SHA-256 hashed at rest; PKCE S256; constant-time master-token comparison; HTTPS deployment. |
| A03 Injection | Pass | Parameterized D1 statements; fixed route paths; bounded JSON/form bodies; OAuth HTML interpolations are escaped; redirect targets must be registered HTTPS URIs or loopback HTTP. |
| A04 Insecure design | Pass with residual | OAuth authorization code + PKCE, state return, resource/audience binding, one-time codes, short access-token TTL, and refresh rotation/replay rejection. Dynamic client registration is public and has no application-level rate limiter; configure Cloudflare rate limiting before wider use. |
| A05 Security misconfiguration | Pass after deploy verification | Exact-origin allowlist, no-store auth responses, CSP on approval page, OAuth discovery, token secret server-side, D1 migration applied remotely. Cloudflare production env values were not exposed in review. |
| A06 Vulnerable components | Pass | `npm audit --omit=dev` → 0 vulnerabilities. |
| A07 Identification/authentication | Pass with residual | Direct bearer requires 32+ chars; OAuth tokens are independently validated, expire, refresh-rotate, and revoke. OAuth's owner login asks for the shared service token, so it is one-operator bootstrap rather than user identity. |
| A08 Software/data integrity | Pass | Scope values are validated against a fixed allowlist; OAuth code tied to registered redirect + PKCE; MCP server tools are built from verified scopes. |
| A09 Logging/monitoring | Pass with limitation | Activity is only an aggregate timestamp/count; prompts and tokens are not stored. Failed auth/client registration abuse is not retained as an audit trail. |
| A10 SSRF | Pass | No arbitrary server-side fetch target comes from MCP/OAuth requests; redirects only return to validated registered targets. |

**Validation:** `npm test` passed 87 tests; `npm run typecheck` passed; `npm run build --workspace @mandate/console` passed; `npm run audit:secrets` passed; `npm audit --omit=dev` reported 0 vulnerabilities; `npm run test:remote-mcp:local` passed actual Pages Functions + local D1 with bearer auth, OAuth DCR, PKCE exchange, read-only scoped tool list, refresh rotation, replay rejection, status, and existing no-transaction chain denial checks. Remote D1 migration `0002_mcp_oauth.sql` applied successfully. Hosted end-to-end verification remains the release/deploy gate.

**Review status:** PASS WITH TRACKED MVP LIMITATIONS (single-operator shared-token bootstrap; rate limiting for public DCR; vendor UI acceptance per plan/client; third-party audit before production-value use).
