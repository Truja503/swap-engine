use ark_lab::{Action, WalletId};
use clap::{Parser, Subcommand};
use std::{path::Path, process::ExitCode};

#[derive(Parser)]
#[command(about = "Bitcoin-only wallet operations for the isolated Arkade regtest lab")]
struct Args {
    /// Use the dedicated, one-shot E2E fixture wallets rather than operator wallets.
    #[arg(long)]
    e2e_fixture: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    InitWallets,
    Addresses {
        wallet: Option<WalletId>,
    },
    Balance {
        wallet: Option<WalletId>,
    },
    ListVtxos {
        wallet: Option<WalletId>,
    },
    Restore {
        wallet: WalletId,
    },
    Board {
        wallet: WalletId,
        input: bitcoin::OutPoint,
    },
    TransferSubmit {
        input: bitcoin::OutPoint,
        sats: u64,
    },
    Pending,
    TransferFinalize {
        txid: bitcoin::Txid,
    },
    VerifySpent {
        input: bitcoin::OutPoint,
        sats: u64,
    },
    SettleVtxo {
        wallet: WalletId,
        input: bitcoin::OutPoint,
    },
    OffboardCoop {
        input: bitcoin::OutPoint,
        address: bitcoin::Address<bitcoin::address::NetworkUnchecked>,
        sats: u64,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();
    let (action, wallet) = match args.command {
        Command::InitWallets => (Action::Initialize, None),
        Command::Addresses { wallet } => (Action::Addresses, wallet),
        Command::Balance { wallet } => (Action::Balance, wallet),
        Command::ListVtxos { wallet } => (Action::ListVtxos, wallet),
        Command::Restore { wallet } => (Action::Restore, Some(wallet)),
        Command::Board { wallet, input } => (Action::Board(input), Some(wallet)),
        Command::TransferSubmit { input, sats } => {
            (Action::TransferSubmit(input, sats), Some(WalletId::Alice))
        }
        Command::Pending => (Action::Pending, Some(WalletId::Alice)),
        Command::TransferFinalize { txid } => {
            (Action::TransferFinalize(txid), Some(WalletId::Alice))
        }
        Command::VerifySpent { input, sats } => {
            (Action::VerifySpent(input, sats), Some(WalletId::Alice))
        }
        Command::SettleVtxo { wallet, input } => (Action::SettleVtxo(input), Some(wallet)),
        Command::OffboardCoop {
            input,
            address,
            sats,
        } => (Action::Offboard(input, address, sats), Some(WalletId::Bob)),
    };
    let both = [WalletId::Alice, WalletId::Bob];
    let repo = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let fixture = repo.join("data/ark/e2e/fixture");
    let repo = if args.e2e_fixture {
        if !std::fs::symlink_metadata(&fixture).is_ok_and(|m| m.is_dir()) {
            eprintln!("ArkWalletStorage: fixture is created by ark:test -- --e2e");
            return ExitCode::FAILURE;
        }
        fixture.as_path()
    } else {
        repo
    };
    let wallets = wallet
        .as_ref()
        .map_or(both.as_slice(), std::slice::from_ref);
    match ark_lab::run(repo, action, wallets).await {
        Ok(report) => {
            println!("{report:#}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
