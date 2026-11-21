#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
source "$root/scripts/ark/bootstrap-funding.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
tag=ark-lab-operator-bootstrap
destination=bcrt1-synthetic-address
fresh_case() {
  mode=$1
  state="$scratch/$mode"
  mkdir -- "$state"
}

miner() {
  case "$1" in
    listtransactions)
      if [[ "$4" == 0 ]]; then
        # Simulate 1000 newer records, none of them operator funding.
        jq -nc '[range(1000) | {category:"generate"}]'
      elif [[ "$mode" == rpc_failure ]]; then
        return 17
      else
        jq -nc --arg prefix "$tag" --arg address "$destination" --arg mode "$mode" \
          --argjson slots "$([[ "$mode" == full || "$mode" == conflicted ]] && echo 21 || echo 20)" '
          [range($slots) | {
            comment:$prefix, category:"send", amount:-1, abandoned:false, $address,
            confirmations:(if $mode == "conflicted" and . == 0 then -1 else 2 end),
            txid: (("0" * 62) + (. + 10 | tostring))
           }] + (if $mode == "recovered" then [{
            comment:($prefix + "-21"), category:"send", amount:-1, abandoned:false, $address,
            confirmations:1, txid:("1" * 64)
           }] else [] end)'
      fi
      ;;
    sendtoaddress)
      [[ "$3" == 1 && "$4" == "$tag-21" && $(cat "$state/operator-funding/21") == "$2" ]] ||
        fail "attempt was not reserved before send"
      printf '%s\n' "$4" >> "$state/send-calls"
      # The caller did not receive a TXID. The next run must not send again.
      return 28
      ;;
    *) fail "unexpected synthetic miner RPC $1" ;;
  esac
}
admin_get() { jq -nc --arg address "$destination" '{$address}'; }
core() {
  [[ "$1" == validateaddress && "$2" == "$destination" ]] || fail "unexpected synthetic Core RPC $1"
  printf '%s\n' '{"isvalid":true}'
}
mine() { fail "unexpected mining in synthetic bootstrap test"; }

expect_failure() {
  local error=$1 rc=0
  (bootstrap_funding) > "$state/stdout" 2> "$state/stderr" || rc=$?
  [[ "$rc" == 1 ]] && grep -Fq -- "$error" "$state/stderr" ||
    fail "expected funding failure: $error (exit $rc)"
}

fresh_case full
bootstrap_funding
[[ ! -e "$state/send-calls" ]] || fail "missed funding on an older wallet page"
fresh_case rpc_failure
expect_failure "cannot reconcile operator funding history"
[[ ! -e "$state/send-calls" ]] || fail "sent despite RPC failure"
fresh_case conflicted
expect_failure "ambiguous operator funding in miner wallet"
[[ ! -e "$state/send-calls" ]] || fail "sent despite a conflicted original"

fresh_case zero_float
(
  miner() {
    case "$1" in
      listtransactions) printf '[]\n' ;;
      sendtoaddress) return 28 ;;
      *) fail "unexpected miner RPC $1" ;;
    esac
  }
  wallet_total() { printf '0.0\n'; }
  expect_failure "uncertain operator funding slot 01"
  fresh_case negative_balance
  wallet_total() { printf '%s\n' '-1'; }
  expect_failure "cannot establish operator wallet balance"
)
fresh_case lost_reply
expect_failure "uncertain operator funding slot 21"
expect_failure "unresolved operator funding slot 21"
mode=recovered
bootstrap_funding
[[ $(cat "$state/send-calls") == "$tag-21" ]] || fail "funding was attempted more than once"

core() {
  [[ "$1" == gettxout ]] || fail "unexpected synthetic Core RPC $1"
  printf '%s\n' "$utxo_reply"
  return "$utxo_status"
}
utxo_status=0
for utxo_reply in '' '{}' '{"confirmations":1,"value":0.002} {"confirmations":1,"value":0.002}'; do
  if confirmed_utxo synthetic 0 200000 >/dev/null; then fail "accepted missing or ambiguous gettxout"; fi
done
utxo_reply='{"confirmations":1,"value":0.002}'
confirmed_utxo synthetic 0 200000 >/dev/null
utxo_status=17
rc=0
confirmed_utxo synthetic 0 200000 >/dev/null || rc=$?
[[ "$rc" == 17 ]] || fail "gettxout hid the RPC failure"

printf '%s\n' 'PASS: paginated history, fail-closed bootstrap, lost-ack recovery and strict gettxout'
