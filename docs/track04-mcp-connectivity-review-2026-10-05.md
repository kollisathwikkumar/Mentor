# Mandate Track 04 and MCP connectivity review

**Review date:** 5 October 2026  
**Repository:** `kollisathwikkumar/Mandate`  
**Hosted endpoint under test:** `https://mandate-console.pages.dev/` and `/mcp`

## Track fit

The live Metropolis portal showed the project under **Trust, Identity & AI Infrastructure** as the primary Track 04 target. Track 04 asks for a reusable primitive that other apps can build on. Its judging rubric weights technology 20%, developer experience 20%, originality/track insight 15%, founder/market 25%, and traction/path 20%. The Mera UX bounty expects Mera to be the full account layer. Current portal submission is incomplete: project identity/one-liner are filled, but no primary track is selected and project details, logo, live product, and demo/pitch videos remain outstanding. No market interviews or traction are asserted here.

Mandate's defensible Track 04 story is a portable, identity-bound authorization primitive: a passkey-derived EVM identity or an existing EVM account owns policies; MCP OAuth binds the caller to that identity; scoped tools expose read-only mandate status, a separately opt-in public native-MON balance, a review-only proposal, or a bounded transfer; Monad independently enforces the supported transfer limits. This is broader than payments as a trust/DX primitive, but current onchain enforcement itself is specifically native MON.

### What the current project solves

AI clients otherwise need broad credentials or manual approval for every operation. Mandate lets an owner establish a bounded policy and selectively grant the corresponding MCP capability. Its enforceable guarantees are limited to the implemented tools and fixed-recipient Monad Testnet contract. The front-page natural-language conversation is a local draft; it does not run an agent or turn arbitrary tasks into permissions.

## Implemented changes in this revision

1. **Passkey-first account path.** Added Mera/WebAuthn PRF creation and unlock using the hosted site's RP ID, BIP-44 EVM address derivation, short-lived Mera/viem signing sessions, and passkey use for app contract transactions. Existing EVM wallets stay available for old Mandate principals and authenticators without PRF.
2. **OAuth sign-in without a copied secret.** Consent now offers create/unlock passkey buttons plus an existing-wallet fallback. A new passkey is clearly described as a new Mandate account; existing policy owners are told to choose the account that created the policy. This prevents presenting a different passkey account as if it owned an old wallet's mandates.
3. **Least-privilege OAuth consent.** Consent lists only scopes requested by the client; mandate status is checked when requested, and balance/proposal/transfer require explicit opt-in. The backend validates submitted scopes against the original request before issuing a code and preserves the requested refresh scope. At least one tool capability is required.
4. **Clearer product positioning.** The MCP URL is the only connection value users copy. Site and README text explains account identity, device passkey verification, non-transaction sign-in, scope controls, and authenticators with WebAuthn PRF. Track 04 notes now distinguish shipped/tested capability from unvalidated roadmap.

## OAuth consent-button incident — 5 October 2026

The user-reported “buttons do nothing” failure was reproduced in the live Claude authorization flow. After a click, the consent page displayed “Select at least one capability” even though `mandate:read` was visibly selected. The checked permission inputs had been rendered outside `#wallet-approval`, while every sign-in handler searched for selected permissions inside that form. Therefore all three buttons returned before opening the passkey or wallet flow. The fix moves the scope controls into the form and adds a regression assertion that the preselected read scope is a descendant of that form. This fixes the silent early exit; it does not complete identity proof or create a user account by itself.

The fix was pushed to GitHub `main` in `09eefab`. The first Git-connected Pages deployment (`4a7c0d70`) still served the old function bundle: the scope list remained outside the form, and clicking the passkey button reproduced the failure. A direct deployment of the verified build then corrected the live form; Cloudflare's latest active production deployment is `438a5452` from `191f493`. Scrapling fetched the canonical live consent page with HTTP 200 and verified `form_start=1074 < checked_read=1340 < form_end=2792`. The user's reloaded Chrome page placed the permission list inside the form; clicking “Continue with my passkey” advanced to Chrome's saved-passkey chooser, offering “Use a phone or tablet” or “USB security key” rather than the old scope error. No identity assertion or OAuth grant was performed, so a signed-in Claude MCP tool call remains unverified and requires the account holder's passkey/wallet action.

For Kimi, the official Kimi Code CLI was absent, so the published `@moonshot-ai/kimi-code` package (2.1.1) was installed and `kimi doctor` reported valid defaults. Scrapling-verified official Kimi Code documentation says remote HTTP MCP is configured in `~/.kimi-code/mcp.json` and OAuth is completed with `/mcp-config login <server-name>`. The Kimi CLI is not yet signed in and Mandate has not yet been added to its MCP configuration; no Kimi connection is claimed. Configuration and OAuth authorization are the next steps.

## Security and compatibility review

- OAuth still uses PKCE, one-time short-lived nonce-bound EIP-191 signatures, origin/audience checks, hashed tokens, and scope validation. The consent page serves a same-origin compiled module under `script-src 'self'`; no inline executable script was added.
- The browser stores only the public WebAuthn credential identifier/transports. The PRF output and derived EVM key are used in memory and zeroed/end-called where the library/API permits. App signing sessions automatically end after 15 minutes or when the user locks/disconnects. Mera describes these as **software signing keys**, not hardware-backed keys; page scripts on the relying-party domain can access live derived bytes. Keep this prototype on Testnet and protect the hosted supply chain. A domain/RP-ID migration requires a documented account recovery/export plan.
- WebAuthn PRF support varies by authenticator. Mera's official compatibility page distinguishes verified providers from unsupported combinations; desktop Chrome's local-profile passkey authenticator is specifically unsupported, while supported password-manager/passkey providers vary. Errors now give a clear fallback rather than an opaque `PRF_UNAVAILABLE` message. Do not claim every device supports passkeys.
- Transfer remains a consequential onchain action; users must opt into the transfer scope and approve the client action. Status and balance are read-only; the balance tool has no address argument and uses only the OAuth-bound principal. Proposals are review-only and do not execute or mutate policies.

## Verification record

The local release gate and the live production checks below are separate evidence. A green source test alone does not prove production behavior.

### Security review

**Security-sensitive:** yes. **OWASP categories checked:** 10/10. **Initial status:** issues documented; no critical/high finding in the reviewed changes.

| Category | Review result |
|---|---|
| Access control | Pass: owner principal is signature-bound; submitted tools scopes are constrained to the client request; transfer remains a separate opt-in scope. |
| Cryptographic failures | Note: passkey-derived key is software/browser-memory based, not hardware-backed; mitigations are memory zeroing/session end/15-minute expiry, but they do not guarantee removal from a JS runtime. Testnet only. |
| Injection | Pass: OAuth pages escape dynamic HTML fields; D1 statements remain parameterized. |
| Insecure design | Note: passkey and legacy wallet produce distinct principals; consent explicitly explains this and has a wallet fallback. RP-ID migration and credential-loss recovery remain open product risks. |
| Security misconfiguration | Pass: the consent form's external script is same-origin under CSP; frame ancestors denied. |
| Vulnerable components | Pass: `npm audit --omit=dev` returned zero known production vulnerabilities in the release gate. |
| Authentication | Pass: existing PKCE, nonce-bound message signature, short authorization lifetime, and session lock/expiry remain enforced. Rate limiting remains a deployment hardening item. |
| Data integrity | Pass: authorization codes remain one-time, and requests with unrequested scopes are rejected. |
| Logging/monitoring | Note: existing activity capture is aggregate; authentication failures are not individually audited to avoid adding sensitive logs. Configure host-level abuse/rate monitoring. |
| SSRF / outbound server requests | N/A for the new browser identity path; MCP resource validation remains exact-resource-bound. |

The follow-on `mandate:balance` capability is separately consented and tool-isolated. It adds no caller-controlled address, does not require an agent signer key, and cannot submit a transaction. Balance is public chain state, but exposing it still requires explicit user consent because it associates an account with an MCP client session.

**Security review status:** Issues documented; no CRITICAL/HIGH findings observed. Medium deployment/product follow-up: configure auth rate limiting and establish a supported account-recovery/domain-migration plan before mainnet or broad release.

### Automated release and integration checks

| Check | Result |
|---|---|
| `npm run test:remote-mcp:local` release gate | PASS (exit 0) |
| Secret scan | PASS — no credential values detected in scanned project files |
| Strict TypeScript | PASS — all referenced packages and console |
| Unit tests (5 Oct follow-up) | PASS — 19 files, 101 tests; 99.35% statements, 98.57% branches, 100% lines/functions |
| Foundry tests | PASS — 15/15 Monad Vault tests |
| D1 / MCP / OAuth integration | PASS — local D1 migration, unauthenticated denial, origin/CORS policy, bearer Streamable HTTP handshake, OAuth PKCE, same-origin consent asset, read-selected / balance-unselected consent, excess-scope rejection, refresh rotation/replay denial, read/proposal/chain tool discovery, Monad status read, revoked-mandate denial |
| Dependency audit | PASS — `npm audit --omit=dev`: 0 vulnerabilities |
| Vite production build | PASS — emitted `/assets/oauth-approve.js` and content-hashed app/identity chunks |
| Live hosted app (Scrapling) | PASS — `https://mandate-console.pages.dev/#/workspace` returned HTTP 200 and displayed the passkey-first onboarding, existing-wallet option, and updated MCP explanation after the direct Pages deploy. |
| Live consent bundle (Scrapling) | PASS — `/assets/oauth-approve.js` returned HTTP 200 from the canonical host and loaded its same-origin, content-hashed passkey helper. |
| Live status endpoint (Scrapling) | PASS — `/mcp/status` returned HTTP 200 with `ready: true`; `connected: false` correctly represented that no authorization was active in the test browser. |
| Live unauthenticated MCP request | PASS — `POST /mcp` initialize without a bearer token returned HTTP 401, `A valid bearer token is required.` |
| Claude client | PARTIAL — the signed-in Claude web connector launched Mandate's canonical-host OAuth authorization flow. The hosted page showed `mandate:read` selected and `mandate:propose` / `mandate:transfer` unselected. No authorization was granted and no token/tool handshake was completed: the account holder must choose an identity and approve the scopes. |
| Kimi browser client | NOT TESTED — Kimi's web chat was signed out and did not expose MCP connector settings in that session. |
| Kimi Code compatibility research | VERIFIED from official Kimi documentation via Scrapling — current Kimi Code supports remote HTTP MCP and OAuth; its TUI offers `/mcp-config`, `/mcp`, and `/mcp-config login <server-name>`. The older Kimi CLI docs warn it is archived. An actual Kimi Code installation/account was not present, so a real Mandate authorization/tool call was not completed. |

### 5 October follow-on: owner-bound balance and recoverable record lookup

The follow-on implementation adds `mandate:balance`, a consent-off-by-default, read-only scope that registers only `get_my_monad_balance`. The server derives its sole address from the signed OAuth principal; the tool accepts no address argument, does not load a transfer signer, and makes no transaction. The frontend saves new mandate IDs locally, verifies every imported ID's current onchain principal before display, provides Copy ID/import for cross-device recovery, and limits automatic event discovery to 100 recent blocks.

The 100-block constraint is from a live call to the configured Monad RPC: `eth_getLogs is limited to a 100 range`. Full historical event discovery is not solved without a maintained indexer/API; the application now handles the public endpoint's limit transparently and lets owners load a known ID instead of presenting a failed search as a chain outage.

Source checks run on this follow-on working tree:

| Command | Result |
|---|---|
| `npm run test:remote-mcp:local` | PASS — release prebuild, 19 test files / 101 tests, 15 Solidity tests, secret scan, type checks, local D1/MCP/OAuth scope checks, dependency audit, production build, and Pages Function MCP handshake all passed; exit 0. |
| `npm run test:browser -- http://127.0.0.1:5173/#/workspace` | PASS — Scrapling 0.4.15 with `--ai-targeted` fetched the workspace and checked record import, MCP explanation, title, and primary form; exit 0. |

The revision was pushed to `main` as `18ecf9f` and deployed to Cloudflare Pages (`https://44d19696.mandate-console.pages.dev`; Git-connected production build `6c3de317`). Follow-up hosted checks on the canonical URL:

| Check | Result |
|---|---|
| Production OAuth authorization | PASS — dynamic client registration, balance-only consent page, signed test identity, nonce validation, redirect/state, and PKCE exchange succeeded. |
| Production Streamable HTTP MCP | PASS — balance-only token discovered exactly `get_my_monad_balance`; the tool returned the matching test principal and a valid MON balance from live Monad RPC. No transfer or transaction was requested. The test revoked its access and refresh tokens; named DCR test-client rows are retained by the script. |
| Unauthenticated hosted MCP | PASS — `POST /mcp` initialize returned HTTP 401 with `A valid bearer token is required.` |
| Hosted UI via Scrapling | PASS — canonical `/#/workspace` returned HTTP 200 with the permission-ID import and MCP guidance; `/mcp/status` returned HTTP 200 with `ready: true`. Recent test traffic made `connected: true` during the five-minute activity window. |
| Visible Chrome page | PASS — the hosted workspace rendered passkey-first account actions and permission-ID import. No user passkey ceremony or onchain signature was performed. |

The successful hosted MCP test used a deterministic disposable test identity. It proves the hosted OAuth/MCP/RPC implementation path, not a signed-in Claude or Kimi client integration. Those client-specific tests remain partial/pending, and the testnet's 100-block event-history cap still prevents automatic full-history discovery.

### Deployment notes and client limitations

- The first Cloudflare Pages build after the source changes failed because the clean CI environment lacked the previously implicit Node type declarations (`process` and `node:crypto` errors). Adding the declared `@types/node` dev dependency fixed the clean build; the failing log was not treated as a passing deployment.
- The first production scrape still returned the old app bundle. The app entry was then changed to content-hashed filenames, followed by a direct Pages upload of the verified build. After the verification record was pushed, Cloudflare Pages also completed the latest Git-connected production build successfully: deployment `beba78da` from `0847b25` is **Active** at `https://beba78da.mandate-console.pages.dev`. The canonical hostname was re-scraped and returned the new UI/assets. An earlier successful deployment was `https://e24ec79f.mandate-console.pages.dev`; canonical production checks were against `https://mandate-console.pages.dev`.
- Claude demonstrated successful client-to-hosted-OAuth launch, but final consent is intentionally not counted as a successful connection. A passkey enrollment would create a new Mandate identity; it will not reveal an existing wallet's policies. To read an existing mandate, the owner needs the original EVM identity that created it. Only read was preselected; no write/transfer access was approved in this test.
- Kimi's [current Kimi Code documentation](https://www.kimi.ai/resources/kimi-code-introduction) says HTTP MCP is supported and documents `/mcp-config` and `/mcp`. The older [Kimi CLI MCP documentation](https://moonshotai.github.io/kimi-cli/en/customization/mcp.html) documents OAuth via `kimi mcp auth <name>` but warns that the CLI is archived; use current Kimi Code guidance for a new setup. A browser-only Kimi chat page is not the same product surface. This is documented guidance, not a live Kimi success claim.

## Remaining work before submission

- Select Track 04 in the portal and complete the description, logo, live URL, and demo/pitch clips; do not imply these were completed by this source change.
- Demonstrate passkey creation with a PRF-capable authenticator, prove same-account policy reads, show a read-only query and review-only proposal in an actual model client, then demonstrate an opt-in bounded transfer and a denied out-of-bounds request using testnet funds.
- Complete Claude authorization and a real read tool call after the account holder chooses the intended identity and approves read-only consent. Install/sign into Kimi Code, then complete its OAuth flow and run `/mcp` plus a read tool call. No passkey ceremony or transfer is counted as completed by a mock signature.
- Interview agent developers/users and obtain evidence for market/traction rubric items; refine the product claim from those findings.
- Validate Mera bounty eligibility against the live bounty brief before claiming the “entire account layer” requirement; this app retains an EVM wallet compatibility route.
