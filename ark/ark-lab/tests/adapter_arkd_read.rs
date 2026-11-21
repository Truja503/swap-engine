use ark_lab::{
    adapter::{AdapterError, ArkAdapter, OperationId, RegtestReadAdapter, LAB_SCOPE},
    WalletId,
};
use bitcoin::Amount;
use std::path::Path;

#[tokio::test]
#[ignore = "requires the dedicated live Ark regtest stack and the existing #53 E2E fixture"]
async fn arkd_contract_read() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/ark/e2e/fixture");
    let alice = RegtestReadAdapter::new(&fixture, WalletId::Alice);
    assert_eq!(alice.scope(), LAB_SCOPE);
    let policy = alice.fee_policy().await.expect("live SDK GetInfo");
    assert_eq!(policy.operator_version, "v0.9.25");
    assert_eq!(policy.dust, Amount::from_sat(330));
    assert!(policy.advertised_fees.is_some());

    let balance = alice.balance().await.expect("live SDK balance");
    assert_eq!(balance.total, Amount::from_sat(125_000));
    let vtxos = alice.vtxos().await.expect("live SDK VTXO history");
    assert!(vtxos.iter().any(|v| v.is_spent && v.ark_txid.is_some()));
    let renewal = vtxos
        .iter()
        .find(|v| v.amount == balance.total && !v.is_preconfirmed && !v.is_spent && !v.is_unrolled)
        .expect("Alice's renewal leaf from #53");
    assert!(!renewal.commitment_txids.is_empty());
    assert_eq!(
        alice.status(OperationId(0)).await,
        Err(AdapterError::UnsupportedCapability)
    );
    println!(
        "arkd {}: dust={} sats, Alice total={} sats, {} VTXOs, renewal={:?}",
        policy.operator_version,
        policy.dust.to_sat(),
        balance.total.to_sat(),
        vtxos.len(),
        renewal.id
    );
}
