# Sourced under the lifecycle lock after chain and operator wallet validation.
bootstrap_funding() {
  local prefix=ark-lab-operator-bootstrap journal="$state/operator-funding"
  local history legacy count i slot file match expected address txid balance unconfirmed=0
  [[ ! -L "$journal" ]] || fail "unsafe operator funding journal"
  mkdir -p -- "$journal"
  [[ -O "$journal" && $(stat -c '%a' "$journal") == 700 ]] || fail "unsafe operator funding journal"

  history=$(miner_history '.[] | select((.comment // "") | startswith($key))' "$prefix") ||
    fail "cannot reconcile operator funding history"
  history=$(jq -cse --arg prefix "$prefix" '
    select(all(.[];
      (.comment == $prefix or (.comment | test("^" + $prefix + "-(0[1-9]|1[0-9]|2[01])$"))) and
      .category == "send" and .amount == -1 and .abandoned == false and
      (.txid | test("^[0-9a-f]{64}$")) and (.address | startswith("bcrt1")) and
      (.confirmations | type == "number" and . >= 0))) |
    select(length == (map(.txid) | unique | length) and length <= 21)
  ' <<<"$history") || fail "ambiguous operator funding in miner wallet; no funds sent"
  legacy=$(jq -er --arg prefix "$prefix" '[.[] | select(.comment == $prefix)] | length' <<<"$history")
  count=$(jq -er 'length' <<<"$history")

  # Legacy deposits occupy the first slots. All new deposits require both a
  # durable pre-send intent and one Core transaction with the exact slot tag.
  # Validate EVERY slot and any unconfirmed transaction before issuing funds.
  for ((i=1; i<=21; i++)); do
    printf -v slot '%02d' "$i"
    file="$journal/$slot"
    match=$(jq -ce --arg comment "$prefix-$slot" '[.[] | select(.comment == $comment)]' <<<"$history")
    if (( i <= legacy || i > count )); then
      [[ ! -e "$file" && ! -L "$file" && "$match" == '[]' ]] ||
        fail "unresolved operator funding slot $slot; reconcile original, never re-fund"
      continue
    fi
    [[ -f "$file" && ! -L "$file" && -O "$file" && $(stat -c '%a' "$file") == 600 ]] ||
      fail "missing or unsafe operator funding intent for slot $slot"
    expected=$(cat -- "$file")
    [[ "$expected" == bcrt1* ]] && jq -e --arg address "$expected" \
      'length == 1 and .[0].address == $address' <<<"$match" >/dev/null ||
      fail "ambiguous operator funding slot $slot; no funds sent"
  done
  while IFS= read -r txid; do
    [[ -n "$txid" ]] || continue
    core getmempoolentry "$txid" >/dev/null ||
      fail "original operator funding is not in the active chain or mempool"
    unconfirmed=1
  done <<<"$(jq -r '.[] | select(.confirmations == 0) | .txid' <<<"$history")"

  if (( count == 0 )); then
    balance=$(wallet_total) || fail "cannot establish operator wallet balance"
    jq -e 'type == "number" and . >= 0' <<<"$balance" >/dev/null ||
      fail "cannot establish operator wallet balance"
    if jq -e '. > 0' <<<"$balance" >/dev/null; then return; fi
    # Zero operator balance alone is not evidence of a fresh miner. If there
    # is any prior outgoing transaction without a recognized bootstrap tag,
    # stop instead of guessing that bootstrap was never attempted.
    local sent
    sent=$(miner_history '.[] | select(.category == "send") | .txid' "$prefix") ||
      fail "cannot establish fresh operator funding history"
    [[ -z "$sent" ]] || fail "operator bootstrap history is ambiguous; no funds sent"
  fi
  if (( count < 21 )); then
    address=$(admin_get wallet/address | jq -er '.address | select(startswith("bcrt1"))') ||
      fail "cannot obtain regtest operator address"
    core validateaddress "$address" | jq -e '.isvalid == true' >/dev/null ||
      fail "invalid operator funding address"
    for ((i=count+1; i<=21; i++)); do
      printf -v slot '%02d' "$i"
      file="$journal/$slot"
      (set -o noclobber; printf '%s\n' "$address" > "$file") && sync -f "$file" ||
        fail "cannot durably reserve operator funding slot $slot; no send attempted"
      txid=$(miner sendtoaddress "$address" 1 "$prefix-$slot") ||
        fail "uncertain operator funding slot $slot; reconcile original, never re-fund"
      [[ "$txid" =~ ^[0-9a-f]{64}$ ]] ||
        fail "ambiguous operator funding slot $slot; reconcile original, never re-fund"
      unconfirmed=1
    done
  fi
  if (( unconfirmed == 1 )); then mine 1; fi
}
