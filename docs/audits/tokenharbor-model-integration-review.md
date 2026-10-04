# Historical: Token Harbor / DeepSeek integration security review

**Superseded:** The backend was subsequently migrated to Google Gemini 3.8 Flash. See [`gemini-model-integration-review.md`](gemini-model-integration-review.md) for the current adapter review.

**Reviewed:** 2026-10-04
**Security-sensitive:** Yes — external API credential and untrusted model response
**Scope:** `packages/model-adapter`, `packages/mcp-server/src/model-tool.ts`, MCP registration, live model test
**Status:** Review-only implementation passes unit/integration checks. Live model acceptance remains pending: the Token Harbor API reports `HTTP 403 email_verification_required` from the local Node process; Cloudflare Pages returns a sanitized transport `TypeError` before receiving an HTTP response.

| OWASP category | Status | Review note |
|---|---|---|
| A01 Broken access control | Pass | Proposal tool is read-only and does not create or widen a mandate. Transfer remains a separate tool requiring onchain mandate checks and explicit MCP/client approval. |
| A02 Cryptographic failures / sensitive data | Pass | API credential is read from backend environment only; no credential, raw request, or provider response body is logged. Local `.env.local` has owner-only mode. |
| A03 Injection | Pass | Prompt data is sent as a JSON string over HTTPS. Model output is JSON parsed then strictly Zod-validated by the intent compiler; it is not evaluated as code or action parameters. |
| A04 Insecure design | Pass | Model output is explicitly review-only; it cannot sign, fund, create policy, or submit a transaction. No automatic retry avoids duplicate provider calls. |
| A05 Security misconfiguration | Pass | Provider host/path and model ID are fixed to the intended Token Harbor route; timeout and completion token output are bounded. |
| A06 Vulnerable components | Pass | `npm audit --omit=dev`: 0 vulnerabilities. |
| A07 Authentication failures | Pass with external gate | Direct API probe returns `email_verification_required` (403); it is surfaced as a sanitized clarification, not as a successful proposal. |
| A08 Data integrity / deserialization | Pass | Provider payload is validated against a Zod schema before any model text enters the compiler. |
| A09 Logging and monitoring | Pass with limitation | Logs include only provider HTTP status; secrets, prompts, and response bodies are excluded. Persistent request/cost telemetry is not implemented. |
| A10 SSRF | Pass | The outbound model URL is hard-coded to the Token Harbor HTTPS chat-completions endpoint; no prompt or caller field controls the destination. |

## Verification evidence

- Unit tests cover request shape, endpoint/model pinning, bounds, timeout abort, malformed responses, status sanitization, and MCP review-only semantics.
- The live key was tested against Token Harbor `/v1/models` and `/v1/chat/completions`; both reported `403 email_verification_required`. No successful completion is claimed.
- The live MCP stdio smoke test reaches Token Harbor but remains red on the same account-verification response. The deployed Pages MCP registers the proposal tool, but its outbound provider fetch currently throws a sanitized `TypeError`; this remote egress issue remains unresolved.
- No chain transaction is part of model verification.
