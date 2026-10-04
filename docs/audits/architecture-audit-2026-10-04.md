# Architecture and invariant audit — 2026-10-04

## Components verified

The implementation follows the repository's proposed boundaries: Solidity + Foundry, TypeScript/Node + npm workspaces, viem, Zod, MCP stdio, NVIDIA-compatible adapter, and React/Vite static client. The local backend service is the MCP process; there is no unnecessary hosted API server or database.

- `MandateVault` is the source of truth. Recipient and authorized signer are not caller-supplied to transfer tools.
- `PolicyEngine` is pure TypeScript and exact decimal conversion never uses floating-point arithmetic.
- `IntentCompiler` returns a review-only proposal and asks for missing/invalid fields rather than creating authority.
- `AgentModelAdapter` has no signer or contract interface.
- MCP transfer handler reads current contract state, denies before signing on deterministic failures, signs EIP-712, submits the narrow contract call, and waits for a successful receipt.
- Console actions call the same contract through a browser wallet and show state read from contract storage/events.

## Invariants exercised

| Invariant | Test evidence |
|---|---|
| Fixed recipient only | Foundry rejects wrong recipient. |
| Per-call and cumulative caps | Foundry rejects each independently; TypeScript returns stable reasons. |
| Deposit requirement | Foundry rejects underfunded request. |
| Expiry | Foundry denies execution and funding at expiry. |
| Replay protection | Foundry rejects repeated nonce. |
| Revocation | Foundry and end-to-end test reject later requests. |
| State changes only on success | Receiver-revert test verifies spent/deposit/nonce roll back. |
| Agent key is not a tool argument | MCP schema lists only mandate ID + MON amount. |
| Chain read failure fails closed | Gateway test proves executor not invoked on read failure. |
| Exact decimal unit conversion | Policy tests cover 1-wei precision and over-precision rejection. |

## Observed operational notes

- Foundry emits expected `block.timestamp` lint notices because expiry is a core contract invariant; this depends on consensus block time, and timestamps are not used for sub-block precision.
- Production console bundle is about 516 kB minified before gzip; Vite warns that one JS chunk exceeds 500 kB. It is ~157 kB gzip. Code splitting can reduce initial payload later.
- The console reads events from a configurable deployment block. Set `VITE_MANDATE_DEPLOYMENT_BLOCK` near contract deployment for public RPCs with range limits.
- No contract address is deployed/configured, so testnet end-to-end and wallet transaction checks remain pending.
