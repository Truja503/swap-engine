//! Proposed #54 contract, private to the Ark lab. See docs/ark/ark-adapter.md.

use crate::{connect, query_operator_info, wallet_store::WalletStore, LabError, WalletId};
use ark_core::{server::FeeInfo, ArkAddress};
use bitcoin::{
    address::NetworkUnchecked, Address, Amount, BlockHash, OutPoint, Txid, XOnlyPublicKey,
};
use std::{
    future::Future,
    num::NonZeroU32,
    path::Path,
    time::{Duration, SystemTime},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Regtest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Asset {
    Btc,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Scope {
    pub network: Network,
    pub asset: Asset,
}

pub const LAB_SCOPE: Scope = Scope {
    network: Network::Regtest,
    asset: Asset::Btc,
};
pub const READ_TIMEOUT: Duration = Duration::from_secs(5);
pub const TRANSFER_TIMEOUT: Duration = Duration::from_secs(30);
pub const ROUND_TIMEOUT: Duration = Duration::from_secs(120);
pub const MAX_QUOTE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Balance {
    pub batch_confirmed: Amount,
    pub preconfirmed: Amount,
    pub recoverable: Amount,
    pub pending_recovery: Amount,
    pub total: Amount,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct VtxoId(pub OutPoint);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vtxo {
    pub id: VtxoId,
    pub amount: Amount,
    pub is_preconfirmed: bool,
    pub is_spent: bool,
    pub is_unrolled: bool,
    pub is_swept: bool,
    pub expires_at_unix: i64,
    pub commitment_txids: Vec<Txid>,
    pub spent_by: Option<Txid>,
    pub ark_txid: Option<Txid>,
    pub settled_by: Option<Txid>,
}

/// Operator-advertised parameters, not a quote, spendability check or fee guarantee.
#[derive(Clone, Debug)]
pub struct FeePolicy {
    pub operator_version: String,
    pub operator_signer: XOnlyPublicKey,
    pub observed_at: SystemTime,
    pub dust: Amount,
    pub utxo_min: Option<Amount>,
    pub utxo_max: Option<Amount>,
    pub vtxo_min: Option<Amount>,
    pub vtxo_max: Option<Amount>,
    pub advertised_fees: Option<FeeInfo>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Intent {
    /// Consume an already funded, wallet-owned boarding output. Never fund it here.
    Boarding { funding: OutPoint, credit: Amount },
    Transfer {
        input: VtxoId,
        recipient: ArkAddress,
        amount: Amount,
    },
    /// Cooperative only; no unilateral exit in this contract.
    Offboarding {
        input: VtxoId,
        recipient: Address<NetworkUnchecked>,
        amount: Amount,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct QuoteId(pub u128);

/// Caller-generated, unique within a registered wallet/operator scope; also the idempotency key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct OperationId(pub u128);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeCaps {
    pub operator: Amount,
    /// User-borne Bitcoin network fee only, not the shared commitment's total fee.
    pub bitcoin: Amount,
}

impl FeeCaps {
    pub fn total(self) -> Option<Amount> {
        self.operator.checked_add(self.bitcoin)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Quote {
    pub id: QuoteId,
    pub intent: Intent,
    pub fee_caps: FeeCaps,
    /// Exclusive; may be earlier than the maximum TTL due to input or round expiry.
    pub expires_at: SystemTime,
}

impl Quote {
    /// Local checks for a first submission. Implementations must also recheck the
    /// spendability, policy and fees of the exact input against live data.
    pub fn validate_submission(&self, request: &Submission, now: SystemTime) -> AdapterResult<()> {
        if self.id != request.quote || self.intent != request.intent {
            return Err(AdapterError::InvalidQuote);
        }
        validate_regtest_intent(&request.intent)?;
        if now >= self.expires_at {
            return Err(AdapterError::QuoteExpired);
        }
        Ok(())
    }
}

pub fn validate_regtest_intent(intent: &Intent) -> AdapterResult<()> {
    match intent {
        Intent::Boarding { credit, .. } => {
            if *credit == Amount::ZERO {
                return Err(AdapterError::LimitsExceeded);
            }
        }
        Intent::Transfer {
            recipient, amount, ..
        } => {
            if *amount == Amount::ZERO {
                return Err(AdapterError::LimitsExceeded);
            }
            if !recipient.encode().starts_with("tark1") {
                return Err(AdapterError::NetworkMismatch);
            }
        }
        Intent::Offboarding {
            recipient, amount, ..
        } => {
            if *amount == Amount::ZERO {
                return Err(AdapterError::LimitsExceeded);
            }
            crate::offboard::checked_address(recipient.clone())
                .map_err(|_| AdapterError::NetworkMismatch)?;
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Submission {
    pub id: OperationId,
    pub quote: QuoteId,
    pub intent: Intent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationStatus {
    /// Fenced locally; no positive remote evidence yet.
    Prepared,
    /// Original TXID or round observed, not yet established as finalized.
    Submitted,
    /// Off-chain receipt reconciled; not a Bitcoin confirmation.
    Preconfirmed,
    /// Commitment or payout observed without the required confirmation depth.
    AwaitingConfirmations,
    /// Required depth currently met; may regress on reorg.
    Confirmed,
    /// The original may have executed. Reconcile; never submit a replacement.
    Uncertain,
    /// Conclusive rejection; timeout and missing data are not rejection.
    Rejected,
}

/// Evidence references, not portable cryptographic proofs or authorization to spend.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Proof {
    TransferReceipt {
        ark_txid: Txid,
        recipient_vtxo: VtxoId,
        amount: Amount,
    },
    BoardingConfirmation {
        funding: OutPoint,
        credited_vtxo: VtxoId,
        amount: Amount,
        commitment: ChainAnchor,
    },
    OffboardingConfirmation {
        payout: OutPoint,
        amount: Amount,
        commitment: ChainAnchor,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChainAnchor {
    pub txid: Txid,
    pub block_hash: BlockHash,
    pub height: u32,
    pub confirmations: NonZeroU32,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum AdapterError {
    #[error("operator network or destination network does not match the lab")]
    NetworkMismatch,
    #[error("operator identity does not match the intended recipient or operation")]
    OperatorMismatch,
    #[error("only BTC is supported")]
    UnsupportedAsset,
    #[error("operator unavailable")]
    OperatorUnavailable,
    #[error("Bitcoin chain view unavailable")]
    ChainUnavailable,
    #[error("wallet busy")]
    WalletBusy,
    #[error("wallet state unavailable")]
    WalletStorage,
    #[error("SDK read failed")]
    SdkRead,
    #[error("read or pre-submit deadline exceeded")]
    Timeout,
    #[error("operation {0:?} may have been submitted; reconcile the original")]
    SubmissionUncertain(OperationId),
    #[error("operation key already bound to a different request")]
    IdempotencyConflict,
    #[error("quote unknown or not bound to this intent")]
    InvalidQuote,
    #[error("quote expired")]
    QuoteExpired,
    #[error("amount, change or fees outside allowed limits")]
    LimitsExceeded,
    #[error("input missing, stale, spent or reserved")]
    InputNotSpendable,
    #[error("operation unknown in this wallet scope")]
    UnknownOperation,
    #[error("capability not implemented by this adapter")]
    UnsupportedCapability,
}

pub type AdapterResult<T> = Result<T, AdapterError>;

/// Implementations are bound to one wallet and operator. This is an internal,
/// statically dispatched interface, not an RPC schema.
#[allow(async_fn_in_trait)]
pub trait ArkAdapter {
    fn scope(&self) -> Scope {
        LAB_SCOPE
    }

    async fn balance(&self) -> AdapterResult<Balance>;
    async fn vtxos(&self) -> AdapterResult<Vec<Vtxo>>;
    async fn fee_policy(&self) -> AdapterResult<FeePolicy>;

    /// Non-binding until exact inputs, intent, limits and freshness are revalidated at submit.
    async fn quote(&self, _intent: Intent, _max_user_fee: Amount) -> AdapterResult<Quote> {
        Err(AdapterError::UnsupportedCapability)
    }

    /// First persist and reserve; retries with the same key and payload read the original,
    /// even after quote expiry. Never blindly repeat a potentially accepted submission.
    async fn submit(&mut self, _request: Submission) -> AdapterResult<OperationStatus> {
        Err(AdapterError::UnsupportedCapability)
    }

    /// Read-only, including after restart. Does not finalize, replace or rebroadcast.
    async fn status(&self, _id: OperationId) -> AdapterResult<OperationStatus> {
        Err(AdapterError::UnsupportedCapability)
    }

    /// `None` means no sufficient current evidence for a known operation, not rejection.
    async fn proof(&self, _id: OperationId) -> AdapterResult<Option<Proof>> {
        Err(AdapterError::UnsupportedCapability)
    }

    /// Reconcile the original attempt by exact identifiers. Only the original pending
    /// transfer may be finalized; no replacement or additional funding.
    async fn recover(&mut self, _id: OperationId) -> AdapterResult<OperationStatus> {
        Err(AdapterError::UnsupportedCapability)
    }
}

/// Real public arkd reads via the pinned rust-sdk; no transaction or admin calls.
pub struct RegtestReadAdapter<'a> {
    repo: &'a Path,
    wallet: WalletId,
}

impl<'a> RegtestReadAdapter<'a> {
    pub fn new(repo: &'a Path, wallet: WalletId) -> Self {
        Self { repo, wallet }
    }

    async fn wallet_client(&self) -> AdapterResult<(WalletStore, crate::SdkClient)> {
        // Check regtest before opening local wallet files, just like the existing lab CLI.
        query_operator_info(37070).await.map_err(read_error)?;
        let store = WalletStore::open(self.repo, self.wallet.name(), false).map_err(read_error)?;
        let client = connect(&store, false).await.map_err(read_error)?;
        Ok((store, client))
    }
}

pub(super) async fn bounded_read<T>(
    read: impl Future<Output = AdapterResult<T>>,
) -> AdapterResult<T> {
    tokio::time::timeout(READ_TIMEOUT, read)
        .await
        .map_err(|_| AdapterError::Timeout)?
}

fn read_error(error: LabError) -> AdapterError {
    match error {
        LabError::NetworkMismatch => AdapterError::NetworkMismatch,
        LabError::OperatorUnavailable => AdapterError::OperatorUnavailable,
        LabError::WalletStorage => AdapterError::WalletStorage,
        LabError::WalletBusy => AdapterError::WalletBusy,
        _ => AdapterError::SdkRead,
    }
}

impl ArkAdapter for RegtestReadAdapter<'_> {
    async fn balance(&self) -> AdapterResult<Balance> {
        bounded_read(async {
            let (_store, client) = self.wallet_client().await?;
            let b = client
                .offchain_balance()
                .await
                .map_err(|_| AdapterError::SdkRead)?;
            if !b.asset_balances().is_empty() {
                return Err(AdapterError::UnsupportedAsset);
            }
            Ok(Balance {
                batch_confirmed: b.confirmed(),
                preconfirmed: b.pre_confirmed(),
                recoverable: b.recoverable(),
                pending_recovery: b.pending_recovery(),
                total: b.total(),
            })
        })
        .await
    }

    async fn vtxos(&self) -> AdapterResult<Vec<Vtxo>> {
        bounded_read(async {
            let (_store, client) = self.wallet_client().await?;
            let list = client
                .list_vtxos()
                .await
                .map_err(|_| AdapterError::SdkRead)?;
            list.all()
                .map(|item| {
                    let v = item.vtxo();
                    if !v.assets.is_empty() {
                        return Err(AdapterError::UnsupportedAsset);
                    }
                    Ok(Vtxo {
                        id: VtxoId(v.outpoint),
                        amount: v.amount,
                        is_preconfirmed: v.is_preconfirmed,
                        is_spent: v.is_spent,
                        is_unrolled: v.is_unrolled,
                        is_swept: v.is_swept,
                        expires_at_unix: v.expires_at,
                        commitment_txids: v.commitment_txids.clone(),
                        spent_by: v.spent_by,
                        ark_txid: v.ark_txid,
                        settled_by: v.settled_by,
                    })
                })
                .collect()
        })
        .await
    }

    async fn fee_policy(&self) -> AdapterResult<FeePolicy> {
        bounded_read(async {
            let info = query_operator_info(37070).await.map_err(read_error)?;
            Ok(FeePolicy {
                operator_version: info.version,
                operator_signer: info.signer_pk.x_only_public_key().0,
                observed_at: SystemTime::now(),
                dust: info.dust,
                utxo_min: info.utxo_min_amount,
                utxo_max: info.utxo_max_amount,
                vtxo_min: info.vtxo_min_amount,
                vtxo_max: info.vtxo_max_amount,
                advertised_fees: info.fees,
            })
        })
        .await
    }
}
