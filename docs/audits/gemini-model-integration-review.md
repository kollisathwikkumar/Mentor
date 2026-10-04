# Gemini 3.8 Flash adapter security review

**Reviewed:** 2026-10-04
**Scope:** `packages/model-adapter`, MCP proposal registration, local/Cloudflare runtime configuration, and live stdio test.
**Credential location:** ignored `.env.local` (mode `0600`) and Cloudflare Pages encrypted runtime secret; the key is not stored in source, browser variables, or MCP tool output.

## Security checks

| OWASP area | Result | Review |
|---|---|---|
| A01 Access control | Pass | Proposal tool remains read-only; transfer still uses its separate policy-gated MCP route. |
| A02 Sensitive data | Pass | Key uses `x-goog-api-key` request header, not URL/query/body; responses and credentials are excluded from logs. |
| A03 Injection | Pass | Model text is parsed by the deterministic compiler and validated before producing a proposal. |
| A04 Insecure design | Pass | Model output can only create a review proposal; it cannot sign, fund, or submit transactions. |
| A05 Misconfiguration | Pass | HTTPS host, endpoint path, model ID, timeout, input size, and output size are pinned. |
| A06 Components | Pass | No new runtime dependency added; dependency audit run with migration. |
| A07 Authentication | Pass | Backend checks that a nonempty configured Gemini key exists; no key is accepted from MCP callers. |
| A08 Data integrity | Pass | Gemini response structure is schema-validated; malformed output fails closed. |
| A09 Logging | Pass | Provider body and request content are omitted from logs; only sanitized HTTP status/error class is logged. |
| A10 SSRF | Pass | Caller-controlled task text cannot select host, path, query, or model. |

## Verification

- Gemini adapter tests: request header/body, response schema, timeout, bounded prompt/output, endpoint/model pinning, and secret-safe errors.
- Live provider call: HTTP 200 from Gemini 3.8 Flash using the configured key.
- Live MCP stdio acceptance: exact signer, recipient, 0.01 MON per-call cap, 0.02 MON total cap, and UTC expiry returned as a schema-validated review proposal; no transaction submitted.
- Cloudflare production Pages MCP proposal test passes after correcting the fetch receiver context and configuring the Pages Worker compatibility date/flags. The authenticated production test also verified live status and inactive-transfer denial without sending a transaction.

**Review status:** PASS for local adapter, MCP stdio, and authenticated production Pages proposal path.
