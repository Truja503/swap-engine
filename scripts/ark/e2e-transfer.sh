# Uses a new CLI process for every call, including submit/finalize and restart.
expect_lab_error() {
  local pattern=$1 output rc=0
  shift
  output=$(lab "$@" 2>&1) || rc=$?
  [[ "$rc" == 1 && "$output" == "$pattern"* ]] ||
    fail "expected $pattern for $1 (exit $rc)"
}

transfer() {
  local before result pending after rows alice_spent alice_change bob_vtxo replay
  before=$(lab balance)
  jq -e '.wallets | .alice.confirmed_sats == 200000 and .bob.total_sats == 0' <<<"$before" >/dev/null
  expect_lab_error ArkInvalidAmount transfer-submit "$alice_input" 500000
  result=$(lab transfer-submit "$alice_input" 75000)
  ark_txid=$(jq -er '.wallets.alice.ark_txid' <<<"$result")
  printf '%s\n' "$ark_txid" > "$run_dir/ark-txid"
  pending=$(lab pending)
  jq -e --arg tx "$ark_txid" '.wallets.alice.pending_ark_txids == [$tx]' <<<"$pending" >/dev/null
  lab transfer-finalize "$ark_txid" | jq -e '.wallets.alice.finalize_attempted == true' >/dev/null
  lab pending | jq -e '.wallets.alice.pending_ark_txids == []' >/dev/null
  lab transfer-finalize "$ark_txid" | jq -e '.wallets.alice.finalize_attempted == false' >/dev/null
  replay=$(lab verify-spent "$alice_input" 75000)
  jq -e '.wallets.alice.rejected == true' <<<"$replay" >/dev/null
  after=$(lab balance)
  jq -e '.wallets | .alice.pre_confirmed_sats == 125000 and .bob.pre_confirmed_sats == 75000' <<<"$after" >/dev/null
  rows=$(lab list-vtxos)
  alice_spent=$(jq -ce --arg input "$alice_input" --arg tx "$ark_txid" \
    '.wallets.alice[] | select(.outpoint == $input and .is_spent and .ark_txid == $tx)' <<<"$rows")
  alice_change=$(jq -ce --arg tx "$ark_txid" '
    .wallets.alice[] | select((.outpoint | startswith($tx + ":")) and .amount_sats == 125000 and
      .origin == "ark_transfer" and (.is_spent | not))' <<<"$rows")
  bob_vtxo=$(jq -ce --arg tx "$ark_txid" '
    .wallets.bob[] | select((.outpoint | startswith($tx + ":")) and .amount_sats == 75000 and
      .origin == "ark_transfer" and (.is_spent | not))' <<<"$rows")
  bob_input=$(jq -er '.outpoint' <<<"$bob_vtxo")
  [[ "$(lab balance)" == "$after" && "$(lab list-vtxos)" == "$rows" ]] || fail "restart snapshot changed"
  jq -n --arg tx "$ark_txid" --argjson before "$before" --argjson after "$after" \
    --argjson input "$alice_spent" --argjson change "$alice_change" --argjson received "$bob_vtxo" '
    {network:"regtest",protocol:"Ark (not Lightning)",ark_txid:$tx,finality:"finalized preconfirmation, not a Bitcoin confirmation",
      before:$before.wallets, after:$after.wallets, $input, $change, $received,
      fee_sats:(([$before.wallets[].total_sats] | add) - ([$after.wallets[].total_sats] | add)),
      interrupted_between_submit_finalize:"PASSED",spent_selection_replay:"PASSED",
      finalize_retry:"PASSED",client_restart:"PASSED",insufficient_input:"PASSED"}' > "$evidence/transfer.json"
}
