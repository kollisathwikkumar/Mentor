# Monad Testnet acceptance record — 2026-10-04

## Outcome

**Live bounded execution and negative-path checks: PASS.** The runner used the local MCP stdio process and chain ID 10143. It refused to proceed unless the configured principal, agent key, recipient, contract, mandate, caps, initial deposit, nonce, and active state matched the expected disposable test fixture.

Command: `npm run test:testnet-flow`

Contract: `0x77065a818481ceebba93e79988bef9fd646f457d`  
Mandate: `0x36a730095a8f287f71184280d67d91c37cc3dd9bc4eebb3cf90908da8067dd4e`

## Verified live behavior

| Check | Result |
|---|---|
| MCP tools | `propose_mandate`, `get_mandate_status`, `request_bounded_transfer` |
| Within-limit transfer | 0.01 MON; receipt success; `TransferExecuted` emitted at nonce 0; recipient balance change adjusted for gas equaled 0.01 MON |
| Transfer receipt | `0xe880a9b30485c516279c45cb1eadc85d01bf1215aedbeedb72b7d7b4de64ae60` |
| Above-cap request | 0.010000000000000001 MON denied with `PER_CALL_LIMIT`; no state change and no transaction submitted |
| Principal revocation | Receipt success; mandate became inactive |
| Revocation receipt | `0x728d4fd010176d88c27658c5a026e4670fa46c79aca1bd335ed03942fca6097d` |
| Post-revocation request | 0.001 MON denied with `MANDATE_INACTIVE`; no state change and no transaction submitted |
| Withdrawal | Remaining 0.01 MON withdrawn to the principal after revocation; receipt/event and gas-adjusted principal balance delta verified |
| Withdrawal receipt | `0xc898a25e6c3a8fa2859f19b3b4e34e6803e95222010d4240c30221f3f19f96b3` |
| Final live status | `active=false`, `spent=10000000000000000`, `deposited=0`, `nextNonce=1`; vault balance 0 |

## Remaining operational acceptance

The Codex project config now allowlists all three Mandate tools with prompt approval; restart Codex to load the updated list in the active session. The Chrome console still reports no EIP-1193 provider, so browser-wallet connection and create/fund/revoke acceptance remain outstanding. This testnet pass is not production readiness or a third-party audit.
