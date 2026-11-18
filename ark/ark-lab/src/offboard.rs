use crate::{blockchain::RegtestBlockchain, LabError, Result, SdkClient};
use bitcoin::{address::NetworkUnchecked, Address, Amount, Network, OutPoint};
use serde_json::{json, Value};
use std::{future::Future, time::Duration};

async fn bounded_submission<T, E>(
    deadline: Duration,
    submission: impl Future<Output = std::result::Result<T, E>>,
) -> Result<T> {
    tokio::time::timeout(deadline, submission)
        .await
        .map_err(|_| LabError::SubmissionUncertain)?
        .map_err(|_| LabError::SubmissionUncertain)
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
    if amount < info.dust.max(info.utxo_min_amount.unwrap_or_default())
        || amount > entry.vtxo().amount
        || info.utxo_max_amount.is_some_and(|max| amount > max)
    {
        return Err(LabError::InvalidAmount);
    }
    let mut rng = bitcoin::secp256k1::rand::thread_rng();
    let commitment = bounded_submission(
        Duration::from_secs(120),
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
}
