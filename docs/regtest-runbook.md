# Existing-VM preflight and remaining live demo

This runbook preserves the existing Bitcoin wallet, chain and Lightning channel.
There is no executable live swap demo in this milestone. `npm run demo` is an
offline component test with fake ledger adapters, explicitly labeled in its output.

## Read-only inspection in the Ubuntu VM

```bash
node --version
bitcoin-cli -regtest -rpcwallet=lqwd-lab getblockchaininfo
bitcoin-cli -regtest -rpcwallet=lqwd-lab getwalletinfo
bitcoin-cli -regtest -rpcwallet=lqwd-lab listunspent 1
bitcoin-cli -regtest -rpcwallet=lqwd-lab listlockunspent
lncli --lnddir=/home/truja/.lnd --network=regtest --rpcserver=127.0.0.1:10009 getinfo
lncli --lnddir=/home/truja/.lnd --network=regtest --rpcserver=127.0.0.1:10009 listchannels
lncli --lnddir=/home/truja/.lnd-alice --network=regtest --rpcserver=127.0.0.1:10010 getinfo
lncli --lnddir=/home/truja/.lnd-alice --network=regtest --rpcserver=127.0.0.1:10010 listchannels
ss -ltnp
```

Check Core says regtest, both nodes are chain-synced, the existing 5,000,000-sat
channel is active, and Alice has enough outbound capacity. Do not paste sensitive
outputs into Git. Verify the REST listener and certificate SAN match the configured
loopback hostname. If REST is unavailable, implement a gRPC adapter or arrange a
local-only REST listener deliberately; do not treat 10009 as REST and do not
automatically overwrite existing configuration.

```bash
npm ci
npm run build
npm test
cp deploy/regtest.env.example .env.regtest
# Review and correct only the application .env.regtest paths locally.
node --env-file=.env.regtest --import tsx scripts/inspect.ts
```

All four checks must pass before wiring live actions. Do not copy cookie content,
macaroons, private TLS keys or wallet material into this project. The inspection
script prints classifications, not secret response bodies.

## Exact remaining implementation work

1. Implement a local durable refund-key store (mode/ACL restrictions, backup,
   per-swap derivation/identifiers) and a user-side tool generating a preimage and
   separate claim key. Provider receives only the hash and public key.
2. Implement a production SwapPorts adapter using the existing clients. Create a
   hold invoice with a final CLTV delta satisfying timeout + 40; validate its
   decoded hash/amount/network on the user side. Reconcile existing invoices by
   hash before retrying unknown creation outcomes.
3. Implement persistent block/mempool cursors, exact outpoint spending detection,
   active-chain confirmation lookup, and disconnect/reorg handling. No supplied
   txid or witness can count as consensus evidence without this lookup.
4. Journal exact Core input selections and provider keys before remote actions.
   On restart reconcile invoice, lockup, spender and pending intent instead of
   funding a second transaction. Resolve MANUAL_REVIEW through verified evidence.
5. Implement a reconnecting invoice subscription/deadline worker with lookup
   reconciliation. Recheck accepted HTLC amounts and minimum expiration, plus
   on-chain claim window, immediately before funding.
6. Implement automatic refund preparation/broadcast and confirmed REFUNDED state.
   Reconcile cancellation/settlement races, partial claims, fee policy, stuck
   funding and external input locks. Never expire a possibly funded swap.
7. Wire the completed adapters/workers into the API and replace the hard gate
   only after integration tests verify each boundary. A flag alone is insufficient.

## Live 50,000-sat acceptance scenario after those changes

1. Record tip, active channel ID and balances. Request a 50,000-sat principal
   quote (currently 50,750-sat invoice and estimated 49,500-sat claim destination).
2. User generates and backs up its secret/key locally, requests the reverse swap,
   and independently reconstructs the returned witness script/address/refund height.
3. Alice starts payment asynchronously. Keep the payment process running while
   a separate process/worker observes LQWD's `ACCEPTED` state. A hold invoice will
   deliberately leave the payment pending; waiting for payment success before
   funding deadlocks the protocol. Track LND payment updates until SUCCEEDED or FAILED.
4. After all liquidity/CLTV checks, persist exact funding transaction, broadcast,
   and mine only the minimum required confirmation blocks to an existing wallet
   address. Verify the output script/value and active-chain confirmation independently.
5. User signs and broadcasts the claim using its own preimage/key. Mine its required
   confirmation, verify its exact spend with Core, and observe the worker extract
   the secret and settle LQWD's hold invoice.
6. Verify LQWD reports SETTLED, Alice reports SUCCEEDED, the claim output is
   confirmed, API reports COMPLETED, and the original channel remains active.
   Record hashes and heights as evidence, never private keys or credentials.
7. Repeat with unpaid expiry, accepted-payment cancellation, insufficient balances,
   stuck lockup, process termination at every action intent, duplicated events,
   invalid claim, and an unclaimed HTLC reaching its refund height. Verify the
   refund's active-chain spend and terminal invoice state before releasing reservations.

These steps describe pending acceptance work, not a successful test already run.
