use crate::{
    blockchain::RegtestBlockchain, bounded_submission, LabError, Result, SdkClient, ROUND_DEADLINE,
};
use ark_core::server::Info;
use bitcoin::{address::NetworkUnchecked, Address, Amount, Network, OutPoint};
use serde_json::{json, Value};

fn check_cooperative_amounts(vtxo_amount: Amount, amount: Amount, info: &Info) -> Result<()> {
    let min_out = info.dust.max(info.utxo_min_amount.unwrap_or_default());
    let min_change = info.dust.max(info.vtxo_min_amount.unwrap_or_default());
    let change = vtxo_amount.checked_sub(amount);
    if amount < min_out
        || info.utxo_max_amount.is_some_and(|max| amount > max)
        || change.is_none_or(|value| value != Amount::ZERO && value < min_change)
    {
        return Err(LabError::InvalidAmount);
    }
    Ok(())
}

pub(crate) fn checked_address(address: Address<NetworkUnchecked>) -> Result<Address> {
    // Base58 testnet and regtest addresses share version bytes. Require
    // an address with a regtest-specific witness HRP.
    let checked = address
        .require_network(Network::Regtest)
        .map_err(|_| LabError::NetworkMismatch)?;
    if !checked.to_string().starts_with("bcrt1") {
        return Err(LabError::NetworkMismatch);
    }
    Ok(checked)
}

pub(crate) async fn cooperative(
    client: &SdkClient,
    input: OutPoint,
    address: Address<NetworkUnchecked>,
    sats: u64,
) -> Result<Value> {
    let address = checked_address(address)?;
    RegtestBlockchain::new()
        .map_err(|_| LabError::IndexerUnavailable)?
        .require_regtest()
        .await
        .map_err(|_| LabError::IndexerUnavailable)?;
    let info = client
        .server_info()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    let list = client
        .list_vtxos()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    let entry = list
        .all_unspent()
        .find(|entry| entry.vtxo().outpoint == input)
        .ok_or(LabError::InputNotSpendable)?;
    if !entry.vtxo().assets.is_empty() {
        return Err(LabError::UnsupportedAsset);
    }
    let amount = Amount::from_sat(sats);
    check_cooperative_amounts(entry.vtxo().amount, amount, &info)?;
    let mut rng = bitcoin::secp256k1::rand::thread_rng();
    let commitment = bounded_submission(
        ROUND_DEADLINE,
        client.collaborative_redeem_vtxo_selection(
            &mut rng,
            [input].into_iter(),
            address.clone(),
            amount,
        ),
    )
    .await?;
    Ok(
        json!({"input":input.to_string(),"address":address.to_string(),"amount_sats":sats,
              "commitment_txid":commitment,"method":"cooperative"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::{secp256k1::Secp256k1, XOnlyPublicKey};
    use std::time::Duration;

    #[test]
    fn cooperative_exit_requires_regtest_witness_address() {
        let secp = Secp256k1::verification_only();
        let key = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
            .parse::<XOnlyPublicKey>()
            .unwrap();
        for net in [Network::Regtest, Network::Bitcoin, Network::Testnet] {
            let addr = Address::p2tr(&secp, key, None, net);
            assert_eq!(
                checked_address(addr.into_unchecked()).is_ok(),
                net == Network::Regtest
            );
        }
    }

    #[tokio::test]
    async fn simulated_offboard_submission_timeout_is_uncertain() {
        // Simulated stalled SDK response; no Bitcoin or Ark services.
        let error = bounded_submission(
            Duration::ZERO,
            std::future::pending::<std::result::Result<(), ()>>(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, LabError::SubmissionUncertain));
    }

    #[test]
    fn cooperative_exit_rejects_sub_dust_change_and_allows_full_drain() {
        let secp = Secp256k1::verification_only();
        let key: XOnlyPublicKey =
            "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
                .parse()
                .unwrap();
        let pk = key.public_key(bitcoin::secp256k1::Parity::Even);
        let forfeit = Address::p2tr(&secp, key, None, Network::Regtest);
        let info = Info {
            version: "v0.9.25".into(),
            signer_pk: pk,
            forfeit_pk: pk,
            forfeit_address: forfeit,
            checkpoint_tapscript: bitcoin::ScriptBuf::new(),
            network: Network::Regtest,
            session_duration: 10,
            unilateral_exit_delay: bitcoin::Sequence(20),
            boarding_exit_delay: bitcoin::Sequence(30),
            utxo_min_amount: None,
            utxo_max_amount: None,
            vtxo_min_amount: Some(Amount::from_sat(330)),
            vtxo_max_amount: None,
            dust: Amount::from_sat(330),
            fees: None,
            scheduled_session: None,
            deprecated_signers: vec![],
            service_status: std::collections::HashMap::new(),
            digest: String::new(),
            max_tx_weight: 0,
            max_op_return_outputs: 0,
        };
        let input = Amount::from_sat(75_000);
        assert!(check_cooperative_amounts(input, Amount::from_sat(30_000), &info).is_ok());
        assert!(check_cooperative_amounts(input, input, &info).is_ok());
        assert!(matches!(
            check_cooperative_amounts(input, Amount::from_sat(74_800), &info),
            Err(LabError::InvalidAmount)
        ));
        assert!(matches!(
            check_cooperative_amounts(input, Amount::from_sat(329), &info),
            Err(LabError::InvalidAmount)
        ));
        assert!(matches!(
            check_cooperative_amounts(input, Amount::from_sat(75_001), &info),
            Err(LabError::InvalidAmount)
        ));
    }
}
