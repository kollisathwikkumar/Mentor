# Mandate Track 04 and MCP connectivity review

**Review date:** 5 October 2026  
**Repository:** `kollisathwikkumar/Mandate`  
**Hosted endpoint under test:** `https://mandate-console.pages.dev/` and `/mcp`

## Track fit

The live Metropolis portal showed the project under **Trust, Identity & AI Infrastructure** as the primary Track 04 target. Track 04 asks for a reusable primitive that other apps can build on. Its judging rubric weights technology 20%, developer experience 20%, originality/track insight 15%, founder/market 25%, and traction/path 20%. The Mera UX bounty expects Mera to be the full account layer. Current portal submission is incomplete: project identity/one-liner are filled, but no primary track is selected and project details, logo, live product, and demo/pitch videos remain outstanding. No market interviews or traction are asserted here.

Mandate's defensible Track 04 story is a portable, identity-bound authorization primitive: a passkey-derived EVM identity or an existing EVM account owns policies; MCP OAuth binds the caller to that identity; scoped tools expose read-only status, a review-only proposal, or a bounded transfer; Monad independently enforces the supported transfer limits. This is broader than payments as a trust/DX primitive, but current onchain enforcement itself is specifically native MON.

### What the current project solves

AI clients otherwise need broad credentials or manual approval for every operation. Mandate lets an owner establish a bounded policy and selectively grant the corresponding MCP capability. Its enforceable guarantees are limited to the implemented tools and fixed-recipient Monad Testnet contract. The front-page natural-language conversation is a local draft; it does not run an agent or turn arbitrary tasks into permissions.

## Implemented changes in this revision

1. **Passkey-first account path.** Added Mera/WebAuthn PRF creation and unlock using the hosted site's RP ID, BIP-44 EVM address derivation, short-lived Mera/viem signing sessions, and passkey use for app contract transactions. Existing EVM wallets stay available for old Mandate principals and authenticators without PRF.
2. **OAuth sign-in without a copied secret.** Consent now offers create/unlock passkey buttons plus an existing-wallet fallback. A new passkey is clearly described as a new Mandate account; existing policy owners are told to choose the account that created the policy. This prevents presenting a different passkey account as if it owned an old wallet's mandates.
3. **Least-privilege OAuth consent.** Consent lists only scopes requested by the client; read is selected by default, proposal and transfer are opt-in. The backend validates submitted scopes against the original request before issuing a code and preserves the requested refresh scope. At least one tool capability is required.
4. **Clearer product positioning.** The MCP URL is the only connection value users copy. Site and README text explains account identity, device passkey verification, non-transaction sign-in, scope controls, and authenticators with WebAuthn PRF. Track 04 notes now distinguish shipped/tested capability from unvalidated roadmap.

## Security and compatibility review

- OAuth still uses PKCE, one-time short-lived nonce-bound EIP-191 signatures, origin/audience checks, hashed tokens, and scope validation. The consent page serves a same-origin compiled module under `script-src 'self'`; no inline executable script was added.
- The browser stores only the public WebAuthn credential identifier/transports. The PRF output and derived EVM key are used in memory and zeroed/end-called where the library/API permits. App signing sessions automatically end after 15 minutes or when the user locks/disconnects. Mera describes these as **software signing keys**, not hardware-backed keys; page scripts on the relying-party domain can access live derived bytes. Keep this prototype on Testnet and protect the hosted supply chain. A domain/RP-ID migration requires a documented account recovery/export plan.
- WebAuthn PRF support varies by authenticator. Mera's official compatibility page distinguishes verified providers from unsupported combinations; desktop Chrome's local-profile passkey authenticator is specifically unsupported, while supported password-manager/passkey providers vary. Errors now give a clear fallback rather than an opaque `PRF_UNAVAILABLE` message. Do not claim every device supports passkeys.
- Transfer remains a consequential onchain action; users must opt into the transfer scope and approve the client action. Status is read-only; proposals are review-only and do not execute or mutate policies.

## Verification record

Local release/integration checks are recorded below. Hosted/Claude/Kimi results are appended after deployment. A green source test alone does not prove production behavior.

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

**Security review status:** Issues documented; no CRITICAL/HIGH findings observed. Medium deployment/product follow-up: configure auth rate limiting and establish a supported account-recovery/domain-migration plan before mainnet or broad release.

### Automated release and integration checks

| Check | Result |
|---|---|
| `npm run test:remote-mcp:local` release gate | PASS (exit 0) |
| Secret scan | PASS — no credential values detected in scanned project files |
| Strict TypeScript | PASS — all referenced packages and console |
| Unit tests | PASS — 17 files, 92 tests; 99.34% statements, 98.56% branches, 100% lines/functions |
| Foundry tests | PASS — 15/15 Monad Vault tests |
| D1 / MCP / OAuth integration | PASS — local D1 migration, unauthenticated denial, origin/CORS policy, bearer Streamable HTTP handshake, OAuth PKCE, same-origin consent asset, selected-scope grant, refresh rotation/replay denial, read/proposal/chain tool discovery, Monad status read, revoked-mandate denial |
| Dependency audit | PASS — `npm audit --omit=dev`: 0 vulnerabilities |
| Vite production build | PASS — emitted `/assets/oauth-approve.js` and app bundle |
| Live Scrapling page check | Pending deploy |
| Claude remote MCP client | Not yet re-tested against this build |
| Kimi remote MCP client | Not yet re-tested against this build |

## Remaining work before submission

- Select Track 04 in the portal and complete the description, logo, live URL, and demo/pitch clips; do not imply these were completed by this source change.
- Demonstrate passkey creation with a PRF-capable authenticator, prove same-account policy reads, show a read-only query and review-only proposal in an actual model client, then demonstrate an opt-in bounded transfer and a denied out-of-bounds request using testnet funds.
- Re-test Claude and Kimi in their actual supported client surfaces with user-controlled passkey/account approval. No passkey ceremony or transfer is counted as completed by a mock signature.
- Interview agent developers/users and obtain evidence for market/traction rubric items; refine the product claim from those findings.
- Validate Mera bounty eligibility against the live bounty brief before claiming the “entire account layer” requirement; this app retains an EVM wallet compatibility route.
