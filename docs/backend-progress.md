# Backend progress

**Snapshot date:** 2026-10-04  
**Testnet backend MVP estimate:** **95% complete**
**Scope:** core backend plus Monad Testnet integration, not production deployment readiness. The percentage is a milestone-weighted estimate, not a measure of lines of code or test coverage.

| Milestone | Weight | Status | Evidence |
|---|---:|---|---|
| Contract, policy engine, deterministic validation, and local test coverage | 25% | Complete | 15 Foundry tests; 43 TypeScript tests; local Anvil allow/deny/revoke end-to-end coverage. |
| Provider/model proposal integration | 20% | Paused | The provider-specific adapter, runtime configuration, and proposal tool are removed from the active code path. Reconnect after the user supplies the new provider key and endpoint/model details. |
| Monad Testnet deployment and code verification | 20% | Complete | Chain ID 10143; contract `0x77065a818481ceebba93e79988bef9fd646f457d`; deployment block `68065182`; 5,910 bytes of bytecode. |
| Live mandate create/fund and backend MCP status read | 15% | Complete | Mandate `0x36a730095a8f287f71184280d67d91c37cc3dd9bc4eebb3cf90908da8067dd4e`; 0.02 MON deposited; MCP returned active status and nonce 0. |
| Live bounded transfer and live negative-path/revoke verification | 15% | Complete | MCP submitted a 0.01 MON transfer; receipt/event/balance and mandate state verified. Over-limit and revoked requests were denied; 0.01 MON remainder was withdrawn after revocation. |
| Browser-wallet/Codex operational acceptance | 5% | In progress | Codex allowlist now includes the transfer tool with prompt approval; restart Codex to load it. Chrome has no EIP-1193 wallet provider, so browser-wallet acceptance remains pending. |
| **Total** | **100%** | **95% complete** | Remaining weighted work: wallet connection plus active Codex reload/acceptance (5%). |

## Next acceptance gates

1. Restart Codex and verify the three configured Mandate tools are available with prompt approval.
2. Connect an EIP-1193 wallet in Chrome on Monad Testnet and verify console read/create/fund/revoke using a separate disposable test mandate.
3. Before production: add provider spend/call caps, operational telemetry, production key custody/rotation, and a third-party contract audit; deploy and verify a separate production configuration.

## Live testnet acceptance run

`npm run test:testnet-flow` passed on 2026-10-04. The runner pins chain ID 10143, the expected contract and mandate, verifies the owner/signer/recipient keys and exact initial state before sending any transaction, and refuses to repeat the non-repeatable flow after state changes.

- MCP currently exposes `get_mandate_status` and `request_bounded_transfer` when chain settings are configured; no model proposal tool is active.
- Bounded transfer: 0.01 MON, receipt success, `TransferExecuted` event nonce 0, recipient delta adjusted for gas exactly 0.01 MON; tx `0xe880a9b30485c516279c45cb1eadc85d01bf1215aedbeedb72b7d7b4de64ae60`.
- Over-limit request: 0.010000000000000001 MON returned `{ "status": "denied", "reason": "PER_CALL_LIMIT" }`; onchain spent/deposit/nonce unchanged.
- Principal revocation: success; tx `0x728d4fd010176d88c27658c5a026e4670fa46c79aca1bd335ed03942fca6097d`.
- Post-revocation 0.001 MON request returned `{ "status": "denied", "reason": "MANDATE_INACTIVE" }`; state unchanged.
- Withdrawal after revocation: returned remaining 0.01 MON to principal, receipt and `FundsWithdrawn` event verified; tx `0xc898a25e6c3a8fa2859f19b3b4e34e6803e95222010d4240c30221f3f19f96b3`.
- Final live MCP status: inactive, spent 0.01 MON, deposited 0, nonce 1; vault native balance 0.

The detailed receipt/state output is recorded in [`testnet-acceptance-2026-10-04.md`](testnet-acceptance-2026-10-04.md).

## Current live testnet identifiers

- Contract: `0x77065a818481ceebba93e79988bef9fd646f457d`
- Mandate: `0x36a730095a8f287f71184280d67d91c37cc3dd9bc4eebb3cf90908da8067dd4e`
- Principal: `0xBAAbc383b51eEA0BE4d070e67B998C6D2Db30b2d`
- Agent signer and fixed recipient: `0xD5FdF82e5cCABa4529D9c3C751513405176a44EE`
- Per-call cap: `0.01 MON`; total limit and current deposit: `0.02 MON`
