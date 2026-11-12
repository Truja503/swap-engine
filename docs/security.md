# Known security limitations

Experimental regtest components, unaudited, with live orchestration disabled.

1. No live consensus execution has been verified. Offline signature verification
   does not run Bitcoin's script interpreter or validate a real Lightning payment.
2. No live block/mempool observer, spender discovery, reorg handling, or confirmation
   rollback. A future observer must prove active-chain membership, input/outpoint,
   and sufficient confirmations. One confirmation is a lab policy only.
3. No secure persisted provider refund-key manager. Refund signing keys must remain
   locally available through the full timeout; never generate one transiently and
   broadcast a live lockup. Client claim keys/preimages also require secure backup.
4. Refund transaction construction is implemented. Automatic refund broadcasting,
   confirmed-refund state progression and invoice reconciliation are not implemented.
   REFUND_PENDING never means funds have been returned.
5. A confirmed claim can expose the secret after Lightning has become unpayable.
   Live claim policy, deadline enforcement and prompt settlement need full worker
   integration. Reorgs, disconnections and rapid regtest mining can exhaust margins.
6. Remote RPC timeouts can have unknown outcomes. The durable intent prevents blind
   recreation but recovery stops in MANUAL_REVIEW. There is no automatic remote
   reconciliation or safe resume command. Do not edit state to bypass this.
7. PSBT preparation can leave Core input locks after an exception or process crash.
   Its create/fund call itself cannot be atomically committed with the local file.
   Exact outpoints must be journaled and reconciled before enabling live swaps.
   Never blanket-unlock a wallet's UTXOs while a swap may be funded.
8. No RBF/CPFP strategy, estimator-driven fee management, or package-relay policy.
   Funding uses a fixed 2 sat/vB and a 1,000-sat ceiling. Claim/refund fees are caller
   supplied, checked for positive integer/non-dust outputs, and have no dynamic policy.
9. Liquidity reservations are amounts, not exact UTXOs. Other wallet users or LND
   payments can consume balances outside the store lock. Channel totals do not
   prove routability, maximum HTLC availability, or a usable single route. MPP
   expiry and amount checks exist, but live multipart behavior is untested.
10. Persistence is a single local JSON file and one exclusive process lock. There
    is no replication, distributed locking, database encryption, tamper evidence,
    migration engine, or full schema validation of every historical state field.
    Corrupt JSON/schema fails startup. Restrict directory access and back it up.
11. A crash leaves a lock file. Confirm all engine processes have stopped, preserve
    state, inspect remote actions, then manually remove only engine.lock. Never
    clear it while another instance runs. Windows file modes do not establish ACLs;
    set directory ACLs explicitly. Do not store state in a synced folder for live use.
12. The HTTP API is loopback only, without auth/rate limits/TLS. Local malicious
    processes can read swap metadata or exhaust quotes/storage. Do not expose it
    through a proxy. There is no multi-user authorization boundary.
13. LND credentials stay in their existing local files. The sample uses an admin
    macaroon, which is overprivileged. Bake a narrowly scoped macaroon before any
    non-lab use. TLS CA/hostname verification stays enabled. Subscriptions need a
    reconnect/backoff and lookup-on-reconnect worker before production wiring.
14. No client wallet UI, invoice decoding/cross-check tool, payment routing tracker,
    watchdog or watchtower integration. The client must independently verify amount,
    payment hash, chain, keys, script, lockup outpoint and timelock before paying/claiming.
15. The API reports component health, not node readiness. A quote can be created
    while nodes are offline; it does not reserve funds or promise acceptance.
16. Logs are intentionally sparse allowlisted events. Errors omit RPC response bodies
    and credentials. No comprehensive tracing, alerting or deadline monitoring exists.
17. Dependencies are well-established libraries but this repository and its script
    have not been audited. Lockfile pinning and a heuristic secret scan do not replace
    dependency review, independent protocol review or comprehensive secret detection.
18. Environment clocks affect quote expiry. Timelocks use chain height, but neither
    local clock manipulation nor deep consensus failures are in the tested threat model.
19. There are no testnet/mainnet, Liquid, Rootstock, Arkade, or RGB integrations.

Do not advertise this milestone as a functioning live atomic swap service.
