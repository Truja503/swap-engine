# Ubuntu regtest read-only deployment

Use the existing Node.js 22 runtime and existing repository at
`/home/truja/projects/swap-engine`. Do not reset, load, create or migrate a wallet;
do not restart Core/LND or change their configuration. No live swaps are enabled.

## Prepare and run manually

```bash
cd /home/truja/projects/swap-engine
node --version
npm ci --cache ./data/npm-cache
npm run build
npm test
mkdir -p data
chmod 700 data
# Copy once, only if .env.regtest does not already exist:
test -e .env.regtest || cp deploy/regtest.env.example .env.regtest
# The example sets APP_MODE=regtest for this read-only deployment. SIMULATION is
# the offline default; use deploy/simulation.env.example as .env.simulation for it.
node --env-file=.env.regtest --import tsx scripts/inspect.ts
# A nonzero preflight exit is expected while synchronization/wallet state is unresolved.
node --env-file=.env.regtest --import tsx src/main.ts
```

Review paths in the repo-local `.env.regtest` without copying credential
contents. The existing Bitcoin cookie, TLS certificate and read-only LND macaroon
stay at their existing VM paths and are read locally by the clients. TLS
verification stays enabled; if the certificate does not cover 127.0.0.1, use a
loopback hostname already present in its SAN rather than disabling verification.
The application always binds `127.0.0.1`, ignoring external HOST settings.

The UI and quote API work without synchronized nodes or a loaded Core wallet.
Quotes persist only application metadata under `data/`; this is not a stateless
HTTP server. Use one application process per data directory; a second writer is
refused by the store lock. Stop the application with SIGINT/SIGTERM for clean
shutdown. Do not remove a lock file just because another process cannot start.

```bash
curl -f http://127.0.0.1:3000/
curl -f http://127.0.0.1:3000/v1/health
curl -f -H 'Content-Type: application/json' \
  -d '{"amountSats":50000}' http://127.0.0.1:3000/v1/quotes
curl -sS -w '\nHTTP %{http_code}\n' http://127.0.0.1:3000/v1/preflight
```

This deployment uses `.env.regtest` with `APP_MODE=regtest`, so it uses only the
existing loopback-only read-only Core/LND clients and real preflight diagnostics.
`.env.simulation` with `APP_MODE=simulation` performs no node connectivity and is
labeled `"mode":"simulation"` in `/v1/health`; it returns 503
`DIAGNOSTICS_NOT_CONFIGURED` for preflight. Mainnet is rejected at startup, and
`POST /v1/swaps/reverse` remains 503 in both modes.

Health is process/component liveness only, not readiness. Preflight returns 503
with sanitized diagnostics while prerequisites are unresolved; its CLI exits 1.
An HTTP 200 preflight means its listed prerequisite checks passed, never that
live swaps are enabled. It checks Core RPC/network, blocks/headers/IBD, loaded
wallet list and on-disk wallet directory; LND REST/network, chain and wallet sync
flags, peer count and active/inactive channels; and Core/LND tip agreement.
Missing `wallet_synced` is reported as unknown and blocks prerequisites; it is
never guessed from another flag. Connectivity failure and malformed responses
are classified without returning raw node errors or credentials. No preflight
action attempts synchronization, reconnecting peers, loading wallets or repairs.

Runtime clients allow only explicitly listed read RPCs. Signing/funding RPCs,
wallet loading, mining, broadcasting and Lightning POST/payment operations are
denied before network access. These denials apply even if synchronization later
recovers. Pure offline builders remain component code and are not exposed by
HTTP or wired into this process. The reverse-swap creation route remains 503;
`ENABLE_LIVE_SWAPS=true` still prevents startup.

## Access from the host machine

Do not expose the HTTP listener on the host-only network. Use an SSH tunnel:

```bash
ssh -N -L 3001:127.0.0.1:3000 truja@192.168.56.108
```

Open `http://127.0.0.1:3001/` on the host. No password belongs in a command,
environment file, service unit, repository or log.

## Optional systemd template — not installed or enabled

`deploy/swap-engine.service` is a reviewable template, not an active service.
It uses `/usr/bin/node`, the repo-local environment file, read-only access to
existing credential paths, and writable access only to application `data/`.
Confirm the installed Node path, username/group and repository path before use.
`systemd-analyze verify deploy/swap-engine.service` validates the template without
starting or enabling it. Installing into `/etc/systemd/system`, reloading the
service manager, starting/enabling the unit or replacing an existing app process
requires a separate approved action. Do not run a foreground/background app and
the service simultaneously with the same data directory.

## Current VM blockers

Read-only SSH inspection confirmed Core regtest height 0 with IBD true, no loaded
wallet and existing `lqwd-lab` on disk. LND LQWD-LAB reports chain/wallet sync
false, zero peers and one inactive channel. The BTWL height-out-of-range condition
is unresolved. Do not infer its precise cause from these symptoms alone, and do
not fix it by mining, resetting datadirs or reopening channels. No usable
confirmed or mempool transaction is guaranteed to exist for confirmation-lookup
acceptance testing. The application must remain in simulation/read-only mode.

## Deployment verification — 2026-11-15

Deployed the reviewed source into the initially clean existing VM repository,
without Git merge/push, node configuration changes or service installation. Native Node.js
v22.22.1 ran `npm ci`, `npm run build` and the automated tests (49/49 passed). The systemd
template passed `systemd-analyze verify` with exit 0; it was not installed,
started or enabled. A standalone application process was started with
`/usr/bin/node --env-file=.env.regtest --import tsx src/main.ts` (before the
example-split this regtest deployment used the file named `.env.simulation`).
Its PID and output are recorded in `data/simulation.pid` and
`data/simulation.log`; do not start a second process against the same store.

At endpoint verification, `/`, `/app.css`, `/app.js` and `/v1/health` returned
200; a 50,000-sat quote returned 201 with a 50,750-sat invoice and 49,500-sat
net estimate; `/v1/swaps/reverse` returned the expected disabled 503.
`/v1/preflight` and `/v1/liquidity` returned 503.

The node state changed during deployment without an action by this application:
the earlier Core RPC/LND gRPC reads succeeded, but later Core RPC port 18443,
LND REST port 8080 and LND gRPC port 10009 were not listening. The Core cookie
was absent, although a bitcoind process remained present. LND's existing log
showed repeated block-height-out-of-range errors followed by shutdown complete
at 22:13:03 VM time. No node restart or repair was attempted. Thus live Node
RPC/REST compatibility remains unverified; diagnostic failure reporting and
simulation endpoints were verified. Sanitized HTTP evidence is saved inside
the VM repository at `data/deployment-verification.json`.
