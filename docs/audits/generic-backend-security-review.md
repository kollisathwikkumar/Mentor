# Generic backend foundation review

Date: 2026-10-04  
Review scope: `packages/connectors/src/index.ts`, task-brief catalog/UI wiring, and the existing Pages MCP boundary. This is a local code review; it is not a production certification.

## Passes covered

1. **Input and connector boundary:** manifests are versioned and registered by exact connector/action key; duplicates and unknown actions fail closed; capability input uses strict Zod schemas; URLs, shell, SQL, arbitrary MCP names, and model code are not interpreted by this package.
2. **Authorization and tenant boundary:** the execution gateway requires an authenticated principal supplied by its caller, checks mandate principal/status/expiry and exact canonical hash equality, requires a matching explicit grant/resource and declared constraints, and rechecks version/principal/status/expiry inside the atomic store reservation contract.
3. **Race/retry behavior:** adapter dispatch happens only after reservation; store must serialize reservations per mandate and enforce the passed call ceiling; retries return cached results or conflict; adapter exceptions are recorded as `unknown` and are not re-dispatched automatically.
4. **Task state/ownership:** the pure reducer checks owner, expected version, and a fixed transition graph, and emits monotonically incremented event versions and caller-provided event IDs.
5. **Build/test hygiene:** production dependency audit and secret scan pass; contract tests remain green.

## Findings / blockers to close before remote multi-user use

- **High — no durable policy store is wired.** `PolicyStore` is an interface; this change adds no D1/SQLite Durable Object implementation or binding, and the test store is not production code. Cross-isolate atomicity, event persistence, budget reservations, and idempotency are therefore not yet verified.
- **High — identity is not per-user yet.** The existing Pages MCP route authenticates a shared bearer secret but does not establish a validated per-user principal/audience/scope. The generic gateway accepts a principal context; it does not authenticate one. Do not expose generic side-effect tools through that route as if it were tenant-isolated.
- **High — existing Monad transfer path is not yet routed through this generic gateway.** It remains governed by the legacy `MandateGateway` and the deployed `MandateVault` contract. Onchain fixed-recipient enforcement remains authoritative for that capability only.
- **Medium — no task API/event persistence/SSE exists.** The reducer is tested in-process, while the task brief stays browser-local. Reconnect cursors, cross-tenant polling, cancellation, and event retention remain unimplemented.
- **Medium — no offchain connector is registered.** The new package defines adapter contracts only. No SaaS/repository/email action is currently authorized or executed.

## Release gate

Keep remote multi-user task/action endpoints disabled until a validated identity adapter, atomic durable `PolicyStore`, persisted event store, and integration tests against local D1/Durable Objects exist. Add each offchain action only with its own credential isolation and provider receipt/reconciliation tests. No deployment or live provider call was made for this review.
