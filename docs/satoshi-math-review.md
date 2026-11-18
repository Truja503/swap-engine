# Satoshi accounting review — accepted and integrated

## Final outcome

Qwen reported `worker_done` with outcome `succeeded` through message
`msg_700afa5fc970` for task `task_1d94b8854925`, dispatch
`ctx_c4128b1b674a`, run `run_0a14eefe267d`.

The supervisor inspected the actual revised files, independently passed the
worker's TypeScript build and 46/46 tests, and passed 319 additional accounting
assertions covering all helper entry points, malformed monetary values, invoice
consistency and safe-integer boundaries against bigint calculations. Previously
reported correctness defects are resolved. All helpers validate monetary quote
fields; total user cost is service fee plus claim fee, excluding provider reserve.

The user requested inclusion in this repository. Copied Qwen's
`src/utils/satoshiMath.ts` and `tests/satoshiMath.test.ts` into the supervisor
workspace as uncommitted files, preserving their implementation and normalizing
only line endings/trailing whitespace. Added supervisor regression coverage in
`tests/satoshiMath.integration.test.ts`, including real `POST /v1/quotes` responses.
The combined workspace passes `npm run build` and **72/72 tests**.

The utility consumes quote values; backend fee policy, frontend behavior,
cryptography and execution gates are unchanged by this integration. It is pure
accounting, not invoice validation or proof a swap can execute. The worker's
worktree remains intact. No Git merge, commit, push or VM deployment was performed
for these accounting files. Earlier review records follow for context only.

Reviewed Qwen source SHA-256 before whitespace normalization:

- Utility: `f1bf48c30e513c51b10ef831a4fac69650e283f73be9dd388e89595e79f2b188`
- Tests: `844d8830b47bceaabc100d0aedab4ea910b8af6c2e263cbb118d8546a061de41`

## First independent review (historical)

The user authorized inspecting the retained worktree and continuing Qwen's
implementation. Independent review found only the two expected untracked files,
`src/utils/satoshiMath.ts` and `tests/satoshiMath.test.ts`. The TypeScript build
and 37/37 tests passed, but additional runtime probes demonstrated that the
helpers accept negative fees, excessive claim fees, NaN values, unsafe fee sums
and inconsistent invoices. The monetary validator is not applied to quote fee
fields. `calculateUserCost` still returns service fee only (750), rather than
total invoice minus net output (1,250). These are blocking correctness defects.

Corrections and required boundary regression tests were sent through the existing
dispatch. No source changes have been accepted or copied into the supervisor
workspace. After Qwen revises its own files, independently validate them again,
then copy only reviewed utility/test files as uncommitted integration changes;
do not Git merge, commit or push. The VM deployment and all live gates remain
separate and unchanged. The earlier preservation/delivery-blocker record below
is retained as history; it is not evidence of the current code passing review.

## Earlier delivery-blocker record

Run: `run_0a14eefe267d`; task: `task_1d94b8854925`;
dispatch: `ctx_c4128b1b674a`.

The retained OpenCode/Qwen session has not demonstrated receipt or execution of
supervised instructions. Last observed state was ready / input_accepted / live /
idle, with terminal fallback `session_not_reported` displaying an Explore child
view. Correction message `msg_2dfe5f49bb68` was recorded by Orca, but no worker
acknowledgment or completion was verified. This is an orchestration blocker, not
a successful worker completion. Polling is stopped; retain the session, worktree,
uncommitted changes and orchestration history. Do not enter or modify that
worktree while its session remains unresolved.

Orca refused the coordinator's attempt to set the task to `blocked` with
`task_not_startable`: an active dispatch prevents that transition. Request ID:
`a1a60117-f23f-4f2e-bfa1-5477d8af9e07`. The active dispatch is preserved; no stop,
abandonment, reset or completion was issued. This note records the blocker
without claiming that Orca's task status changed.

## Defects found in the previously inspected implementation

- `calculateNetReceivedSats` returns principal unchanged. A 50,000-sat principal
  minus a 500-sat estimated claim fee must produce **49,500 sats** on-chain.
- `calculateNetSatsLost` must use invoice minus net output:
  **50,750 - 49,500 = 1,250 sats** net user cost.
- The 1,000-sat funding reserve is provider-side. Do not add it to user losses.
- Validate every fee field and monetary operand as a nonnegative safe integer;
  reject NaN, infinities, fractions, negative values, excessive claim fees,
  inconsistent invoice totals and unsafe arithmetic results. Cover zero fees,
  permitted amount boundaries and overflow boundaries.
- Correct tests expecting 50,000 received or 2,250 lost. Include changed API fee
  values to ensure helpers consume quote values rather than hard-code policy.
- `calculateMaxLoss` currently has a misleading, unjustified accounting contract
  and returns 52,250 for this example. Define a supported meaning or remove it;
  do not preserve tests that endorse double-counting.

No revised implementation, worker test result or successful review loop has been
verified. This note is stored in the supervisor's UI workspace only.
