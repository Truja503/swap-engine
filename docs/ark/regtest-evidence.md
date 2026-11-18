# Ark regtest: evidence for #50–#53

Run on 2026-11-18 in `ark-regtest-46-54`, with Podman 4.3.1 /
podman-compose 1.6.0, Node 22.23.2, Rust 1.97.1, Bitcoin Core 31.0,
arkd v0.9.25 and `arkade-os/rust-sdk` v0.12.1.
The GitHub-hosted Ubuntu workflow was not dispatched.

| Command | Observed result |
| --- | --- |
| `npm run ark:start` | Exit 0; owned Core at height 106; NBXplorer and Esplora synced, signer healthy, operator wallet initialized, unlocked and synced. |
| `npm run ark:status` | Exit 0; same tip `650cbb7ea52ef7b9bccb8ccedc73876153dc6b7a084578b4ece25cd711e26357`; regtest genesis `0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206`; PostgreSQL and Redis ready. |
| `npm run ark:test -- --unit-only` | Exit 0; 5 passed, 0 failed; includes one **synthetic** offboard submission timeout. |
| `npm run ark:test -- --e2e` | Exit 0; 7 live stages passed, 2 skipped. See below. |
| `npm run ark:test -- --e2e` (second invocation) | Expected exit 1: claimed fixture refused; no further funding and height stayed 110. |
| `npm run ark:stop` | Exit 0; zero lab containers running, same container IDs and volume names. |
| `cargo fmt --manifest-path ark/Cargo.toml --all -- --check` | Exit 0. |
| `cargo clippy --manifest-path ark/Cargo.toml --locked --all-targets --all-features -- -D warnings` | Exit 0. |
| `npm run secrets:check` | Exit 0; no findings. |

## Integrated live run (`data/ark/e2e/evidence/`)

| Transaction | TXID | Core height / block hash | Chain fee |
| --- | --- | --- | ---: |
| Funding | `838f2bb0e1d75bb5dfb674fda04ada9bf248538233baad549211f3bc9f9ac89e` | 107 / `5ca291fab402ff7a14d7fc1a71bbdbaab4d0834b50699b3e6304fec5f3190b88` | 165 sats |
| Boarding commitment | `6b92ac2e01f4c4f1bae0118f72601895307df20a97e403dda5c1dd19edf6ac66` | 108 / `4da16ace5e3e5a04d8a9c642cde1901a78f888642e504393fe5baff1aa321973` | 262 sats |
| Ark payment A→B | `a80d04eb37f764e05afdcf0f1dded6af2f13fb5eaf34f4452e52992405e1e77e` | Off-chain; original ancestor at 108 | N/A |
| Cooperative offboard commitment | `7abbc24d23d0dcdce13a9d290507b8e60cfdfc6c25631f1dc5cfe044020f03f6` | 109 / `003f40a9dd7c00a6976bfbb94ecd883c9458957194f0ac00505a68d054826ee4` | 241 sats |
| Stale VTXO renewal commitment | `c90dd08ff64ed5c519273fd613c5cf7ebdc3df6b4eed28fcc6c6d9b34c40a6fe` | 110 / `383f81797b2b45b53e09a9f652a8213cd099a9760a5016ec5a88df205105b3d1` | 198 sats |

| Stage | Status | Observed balances and outpoints |
| --- | --- | --- |
| Boarding | PASSED | Funding output `838f2bb0e1d75bb5dfb674fda04ada9bf248538233baad549211f3bc9f9ac89e:0` paid `bcrt1pjccs349xmkvwtandljfuav0k0mwudsfualnhwzjmqyechwqrqltqrdgzxe`. Alice 0 → 200,000 confirmed sats at `d16feced5f5edf5812280f8105d60c213c061d7f7a3750fedc2df83c6608818b:0`. Boarding fee 0 sats; reselecting that spent boarding input returned no new commitment. Wrong network, dust and insufficient-funds preflights rejected. |
| Transfer and client restart | PASSED | Consumed Alice's boarding VTXO; her change `a80d04eb37f764e05afdcf0f1dded6af2f13fb5eaf34f4452e52992405e1e77e:1` was 125,000 sats, Bob's receipt `a80d04eb37f764e05afdcf0f1dded6af2f13fb5eaf34f4452e52992405e1e77e:0` was 75,000 sats. Both preconfirmed after finalizing the original pending TXID in a new client process. Fee 0 sats. Restart snapshots matched; SDK selection refused the consumed input and finalization retry did not submit; insufficient input rejected. |
| Cooperative offboard | PASSED | Consumed Bob's 75,000-sat receipt; Ark change `5728835ca405ab407114265b8e03d1bb3309e9d9874dfc30ed0dd0962f58279c:0` held 45,000 sats. Core output `7abbc24d23d0dcdce13a9d290507b8e60cfdfc6c25631f1dc5cfe044020f03f6:2` paid 30,000 sats (up from zero) to `bcrt1pu4sdpc2qxpgmfecke8q7kr093zu9xa28nchgsrgq80xt7res6cxs2fcwku`. Commitment locktime 0; user fee 0 sats. Wrong network and insufficient input rejected. |
| Stale VTXO and renewal | PASSED | Expired Alice change refused for payment; consumed via renewal into confirmed `0fcd7ad8f87aec0930ad1e0b88f391d33b073e4b3c24a58eb2bea9f55d54cc28:0` holding the same 125,000 sats (0-sat balance delta). |
| Operator unavailable | PASSED | Stopped owned arkd; cooperative call returned `ArkOperatorUnavailable` before submission. Restarted and verified readiness. |
| Core RPC unavailable | PASSED | Stopped owned Core; RPC readiness call failed. Restarted and verified regtest genesis and indexer sync. |
| Esplora unavailable | PASSED | Stopped owned Esplora API; cooperative call returned `ArkIndexerUnavailable` before submission. Restarted and verified sync. |
| Live mid-submission timeout | SKIPPED | Only the offline stalled-response simulation passed. Transfer interruption was a real submit/reconnect/finalize sequence, with the boundary created deliberately. |
| Unilateral exit | SKIPPED | No `submitpackage`, unroll or CSV rescue transaction was performed. |

## Earlier live rehearsal (separate wallets)

The initial check used the normal local lab wallets, before running the
dedicated one-shot fixture. It did not repeat ambiguous funding. Its transfer
assertions completed; the initial JSON formatter failed afterwards and was
fixed before the integrated run. These are the independently observed IDs
from that rehearsal:

| Operation | TXID and Core height | Fee | VTXO / output |
| --- | --- | ---: | --- |
| Funding | `252803b71b706c29bb1be73c77b9783d02371d6098b1d9d1f88e0c4c4bd57a69` / 103 | 165 sats on-chain | Boarding `:1`, 200,000 sats |
| Boarding | `92921a42593acf5d609a4e5676b688dd3fbab2c09360a9b69e93d1bd16993c27` / 104 | 262 sats on-chain; 0 sats deducted from user | `c74bbd3822ef8b04e077731e82d60537cb9fc7c5df8b9052c459260d5ce5209e:0` |
| Renewal after expiry | `f6682303803557435dcdee4a796c88b1ef1dd059469af8223640ff323048a1a9` / 105 | 198 sats on-chain; 0 sats deducted from user | `8d66733bc6357f168896e6957d79b035497a9b2a5858cf716a1bba9bbd6fa5ba:0` |
| Transfer | `e2d82ba144eb590649495b6638707c3866f62e7f49dd058a02b8705b43407caa` / off-chain | 0 sats | `:0` to Bob (75,000 sats); `:1` Alice change (125,000 sats) |
| Cooperative offboard | `37c4413cb474cd5b4803e0d3c3af2ec4c721dca62b23156499f22637ba7b3b2e` / 106 | 241 sats on-chain; 0 sats deducted from user | `:2` paid 30,000 sats on-chain; change VTXO `3024fb78c92657972d68dd4f7152e43a3fd6388c1463fc7f84ab69d18b89839f:0` |
