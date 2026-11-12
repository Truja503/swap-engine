# Protocol invariants and architecture

## Atomicity model

The user samples a uniformly random 32-byte preimage `p` and controls a claim
private key. Only `SHA256(p)` and the compressed claim public key cross the
initial API boundary. The provider controls a different refund key. The provider
creates a hold invoice for that exact hash; it must not know `p` before the claim.

The P2WSH witness script is:

```text
OP_IF
  OP_SIZE 32 OP_EQUALVERIFY
  OP_SHA256 <payment_hash> OP_EQUALVERIFY
  <user_claim_pubkey> OP_CHECKSIG
OP_ELSE
  <absolute_refund_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
  <provider_refund_pubkey> OP_CHECKSIG
OP_ENDIF
```

Claim witness: `[signature, preimage, 01, witnessScript]`.
Refund witness: `[signature, empty, witnessScript]`.
Signatures use SegWit v0 and SIGHASH_ALL. A refund uses transaction version 2,
`nLockTime=refundHeight` and sequence `0xfffffffe`. It is eligible for the next
block when the current tip is at least refundHeight. The claim has no timelock;
after timeout the claim and refund branches can race. A client must claim well
before the deadline. These are standard Bitcoin primitives via bitcoinjs-lib,
ecpair and tiny-secp256k1; the application implements no custom cryptography.

## Required invariants

1. Enforce regtest at both nodes before live work. Never modify channels or node configuration.
2. Never generate or request the user's preimage on the service. Never log secrets.
3. Validate compressed public keys, distinct claim/refund keys, 32-byte hashes,
   and absolute block-height timelocks below 500,000,000.
4. Swap creation reserves monetary liquidity atomically. An idempotency key binds
   to immutable quote/hash/key/timeout parameters. A hash cannot identify two swaps.
5. Fund only an `ACCEPTED` invoice of the precise amount and hash. Sum accepted
   HTLC amounts exactly in millisatoshis, and check every accepted part's expiry.
6. The minimum incoming HTLC expiration must be at least refundHeight + 40 blocks.
   The on-chain refund starts 20–40 blocks after the tip at swap creation; funding
   stops if fewer than 10 blocks remain. Recheck after PSBT preparation.
7. Persist a write-ahead action intent before every irreversible action; persist
   the exact signed funding hex/outpoint before broadcasting. Validate the actual
   funding output script/value/txid. A lost response is not a failed transaction.
8. Do not settle from an untrusted callback or a caller-supplied preimage. Require
   consensus-confirmed claim evidence, match its input to the exact lockup outpoint,
   match its witness script, and verify SHA-256 before calling LND.
9. RPC success does not imply settlement. Observe `SETTLED`, then independently
   recheck active-chain claim confirmation before marking completion.
10. Never release funded/uncertain reservations as expired or failed. Refund
    completion requires a consensus-confirmed refund spend and invoice reconciliation.
11. Restart must not repeat funding/invoice creation blindly. This milestone stops
    uncertain and funded in-flight swaps in `MANUAL_REVIEW`.

The coordinator enforces these locally where evidence is available. The live
observer and full recovery are missing, so these invariants are **not a claim of
live atomicity** and the public funding path is disabled.

## Boundaries and storage

`SwapManager` validates quotes, enforces creation idempotency, and reserves funds.
`SwapStateMachine` rejects illegal transitions and records a history.
`SwapCoordinator` serializes external workflows and persists action intents.
`SwapPorts.confirmed` must return an active-chain consensus-accepted transaction;
it is not implemented by a production observer. Tests inject fake evidence.

`Store` uses an exclusive single-process lock file, copy-on-write transactions,
file fsync, atomic replacement, and POSIX directory fsync. On a replacement/fsync
failure it refuses subsequent reads/writes until restart. State and locks belong
in the ignored `data/` directory. They contain payment/transaction metadata and
must be backed up privately. Atomic replacement is validated locally on Windows;
power-loss guarantees require the VM's filesystem and storage to honor fsync.

There is one coordinator queue per instance. A deployment must create exactly one
coordinator with one store; multiple coordinator instances over one store are not
supported. Monetary reservations persist across process restarts; Core input locks
and private-key storage still need durable external reconciliation.

## Completion and recovery

Terminal states are COMPLETED, EXPIRED, REFUNDED and FAILED. MANUAL_REVIEW is a
nonterminal stop retaining reservations. Pending action intents distinguish remote
uncertainty from the last observed state. Recovery deliberately does not automatically
clear an intent or settle/refund funds. No mutation endpoint can bypass it.

The 40-block Lightning safety margin is a lab parameter, not a production safety
analysis. Block production on regtest is operator-controlled; mining a large batch
can consume all safety margins instantly. A held invoice's wall-clock expiry does
not replace the per-HTLC absolute CLTV checks.

## Primary API references consulted

- [LND AddHoldInvoice](https://lightning.engineering/api-docs/api/lnd/invoices/add-hold-invoice/)
- [LND SubscribeSingleInvoice](https://lightning.engineering/api-docs/api/lnd/invoices/subscribe-single-invoice/index.html)
- [LND SettleInvoice](https://lightning.engineering/api-docs/api/lnd/invoices/settle-invoice/)
- [Bitcoin Core PSBT funding](https://bitcoincore.org/en/doc/0.19.0/rpc/wallet/walletcreatefundedpsbt/)

The Core reference is historical; fee_rate behavior must be checked against the
VM's installed Core version during the pending live adapter tests.
