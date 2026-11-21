use crate::{LabError, Result};
use bip39::Mnemonic;
use bitcoin::{bip32::Xpriv, Network};
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

pub struct WalletStore {
    dir: PathBuf,
    create: bool,
    _lock: File,
}

fn private_dir(path: &Path, create: bool) -> Result<()> {
    if create {
        match DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(LabError::WalletStorage),
        }
    }
    let meta = fs::symlink_metadata(path).map_err(|_| LabError::WalletStorage)?;
    if !meta.is_dir() || meta.mode() & 0o777 != 0o700 || !same_user(&meta) {
        return Err(LabError::WalletStorage);
    }
    Ok(())
}

fn same_user(meta: &fs::Metadata) -> bool {
    // SAFETY: geteuid takes no arguments and has no preconditions.
    meta.uid() == unsafe { libc::geteuid() }
}

fn private_file(path: &Path, create: bool) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| LabError::WalletStorage)?;
    let meta = file.metadata().map_err(|_| LabError::WalletStorage)?;
    if !meta.is_file() || meta.mode() & 0o777 != 0o600 || meta.nlink() != 1 || !same_user(&meta) {
        return Err(LabError::WalletStorage);
    }
    Ok(file)
}

impl WalletStore {
    pub fn open(repo: &Path, wallet: &str, create: bool) -> Result<Self> {
        if wallet.is_empty()
            || wallet == "."
            || wallet == ".."
            || wallet.contains(['/', '\\', '\0'])
        {
            return Err(LabError::WalletStorage);
        }
        let data = repo.join("data");
        if create {
            match DirBuilder::new().mode(0o700).create(&data) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(LabError::WalletStorage),
            }
        }
        if !fs::symlink_metadata(&data).is_ok_and(|m| m.is_dir() && same_user(&m)) {
            return Err(LabError::WalletStorage);
        }
        let lab = data.join("ark");
        let wallets = lab.join("wallets");
        let dir = wallets.join(wallet);
        for path in [&lab, &wallets, &dir] {
            private_dir(path, create)?;
        }
        let lock = private_file(&dir.join("wallet.lock"), true)?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| LabError::WalletBusy)?;
        Ok(Self {
            dir,
            create,
            _lock: lock,
        })
    }

    pub fn identity(&self, create: bool) -> Result<Xpriv> {
        let path = self.dir.join("mnemonic.txt");
        if create
            && fs::symlink_metadata(&path).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
        {
            if fs::symlink_metadata(self.dir.join("contracts.sqlite")).is_ok() {
                return Err(LabError::WalletStorage);
            }
            let words = Mnemonic::generate(24).map_err(|_| LabError::WalletStorage)?;
            let text = Zeroizing::new(words.to_string());
            let mut staged =
                tempfile::NamedTempFile::new_in(&self.dir).map_err(|_| LabError::WalletStorage)?;
            staged
                .write_all(text.as_bytes())
                .and_then(|()| staged.as_file().sync_all())
                .map_err(|_| LabError::WalletStorage)?;
            staged
                .persist_noclobber(&path)
                .map_err(|_| LabError::WalletStorage)?;
            File::open(&self.dir)
                .and_then(|dir| dir.sync_all())
                .map_err(|_| LabError::WalletStorage)?;
        }
        let mut words = Zeroizing::new(String::new());
        private_file(&path, false)?
            .take(1024)
            .read_to_string(&mut words)
            .map_err(|_| LabError::WalletStorage)?;
        let mnemonic = Mnemonic::parse(words.trim()).map_err(|_| LabError::WalletStorage)?;
        let seed = Zeroizing::new(mnemonic.to_seed_normalized(""));
        Xpriv::new_master(Network::Regtest, seed.as_slice()).map_err(|_| LabError::WalletStorage)
    }

    pub fn contracts(&self) -> Result<ark_client::SqliteContractStore> {
        let path = self.dir.join("contracts.sqlite");
        private_file(&path, self.create)?;
        ark_client::SqliteContractStore::new(path).map_err(|_| LabError::WalletStorage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn identities_are_distinct_private_and_reopen_unchanged() {
        let repo = tempfile::tempdir().unwrap();
        let alice = WalletStore::open(repo.path(), "alice", true).unwrap();
        let bob = WalletStore::open(repo.path(), "bob", true).unwrap();
        let a = alice.identity(true).unwrap();
        let b = bob.identity(true).unwrap();
        assert!(a != b);
        assert!(alice.identity(true).unwrap() == a);
        alice.contracts().unwrap();
        assert!(WalletStore::open(repo.path(), "alice", false).is_err());
        drop(alice);
        let alice = WalletStore::open(repo.path(), "alice", false).unwrap();
        assert!(alice.identity(false).unwrap() == a);
        alice.contracts().unwrap();
        for name in ["mnemonic.txt", "contracts.sqlite"] {
            assert_eq!(
                fs::metadata(alice.dir.join(name)).unwrap().mode() & 0o777,
                0o600
            );
        }
        fs::set_permissions(
            alice.dir.join("mnemonic.txt"),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        assert!(alice.identity(true).is_err());
    }

    #[test]
    fn refuses_symlinked_wallet_state() {
        let repo = tempfile::tempdir().unwrap();
        let alice = WalletStore::open(repo.path(), "alice", true).unwrap();
        symlink("/dev/null", alice.dir.join("mnemonic.txt")).unwrap();
        assert!(alice.identity(true).is_err());
        symlink("/dev/null", alice.dir.join("contracts.sqlite")).unwrap();
        assert!(alice.contracts().is_err());
    }

    #[test]
    fn refuses_traversal_names_and_missing_contracts_on_reopen() {
        let repo = tempfile::tempdir().unwrap();
        for bad in ["", ".", "..", "../bob", "alice/sub", "a\\b", "a\0b"] {
            assert!(WalletStore::open(repo.path(), bad, true).is_err());
        }
        let alice = WalletStore::open(repo.path(), "alice", true).unwrap();
        alice.identity(true).unwrap();
        drop(alice);
        let reopened = WalletStore::open(repo.path(), "alice", false).unwrap();
        assert!(reopened.contracts().is_err());
    }
}
