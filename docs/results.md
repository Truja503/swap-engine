# Actual verification record — November 12, 2026

## Environment

The provided workspace is an initially empty Windows PowerShell directory, not
the Ubuntu VM in the task. Node.js 24.19.0, npm 11.17.0 and Git are available.
Bitcoin Core CLI, lncli and GitHub CLI are absent. TCP probes to local ports
18443 and 10009 returned false. WSL enumeration returned
`Wsl/E_ACCESSDENIED`. No attempt was made to reset or modify either node.

`npm run inspect` exited 1: bitcoin_regtest, lnd_regtest_synced, wallet_liquidity
and incoming_liquidity all failed. The configured `/home/truja` files are absent
in this Windows workspace. This is not evidence about the separate VM's health.

The connected GitHub integration identifies account `Truja503`. Available connector
tools do not include repository creation or source pushes; `gh` is not installed.
No remote publication succeeded or is implied by the local commit.

## Commands and results

| Command | Actual result |
| --- | --- |
| `npm install --no-audit --no-fund` | Installed 25 packages with permitted network access; lockfile generated |
| `npm run build` | Passed strict TypeScript checking |
| `npm test` | 27 tests passed, 0 failed, 0 skipped |
| `npm run demo` | Passed the one explicitly offline 50,000-sat test |
| `npm run inspect` | Failed all four live node checks; expected environment blocker |
| `npm run secrets:check` | 35 indexed files, zero heuristic findings before initial commit |

The final HTTP-inclusive test execution required loopback network access outside
the restricted network sandbox. An earlier sandbox run passed 26 tests and failed
the HTTP test with EACCES connecting to its own server. Earlier persistence tests
also hit EPERM replacing files in redirected temporary storage; moving generated
fixtures to the writable ignored workspace data/tests directory resolved that
restriction without weakening atomic replacement.

The offline flow uses a real signed 50,000-sat contract transaction with randomly
generated test keys and fake consensus/invoice adapters. It proves local
cryptographic linkage and coordinator behavior under the port contract. It does
not prove consensus acceptance, LND compatibility or actual atomic settlement.

## Phase status

| Phase | Status and evidence |
| --- | --- |
| A — inspect environment | Local inspection completed; Ubuntu live nodes blocked |
| B — hold invoices | REST client and acceptance/settlement logic implemented; offline checks pass; no live hold invoice |
| C — HTLC/claim/refund | Real transaction construction/signature verification passes; PSBT RPC adapter implemented; no live consensus execution |
| D — coordinator | Persistent state/intents and offline complete path implemented; no live adapter/observer wiring |
| E — actual 50,000-sat reverse swap | **Not executed**; explicit live gate remains |
| F — failures/recovery | Offline duplicate, liquidity, timeout, failed-action, restart and API tests pass; automatic recovery/refund integration pending |
| G — documentation | README, invariants, limitations, results and VM acceptance runbook included |

## Publication and secret review

`.gitignore` excludes runtime state, environment files except the credential-free
example, keys, cookies, macaroons, wallets, logs and dependencies. A tracked-content
and history heuristic scanner is provided as `npm run secrets:check`. No real
credentials were supplied to the implementation or tests. See README for private
publication commands. No open-source license was chosen.
