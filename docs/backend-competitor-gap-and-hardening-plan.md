# Backend competitor review and Mandate hardening plan

**Review date:** 5 October 2026
**Implementation status:** P0 fail-closed MCP hardening is implemented and locally verified. The D1 policy/task backend, wallet-signature policy lifecycle, and policy-gated Monad transfer path are implemented and verified in local Wrangler Pages + D1 + OAuth. No production migration or deployment has been performed.

## Closest working reference: IntentFrame

IntentFrame's public repository describes a concrete agent-action path: an agent submits structured intents through an Actor SDK boundary; the runtime parses and validates the request; deterministic gates and (where needed) semantic analysis/Guardian policy decide; a separate Executor holds credentials and performs approved operations; an audit trail records the decision and execution. Its [quickstart](https://github.com/intentframe/intentframe/blob/main/docs/quickstart.md) documents installation, a demo, root-demo dry-run tests, and unit tests. Its [architecture](https://github.com/intentframe/intentframe/blob/main/docs/architecture.md), [executor contract](https://github.com/intentframe/intentframe/blob/main/docs/executor.md), and [evidence report](https://github.com/intentframe/intentframe/blob/main/docs/evidence.md) describe its boundary and test evidence.

IntentFrame's reported adversarial results are project-published evidence, not an independent audit. Its own evidence page explicitly records a **salami-slicing gap** in its invoice suite (several actions each below a per-action limit can exceed the intended aggregate), an important category to cover in Mandate's generic offchain policy model. The published architecture also depends on the developer routing every consequential action through the supported Actor/Executor boundary; direct I/O outside that boundary is outside its own security claim.

Kontext is a useful second reference: its [quickstart](https://docs.kontext.security/getting-started/quickstart) documents a local endpoint daemon, agent hooks, connection checks, activity traces, and an observe-before-enforce policy lifecycle. Nodra's [MCP Guard integration](https://www.nodrasecurity.com/integrations/mcp) shows the intended server-side pattern—authorize immediately before tool execution, then record the outcome—but its public page does not expose the complete control-plane implementation. These are comparison references, not assertions of independent production validation.

## Mandate backend gaps found in this repository

1. **Generic policy code exists but is not an end-to-end product path.** `packages/connectors` already contains a typed capability registry, canonical-hash policy format, in-memory tested authorization gateway contract, and task-state reducer. But no production PolicyStore, task API/event persistence, validated per-user identity route, or generic MCP/runtime integration is wired; the dashboard chat remains draft-only. The existing MCP server and onchain payment path do not call this generic gateway.
2. **Authority defaults are too broad in the standalone MCP constructor.** `createMandateMcpServer()` treated omitted `MCP_GRANTED_SCOPES` as every known capability. Missing configuration therefore granted rather than denied authority. **P0 fixed locally:** omitted scopes now expose zero tools.
3. **Unbound principal was treated as authorized.** `mandateBelongsToPrincipal()` returned true when principal was undefined, so local/stdin use could not distinguish a missing identity from a deliberate operator. **P0 fixed locally:** unbound access now requires an explicit flag; the hosted route sets it only for the separately configured master bearer. OAuth paths always supply and verify the principal.
4. **Activity evidence is not an action audit trail.** The D1 `mcp_activity` record is one aggregate last-seen row/count. It does not provide a per-action decision record, policy version/hash, denial reason, or verified execution outcome. Monad events evidence the supported transfer path, but not general tools.
5. **The generic authorization contract is not operationally durable.** Policy grants have resource/equality constraints and per-grant `maxCalls`, and the tested gateway reserves before dispatch. However the only concrete store is test memory, aggregate monetary precision/quotas need typed fixed-point design, and no remote execution route uses it. Cross-request budgets and concurrency are not yet proven.
6. **The hard guarantee is narrow and must remain accurately stated.** Monad can independently enforce the supported native-MON contract action. It cannot enforce arbitrary offchain GitHub, email, filesystem, or project-workflow effects unless their connector calls are routed through the generic gateway.

## Implementation sequence

### P0 — Close unsafe authority defaults (implemented)

- Make omitted scopes result in zero tools.
- Require an authenticated matching principal for mandate reads and transfers by default.
- Allow unbound access only through an explicit operator-mode flag, wired solely from the existing configured master bearer path; keep OAuth principal checks mandatory.
- Add regression tests for omitted scopes, absent principal, explicit operator mode, and authenticated owner access.
- Add explicit scopes/mode to local configuration guidance so integrations fail visibly rather than silently broadening authority.

### P1 — Wire the existing generic policy core to durable state and identity

- Retain and test the existing typed capability/policy schema and `AuthorizationGateway`; make policy source, approved hash, agent identity, and caller identity derive from verified owner state, not MCP input/model output.
- Implement durable D1/Durable Object-backed mandate, task-event, and idempotency/reservation stores. Use transaction/serialized atomic reservations and revision checks; do not claim usage limits until concurrent requests are covered against the actual local service.
- Replace floating point amounts with exact integer/minor-unit or decimal-string arithmetic where quotas are money-like. Add aggregate caps/counts per policy, not just per action.
- Keep model output proposal-only. Persist an exact canonical policy draft, show it to the principal, and activate only after explicit owner confirmation binds the approved hash.
- Add integration tests for owner isolation, no implicit principal, salami slicing across repeated actions, concurrent reservations, replay, expiry, revocation, malformed action, canonical target mismatch, and database restart/reconnect.

**P1 implemented locally (5 October 2026):** migration `0004_generic_authorization.sql` adds durable mandates, grant counters, action attempts, audit events, decisions (including missing-policy denials without foreign-key failure), tasks, and versioned task events. `D1PolicyStore` validates canonical policy hashes, verifies owner EIP-191 signatures bound to origin/owner/mandate/version/hash/expiry, performs revocation, reserves calls and integer-unit aggregate budgets in one D1 transaction batch, binds idempotency keys to a canonical action-request digest, and records action decisions/outcomes. `/api/mandates` and `/api/tasks` expose wallet-owner-scoped CRUD/event routes under the `mandate:policy` OAuth scope. Task state updates use owner checks and compare-and-swap versions and cannot self-assert execution success.

**P2 first vertical implemented locally:** `/mcp` injects the durable policy store into the server. OAuth `request_bounded_transfer` now executes through `AuthorizationGateway` and the registered `monad.native:native.transfer` adapter before the existing onchain gateway/contract checks. The owner signs a policy bound to the OAuth client ID; a different agent is denied. The master bearer remains an explicit operator-only legacy path. The local Pages integration test creates/signs/approves/revokes a D1 policy, exercises task events, proves an OAuth transfer request without a policy is denied before chain RPC, and proves a valid offchain policy still cannot bypass an onchain owner mismatch. This is one guarded vertical, not a generic connector framework for arbitrary offchain work.

### Persistence choice from the Scrapling research pass

- Keep the current Pages Functions + D1 topology for policy/task/audit records. Cloudflare's D1 docs say `batch()` executes statements sequentially and transactionally, rolling back the batch when a statement fails; this gives the current atomic reservation seam. Source fetched with Scrapling `--ai-targeted`: [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).
- Do not introduce a global Durable Object for every operation. Cloudflare recommends Durable Objects for serialized stateful coordination and modeling one object per coordination atom/entity. Re-evaluate per-mandate Durable Objects if measured D1 contention/latency or the deployment load needs stronger per-entity sequencing. Source fetched with Scrapling `--ai-targeted`: [Durable Objects best practices](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
- A D1 batch makes each *reservation* atomic, but an external side effect and D1 commit cannot form one distributed transaction. Dispatch therefore needs idempotent provider requests, a durable `reserved → outcome` ledger, conservative `unknown` handling, and reconciliation; never blindly retry an uncertain write.

### P2 — Expand the gated connector runtime (first Monad vertical shipped locally)

- Add workspace UI support for task creation, policy review, exact wallet-signing, status, and revocation; connect task IDs to action events.
- Require adapters to declare reversibility/idempotency and return a normalized execution receipt. Do not claim to protect integrations that do not route through this seam.
- Add bounded read-only GitHub capability, then one reversible write using isolated per-user credentials; never ship a generic “run arbitrary tool” escape hatch.
- Preserve native MON as its own vertical and continue using contract-level checks as an independent enforcement layer. Add connector outcome verification and reconciliation before expanding to writes.

### P3 — Broaden audit coverage, concurrency, and operations

- D1 now records allow reservations, deny reason codes/request digests, policy version, idempotency identity, and normalized provider outcomes. Next, add task ID, MCP client identity, and connector verification evidence to each decision/outcome row.
- Aggregate call and amount caps are reserved atomically under concurrent actions using D1 batch conditional updates. Run larger load/contention tests before setting production throughput claims.
- Add rate limits, bounded request sizes/timeouts, and fail-closed behavior for missing DB/RPC/policy state. Do not let telemetry failure turn into authorization success; distinguish audit-required actions from best-effort connection counts.
- Provide an end-to-end test with a real local persistence service and a fake controlled connector, then a live Testnet/onchain run for Monad-specific actions.

## First implementation target

P0 is implemented locally because granting every tool when scopes were omitted and accepting an absent principal were concrete fail-open behaviors. The first working P1/P2 vertical now passes local D1/Pages/OAuth integration. The next implementation slice is **workspace UI integration and offchain connector expansion**. Do not claim arbitrary task execution, verified project workflows, or offchain coverage until each concrete adapter is registered, owner-credentialed, routed through this gate, and tested end to end.

## Validation record for the first P1 slice

- `npm run test:d1-policy:local`: passed against a real local Wrangler D1 instance. Four concurrent 20-unit calls under a 50-unit aggregate cap produced exactly two allowed actions; the remainder were denied with `BUDGET_LIMIT`. Replaying one idempotency key returned the original receipt; reusing that key with modified arguments was denied. D1 recorded two reservations, two completions, aggregate-budget and idempotency-conflict denials, and task events. A fresh owner signature activated only the exact mandate origin/owner/ID/version/hash/expiry. Stale task revision and cross-principal task read were rejected.
- `node --env-file=.env.local scripts/test-remote-pages-mcp.mjs`: passed against local Cloudflare Pages Functions + OAuth + D1. Wallet PKCE identity created and signed/approved/revoked a policy bound to its registered OAuth client; persisted task creation, proposal transition and stale CAS rejection passed; an OAuth transfer without policy was denied before chain RPC; a valid policy with a mismatched onchain owner was rejected in the adapter; existing revoked onchain contract denial remained enforced.
- `npm exec vitest run packages/connectors/test/registry.test.ts`: baseline was 15 tests passed; modified suite adds a salami-slicing aggregate-budget test.
- `npm run typecheck`: passed after the D1 store implementation.
- Not yet verified: production D1 migration/deployment, workspace UI integration, arbitrary offchain connectors, connector credential isolation, larger concurrency/load contention, task-ID correlation in action audit, and a live Testnet transfer made through a separately signed D1 policy.

## Source review notes

- IntentFrame repository and docs were fetched with Scrapling `--ai-targeted` from its official public GitHub repository; the README and docs were retrieved with HTTP 200. Its published claims and evidence are identified above as self-reported.
- Kontext's official quickstart was fetched with Scrapling `--ai-targeted` and HTTP 200.
- Nodra's official MCP Guard page was fetched with Scrapling `--ai-targeted` and HTTP 200.
- This is a design/code review, not an independent penetration test, vendor audit, or production certification.
