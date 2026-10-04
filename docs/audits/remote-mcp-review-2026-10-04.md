# Remote MCP implementation and security review — 2026-10-04

## Scope and status

Reviewed the Cloudflare Pages Streamable HTTP route, shared MCP server factory, Codex remote setup generator, local Pages integration test, and NVIDIA adapter retry. The function is now published to Pages production and its encrypted runtime settings have been provisioned. Live unauthenticated and authenticated calls were verified against the production URL.

## Security review

**Security-sensitive:** yes. **OWASP categories checked:** 10/10.

| Category | Status | Evidence / note |
|---|---|---|
| A01 Broken access control | PASS with MVP limitation | Every non-preflight request requires a bearer token of at least 32 characters; chain contract independently checks transfer authority. One shared token does not provide per-user identity or tenant isolation. |
| A02 Cryptographic failures / exposure | PASS | Token compared without direct string equality; no token in generated command or client bundle; secrets come from runtime environment. |
| A03 Injection | PASS | MCP SDK owns protocol parsing; URL is validated as HTTPS and shell-quoted for the Codex command; MCP tool arguments use Zod schemas. |
| A04 Insecure design | NOTE | Stateless server and contract-enforced bounds. Shared bearer plus shared server signer is suitable only for controlled testnet MVP; no tenant isolation. |
| A05 Security misconfiguration | PASS | Missing/short token fails closed with 503; unknown origins fail 403; unsupported methods fail 405; errors are sanitized; responses are no-store. |
| A06 Vulnerable components | PASS (production audit) | `npm audit --omit=dev`: 0 vulnerabilities. |
| A07 Authentication failures | NOTE | Bearer is required and minimum length checked. Configure Cloudflare rate limiting and key rotation/monitoring before broader access. |
| A08 Data integrity | PASS | Transfer policy remains checked by chain contract; proposal output remains review-only. |
| A09 Logging/monitoring | NOTE | No secrets or provider body are returned; configure Cloudflare request/error monitoring and alerting before broad access. |
| A10 SSRF | PASS | The route makes no caller-directed fetches; provider endpoint is server configuration and adapter requires HTTPS. |

## Verification

- `npm test`: 9 files, 53 tests passed (99.35% statements, 98.56% branches, 95% functions, 100% lines on instrumented files).
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite reports the existing 541.92 kB JavaScript chunk-size warning.
- `npm run test:remote-mcp:local`: Cloudflare Pages Function starts; auth/CORS checks pass; authenticated Streamable HTTP initializes; all three tools list; live Monad status is read; revoked mandate transfer returns `MANDATE_INACTIVE` with no transaction.
- Live production verification: unauthenticated POST returned HTTP 401; bearer-authenticated MCP initialized and listed all three tools; live mandate status read `active=false`, `deposited=0`; transfer request returned `MANDATE_INACTIVE`; no transaction submitted.
- Initial remote proposal calls returned `needs_clarification` from Worker-side fetch failures although local Node inference succeeded. Replaced `AbortSignal.timeout` with a fresh `AbortController` timeout per attempt and bounded retry; the local Pages runtime and production Cloudflare Worker then returned validated review-only proposals.
- `npm run audit:secrets`: passed.
- `npm run audit:deps`: 0 production vulnerabilities.
- Wrangler authenticated successfully. Final Pages deployment `cbf87695` is Production on branch `main`; runtime settings were uploaded to production without printing values.

## Remaining release gates

1. Configure Cloudflare rate limiting, monitoring, and rotation for the shared testnet bearer token; replace the shared-token model with per-user identity before multi-user production use.
2. Continue monitoring the NVIDIA provider; the current live proposal check succeeds, and its unavailable-provider fallback remains covered by tests.
