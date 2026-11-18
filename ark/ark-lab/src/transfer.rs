use crate::{LabError, Result, SdkClient};
use ark_core::{
    contract::SpendPathKind,
    send::{SendReceiver, VtxoInput},
};
use bitcoin::{Amount, OutPoint, Txid};
use serde_json::{json, Value};

pub(crate) async fn submit(
    alice: &SdkClient,
    bob: &SdkClient,
    input: OutPoint,
    sats: u64,
) -> Result<Value> {
    let pending = alice
        .list_pending_offchain_txs()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    if !pending.is_empty() {
        return Err(LabError::SubmissionUncertain);
    }
    let info = alice
        .server_info()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    let list = alice
        .list_vtxos()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    let entry = list
        .spendable_offchain()
        .find(|entry| entry.vtxo().outpoint == input)
        .ok_or(LabError::InputNotSpendable)?;
    if !entry.vtxo().assets.is_empty() {
        return Err(LabError::UnsupportedAsset);
    }
    let amount = Amount::from_sat(sats);
    let minimum = info.dust.max(info.vtxo_min_amount.unwrap_or_default());
    let change = entry.vtxo().amount.checked_sub(amount);
    if amount < minimum
        || info.vtxo_max_amount.is_some_and(|max| amount > max)
        || change.is_none_or(|value| value != Amount::ZERO && value < minimum)
    {
        return Err(LabError::InvalidAmount);
    }
    let selection = entry
        .spend_selection(SpendPathKind::Forfeit)
        .map_err(|_| LabError::InputNotSpendable)?;
    let (address, _) = bob
        .get_offchain_address()
        .await
        .map_err(|_| LabError::Sdk("Bob Ark address"))?;
    let txid = alice
        .submit_offchain_tx(
            vec![VtxoInput::new_with_spend_selection(
                selection,
                entry.tapscripts(),
                entry.script_pubkey(),
                entry.vtxo().amount,
                input,
                vec![],
            )],
            address,
            amount,
        )
        .await
        .map_err(|_| LabError::SubmissionUncertain)?;
    Ok(
        json!({"ark_txid":txid,"input":input.to_string(),"amount_sats":sats,
              "recipient":address.to_string(),"state":"submitted_not_finalized"}),
    )
}

pub(crate) async fn pending(client: &SdkClient) -> Result<Value> {
    let transactions = client
        .list_pending_offchain_txs()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    let ids: Vec<_> = transactions.iter().map(|tx| tx.ark_txid).collect();
    Ok(json!({"pending_ark_txids":ids}))
}

pub(crate) async fn finalize(client: &SdkClient, txid: Txid) -> Result<Value> {
    let transactions = client
        .list_pending_offchain_txs()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    let is_pending = transactions.iter().any(|tx| tx.ark_txid == txid);
    if is_pending {
        client
            .finalize_pending_offchain_tx(txid)
            .await
            .map_err(|_| LabError::SubmissionUncertain)?;
    }
    Ok(json!({"ark_txid":txid,"finalize_attempted":is_pending}))
}

// Exercise the SDK's normal selection guard only on an input the real
// index already confirms was consumed. Never send a replay to the operator.
pub(crate) async fn verify_spent(
    alice: &SdkClient,
    bob: &SdkClient,
    input: OutPoint,
    sats: u64,
) -> Result<Value> {
    let list = alice
        .list_vtxos()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    if !list
        .all()
        .any(|entry| entry.vtxo().outpoint == input && entry.vtxo().is_spent)
    {
        return Err(LabError::Sdk("expected already-consumed replay input"));
    }
    let (address, _) = bob
        .get_offchain_address()
        .await
        .map_err(|_| LabError::Sdk("Bob Ark address"))?;
    match alice
        .send_selection(
            &[input],
            vec![SendReceiver::bitcoin(address, Amount::from_sat(sats))],
        )
        .await
    {
        Err(error)
            if error
                .to_string()
                .contains("failed to resolve selected send inputs") =>
        {
            Ok(json!({"input":input.to_string(),"rejected":true}))
        }
        _ => Err(LabError::Sdk("expected SDK selection rejection")),
    }
}
