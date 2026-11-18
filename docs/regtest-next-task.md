# First bounded regtest integration task

Implemented and fixture-tested a **read-only Bitcoin confirmation lookup adapter**
before wiring production swap actions. This milestone verifies mocked RPC contract
behavior, not live Core consensus acceptance or an actual reverse swap.

## Original integration gap

`SwapPorts.confirmed(txid)` in `src/core/SwapCoordinator.ts` needs independently
verified active-chain transaction evidence. The existing
`BitcoinRpcClient.confirmedTransaction(txid, blockHash)` requires a block hash
from its caller, checks active-chain membership and confirmations, but does not
resolve the block hash or verify that the returned transaction hex hashes to the
requested txid. No production `SwapPorts` implementation supplies this bridge.

`LndClient` already provides hold-invoice operations, lookup, regtest/sync checks
and subscription. Subscription reconnect/lookup reconciliation is explicitly
left to the caller. Those operations must remain unwired while consensus
observation and recovery are incomplete.

## Deliverable and independent acceptance checks

1. Add a narrow injectable RPC transport for deterministic fixture tests without
   reading credentials or contacting nodes. Preserve loopback-only endpoints.
2. Implement a read-only lookup that asserts Bitcoin regtest, discovers a
   transaction's block location through an explicitly supported node/index
   capability, and checks it against active-chain evidence. Fail closed when the
   transaction or required index/history is unavailable; do not enable indexes
   or change Core configuration automatically.
3. Parse returned transaction hex and verify its txid equals the requested txid.
   Require a positive safe-integer confirmation count and active-chain membership.
   Reject malformed responses, missing block location, mempool-only transactions,
   wrong txids, disconnected blocks and RPC failures. Include a simulated reorg
   between discovery and verification; document the residual race and require
   fresh confirmation checks at settlement/completion boundaries.
4. Test the adapter contract independently with recorded-shape synthetic RPC
   fixtures: valid confirmation, all rejection cases above, and non-regtest
   rejection before any subsequent lookup. Run `npm run build` and `npm test`.

Do not connect the adapter to public swap creation in this task. Do not generate
keys, read wallet secrets/macaroons, broadcast, mine, pay, settle, change node
configuration, merge or push. Keep the API's 503 live-creation gate and startup
refusal of `ENABLE_LIVE_SWAPS=true` intact. Fixture tests prove adapter behavior,
not live Core consensus acceptance.

This isolates the confirmation boundary from the larger pending roadmap in
`regtest-runbook.md`: secure key management, invoice reconciliation, durable
outpoint/reorg observation, action journals, reconnect/deadline workers and
automatic refunds are still prerequisites to enabling live orchestration.

## Implemented interface and evidence checks

`BitcoinConfirmationLookup` takes a narrow `ConfirmationRpc` transport. The
existing local, cookie-authenticated `BitcoinRpcClient` supplies it without any
new credential handling. `BitcoinRpcClient.confirmed(txid)` now matches
`SwapPorts.confirmed`; when assigning this method to a ports object, bind it to
the client (`confirmed: bitcoin.confirmed.bind(bitcoin)`). No production
coordinator or API wiring is added. The existing
`confirmedTransaction(txid, blockHash)` method delegates to the same verifier
with a block-location hint and returns the normalized `{ hex, confirmations }`
evidence rather than the previous raw RPC response.

Every lookup validates the input hash, asserts regtest through
`getblockchaininfo`, discovers a block using `getrawtransaction` when no hint is
provided, and repeats `getrawtransaction` with that explicit block hash. Both
transaction responses must have matching metadata and a parsed hex txid equal
to the requested txid. The block-specific response must explicitly report
`in_active_chain: true` and a positive safe-integer confirmation count.

The verifier cross-checks the block header's hash, height and confirmations,
uses `getblockhash(height)` to check active-chain membership, and reads a final
regtest chain snapshot. Initial and final tip hash/height must match, and
confirmation counts must agree with that tip. Any RPC error, missing field,
unknown/mempool-only transaction, unavailable historical data or inconsistent
observation throws; no partial evidence or cached success is returned. A tip
extension during lookup is also conservatively rejected; a caller may make a
fresh request later, without treating that rejection as a failed swap.

Historical discovery requires Core's available `txindex` history; no index is
enabled automatically, no wallet lookup is used, and pruned/unavailable blocks
are not recovered automatically. A validated block hint avoids discovery but
does not relax confirmation checks. The trusted node supplies consensus and
block-membership assertions; this adapter does not independently validate full
blocks or Merkle proofs. Multiple RPC calls are not an atomic snapshot: a reorg
after the final check, or a transient change away from and back to the same tip
between observations, can escape detection. Fresh checks at settlement and
completion remain necessary; this is not a persistent reorg observer.

`tests/bitcoinConfirmation.test.ts` uses only static synthetic transaction bytes
and scripted RPC fixtures, with exact method/parameter assertions. It exercises
the port and both client entry points, malformed identities/responses, chain
guards, failures at every RPC step, reorgs at several stages, and fresh evidence
on repeated calls. No credentials or nodes are accessed by these tests and no
transaction is created, signed or broadcast by this lookup or its new tests.
Validation: `npm run build` passed; `npm test` passed 42/42 tests including
existing live-gate regression tests. Existing offline crypto tests still run as
part of the repository suite; no live-node test was performed.

RPC semantics checked against the official Bitcoin Core 30.0 documentation:
[getrawtransaction](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/)
and [getblockheader](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/).
Compatibility with the lab's installed Core version remains to be verified.
