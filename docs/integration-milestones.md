# Regtest integration milestones

## Ownership and sequence

1. Readiness and read-only consensus evidence — Codex owns VM checks and RPC
   verification. Restore only existing processes/wallets with explicit approval.
2. Reverse-swap safety — Codex owns client custody, signatures, exact-outpoint
   observation, confirmation/reorg checks, monetary/invoice invariants and recovery.
3. Presentation — Qwen owns only `src/ui/swapStatus.ts` and
   `tests/swapStatus.test.ts` in its separate worktree. Contract is a pure
   `describeSwapState(state)` returning `{ label, tone, terminal }`; no network,
   fees, keys, protocol changes or shared-file edits. Codex integrates after review.
4. Controlled reverse test — blocked until node readiness, persistent key custody,
   production action/reconciliation adapters and explicit transaction approval.
5. Forward direction — separate design/implementation after reverse acceptance.
   The web interface must continue to label it NOT IMPLEMENTED meanwhile.

## Implemented in this milestone

- `SpendEvidence` independently verifies exact prevout, funding script/value,
  canonical witness branch, SHA256 secret, SIGHASH_ALL ECDSA signature, key
  separation and refund CLTV. It supplements trusted Core consensus checks; it
  is not a general Bitcoin script interpreter.
- `BitcoinSpendObserver` performs bounded active-chain block scans starting at
  a caller-verified funding height. It persists public checkpoints atomically,
  resumes after reopen, revalidates cached spends, rescans after disconnects,
  and refuses checkpoint advancement on changed tips or failed evidence. It does
  not turn mempool presence or a bounded negative search into confirmed evidence.
- Coordinator actions require an explicit regtest port assertion. Claim evidence
  is checked again immediately before settlement; final invoice state and chain
  evidence are checked before completion. Cancellation intents are durable.
  Confirmed refund tracking requires cancellation observation and fresh chain
  evidence. A read-only audit can move previously finalized swaps back to manual
  review if evidence disappears, retaining reservations.
- Invoice integer parsing, hashes, accepted millisatoshi totals and per-HTLC
  deadlines are checked without floating-point conversions or NaN bypasses.
- `ClaimWallet` generates the secret/claim key only in a client process; private
  fields are excluded from JSON. It signs only its own contract and supports
  best-effort memory clearing. It is not a durable client backup or provider key
  store; JavaScript cannot guarantee elimination of all memory copies.
- Qwen's reviewed status helper is used by swap status responses. Only COMPLETED
  is presented as success. Lightning routing fees are explicitly unknown and
  excluded from quoted estimated cost rather than displayed as zero.
- Preflight distinguishes locked LND wallets, unavailable REST and missing Core
  ZMQ publishers expected by the existing LND configurations.
- `scripts/verify-readonly.ts` tests an existing confirmed transaction, unknown
  rejection, any existing mempool sample and optional historical exact-spend
  discovery without generating transactions. Run on the VM with
  `node --env-file=.env.simulation --import tsx scripts/verify-readonly.ts --find-spend`.

The HTTP creation gate and read-only runtime remain intact. No new live action
adapter is wired into the service. Observation and audits require explicit
invocation; this is not yet an autonomous production watcher/recovery service.
Reorg detection between RPC observations is not an atomic chain snapshot.

## Verification and remaining work

Earlier milestone: local build and 102/102 tests passed. Offline tests cover signatures, forged/malformed
witnesses, premature refunds, exact output selection, network guards, lost
settlement/cancellation outcomes, actual store reopen, interrupted scans,
same-height reorgs, final-state evidence loss and reservation retention. Store
commits detach adapter-owned objects before asynchronous writes so caller
mutation cannot silently diverge in-memory state from its durable snapshot.
These are not live consensus or Lightning settlement proofs.

Read-only Core verification passed at height 128, tip
`50520329c5e32a19f4b3bc4bbc47dd61a1e7774ffae9520407e85923ddfb9676`.
Confirmed txid `312a59b6f571fb49a6349a84ce689318eb3073387dc57000b0661f86f0d53e79d`
returned one confirmation; an unknown txid was rejected with RPC -5. The mempool
was empty, so no live unconfirmed sample was manufactured. `txindex` was synced.

The exact-outpoint observer also passed against actual Core history: outpoint
`bcd16e1bfa03a65a7013a88a1f0de6e85dde8f530ddd5dd7385b929204522e64:1`
was spent by `ecdb39ab0a5a0fb71fc5b72e4544c0f894a99a68bd94883ec5947819a90f085f`,
confirmed in block `446b69bef2501e7c1cb546f391437c4ff965f270d4d3d78e57df03c5a19a1160`
with six confirmations. This is an existing historical channel-funding spend,
not a newly executed swap or proof of an HTLC claim.

The existing wallet was loaded and existing LND processes started/unlocked with
user approval. Both initially exited because Core had no ZMQ publishers. The
user then approved a clean Core restart with loopback ZMQ flags and LND recovery.
Core retained the exact height/tip and its publishers became available. The first
restart attempt failed before a new log; after verifying the original PID had
exited, the same approved command succeeded. No configuration file was edited.
No mining, new payment, funding transaction or channel creation was authorized
or performed as part of that recovery.

Still required before a funded reverse test: durable provider refund-key custody
and client backups; independently decoded invoice/network/hash/amount checks;
production adapters and exact Core input/key/action reconciliation; invoice
subscription reconnect/deadline scheduling; approved live signing, funding,
claim/refund, restart and reorg scenarios. Automatic refunds are not implemented
by merely observing an existing signed refund. Forward swaps remain pending.

## Delegation evidence and measurement

Orca run `run_0a14eefe267d`, implementation task `task_4a6b28dbc590`, dispatch
`ctx_1491ad21f6b1`. Acknowledgment body `msg_37a2244fc657` identified the owned
files and contract, but was incorrectly submitted as worker_done and rejected.
The corrected completion `msg_a1584ea9ae65` contained both IDs and settled the
implementation task. Codex inspected both files, passed their three focused tests
and the worker build, then tested the integrated repository. No implementation
rework was needed; reporting metadata needed correction.

One low-risk implementation task yielded two accepted files. Orca additionally
created reporting-only follow-up `ctx_68159272e9c0`; proper completion
`msg_d05bba8ca701` settled that task without source changes. Its session and
history are preserved without repetitive polling. Token counts, model costs and
reliable Qwen execution duration were not exposed; no savings or counts are
invented. Codex retains security-critical code ownership and final verification.

## Latest approved readiness check

Core was rechecked at height 129 with initial block download false. Both LND
REST endpoints remained reachable with one peer and one active channel each,
but chain and wallet sync flags had become false. The tip was 10,921 seconds old.
Under the user's approval to mine necessary regtest blocks, exactly one further
block was mined to the existing owned lqwd-lab address. No node restart or
configuration change was needed. Core and both LND nodes then reported height
130; both LND sync flags became true. New block:
`27abbfd8909abc33f582d7ddc4148ca21781fe79fc32aa542cea14573c861e69`.

The earlier invoice-only milestone created swap
`4c23a380-0518-4979-9a5b-1bb263fe58fd`. The latest provider REST lookup reports
that invoice CANCELED with zero paid sats. The saved swap has no client-payment
or funding intent. It must not be paid or treated as a completed swap. A fresh
reviewed invoice/contract is needed; the controlled execution CLI remains to be
wired and independently verified before an actual funded reverse test.

The local build passes. Latest automated run: 125 tests, 123 passed, zero failed,
two POSIX custody tests skipped on Windows. These latest additions have not yet
been deployed or retested on Ubuntu. LND invoice parsing normalizes the actual
REST InvoiceHTLC `expiry_height` field; regression tests distinguish exact held
amounts from settled paid amounts. The controlled runner now rejects canceled,
substituted or already-paid invoices before payment intent or payer startup.
Public HTTP swap execution remains disabled. No swap payment, funding broadcast,
claim broadcast or settlement was performed during this readiness check.
