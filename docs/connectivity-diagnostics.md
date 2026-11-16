# Connectivity diagnostics: provider, Alice, channels and readiness

This document describes the read-only diagnostics integrated at baseline
`b56f2d7`. It does not authorize node changes, wallet loading, payments, mining,
transaction broadcast, commits, merges or pushes. No live finding below is
asserted as current: historical observations are quoted only from existing
repository documentation and must be re-measured before being used as evidence.

Relevant implementations:

- `src/diagnostics/RegtestDiagnostics.ts` — sanitized Core/provider/Alice report.
- `scripts/diagnose.ts` — CLI wiring for that report.
- `src/diagnostics/preflight.ts` — canonical lowercase preflight module used by
  `GET /v1/preflight`.
- `src/diagnostics/ReadOnlyClients.ts` — runtime allowlist for read RPCs/REST.
- `scripts/inspect.ts` — earlier four-check connectivity probe.

## 1. Run the sanitized report

Run inside the existing Ubuntu VM from the existing repository. Do not copy
credential contents, macaroons, cookies or TLS private keys into this repository.

```bash
cd /home/truja/projects/swap-engine
npm ci
npm run build
npm test
```

Provider values default to the existing lab paths. If `LND_MACAROON_PATH` is
unset, `scripts/diagnose.ts` falls back to the admin macaroon path. Prefer setting
the existing read-only macaroon explicitly:

```bash
export BITCOIN_RPC_URL='http://127.0.0.1:18443'
export BITCOIN_COOKIE_PATH='/home/truja/.bitcoin/regtest/.cookie'
export BITCOIN_WALLET='lqwd-lab'
export LND_REST_URL='https://127.0.0.1:8080'
export LND_TLS_CERT_PATH='/home/truja/.lnd/tls.cert'
export LND_MACAROON_PATH='/home/truja/.lnd/data/chain/bitcoin/regtest/readonly.macaroon'
```

Alice is reported only when all three Alice values are supplied. Use the REST
listener, certificate and readable macaroon already present on the VM. Do not
assume Alice's REST port is the gRPC port `10010`; discover it from the existing
local configuration.

```bash
export ALICE_LND_REST_URL='https://127.0.0.1:<existing-alice-rest-port>'
export ALICE_LND_TLS_CERT_PATH='<existing-alice-tls-cert>'
export ALICE_LND_MACAROON_PATH='<existing-alice-readonly-macaroon>'

npm run diagnose
```

`npm run diagnose` prints sanitized JSON and exits nonzero unless Core, provider
and Alice all reach `status: "ok"`. It does not print credential paths, cookie or
macaroon contents, TLS key material, raw node error bodies or private keys.
`npm run diagnose` is the only current command that reports provider and Alice
in one result.

The HTTP route `GET /v1/preflight` reports the provider configuration only. It
returns `200` only when its prerequisites are satisfied and `503` otherwise:

```bash
node --env-file=.env.simulation --import tsx src/main.ts
curl -sS -w '\nHTTP %{http_code}\n' http://127.0.0.1:3000/v1/preflight
curl -sS http://127.0.0.1:3000/v1/health
```

`/v1/health` is process/component liveness, not node readiness. The runtime
clients deny all write/signing/funding/payment operations even if synchronization
later recovers.

## 2. Core readiness commands and fields

Read-only Core CLI checks:

```bash
bitcoin-cli -regtest getzmqnotifications
bitcoin-cli -regtest -rpcwallet=lqwd-lab getblockchaininfo
bitcoin-cli -regtest -rpcwallet=lqwd-lab getwalletinfo
bitcoin-cli -regtest -rpcwallet=lqwd-lab listwallets
bitcoin-cli -regtest -rpcwallet=lqwd-lab listwalletdir
```

Expected readiness evidence:

| Field/check | Ready evidence |
| --- | --- |
| `getblockchaininfo.chain` | `regtest` |
| `getblockchaininfo.blocks` / `headers` | Both known and `headers >= blocks` |
| `getblockchaininfo.initialblockdownload` | `false` |
| `getblockchaininfo.bestblockhash` | A present, nonzero 64-hex tip hash |
| `getwalletinfo.walletname` | The configured `lqwd-lab` wallet is loaded |
| `listwallets` / `listwalletdir` | The wallet is both loaded and present on disk |
| `getzmqnotifications` | Existing lab expectations: `pubrawblock` at `tcp://127.0.0.1:28332` and `pubrawtx` at `tcp://127.0.0.1:28333` |

`npm run diagnose` reports these as `core.network`, `core.height`, `core.headers`,
`core.inInitialBlockDownload`, `core.tipHash` and the Core `failures` list.
`GET /v1/preflight` additionally reports Core ZMQ availability and wallet
loaded-on-disk state.

## 3. Provider and Alice LND readiness commands and API paths

Read-only `lncli` checks already documented for this VM:

```bash
lncli --lnddir=/home/truja/.lnd --network=regtest --rpcserver=127.0.0.1:10009 getinfo
lncli --lnddir=/home/truja/.lnd --network=regtest --rpcserver=127.0.0.1:10009 listpeers
lncli --lnddir=/home/truja/.lnd --network=regtest --rpcserver=127.0.0.1:10009 listchannels
lncli --lnddir=/home/truja/.lnd --network=regtest --rpcserver=127.0.0.1:10009 pendingchannels

lncli --lnddir=/home/truja/.lnd-alice --network=regtest --rpcserver=127.0.0.1:10010 getinfo
lncli --lnddir=/home/truja/.lnd-alice --network=regtest --rpcserver=127.0.0.1:10010 listpeers
lncli --lnddir=/home/truja/.lnd-alice --network=regtest --rpcserver=127.0.0.1:10010 listchannels
lncli --lnddir=/home/truja/.lnd-alice --network=regtest --rpcserver=127.0.0.1:10010 pendingchannels
```

LND REST paths used by the read-only diagnostics:

| API path | Purpose |
| --- | --- |
| `GET /v1/getinfo` | pubkey, alias, version, chains, chain/graph sync and block height/hash |
| `GET /v1/state` | wallet/server state; `SERVER_ACTIVE` is the ready state |
| `GET /v1/peers` | connected peer pubkey and address |
| `GET /v1/channels` | channel point, active flag, capacity, balances, reserves and pending HTLCs |
| `GET /v1/graph/node/{pubkey}` | peer alias when the public graph has that node |
| `GET /v1/channels/pending` | optional pending-channel verification; not part of `npm run diagnose` |

`npm run diagnose` reports each LND node separately as `lnd.provider` and
`lnd.alice`. It combines `/v1/peers` with channel counterparties: a peer seen in
`/v1/peers` is `connected: true`; a channel counterparty not listed there is
`connected: false`. An unavailable peer alias remains `null` and is reported as a
sanitized failure rather than guessed.

Readiness evidence for each node:

- `identity.pubkey` is present.
- `network.onRegtest` is `true` (`bitcoin`/`regtest`, exactly one chain).
- `sync.syncedToChain` is `true`; report `syncedToGraph` separately.
- `wallet.state` is `SERVER_ACTIVE`; `null` means unknown, not active.
- `peers` and `channels` were read successfully; an empty list is valid data.
- At least one active channel exists for usable liquidity, although the rich
  report itself does not treat zero active channels as a transport failure.

The canonical lowercase preflight also checks `wallet_synced`, `num_peers` and
Core/LND tip agreement. A missing `wallet_synced` value is unknown and blocks the
preflight; it is not inferred from another flag.

## 4. Directional liquidity interpretation

For each active channel:

```text
outbound = max(0, local_balance  - local_reserve  - sum(outgoing pending HTLCs))
inbound  = max(0, remote_balance - remote_reserve - sum(incoming pending HTLCs))
```

- `capacitySats` is total channel capacity, not spendable liquidity.
- Reserves are `local_constraints.chan_reserve_sat` and
  `remote_constraints.chan_reserve_sat`.
- Pending HTLC totals come from `pending_htlcs`, split by `incoming`.
- Only active channels contribute to `liquidity.outboundSats` and
  `liquidity.inboundSats`. Inactive channels remain in the channel list with
  `state: "INACTIVE"` and are excluded from the aggregate.
- `null` always means unknown; it is never a zero substitute. Missing channel
  fields appear in that channel's `unknown` array.
- If any active channel has unknown directional liquidity, aggregate totals are
  `null` and `unknownChannels` names the affected channel points (or `"unknown"`
  when the channel point itself is unavailable).
- Safe-integer overflow returns `null` rather than an unsafe number. Aggregate
  overflow adds `aggregateOutboundOverflow` and/or `aggregateInboundOverflow` to
  `unknownChannels`. Per-channel pending HTLC overflow leaves `pendingHtlcs`
  totals `null` and marks the channel unknown.

For a reverse swap, the provider must receive the held Lightning payment and
Alice must pay it:

- Provider **inbound** liquidity is the relevant receiving capacity.
- Alice **outbound** liquidity is the relevant paying capacity.
- Provider outbound and Alice inbound are not the primary reverse-swap direction.
- At the same `channel_point`, provider inbound and Alice outbound should be
  directionally consistent after reserves and pending HTLCs. Do not require exact
  equality, because pending HTLCs, reserves and observation times can differ.

## 5. Classifying failures strictly from report evidence

Sanitized diagnostic categories:

| Category | Meaning | Do not claim |
| --- | --- | --- |
| `BITCOIN_CONFIG_UNAVAILABLE`, `LND_CONFIG_UNAVAILABLE` | Local env/file/config missing | That the node is down or corrupt |
| `BITCOIN_RPC_UNREACHABLE`, `LND_UNREACHABLE` | Transport failed (refused, timeout, TLS/connectivity) | That chain or channel state is unhealthy |
| `BITCOIN_RPC_ERROR`, `LND_RPC_ERROR` | Request reached a service but failed | A precise cause without supporting local logs/CLI evidence |
| `BITCOIN_MALFORMED_RESPONSE`, `LND_MALFORMED_RESPONSE` | Wrong endpoint, protocol/version mismatch or invalid shape | Node failure |
| `BITCOIN_WRONG_NETWORK`, `LND_WRONG_NETWORK` | Node is not Bitcoin regtest | Mainnet/testnet operation |
| `BITCOIN_INVALID_HEIGHT`, `BITCOIN_IN_IBD`, `BITCOIN_TIP_UNAVAILABLE` | Core chain is inconsistent or not ready | Wallet/channel cause |
| `LND_NOT_SYNCHRONIZED` | LND chain sync flag is not true | Peer/channel cause |
| `LND_NO_ACTIVE_CHANNELS` | Channel data was read but no channel is active | That no channel exists or that a specific channel failed |
| `BITCOIN_WALLET_UNAVAILABLE` | Core wallet RPC failed or wallet is not available | Loss of funds |

Preflight blocker strings such as `CORE_GENESIS_ONLY`, `CORE_SYNC_UNRESOLVED`,
`CORE_HEADERS_AHEAD`, `WALLET_NOT_LOADED`, `LND_WALLET_LOCKED`,
`LND_CHAIN_SYNC_UNRESOLVED`, `LND_WALLET_SYNC_UNRESOLVED`,
`CORE_LND_TIP_UNVERIFIED_OR_DIFFERENT`, `NO_ACTIVE_CHANNELS` and
`NO_LND_PEERS` are readiness decisions from one snapshot. They do not by
themselves prove a permanent node fault.

## 6. SSH/VM blocker classification

Use only verified evidence from the current run:

1. If `npm run diagnose` runs in a Windows/workspace copy and reports
   `*_CONFIG_UNAVAILABLE` because `/home/truja` paths are absent, classify this as
   a local workspace/credential-path blocker. Do not infer that the separate VM's
   nodes are unhealthy.
2. If it runs inside the VM and reports `*_UNREACHABLE`, verify the existing
   listeners and local credential readability without changing configuration.
   Only then classify a connectivity blocker. A missing local cookie/macaroon or
   TLS file is a config blocker, not evidence of node failure.
3. If Core height/IBD or LND sync/wallet-state checks fail, classify a readiness
   blocker from those exact fields. Do not restart, mine, reset datadirs, load a
   wallet or repair channels based on this document.
4. Historical repository evidence is not current evidence. Existing docs record,
   at different times, a Windows workspace without `/home/truja` files and failed
   local port probes; a VM snapshot with Core height 0/IBD true, no loaded wallet
   and one inactive LQWD-LAB channel; a deployment where Core RPC and LND ports
   were not listening; and an approved readiness check at height 130 with one peer
   and one active channel per LND node. These snapshots differ, so re-run the
   read-only checks before classifying the current VM state.

## 7. Channel-2 blocker classification

Available repository documentation contains no verified second channel. The
latest recorded readiness check states one peer and one active channel on each
LND node; an earlier deployment snapshot states one inactive channel. No
available log or state file in this repository establishes a second channel or
its failure mode. Therefore "channel-2" is **unverified**, not an established
cause.

Classify using channel points and both nodes' reports:

| Evidence | Classification |
| --- | --- |
| Same `channel_point` present and `active: true` on provider and Alice | Verified active channel |
| Same `channel_point` present but inactive on either side | Inactive/not currently usable; check pending channels |
| Only one node reports the channel | One-sided or stale evidence; check `/v1/channels/pending` or `pendingchannels` |
| Neither node reports the channel and `channels` reads succeeded | Not observed in this run; do not assert that it exists |
| `channels` read failed or `unknownChannels` is nonempty | Evidence incomplete; classify unknown, not absent |
| Active channel but aggregate directional liquidity is zero | Channel exists but lacks usable capacity in that direction |
| Peer for the channel is `connected: false` | Connectivity/channel-state problem to verify, not proof of channel absence |

Do not infer a second channel from capacity, balances, peer count or a
`channel_point` seen on only one side. Record the sanitized channel point,
active/state, capacity, directional liquidity and any pending-channel evidence
before assigning a blocker.

## 8. Evidence handling

- Prefer `npm run diagnose` JSON as the primary evidence because it is sanitized
  and covers Core, provider and Alice together.
- Record only the fields needed for classification: timestamps, heights, tip
  hashes, pubkeys, aliases, channel points, active flags, balances, directional
  liquidity and sanitized failure categories.
- Never paste macaroon or cookie contents, TLS private keys, wallet material,
  raw authorization headers or arbitrary node response bodies into Git, chat or
  logs.
- Do not treat a failed or partial diagnostic run as proof of node failure.
  Re-run the read-only checks after correcting local config/connectivity.
