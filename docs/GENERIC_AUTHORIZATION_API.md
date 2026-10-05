# Durable Mandates and Task API

This backend slice turns the generic authorization foundation into a persisted policy lifecycle and connects its one implemented consequential connector—the existing Monad native-MON transfer—to the hosted MCP route. It is a working bounded vertical, not yet a universal agent/tool proxy.

## Request flow

1. The MCP client obtains a wallet-authenticated OAuth access token. The API derives `principalId` from the verified token; clients cannot choose or override the owner.
2. An owner with `mandate:policy` creates a draft. The API binds `agentId` to the OAuth client ID that will invoke the MCP action; the caller cannot choose it. The API accepts only the registered `monad.native:native.transfer` capability and bounded integer-unit parameters.
3. The API returns the exact canonical `policyHash` and EIP-191 `approvalMessage`. The owner signs that exact message with the same wallet.
4. The owner posts the signature to the approval endpoint. The backend recovers the signer, binds origin, owner, mandate ID, version, policy hash, and expiry, and activates the draft with a compare-and-swap update.
5. An MCP client with `mandate:transfer` calls `request_bounded_transfer` with the generic policy ID, onchain Monad mandate ID, amount, and an idempotency key.
6. `AuthorizationGateway` revalidates the owner, active status, expiry, policy hash, grant, resource, exact integer amount, call cap, aggregate budget, and idempotency record. A D1 batch atomically reserves quota before dispatch.
7. The adapter checks that the onchain mandate belongs to the authenticated wallet, then calls the existing `MandateGateway`. The contract independently checks the fixed recipient, onchain per-call/total limits, expiry, nonce, and revocation.
8. The transaction receipt or conservative `unknown` result is persisted. Repeated requests with the same key and same canonical request return the prior result; changed arguments under that key are denied.

The generic D1 policy is an additional user-approved authorization envelope. It does not replace or weaken the Monad contract. If D1/policy state is missing, the OAuth write tool is not exposed or the action fails closed.

## OAuth scopes

- `mandate:policy`: create, read, approve, revoke policies and create/read user-owned tasks/events.
- `mandate:transfer`: expose the generic-policy-gated `request_bounded_transfer` tool to OAuth clients.
- The existing master bearer remains an explicit operator-mode compatibility path. OAuth requests do not receive operator-mode behavior.

Clients should request only the scopes they need. A bearer token without the wallet-derived `mandate:policy` scope cannot create or approve a policy.

`GET /api/session` returns the verified token principal, OAuth client ID, and granted scopes. The workspace calls it immediately after PKCE token exchange and verifies that the returned wallet matches the account which initiated sign-in before retaining the session.

## Policy endpoints

All endpoints require `Authorization: Bearer <OAuth access token>` with `mandate:policy`.

### Create draft

`POST /api/mandates`

```json
{
  "expiresAt": 1800003600,
  "grants": [
    {
      "connectorId": "monad.native",
      "actionId": "native.transfer",
      "resourceId": "0x<64-hex-character-onchain-mandate-id>",
      "argumentEquals": {},
      "maxCalls": 2,
      "amountField": "amountNanoMon",
      "maxAmount": 25000000,
      "maxTotalAmount": 50000000
    }
  ]
}
```

`amountNanoMon` is an integer unit: **1 MON = 1,000,000,000 nanoMON**. This keeps generic quotas exact in JavaScript and SQLite integers. Expiry must be more than one minute in the future and no more than one year ahead. The response returns a server-generated mandate ID, the verified OAuth client ID as `agentId`, canonical hash, draft, and exact wallet-signing message. Execution requires the verified MCP client ID to match this signed `agentId`.

### Approve, inspect, revoke

- `POST /api/mandates/{id}/approve` with `{"signature":"0x…"}` activates only the currently stored draft whose exact owner, origin, version, hash, and expiry match the recovered signature.
- `GET /api/mandates/{id}` returns the owner-scoped policy snapshot and usage/idempotency state.
- `POST /api/mandates/{id}/revoke` revokes only an active mandate owned by the authenticated wallet.

## MCP transfer tool

OAuth clients need both `mandate:policy` (to establish the policy) and `mandate:transfer` (to invoke this action). Input:

```json
{
  "policyId": "<D1 mandate ID>",
  "mandateId": "0x<64-hex-character-onchain-mandate-id>",
  "amountNanoMon": 10000000,
  "idempotencyKey": "client-request-000000000001"
}
```

There is intentionally no caller-provided recipient or signer. The contract mandate fixes the recipient and the authenticated policy binds the onchain mandate resource. A policy denial is returned before adapter dispatch; a contract denial is independently enforced onchain.

## Persisted tasks/events

- `POST /api/tasks` creates an owner-scoped `received` task with a durable version-0 event.
- `GET /api/tasks/{id}` returns the task data and ordered events only to its owner.
- `POST /api/tasks/{id}/events` accepts compare-and-swap transitions for `clarification_required`, `proposal_ready`, `unsupported`, and `cancelled` only. Clients cannot self-assert execution, success, or verified connector outcomes through this endpoint.
- Execution outcomes remain recorded by the backend action ledger; no generic arbitrary-task executor is exposed yet.

## D1 records and guarantees

Migration `0004_generic_authorization.sql` adds `mandates`, `mandate_grant_usage`, `mandate_action_attempts`, `mandate_audit_events`, `authorization_decisions`, `mandate_tasks`, and `mandate_task_events`. Policy revisions and approval hashes are retained in the mandate JSON/columns; the decision ledger stores request digests and denial reason codes even for missing mandate IDs (so missing-policy denials can be audited without foreign-key failure). Provider result data is stored per idempotency key.

D1 `batch()` provides the atomic call/budget reservation and task revision update. Reservations consume budget before dispatch; uncertain external outcomes do not release budget or trigger automatic retries. This is deliberately conservative because a database transaction cannot atomically include an external transaction/provider side effect.

## Current limits and next backend tranche

- Implemented execution is **Monad native-MON transfer only**. GitHub, email, filesystem, arbitrary MCP servers, project-workflow verification, and offchain writes have no registered connector here.
- Workspace chat still does not execute tasks. The workspace UI now has a PKCE OAuth client for the persisted task API: it creates and reloads task records, displays versioned event history, performs CAS cancellation, refreshes tokens, and revokes its access and refresh tokens on disconnect. It does not yet create/approve/revoke generic D1 mandates.
- The UI mandate API binding is intentionally not presented as complete: D1 policy drafts bind `agentId` to the OAuth client that creates the policy. A workspace-specific OAuth client does not identify the external AI/MCP client that will execute the action. The application needs a deliberate authenticated agent-linking flow before displaying generic mandate creation as actionable; otherwise it would create valid but unusable grants.
- Next: add authenticated agent linking or a policy handoff flow that retains the exact invoking MCP client identity; link task IDs to action decisions; add a task execution planner that can call only registered capabilities; then implement connector-specific UI/approval and read-only GitHub registration before any writes.
- Do not advertise “any system” or “all user tasks” as working until an explicit adapter exists, its effects pass through the gateway, and its success is independently verified.

## Local verification

- `npm run test:d1-policy:local` runs actual Wrangler D1 locally and verifies signed approval, concurrent aggregate quota, key-reuse resistance, per-action audit, and task revision/owner isolation.
- `node --env-file=.env.local scripts/test-remote-pages-mcp.mjs` runs local Pages Functions + D1 + OAuth PKCE and verifies REST policy approval/revocation bound to the OAuth client, task/event persistence, OAuth MCP discovery, missing-policy denial before chain RPC, and adapter rejection when a valid D1 policy points to an onchain mandate owned by another wallet.
- `npx wrangler pages functions build --outdir /tmp/mandate-pages-functions-build --compatibility-date 2026-10-04` checks Pages Function bundling.
