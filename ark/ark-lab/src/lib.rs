mod blockchain;
mod wallet_store;

use ark_bdk_wallet::Wallet;
use ark_client::{
    BoltzReferralId, Client, InMemorySwapStorage, OfflineClient, OfflineClientConfig,
};
use ark_core::server::Info;
use bitcoin::Network;
use blockchain::{RegtestBlockchain, ESPLORA};
use serde_json::{json, Value};
use std::{net::Ipv4Addr, path::Path, sync::Arc, time::Duration};
use wallet_store::WalletStore;

const OPERATOR: &str = "http://127.0.0.1:37070";
const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
pub enum LabError {
    #[error("ArkOperatorUnavailable: could not query the local Arkade operator")]
    OperatorUnavailable,
    #[error("ArkNetworkMismatch: expected Bitcoin regtest")]
    NetworkMismatch,
    #[error("ArkUnsupportedAsset: this lab only reports BTC")]
    UnsupportedAsset,
    #[error(
        "ArkWalletStorage: initialize with init-wallets and check wallet files and permissions"
    )]
    WalletStorage,
    #[error("ArkWalletBusy: another process holds the wallet lock")]
    WalletBusy,
    #[error("ArkSdkOperationFailed: {0}")]
    Sdk(&'static str),
}

type Result<T> = std::result::Result<T, LabError>;
type SdkClient = Client<RegtestBlockchain, Wallet, InMemorySwapStorage>;

#[derive(Clone, Copy, clap::ValueEnum)]
pub enum WalletId {
    Alice,
    Bob,
}

impl WalletId {
    fn name(self) -> &'static str {
        match self {
            Self::Alice => "alice",
            Self::Bob => "bob",
        }
    }
}

#[derive(Clone, Copy)]
pub enum Action {
    Initialize,
    Addresses,
    Balance,
    ListVtxos,
    Restore,
}

fn regtest(info: &Info) -> Result<()> {
    if info.network != Network::Regtest
        || !info
            .forfeit_address
            .as_unchecked()
            .is_valid_for_network(Network::Regtest)
    {
        return Err(LabError::NetworkMismatch);
    }
    Ok(())
}

async fn operator_info(port: u16) -> Result<Info> {
    let url = format!("http://{}:{port}", Ipv4Addr::LOCALHOST);
    let mut probe = ark_grpc::Client::new(url);
    let info = tokio::time::timeout(TIMEOUT, async {
        probe.connect().await?;
        probe.get_info().await
    })
    .await
    .map_err(|_| LabError::OperatorUnavailable)?
    .map_err(|_| LabError::OperatorUnavailable)?;
    regtest(&info)?;
    Ok(info)
}

async fn connect(store: &WalletStore, create: bool) -> Result<SdkClient> {
    let identity = store.identity(create)?;
    let config = OfflineClientConfig {
        ark_server_url: OPERATOR.into(),
        // No swap commands; do not inherit an upstream mainnet default.
        boltz_url: String::new(),
        boltz_referral_id: BoltzReferralId::Disabled,
        timeout: TIMEOUT,
        server_info_ttl: Duration::MAX,
        delegator_pk: None,
        historical_delegator_pks: vec![],
    };
    let blockchain =
        RegtestBlockchain::new().map_err(|_| LabError::Sdk("indexer configuration"))?;
    let wallet = Wallet::new_from_xpriv(identity, Network::Regtest, ESPLORA)
        .map_err(|_| LabError::Sdk("on-chain wallet configuration"))?;
    let client = OfflineClient::with_bip32(
        config,
        identity,
        None,
        Arc::new(blockchain),
        Arc::new(wallet),
        Arc::new(InMemorySwapStorage::default()),
    )
    .with_contract_store(Box::new(store.contracts()?))
    .connect()
    .await
    .map_err(|_| LabError::OperatorUnavailable)?;
    regtest(
        &client
            .server_info()
            .await
            .map_err(|_| LabError::OperatorUnavailable)?,
    )?;
    Ok(client)
}

async fn addresses(client: &SdkClient) -> Result<Value> {
    let mut ark = client
        .get_offchain_addresses()
        .await
        .map_err(|_| LabError::Sdk("Ark addresses"))?
        .into_iter()
        .map(|(address, _)| address.to_string())
        .collect::<Vec<_>>();
    let mut boarding = client
        .get_boarding_addresses()
        .await
        .map_err(|_| LabError::Sdk("boarding addresses"))?
        .into_iter()
        .map(|address| address.to_string())
        .collect::<Vec<_>>();
    let bitcoin = client
        .get_onchain_address()
        .map_err(|_| LabError::Sdk("on-chain address"))?
        .to_string();
    if ark.is_empty()
        || boarding.is_empty()
        || !bitcoin.starts_with("bcrt1p")
        || !ark.iter().all(|address| address.starts_with("tark1"))
        || !boarding.iter().all(|address| address.starts_with("bcrt1p"))
    {
        return Err(LabError::NetworkMismatch);
    }
    ark.sort_unstable();
    ark.dedup();
    boarding.sort_unstable();
    boarding.dedup();
    Ok(json!({"ark":ark, "boarding":boarding, "onchain":bitcoin}))
}

async fn balance(client: &SdkClient) -> Result<Value> {
    let b = client
        .offchain_balance()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    if !b.asset_balances().is_empty() {
        return Err(LabError::UnsupportedAsset);
    }
    Ok(json!({
        "confirmed_sats": b.confirmed().to_sat(),
        "pre_confirmed_sats": b.pre_confirmed().to_sat(),
        "recoverable_sats": b.recoverable().to_sat(),
        "pending_recovery_sats": b.pending_recovery().to_sat(),
        "total_sats": b.total().to_sat()
    }))
}

async fn vtxos(client: &SdkClient) -> Result<Value> {
    let list = client
        .list_vtxos()
        .await
        .map_err(|_| LabError::OperatorUnavailable)?;
    let mut rows = Vec::new();
    for item in list.all() {
        let v = item.vtxo();
        if !v.assets.is_empty() {
            return Err(LabError::UnsupportedAsset);
        }
        let id = v.outpoint.to_string();
        rows.push((
            id.clone(),
            json!({
                "outpoint": id,
                "amount_sats": v.amount.to_sat(),
                "origin": if v.is_preconfirmed { "ark_transfer" } else { "batch_leaf" },
                "commitment_txids": v.commitment_txids,
                "is_spent": v.is_spent,
                "is_unrolled": v.is_unrolled,
                "is_swept": v.is_swept,
                "is_expired": v.is_expired(),
                "created_at": v.created_at,
                "expires_at": v.expires_at,
                "spent_by": v.spent_by,
                "settled_by": v.settled_by
            }),
        ));
    }
    rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    Ok(Value::Array(
        rows.into_iter().map(|(_, value)| value).collect(),
    ))
}

pub async fn run(repo: &Path, action: Action, wallets: &[WalletId]) -> Result<Value> {
    // Check the operator before generating, deriving, or opening local wallet files.
    operator_info(37070).await?;
    let mut result = serde_json::Map::new();
    for &id in wallets {
        let create = matches!(action, Action::Initialize);
        let store = WalletStore::open(repo, id.name(), create)?;
        let client = connect(&store, create).await?;
        let data = match action {
            Action::Initialize | Action::Addresses => addresses(&client).await?,
            Action::Balance => balance(&client).await?,
            Action::ListVtxos => vtxos(&client).await?,
            Action::Restore => {
                let report = client
                    .restore_contracts(ark_client::DEFAULT_GAP_LIMIT)
                    .await
                    .map_err(|_| {
                        LabError::Sdk("contract restoration requires operator and Esplora")
                    })?;
                json!({"entries_found": report.entries.len(), "addresses": addresses(&client).await?})
            }
        };
        result.insert(id.name().to_string(), data);
    }
    Ok(json!({"network":"regtest","asset":"BTC","wallets":result}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unreachable_operator_returns_sanitized_error() {
        // Reserve an ephemeral local TCP port without listening. No mock server.
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket.bind((Ipv4Addr::LOCALHOST, 0).into()).unwrap();
        let error = operator_info(socket.local_addr().unwrap().port())
            .await
            .unwrap_err();
        assert!(matches!(error, LabError::OperatorUnavailable));
        assert_eq!(
            error.to_string(),
            "ArkOperatorUnavailable: could not query the local Arkade operator"
        );
    }
}
