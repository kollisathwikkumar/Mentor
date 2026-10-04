# Mandate — Track 04 Ideation and Problem Research

**Status (5 October 2026):** Track-fit hypothesis with an implemented testnet authorization primitive and hosted MCP/OAuth prototype. User demand remains unvalidated; see the honest shipped-vs-roadmap map below.
**Research checked:** 4 October 2026  
**Track:** Metropolis Track 04 — Trust, Identity & AI Infrastructure

## 1. Track fit and research method

The supplied [Monad Metropolis official page](https://monad.xyz/developers/hackathons/metropolis) was fetched with Scrapling (`extract get --ai-targeted`) and returned HTTP 200. It identifies Track 04 as Trust, Identity & AI Infrastructure, focused on problems around identity, provenance, data ownership, and agent trust. It highlights Monad's P256 precompile, WebAuthn/passkey accounts, and the ERC-8004 agent registry as relevant directions. Track 04 favors protocol and infrastructure work, so Mandate should be a reusable authorization primitive with a working integration—not only a dashboard.

Primary-source research used Scrapling 0.4.14+ for Monad, OWASP, NIST, and C2PA resources. The Metropolis portal requires sign-in, so public track information was checked against Monad's official page. Scrapling fetch status details are recorded in §11.

### Track 04 mapping: what Mandate solves now

Track 04 is **Trust, Identity & AI Infrastructure**. The portal describes a reusable protocol primitive for trust, provenance, user-owned data, and AI—not just a standalone consumer app. Mandate's credible, demoable problem is narrower and concrete: an AI client otherwise receives broad authority, while a user cannot verify that the next supported action stays within their chosen boundary.

| Track question | Mandate's current answer | Evidence / limit |
|---|---|---|
| Who is the user? | A passkey-derived EVM account (Mera/WebAuthn PRF) or an existing EVM wallet; OAuth binds the MCP principal to that address. | The authenticator's PRF support is required for passkeys; wallet compatibility remains a fallback. |
| What is the trust primitive? | A Monad Testnet `MandateVault` policy bound to a principal, agent signer, one recipient, native MON per-call/total limits, expiry, nonce, and revocation. | It is a narrow financial policy, not arbitrary tool/API authorization. |
| How do AI clients reach it? | One vendor-neutral remote Streamable HTTP MCP endpoint with OAuth 2.1 + PKCE, dynamic registration, per-tool scopes, and the same identity flow. | Works only in MCP clients implementing the relevant remote transport and OAuth flow. |
| Is it more than transfers? | `mandate:read` inspects status for a supplied mandate ID; optional `mandate:balance` reads the authenticated account's public native MON balance; `mandate:propose` produces a review-only proposal; `mandate:transfer` requests a bounded action. Every scope is separately gated, and balance is not selected by default. | The status tool rechecks the authenticated principal against the mandate owner. The balance tool accepts no address input and reads only the OAuth-bound principal. Proposals do not execute tasks or create/update policies. The front-page conversation is a local draft, not an AI agent runtime. |
| How are older policies found? | New IDs are saved in this browser; owners can copy/import an ID on another device. The UI only auto-searches recent events. | Monad's configured public RPC rejects `eth_getLogs` ranges larger than 100 blocks. There is no indexed event service configured, so historical discovery is not claimed as complete. |
| What should not be claimed? | Universal agent execution, general-purpose API permissions, production-ready custody, a live Mera bounty integration, user traction, or finished third-party integrations. | These are roadmap/validation work, not currently shipped proof. |

**Hackathon thesis:** Mandate is a reusable identity-bound authorization layer for AI tools. A passkey makes the user account approachable; scoped MCP capabilities make delegation portable across model vendors; an independently checked onchain policy makes the supported transfer boundary enforceable. The best demo should show the read-only and review-only paths before an explicitly opted-in transfer, including a denial when the request exceeds the rule.

## 2. Problem and user need

People and teams delegate real work to AI agents, but the simplest integration often hands an agent a broad wallet, API key, or tool. A mistaken, manipulated, or out-of-scope model action may then have more authority than the user intended. Manual confirmation of every action can make an agent useless; activity logs can explain an action after it has happened but do not prevent it.

**User need:** “Let this agent complete this task, only within the authority I approve, and show me what it did or why it was blocked.”

OWASP's LLM06:2025 describes harm from excessive agent functionality, permissions, and autonomy, and recommends least privilege, user-context authorization, downstream enforcement, approvals for consequential actions, and monitoring. NIST's NCCoE is actively exploring standards-based agent identity and authorization. These sources support the problem area; they do not prove market demand for Mandate. Validate that demand with agent builders and users.

### Under-served gap (hypothesis)

Agent identity or reputation can identify an agent, but does not by itself limit its next action. The opportunity is to turn a user's task intent into **narrow authority that is reviewed by the user and checked at execution time**. Mandate combines a natural-language policy proposal with deterministic enforcement and an independent onchain guard for supported value-moving actions.

This is a hypothesis, not a claim that no competing permission products exist. Interview agent developers and potential users before making market-size or uniqueness claims.

## 3. Product definition

**Long-term Mandate** is a security and authorization layer for autonomous AI agents. The **current prototype** implements the narrower path: a user defines fixed fields in the console, authorizes a bounded native-MON policy on Monad Testnet, and exposes owner-scoped status/balance reads, review-only proposal, and bounded transfer MCP tools through OAuth. It does not parse the local chat draft into a policy or execute arbitrary work. A deterministic gateway and the Monad contract independently enforce the supported transfer path.

**Core principle:** the model proposes; the user authorizes; deterministic software and the contract enforce.

The agent can choose how to complete a task only within the tools and limits in its Mandate. It cannot grant itself permission, widen the scope, replace a recipient, change a budget, extend expiry, or bypass the supported gateway/contract path.

### Example: natural language to Mandate

User: “Let my payment agent send Alice up to 10 MON before 8 PM.”

Mandate must not silently interpret this. The input is missing or ambiguous about:

- Which registered agent is authorized?
- Which wallet address is Alice?
- Is 10 MON the per-transfer maximum, total budget, or both?
- Which date and timezone does 8 PM refer to?
- Do transaction fees count toward the limit?

Mandate asks targeted questions. Once answered, it may propose:

```json
{
  "agent": "0x…A1",
  "action": "transfer_native_mon",
  "chain": "Monad Testnet",
  "asset": "MON",
  "recipient": "0x…B2",
  "maxPerTransfer": "4 MON",
  "maxTotal": "10 MON",
  "expiresAt": "2026-10-04T20:00:00+05:30"
}
```

The application validates and normalizes the candidate, then displays this exact policy for review. The user can edit, reject, or confirm it in their wallet. The user-signed transaction creates the Mandate. Raw prompt text and personal details stay offchain; the contract stores only enforceable normalized fields and, optionally, a commitment to the reviewed policy.

A 3 MON transfer to the approved Alice address before expiry can succeed. A 5 MON transfer (if the per-transfer limit is 4), a transfer to another address, a replayed intent, or a transfer after expiry/revocation must fail. The model's confidence score is never treated as permission.

## 4. Why Mandate is the selected concept

Scores below are working judgments (1–5), not external market data. The criteria are user harm, differentiation, hackathon buildability, demo clarity, and Track 04 fit.

| Candidate | Harm | Differentiation | Buildability | Demo | Track fit | Total |
|---|---:|---:|---:|---:|---:|---:|
| **Mandate: natural-language intent to enforceable agent authorization** | 5 | 5 | 4 | 5 | 5 | **24/25** |
| Provenance that survives image/video transformations | 4 | 4 | 2 | 4 | 5 | 19/25 |
| Passkey-first agent account and recovery flow | 4 | 3 | 4 | 4 | 4 | 19/25 |

Mandate combines an understandable user problem with infrastructure judges can inspect: a typed, user-approved policy; deterministic rejection; Monad contract enforcement; and a real allow/deny/revoke flow. Its scope remains buildable only if the first release protects one onchain action rather than claiming universal API/wallet/tool protection.

## 5. Product and authorization lifecycle

1. **Describe:** user enters a task in ordinary language.
2. **Propose:** hosted model API returns a typed candidate policy and identifies unresolved fields. Its output is untrusted.
3. **Clarify:** if agent, target, action, amount semantics, currency/unit, date/timezone, or required limits are unclear, ask the user; do not guess or enable signing.
4. **Validate:** deterministic schema and semantic rules validate supported actions, addresses, amounts, time boundaries, cap relationships, and policy version. The natural-language model is not the validator of record.
5. **Preview:** show the exact agent identity, action/tool, target, chain/asset, per-action and total limits, expiry, call limit, and material assumptions. The user can edit or reject it.
6. **Authorize:** the principal explicitly confirms through their wallet. The signed transaction creates the Mandate with only normalized fields and an optional policy hash; no raw prompt is stored onchain.
7. **Act:** agent uses narrow MCP tools. The gateway checks every supported request against the current mandate. For a supported onchain transfer, the Monad contract repeats the decisive checks atomically before moving funds.
8. **Explain and revoke:** show successful transaction receipts and local denial reasons. The user may revoke; subsequent execution fails onchain.

Prompt injection and model error are not claimed to be solved. The demonstrable guarantee is narrower: an action routed through the supported path cannot exceed the enforceable policy, even if the model proposes it.

## 6. Architecture and Monad's role

- **Natural-language intent compiler:** provider-neutral model adapter proposes typed fields and asks follow-up questions. It never signs or creates authority.
- **Deterministic policy package:** owns schema versions, canonicalization, allowed action types, semantic checks, stable allow/deny reasons, and ambiguity requirements.
- **User confirmation UI:** displays the canonical preview and asks the wallet to sign the exact Mandate creation transaction. No background or model-triggered approval.
- **MCP gateway:** exposes only narrow tools, such as `get_mandate_status` and `request_bounded_transfer`. It has no arbitrary shell, generic wallet, calldata, or URL-fetch tool.
- **Monad contract:** stores the enforceable onchain fields, revocation state, and escrow balance; atomically checks signer, approved recipient, per-call and total cap, expiry, nonce, and available deposit for native MON transfers.
- **Receipts:** successful executions emit compact onchain events. A reverted transaction does not persist logs; denials should be returned as local structured reasons rather than misrepresented as onchain denial receipts.
- **Hosted model API:** key is backend-only; use token/call/time/retry/spend limits. Minimize prompt data and review provider retention settings. Deterministic tests need no API calls.

Monad's role must be real: it holds the live mandate state and independently enforces the supported onchain transfer. Publishing a hash after an external service has already acted is not sufficient. Protecting external APIs such as airline bookings requires a later real connector whose credential and execution route are controlled by the gateway; that is outside the first vertical slice.

## 7. MVP and deliberate boundaries

### Must ship

- Natural-language request → typed proposed policy → clarification if needed → exact preview → user wallet confirmation.
- One principal and one registered agent signer.
- One action: native MON transfer to one approved recipient on Monad Testnet.
- Per-transfer limit, total budget, expiry, nonce/replay protection, and revocation.
- Funded MandateVault and independent contract enforcement.
- MCP server with authenticated mandate-status lookup, separately scoped authenticated-account balance read, review-only proposal, and separately scoped bounded-transfer tools.
- Deterministic test harness and a reproducible working allow/deny/revoke scenario.
- Clear setup, architecture, limitations, public repository, and demo evidence.

### Defer

- General-purpose permissioning for any wallet, tool, or API.
- Real flight booking, payment-provider integrations, arbitrary contract calls, or uncontrolled external API execution.
- Multi-chain support, agent marketplace/reputation, broad enterprise IAM, production key custody, and storing personal information onchain.
- P256/passkey signing or ERC-8004 dependency until the EOA/EIP-712 path is passing and tested; identity never replaces authorization.

## 8. Demo scenarios and acceptance evidence

1. **Ambiguous request:** enter the Alice/10 MON/8 PM request. Show Mandate asking for Alice's address, whether the cap is per-transfer or aggregate, and the date/timezone. No wallet action is offered yet.
2. **Policy approval:** fill the missing fields. Show the normalized preview and have the principal sign the exact mandate creation transaction.
3. **Allowed:** request a 3 MON transfer to Alice before expiry; show success, Monad transaction, and event.
4. **Over per-transfer cap:** request 5 MON when the cap is 4; show no transfer and the local denial reason.
5. **Wrong target:** request payment to another address; show rejection.
6. **Aggregate limit:** after spending the approved budget, request another transfer; show rejection and unchanged spent/balance state.
7. **Replay:** submit the same signed intent/nonce twice; show the second attempt fails.
8. **Expired/revoked:** test each condition independently and show that revocation blocks a request that was previously valid.
9. **Model manipulation:** ask the model to ignore its mandate. Show the generated request is still rejected by deterministic checks/contract.

Acceptance criteria: in-policy transfer succeeds; every listed negative case produces no value transfer; failed/reverted execution leaves no partial spend or nonce mutation; user can independently verify successful receipts; no prompt, API key, or personal task text is put onchain. The user can explain that the UI previews/controls the real gateway and contract rather than simulating them.

## 9. User validation plan

Interview 5–8 agent builders, small-team operators, security practitioners, or people who delegate actions to agents. Ask about the last time they gave an agent a credential, the action they would not delegate, how they revoke access, what evidence they need, and which confirmation steps are frustrating. Avoid pitching the solution before hearing their workflow.

**Evidence that strengthens the hypothesis:** people describe broad credentials, unclear task scope, cumbersome approvals, weak revocation, or inability to verify agent actions; at least two identify a workflow where the proposed policy fields would help; another developer attempts the SDK/MCP integration.

**Evidence that weakens it:** target users already have effective task-scoped permissions and revocation, or do not delegate consequential actions. In that case, narrow the product to a concrete integration or revisit the problem choice.

## 10. Main risks and mitigations

- **Model misinterprets intent:** present an exact policy preview; ask instead of guessing; require wallet confirmation; test ambiguous wording.
- **Overly broad defaults:** use no authority-expanding defaults. Missing or invalid required values block policy creation.
- **A dashboard-only result:** make the real gateway and Monad contract the product; prove real execution and denials.
- **Gateway bypass:** scope claims to controlled tools. For the onchain MVP, the contract is the final enforcement layer. Offchain API support requires exclusive credential control and downstream enforcement.
- **Stale state/races:** contract checks policy and budget atomically at execution; gateway reads fresh state and fails closed on unavailable/ambiguous RPC.
- **Privacy leakage:** no raw prompts, secrets, or private personal data onchain; minimize content sent to the hosted model provider.
- **Agent identity confused with trust:** identity answers “which agent?”; a mandate answers “what may it do?” Reputation never bypasses the policy.
- **Overbuilding:** one action, one chain, one recipient, one agent path, rigorous negative tests.

## 11. Research sources and Scrapling record

- [Monad Metropolis official page](https://monad.xyz/developers/hackathons/metropolis) — Scrapling `extract get --ai-targeted`, HTTP 200.
- [Monad hackathon portal](https://hackathon.monad.xyz/) — Scrapling browser fetch returned HTTP 200; application content is behind sign-in/registration.
- [OWASP LLM06: Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) — Scrapling `extract get --ai-targeted`, HTTP 200.
- [NIST NCCoE Agent Identity and Authorization](https://www.nccoe.nist.gov/projects/software-and-ai-agent-identity-and-authorization) — Scrapling stealthy browser fetch, HTTP 200.
- [NIST AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative) — Scrapling `extract get --ai-targeted`, HTTP 200.
- [C2PA Specifications](https://spec.c2pa.org/specifications/specifications/2.4/index.html) — Scrapling `extract get --ai-targeted`, HTTP 200. Media provenance remains a viable alternative area, but this concept is distinct and fits the selected enforcement vertical slice.
