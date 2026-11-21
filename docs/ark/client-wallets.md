# Wallets A/B del laboratorio Arkade (#49)

Después de `bash scripts/ark/bootstrap-regtest.sh`, desde la raíz del worktree:

```sh
cargo build --manifest-path ark/Cargo.toml --locked
ark/target/debug/ark-lab init-wallets
ark/target/debug/ark-lab addresses
ark/target/debug/ark-lab balance
ark/target/debug/ark-lab list-vtxos
ark/target/debug/ark-lab restore alice
```

`addresses`, `balance` y `list-vtxos` consultan ambas wallets si se
omite el argumento, o sólo `alice` / `bob` si se especifica. Las identidades
BIP39 y contratos del SDK viven en `data/ark/wallets/{alice,bob}/`, con
directorios `0700`, archivos `0600` y exclusión de Git. `init-wallets`
conserva identidades existentes. Haz copias de seguridad privadas; no
compartas ni las frases ni los archivos. `restore` vuelve a descubrir
contratos con actividad de la identidad local desde el operador y Esplora.

El único cliente Ark es `arkade-os/rust-sdk` v0.12.1 fijado por commit.
El CLI no acepta endpoints arbitrarios, valida que el operador sea regtest
y sólo muestra BTC en satoshis. El listado consulta el índice del operador,
no una caché de VTXOs: SQLite conserva contratos/identidad de recepción,
PostgreSQL del operador conserva las proyecciones de VTXOs.

Si el operador está fuera de línea, `balance` retorna código `1` y
`ArkOperatorUnavailable` en stderr, sin emitir ceros aparentes en stdout.
Con wallets sin fondos, un saldo real de `0` y un listado real `[]` son
normales; el primer VTXO con fondos requiere el boarding de #50.
