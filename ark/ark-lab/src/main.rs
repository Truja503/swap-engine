use ark_lab::{Action, WalletId};
use clap::{Parser, Subcommand};
use std::{path::Path, process::ExitCode};

#[derive(Parser)]
#[command(about = "Bitcoin-only wallet operations for the isolated Arkade regtest lab")]
struct Args {
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
}

#[tokio::main]
async fn main() -> ExitCode {
    let (action, wallet) = match Args::parse().command {
        Command::InitWallets => (Action::Initialize, None),
        Command::Addresses { wallet } => (Action::Addresses, wallet),
        Command::Balance { wallet } => (Action::Balance, wallet),
        Command::ListVtxos { wallet } => (Action::ListVtxos, wallet),
        Command::Restore { wallet } => (Action::Restore, Some(wallet)),
        Command::Board { wallet, input } => (Action::Board(input), Some(wallet)),
    };
    let both = [WalletId::Alice, WalletId::Bob];
    let repo = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
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
