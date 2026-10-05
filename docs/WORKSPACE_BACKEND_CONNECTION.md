# Workspace to Backend Connection

## What is connected

The Workspace can use Mandate's authenticated Pages API to persist user task records. It does **not** call an AI agent or execute arbitrary tasks. The task `received` state and versioned events are a durable intake/audit record only.

## Sign-in and request sequence

1. Connect a Mandate passkey or EVM wallet in the Workspace. This establishes the owner address used to compare identities; it does not hand the browser an OAuth token.
2. Choose **Connect backend**. The console registers a same-origin public OAuth client and stores a random PKCE verifier and state in `sessionStorage`.
3. The browser navigates to `/oauth/authorize`, which displays the normal Mandate consent and passkey/wallet signing page for `mandate:policy` and refresh access.
4. The authorization server redirects to the console with a one-time code and state. The SPA checks state and origin, exchanges the code with the PKCE verifier, then calls `GET /api/session`.
5. The console checks that the verified API principal equals the owner address that began sign-in and that the registered client ID and `mandate:policy` scope match. Only then does it retain access and refresh tokens in tab-scoped `sessionStorage`.
6. **Send** creates a task through `POST /api/tasks`, reads it through `GET /api/tasks/{id}`, and shows its server-returned ID, state, revision, and event history. Authenticated `GET /api/tasks?limit=20&cursor=…` lists owner-scoped history with stable keyset pagination; the latest task ID remains a convenience for restoring the selected record after refresh.
7. **Refresh task** reloads server state. **Cancel record** requests a compare-and-swap transition using the last observed version. A conflict or API error remains visible; the UI does not silently claim success.
8. **Revoke connection** calls OAuth token revocation for access and refresh tokens before removing the local session. Sign-in is required again to resume.

## User-visible behavior

- Without backend sign-in, chat remains a local draft and tells the user it was not persisted.
- With backend sign-in, chat text is saved to the task API. The UI explicitly says that no agent or connector executed it.
- The available consequential action remains a separate onchain MON transfer capability. Onchain permission creation, funding, and revocation are wallet transactions and are distinct from task record state.
- Task records are owner-isolated by the OAuth principal. The API never accepts a principal from the browser as authority.
- Task history is fetched from D1 on connection, selected tasks are fetched from the detail endpoint, and additional records are loaded by opaque server cursors. The endpoint clamps page size and rejects malformed cursors.

## Current integration gaps

- The generic D1 mandate create/approve/revoke endpoints are not yet in the Workspace interface. A draft binds its agent ID to the OAuth client that created it; the console's OAuth client is not the external AI client's OAuth identity. Creating a policy from the Workspace today could therefore produce a grant unusable by the connected AI client. The product needs an authenticated agent-linking/handoff design before exposing this as a working flow.
- Task history now has an owner-scoped list API and UI with cursor pagination. Full-text search is not implemented; history pages are ordered by immutable creation time and ID.
- No task planner, general MCP proxy, GitHub/email/filesystem adapter, or offchain verification exists. The UI must not transition a task into execution/success based on a client-supplied assertion.
- Generic D1 mandate management is not exposed in the Workspace. The correct caller is the external AI/MCP OAuth client whose verified `clientId` becomes `agentId`; an owner-consented cross-client linking/handoff protocol is not implemented. The console must not create a mandate against its own OAuth client and label it usable by another agent.
- Browser sign-in/API behavior has been tested at the client-module and local Pages integration layers. Live hosted deployment still needs the `0004_generic_authorization.sql` migration applied and a browser OAuth sign-in verified against the deployed Pages domain.

## Security review notes

- **PKCE and CSRF:** The public OAuth client uses S256 PKCE, high-entropy verifier/state, tab-scoped flow state, exact callback origin/state checks, and a one-time code exchange. Invalid response state never reaches the token endpoint.
- **Identity and access control:** The console validates token identity through `GET /api/session` and matches the verified principal, registered client ID, and `mandate:policy` scope against the initiated flow. The task API derives the owner from the access token; returned task and event owners are checked again by the client.
- **Token lifecycle:** Access and rotating refresh tokens stay in `sessionStorage`, not the URL or persistent local storage. Disconnect revokes both before clearing local state. Failed identity binding revokes the newly exchanged pair. Concurrent refresh attempts for the same rotating token share one in-flight request.
- **Rendering and input:** API JSON is checked for the task/event structure and identity. User-supplied task text and event labels render as React text, not HTML. Task IDs are URL-encoded; server routes validate methods, schemas, request-size limits, OAuth scope, and ownership. Task-list cursors are bounded, base64url-only, decoded with a strict schema, and combined with the verified principal in parameterized SQL; page size is limited to 100.
- **Residual production control:** Browser-held bearer tokens are exposed to any successful same-origin script compromise; retain the strict CSP and avoid third-party scripts. Add Cloudflare edge rate limits/abuse monitoring for dynamic client registration, authorization attempts, and task creation before broad production use. No hosted deployment or rate-limit configuration was changed in this task.

## Validation

- `npx vitest run apps/console/src/workspace-api.test.ts` covers PKCE state validation, token exchange, server identity verification, task create/read/cancel, errors, refresh rotation, and token revocation.
- `npm run test:d1-policy:local` covers real local Wrangler D1 owner isolation and stable pagination where multiple tasks share the same timestamp.
- `node --env-file=.env.local scripts/test-remote-pages-mcp.mjs` covers local Pages/D1 OAuth session endpoint, task-list pagination and invalid limits/cursors, policy/task persistence, and MCP enforcement.
- `npm run build --workspace @mandate/console` runs release verification, strict TypeScript, tests, contracts, dependency audit, then bundles the frontend.

### Security review of task-history API

**Security-sensitive:** yes (OAuth-protected API and D1 query). **OWASP checks:** A01 access control—owner always derived from verified OAuth identity and included in list SQL; A02 sensitive data—no tokens or secrets in task page responses; A03 injection—cursor values use schema validation and parameterized SQL; A04 design—keyset cursor uses immutable creation ordering and stable ID tie-break; A05 configuration—no permissive CORS change; A06 components—`npm audit --omit=dev` passed; A07 authentication—existing token/scope checks remain mandatory; A08 integrity—cursor cannot alter task ownership and transition CAS remains unchanged; A09 logging—no cursor/token is logged; A10 SSRF—no server-side URL fetch added. Rate limiting and hosted migration/application remain operational requirements, not locally verified controls.
