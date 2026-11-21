# Matriz de Compatibilidad, Selección de Stack y Mapeo de APIs (`arkade-os/rust-sdk`)

> **Alcance y estado (#47 — `[ARK][01][P1]`):** Este documento entrega el cierre documental del issue [#47](https://github.com/Truja503/swap-engine/issues/47) bajo la épica [#46](https://github.com/Truja503/swap-engine/issues/46). Fija versiones, commits, imágenes de contenedor, toolchains, licencias y APIs concretas verificadas en fuentes oficiales a fecha **2026-11-18**. No modifica el motor TypeScript existente (`src/`), ni la UI (`src/web`), ni `Bitcoin Core` (`127.0.0.1:18443`, wallet `lqwd-lab`), ni los nodos `LND` de `LQWD-SWAPS`.

---

## 1. Decisión de Cliente SDK: `arkade-os/rust-sdk` vs `arkade-os/ts-sdk`

Los issues [#46](https://github.com/Truja503/swap-engine/issues/46) y [#47](https://github.com/Truja503/swap-engine/issues/47) citan inicialmente `arkade-os/ts-sdk` como referencia documental, mientras que la instrucción técnica del proyecto especifica utilizar **[`arkade-os/rust-sdk`](https://github.com/arkade-os/rust-sdk)** (`ark-rs` / `ark-client`) como cliente de implementación del laboratorio Ark en regtest, **sin reescribir el motor principal de Swap Engine**.

### 1.1 Comparativa técnica verificada

| Dimensión | `arkade-os/rust-sdk` (Seleccionado) | `arkade-os/ts-sdk` (Referencia en issues) | Impacto en `swap-engine` (#46–#54) |
| --- | --- | --- | --- |
| **Repositorio oficial** | [`arkade-os/rust-sdk`](https://github.com/arkade-os/rust-sdk) | [`arkade-os/ts-sdk`](https://github.com/arkade-os/ts-sdk) | Ambos son mantenidos oficialmente por Ark Labs (`arkade-os`). |
| **Versión / Tag estable fijado** | `v0.12.1` (`2026-11-13`) — commit `352ca21bcaa01d3ddb535b0ebfb20cd9b028c357` | Paquete `@arkade-os/sdk@0.5.8` (`2026-11-18`) / tag git `v0.4.27` (`d663d158bdf90354a15fd6878c482026f40ea2a0`) / `master` `d9e55f619c0f097a29b4f4f6360c7aac709315ad` | `rust-sdk v0.12.1` tiene tags semver unificados para todo el workspace Cargo. |
| **Target de protocolo `arkd`** | `TARGET_ARKD_VERSION = "0.9.15"`, probado en CI contra `ghcr.io/arkade-os/arkd:v0.9.25` | Probado contra `arkd:v0.9.25` via submódulo `arkade-regtest` | Ambos comparten el mismo harness base (`ArkLabsHQ/arkade-regtest`). |
| **Runtime / Toolchain requerido** | Rust MSRV `1.86.0` (edición `2021`, `resolver = "2"`). Host local verificado con `rustc 1.97.1` / `cargo 1.97.1` | Monorepo exige `node >=24.22.1 <27` y `pnpm >=10.25.0 <11` (paquete SDK individual admite `node >=22.13.0 <27`) | La VM Ubuntu de `swap-engine` corre Node `v22.22.1` (y el host local `v22.23.2`) con `npm`. Usar `rust-sdk` en `ark/` evita conflictos con `package.json`, `package-lock.json` o `pnpm` en el motor TS. |
| **Transporte con `arkd`** | `ark-grpc` (`tonic 0.14`, streaming nativo de rondas/eventos y suscripciones) + `ark-rest` (`reqwest 0.12`) | REST/fetch + WebSocket/SSE (`@scure/btc-signer`, `@noble/secp256k1`) | `ark-client` opera sobre gRPC HTTP/2 nativo contra `arkd:7070` y expone tipado fuerte con `bitcoin 0.32.7`. |
| **Wallet on-chain & BDK** | Crate dedicado `ark-bdk-wallet` basado en `bdk_wallet` (BIP86 Taproot) + `bdk_esplora` + `esplora_client` | Descriptores `@bitcoinerlab/descriptors-scure` + `ws-electrumx-client` / Esplora | `ark-bdk-wallet` provee selección de monedas on-chain y firma PSBT lista para fee-bumping P2A (`build_anchor_tx`) en salidas unilaterales. |
| **Persistencia de contratos y VTXOs** | `SqliteContractStore` (`rusqlite 0.32` bundled) + `SqliteSwapStorage` (`sqlx 0.8`), además de `MemoryContractStore` y `restore_contracts(gap_limit)` | Repositorios `sqlite`, `realm`, `expo` e in-memory | `SqliteContractStore` persiste contratos VTXO (2-leaf/3-leaf) y de boarding en SQLite local sin dependencias externas. |
| **Salidas (Offboarding)** | `collaborative_redeem`, `collaborative_redeem_vtxo_selection`, `build_unilateral_exit_trees`, `broadcast_next_unilateral_exit_node` (con CPFP P2A `bump_tx` + `submitpackage`) y `send_on_chain` | Collaborative redeem / unroll y utilidades de script | `rust-sdk` incluye cobertura E2E completa de árbol de salida unilateral con `submitpackage` contra Bitcoin Core 31.0. |
| **Aislamiento respecto a Swap Engine** | Workspace Cargo separado bajo `ark/` (`ark/Cargo.toml`); **cero** cambios a `package.json`, `tsconfig.json` o `src/` | Requeriría añadir dependencias npm o sub-paquetes TS conviviendo con el motor actual | El workspace Rust bajo `ark/` garantiza que el motor TypeScript existente permanezca intacto mientras se valida Ark en regtest (#48–#53) y se propone el contrato `ArkAdapter` (#54). |

> **Conclusión de selección (#47):** Se fija **`arkade-os/rust-sdk` (`v0.12.1`)** como único SDK cliente para los issues #48 a #54, ejecutado desde un workspace Rust aislado bajo `ark/` contra el operador oficial **`arkade-os/arkd` (`v0.9.25`)**. No se reescribe el motor TypeScript existente ni se mezclan implementaciones alternativas de Ark (como Bark/Second).

---

## 2. Versiones, Commits, Imágenes y Licencias Fijadas

Todas las referencias siguientes fueron consultadas y verificadas directamente contra los repositorios oficiales en GitHub el **2026-11-18**.

### 2.1 Repositorios oficiales de referencia

| Componente | Repositorio | Tag / Rama fijada | Commit SHA exacto | Fecha del commit / release | Licencia | Rol en #46–#54 |
| --- | --- | --- | --- | --- | --- | --- |
| **Arkade Rust SDK** | [`arkade-os/rust-sdk`](https://github.com/arkade-os/rust-sdk) | **`v0.12.1`** (release estable) | `352ca21bcaa01d3ddb535b0ebfb20cd9b028c357` | `2026-11-13T02:30:10Z` (HEAD `master`: `c786942969dd16f9e94fc165a99a329a39ed183d` del `2026-11-16`) | `MIT` | Cliente SDK (`ark-core`, `ark-client`, `ark-grpc`, `ark-rest`, `ark-bdk-wallet`, `ark-fees`) para wallets A/B, boarding, pagos VTXO y offboarding. |
| **Operador Arkade (`arkd`) — Baseline E2E** | [`arkade-os/arkd`](https://github.com/arkade-os/arkd) | **`v0.9.25`** (fijado por `rust-sdk v0.12.1`) | `97386cb3d95c2f515c9447dd9f0cd169d752ead8` | `2026-11-05T11:52:11Z` | `MIT` | Imagen del operador `arkd`, `arkd-wallet` y `arkd-signer` validada por la suite E2E de `rust-sdk v0.12.1`. |
| **Operador Arkade (`arkd`) — Patch reciente** | [`arkade-os/arkd`](https://github.com/arkade-os/arkd) | `v0.9.26` (último release estable) | `586526e5572b3db24df2ab2de31915d93feba930` | `2026-11-11T14:07:32Z` (HEAD `master`: `fee16a7ba28c3e508c892b07cb7db9028a715f8f` del `2026-11-16`) | `MIT` | Release con 5 commits sobre `v0.9.25` (filtro `asset_ids` en `GetVtxos`, rechazo de intents con CSV tapleaves `#203`, bump `golang.org/x/net@v0.62.0`). Disponible como candidato de prueba secundaria. |
| **Harness Regtest Oficial** | [`ArkLabsHQ/arkade-regtest`](https://github.com/ArkLabsHQ/arkade-regtest) | Submódulo `regtest` de `rust-sdk v0.12.1` | `a1b4fdc859b41281d00d16596408055f254225bf` | Pin en `rust-sdk` `v0.12.1` (`master`) | Sin SPDX (`null` en GitHub API) | Referencia arquitectónica del stack Docker Compose (`compose.base.yml` + `compose.ark.yml`) y flujo de inicialización (`lib/setup/arkd.mjs`). **No se vendoriza código**; se escribe configuración propia aislada en `deploy/ark/` y `scripts/ark/`. |
| **Arkade TypeScript SDK** | [`arkade-os/ts-sdk`](https://github.com/arkade-os/ts-sdk) | `@arkade-os/sdk/0.5.8` / tag `v0.4.27` | `d663d158bdf90354a15fd6878c482026f40ea2a0` (`v0.4.27`) / `d9e55f619c0f097a29b4f4f6360c7aac709315ad` (`master`) | `2026-11-18T14:41:26Z` | `MIT` (en `packages/sdk/package.json`) | Sólo referencia comparativa documental (#47) y de diseño de interfaz para `ArkAdapter` (#54). No instalado. |
| **Repositorio anfitrión** | [`Truja503/swap-engine`](https://github.com/Truja503/swap-engine) | Rama worktree `ark-regtest-46-54` | Base `main` local | `2026-11-18` | Propietario (Todos los derechos reservados en `LICENSE`) | Motor principal. Las dependencias externas conservan sus licencias (`MIT`). |

### 2.2 Notas de compatibilidad entre `rust-sdk v0.12.1` y `arkd v0.9.25` / `v0.9.26`

1. **Cabeceras de protocolo:** `ark-core v0.12.1` (`ark-core/src/server.rs`) define `TARGET_ARKD_VERSION = "0.9.15"` (enviado en `X-Build-Version` / `x-build-version`) y `SDK_VERSION = "rust-sdk/0.12.1"` (enviado en `X-SDK-Version` / `x-sdk-version`).
2. **Cambios críticos en `arkd v0.9.25` reflejados en `rust-sdk v0.12.1`:**
   - **Eliminación de SQLite/Badger en `arkd`:** A partir de `arkd v0.9.25` (PR `#132`), `arkd` **sólo** soporta PostgreSQL (`ARKD_DB_TYPE=postgres`, `ARKD_EVENT_DB_TYPE=postgres`) y Redis (`ARKD_LIVE_STORE_TYPE=redis`).
   - **Extracción de `arkd-signer`:** Desde `arkd v0.9.25` (PR `#126`), el firmante de VTXOs del operador corre como servicio independiente (`ghcr.io/arkade-os/arkd-signer:v0.9.25`) en el puerto interno `6061` (`ARKD_SIGNER_ADDR=arkd-signer:6061`).
   - **Finalización one-shot y co-firma on-chain:** `arkd v0.9.25` introduce `CosignOnchainTx`, `indexer.GetUtxos` y finalización de transacciones off-chain en el envío (`submit_offchain_tx_oneshot`), además de mantener compatibilidad con el flujo de dos pasos (`submit_offchain_tx` + `finalize_offchain_tx`).
3. **Por qué se fija `v0.9.25` como imagen primaria y `v0.9.26` como secundaria:**
   - El archivo oficial `.env.regtest` de `arkade-os/rust-sdk` en el tag `v0.12.1` fija explícitamente `ARKD_IMAGE=ghcr.io/arkade-os/arkd:v0.9.25`, `ARKD_WALLET_IMAGE=ghcr.io/arkade-os/arkd-wallet:v0.9.25` y `ARKD_SIGNER_IMAGE=ghcr.io/arkade-os/arkd-signer:v0.9.25`.
   - `arkd v0.9.26` añade la validación `"Reject all intents spending inputs with CSV tapleaves (#203)"`; por tanto, `v0.9.25` se establece como pin primario garantizado por el CI de `rust-sdk v0.12.1`, permitiendo probar `v0.9.26` mediante variable de entorno en `deploy/ark/ark.regtest.env.example`.

---

## 3. Toolchains, Runtimes e Imágenes del Stack Regtest Oficial

### 3.1 Toolchains y runtimes de desarrollo

| Herramienta | Requisito mínimo oficial | Versión verificada en entorno local | Versión empleada por upstream | Uso en este proyecto |
| --- | --- | --- | --- | --- |
| **Rust (`rustc` / `cargo`)** | **MSRV `1.86.0`** (`edition = "2021"`, `resolver = "2"`) | `rustc 1.97.1 (8bab26f4f 2026-07-14)` / `cargo 1.97.1 (c980f4866 2026-06-30)` | `stable` en CI (`dtolnay/rust-toolchain@master`), check MSRV `1.86` con `Cargo-minimal.lock` | Compilación y ejecución del workspace `ark/` (binario CLI, librería cliente, tests unitarios y E2E). |
| **Node.js** | `>= 22.0.0` (en `swap-engine`) | `v22.23.2` (local) / `v22.22.1` (VM Ubuntu) | `node-version: '20'` en `e2e-core.yml` de `rust-sdk`; `node-version: 24` en CI de `swap-engine` | Ejecución de `npm run secrets:check` y scripts auxiliares. El stack Ark en `scripts/ark/` usará Bash + `docker compose` + `curl`/`jq` sin requerir `pnpm`. |
| **Contenedores** | Docker Engine + Compose v2 (o Podman 4.3+ con `podman-compose`) | `podman 4.3.1` / `podman-compose 1.6.0` (local) | Docker Compose v2 en `ubuntu-latest` | Aislamiento completo del stack `swap-engine-ark-regtest`. |
| **Go** | No requerido en host (ejecución vía imágenes GHCR) | `go1.23.5 linux/amd64` (local) | `golang:1.27.3` dentro del `Dockerfile` de `arkd v0.9.25/v0.9.26` | `arkd`, `arkd-wallet` y `arkd-signer` se ejecutan desde imágenes oficiales precompiladas (`ghcr.io/arkade-os/*`), evitando instalar Go `1.27.3` en el host. |
| **SQLite** | Incluido vía crate `rusqlite = "0.32"` (`features = ["bundled"]`) | Bundled en compilación Cargo | `rusqlite 0.32` / `sqlx 0.8` | Persistencia local de contratos (`SqliteContractStore`) para las wallets cliente A y B bajo `data/ark/`. |

### 3.2 Imágenes de contenedores del laboratorio Regtest Arkade

Basado en `ArkLabsHQ/arkade-regtest` (`a1b4fdc859b41281d00d16596408055f254225bf`) y `arkade-os/rust-sdk/.env.regtest` (`v0.12.1`), depurado para **excluir estrictamente LND, solvers Lightning/EVM y frontends web**:

| Servicio en `deploy/ark/` | Imagen oficial fijada | Rol en el stack Arkade | ¿Requerido en #48–#53? |
| --- | --- | --- | --- |
| `bitcoin` | `btcpayserver/bitcoin:31.0` | Nodo Bitcoin Core 31.0 en `regtest` exclusivo del laboratorio Ark (`txindex=1`, `blockfilterindex=1`, `fallbackfee=0.00001`, `minrelaytxfee=0`, soporte TRUC/P2A y `submitpackage`). | **Sí (Core dedicado)** |
| `postgres` | `postgres:16` | Base de datos relacional compartida internamente por `nbxplorer` (DB `nbxplorer`) y `arkd` (DBs `projection` y `event` con `ARKD_PG_DB_AUTOCREATE=true`). | **Sí** |
| `nbxplorer` | `nicolasdorier/nbxplorer:2.6.7` | Indexador UTXO para `arkd-wallet`. Requiere `>= 2.6.1` para compatibilidad con `getpeerinfo` de Bitcoin Core 31.0 (`NBXplorer#545`). | **Sí** |
| `fulcrum` | `cculianu/fulcrum:v2.1.1` | Servidor Electrum indexador que alimenta al backend Esplora (`mempool_api`). | **Sí** |
| `mempool_mariadb` | `mariadb:10.5` | Base de datos interna para `mempool_api`. | **Sí** |
| `mempool_api` | `mempool/backend:v3.3.1` | Backend del explorador local conectado a `bitcoin` y `fulcrum`. | **Sí** |
| `mempool_web` | `mempool/frontend:v3.3.1` | Proxy HTTP que expone la API REST compatible con Esplora bajo `/api` consumida por `arkd` (`ARKD_ESPLORA_URL`) y `ark-bdk-wallet`. | **Sí** |
| `redis` | `redis:7-alpine` | Live store en memoria requerido por `arkd v0.9.25+` (`ARKD_LIVE_STORE_TYPE=redis`). | **Sí** |
| `arkd-wallet` | `ghcr.io/arkade-os/arkd-wallet:v0.9.25` | Demonio de wallet on-chain del operador conectado a `nbxplorer:32838`. | **Sí** |
| `arkd-signer` | `ghcr.io/arkade-os/arkd-signer:v0.9.25` | Servicio firmante de VTXOs del operador (puerto interno `6061`, sin publicación al host). | **Sí** |
| `arkd` | `ghcr.io/arkade-os/arkd:v0.9.25` | Operador Arkade (API pública gRPC/REST en `7070`, Admin API en `7071`, más binario CLI interno `ark`). | **Sí** |
| `emulator` | `ghcr.io/arkade-os/emulator:v0.0.9` | Introspector/firmante de `arkade-script` (puerto `7073`). | **Opcional (perfil `emulator`)** — No requerido para flujos estándar VTXO A/B (#48–#53). |
| `lnd`, `lnd-peer`, `intent-solver`, `solver`, `covclaimd`, `lnurl-server`, `fulmine-delegator`, `strfry`, `bucket-sync`, `arkade-wallet`, `arkade-explorer`, `anvil` | *(Presentes en `arkade-regtest` upstream)* | Servicios de Lightning, Nostr, EVM y UI web del harness general de Ark Labs. | **PROHIBIDOS / EXCLUIDOS** — Omitidos del compose de `deploy/ark/` por límite de alcance (#46). |

> **Hallazgo clave de aislamiento frente a `arkade-regtest` upstream:** En `ArkLabsHQ/arkade-regtest/docker/compose.base.yml`, el contenedor `lnd` (`btcpayserver/lnd:v0.19.3-beta`) forma parte del perfil `base` y publica por defecto los puertos `9735` y `10009`, mientras `bitcoin` publica `18443` y `mempool_web` publica `3000`. Ejecutar `arkade-regtest` sin modificar colisionaría directamente con `LQWD-SWAPS` (`3000`, `9735`, `10009`, `18443`) y levantaría un nodo LND no autorizado. Por ello, `deploy/ark/docker-compose.regtest.yml` define **únicamente** los servicios de cadena/indexación/operador Ark sin ningún contenedor `lnd`, con prefijo `ark_lab_` y puertos de loopback en el rango `30000–39999`.

---

## 4. Crates del Workspace `arkade-os/rust-sdk` (`v0.12.1`) y Dependencias Clave

### 4.1 Crates oficiales a utilizar en `ark/Cargo.toml`

| Crate | Versión | Propósito | Features requeridas |
| --- | --- | --- | --- |
| `ark-core` | `0.12.1` | Tipos de protocolo Arkade (`ArkAddress`, `Vtxo`, `VtxoList`, `VirtualTxOutPoint`, `BoardingOutput`, `SendReceiver`, `server::Info`, `history`, `unilateral_exit`, `batch`, `intent`). | Default |
| `ark-client` | `0.12.1` | Cliente de alto nivel (`OfflineClient`, `Client`, `OffChainBalance`, `Bip32KeyProvider`, `StaticKeyProvider`, `SqliteContractStore`, `MemoryContractStore`, `Blockchain`, `OnchainWallet`). | `["sqlite", "tls-native-roots"]` (y `"test-utils"` en dev/tests si se inspeccionan TXs on-chain sin transmitir) |
| `ark-bdk-wallet` | `0.12.1` | Implementación de `ark_client::wallet::OnchainWallet` respaldada por `bdk_wallet` (descriptores Taproot `Bip86`) y `esplora_client`. | Default |
| `ark-grpc` | `0.12.1` | Cliente de transporte gRPC (`ark_grpc::Client`) hacia `arkd` (`7070`). | Default |
| `ark-rest` | `0.12.1` | Cliente REST OpenAPI (`ark_rest::Client`) para consultas HTTP ligeras (`/v1/info`). | Default |
| `ark-fees` | `0.12.1` | Evaluador de programas CEL para cálculo de comisiones de `arkd` (`offchain_input`, `onchain_input`, `offchain_output`, `onchain_output`). | Default |

### 4.2 Dependencias directas de soporte en el workspace `ark/`

- `bitcoin = { version = "0.32.7", features = ["rand", "serde"] }`
- `bip39 = "2.1"` (o generación de semilla hex de 32 bytes / `Xpriv::new_master`)
- `esplora-client = "0.11"` (para la implementación de `ark_client::Blockchain` contra `http://127.0.0.1:33000/api`)
- `reqwest = { version = "0.12", features = ["json"] }` (para llamadas JSON-RPC directas al Bitcoin Core aislado en `http://127.0.0.1:38443`: `gettxout`, `getrawtransaction`, `submitpackage`, `getblockchaininfo`)
- `tokio = { version = "1.41.0", features = ["macros", "rt-multi-thread", "sync", "time"] }`
- `serde = { version = "1.0", features = ["derive"] }` y `serde_json = "1.0"`
- `clap = { version = "4.5", features = ["derive"] }`
- `anyhow = "1.0"` y `tracing = "0.1.37"` / `tracing-subscriber = "0.3"`
- `rand = "0.8"`

---

## 5. Mapeo de APIs Concretas del SDK por Flujo Funcional (#48–#54)

> **Convención de estado:**
> - **VERIFICADO EN SDK (`v0.12.1`):** Firma, tipos y comportamiento confirmados en el código fuente oficial de `arkade-os/rust-sdk` tag `v0.12.1`.
> - **PENDIENTE DE EJECUCIÓN (#48–#54):** Código del laboratorio local bajo `ark/` y ejecución real contra contenedores en regtest que se implementará en los issues posteriores a #47.

### 5.1 Lectura de Estado del Operador y Salud (#48, #54)

- **Estado:** **VERIFICADO EN SDK (`v0.12.1`)** / **PENDIENTE DE EJECUCIÓN (#48, #54)**
- **APIs concretas:**
  1. `ark_rest::Client::new(ark_server_url: String)` -> `client.get_info().await -> Result<ark_core::server::Info, ark_rest::Error>`
     - Consulta HTTP REST sin requerir wallet local (ideal para healthcheck y lectura en #48 y #54).
  2. `ark_grpc::Client::new(ark_server_url: String)` -> `client.connect().await?` -> `client.get_info().await -> Result<ark_core::server::Info, ark_grpc::Error>`
  3. `ark_client::Client::server_info(&self).await -> Result<ark_core::server::Info, ark_client::Error>` (con caché TTL `server_info_ttl`) y `Client::refresh_server_info(&self).await` (lectura forzada sin caché).
- **Campos de `ark_core::server::Info` verificados (`ark-core/src/server.rs`):**
  - `version: String`
  - `signer_pk: bitcoin::secp256k1::PublicKey`
  - `forfeit_pk: bitcoin::secp256k1::PublicKey`
  - `forfeit_address: bitcoin::Address`
  - `checkpoint_tapscript: bitcoin::ScriptBuf`
  - `network: bitcoin::Network` (debe validarse `== bitcoin::Network::Regtest`)
  - `session_duration: u64`
  - `unilateral_exit_delay: bitcoin::Sequence`
  - `boarding_exit_delay: bitcoin::Sequence`
  - `utxo_min_amount: Option<Amount>`, `utxo_max_amount: Option<Amount>`
  - `vtxo_min_amount: Option<Amount>`, `vtxo_max_amount: Option<Amount>`
  - `dust: bitcoin::Amount` (accesible también vía `client.dust().await?`)
  - `fees: Option<FeeInfo>` (`intent_fee.{offchain_input, onchain_input, offchain_output, onchain_output}`, `tx_fee_rate`)
  - `scheduled_session: Option<ScheduledSession>`
  - `deprecated_signers: Vec<DeprecatedSigner>`
  - `service_status: HashMap<String, String>`
  - `digest: String`, `max_tx_weight: i64`, `max_op_return_outputs: i64`

### 5.2 Creación de Wallets Cliente A y B, Direcciones, Balances y Persistencia VTXO (#49)

- **Estado:** **VERIFICADO EN SDK (`v0.12.1`)** / **PENDIENTE DE EJECUCIÓN (#49)**
- **Inicialización de identidad y almacenamiento persistente (`ark-client/src/lib.rs`, `ark-bdk-wallet/src/lib.rs`):**
  1. ** Derivación HD BIP32:**
     - `let xpriv = bitcoin::bip32::Xpriv::new_master(bitcoin::Network::Regtest, &seed_bytes)?;`
     - `Bip32KeyProvider::new(xpriv, derivation_path)` (por defecto `ark_core::DEFAULT_DERIVATION_PATH`).
  2. **Wallet on-chain auxiliar (BDK):**
     - `let bdk_wallet = Arc::new(ark_bdk_wallet::Wallet::new_from_xpriv(xpriv, Network::Regtest, "http://127.0.0.1:33000/api")?);`
  3. **Persistencia SQLite de contratos VTXO y Boarding:**
     - `let contract_store = ark_client::SqliteContractStore::new("data/ark/wallets/alice/contracts.sqlite")?;`
     - `let swap_storage = Arc::new(ark_client::InMemorySwapStorage::default());` (o `SqliteSwapStorage::new(...)` si se requiere).
  4. **Construcción y conexión del cliente para Alice (Wallet A) y Bob (Wallet B):**
     ```rust
     let config = OfflineClientConfig {
         ark_server_url: "http://127.0.0.1:37070".to_string(),
         boltz_url: "http://127.0.0.1:39069".to_string(), // placeholder inactivo; no se ejecutan swaps Boltz/LN
         timeout: Duration::from_secs(30),
         server_info_ttl: Duration::from_secs(60),
         ..Default::default()
     };
     let client = OfflineClient::with_bip32(
         config,
         xpriv,
         None,
         blockchain.clone(),
         bdk_wallet.clone(),
         swap_storage,
     )
     .with_contract_store(Box::new(contract_store))
     .connect_with_retries(5)
     .await?;
     ```
- **Generación de direcciones y listado de contratos:**
  - `client.get_offchain_address().await -> Result<(ArkAddress, Vtxo), Error>` (dirección Ark regtest `tark1...`, persiste automáticamente el `DefaultVtxoContract` activo en `ContractManager`).
  - `client.get_offchain_addresses().await -> Result<Vec<(ArkAddress, Vtxo)>, Error>`
  - `client.get_boarding_address().await -> Result<bitcoin::Address, Error>` (dirección Taproot on-chain de boarding `bcrt1p...`, persiste `BoardingContract`).
  - `client.get_boarding_addresses().await -> Result<Vec<bitcoin::Address>, Error>`
  - `client.get_onchain_address() -> Result<bitcoin::Address, Error>` (dirección on-chain estándar BDK `bcrt1p...`).
  - `client.list_contracts().await -> Result<Vec<ContractInfo>, Error>`
- **Consulta de balances, listado de VTXOs y recuperación tras reinicio:**
  - `client.offchain_balance().await -> Result<OffChainBalance, Error>`:
    - `.confirmed() -> Amount` (VTXOs en hoja de árbol de batch confirmado: `is_preconfirmed == false`)
    - `.pre_confirmed() -> Amount` (VTXOs recibidos por transferencia off-chain pendientes de incluir en batch: `is_preconfirmed == true`)
    - `.recoverable() -> Amount` (VTXOs expirados, swept o sub-dust recuperables en el siguiente `settle`)
    - `.pending_recovery() -> Amount` (VTXOs bajo firmante deprecado tras cutoff)
    - `.total() -> Amount` (`pre_confirmed + confirmed + recoverable + pending_recovery`)
  - `client.list_vtxos().await -> Result<AnnotatedVtxoList, Error>` (histórico completo).
  - `client.list_vtxos_filtered(GetVtxosRequestFilter::Renewable).await -> Result<AnnotatedVtxoList, Error>` (VTXOs no gastados: spendable + recoverable).
  - `client.list_vtxos_filtered(GetVtxosRequestFilter::Spendable).await -> Result<AnnotatedVtxoList, Error>` (VTXOs seleccionables para pago off-chain).
  - `client.restore_contracts(ark_client::DEFAULT_GAP_LIMIT).await -> Result<ContractRestoreReport, Error>` (redescubre claves HD e hidrata contratos off-chain y boarding desde el indexador `arkd` y `Blockchain`).

### 5.3 Boarding On-Chain BTC → Ark y Creación de VTXOs (#50)

- **Estado:** **VERIFICADO EN SDK (`v0.12.1`)** / **PENDIENTE DE EJECUCIÓN (#50)**
- **Secuencia de APIs (`ark-client/src/batch.rs`):**
  1. `let boarding_addr = alice.get_boarding_address().await?;`
  2. Fondeo on-chain en el Bitcoin Core aislado (`127.0.0.1:38443`) hacia `boarding_addr` y minado de 1 bloque (`generatetoaddress`).
  3. Verificación del UTXO de boarding vía `blockchain.find_outpoints(&boarding_addr).await?` (confirmando `outpoint`, `amount`, `confirmations >= 1`, `!is_spent`).
  4. Participación en la ronda/batch del operador para convertir el UTXO de boarding en un VTXO confirmado:
     - `let commitment_txid: Option<Txid> = alice.settle(&mut rng).await?;`
     - Alternativa con selección explícita de outpoints: `alice.settle_vtxos(&mut rng, &[], &[boarding_outpoint]).await?;`
  5. Minado de 1 bloque en Core local y verificación post-boarding:
     - `alice.offchain_balance().await?.confirmed()` refleja el monto ingresado (menos `onchain_input` fee configurada en `arkd`).
     - `alice.list_vtxos_filtered(GetVtxosRequestFilter::Spendable).await?` lista el nuevo `VirtualTxOutPoint` con `is_preconfirmed == false` y `commitment_txids` conteniendo `commitment_txid`.

### 5.4 Transferencia Off-Chain Ark Wallet A → Wallet B (#51)

- **Estado:** **VERIFICADO EN SDK (`v0.12.1`)** / **PENDIENTE DE EJECUCIÓN (#51)**
- **Secuencia de APIs (`ark-client/src/send_vtxo.rs`):**
  1. Wallet B genera dirección de recepción:
     - `let (bob_ark_addr, _vtxo) = bob.get_offchain_address().await?;`
  2. Wallet A construye el receptor y envía:
     - `let receiver = ark_core::send::SendReceiver::bitcoin(bob_ark_addr, Amount::from_sat(100_000));`
     - Con selección automática de VTXOs:
       `let ark_txid: Txid = alice.send(vec![receiver]).await?;`
     - Con selección explícita de VTXOs por `OutPoint`:
       `let ark_txid: Txid = alice.send_selection(&[selected_vtxo_outpoint], vec![receiver]).await?;`
  3. Verificación inmediata tras `send` (estado **pre-confirmado**):
     - En Wallet B: `bob.offchain_balance().await?.pre_confirmed() == Amount::from_sat(100_000)`.
     - En Wallet A: el VTXO de entrada pasa a `is_spent == true` (`spent_by: Some(checkpoint_txid)`, `ark_txid: Some(ark_txid)`) y el VTXO de cambio aparece como `pre_confirmed()`.
  4. Opcional — Elevación a VTXO confirmado en árbol de batch (`settle_all`):
     - `let batch_txid = bob.settle_all(&mut rng).await?;` -> mueve el saldo de Bob de `pre_confirmed()` a `confirmed()`.
  5. **Recuperación ante fallos/respuestas ambiguas entre `submit` y `finalize` (#51, #53):**
     - `alice.list_pending_offchain_txs().await -> Result<Vec<PendingTx>, Error>`
     - `alice.continue_pending_offchain_txs().await -> Result<Vec<Txid>, Error>`
     - `alice.finalize_pending_offchain_tx(ark_txid).await -> Result<(), Error>`

### 5.5 Offboarding Ark → Bitcoin On-Chain y Salida Unilateral (#52)

- **Estado:** **VERIFICADO EN SDK (`v0.12.1`)** / **PENDIENTE DE EJECUCIÓN (#52)**
- **Mecanismo 1 — Salida Cooperativa Estándar (`collaborative_redeem`, `ark-client/src/batch.rs`):**
  - `bob.collaborative_redeem(&mut rng, onchain_dest_address, amount).await -> Result<Txid, Error>`
  - `bob.collaborative_redeem_vtxo_selection(&mut rng, selected_outpoints.into_iter(), onchain_dest_address, amount).await -> Result<Txid, Error>`
  - **Semántica:** El cliente se une al siguiente batch de `arkd` con `BatchOutputType::OffBoard`. El operador incluye un output on-chain directo a `onchain_dest_address` en la transacción de compromiso (`commitment_txid`) y devuelve el cambio como nuevo VTXO off-chain, descontando `eval_onchain_output_fee`.
- **Mecanismo 2 — Salida Unilateral / Rescate sin cooperación del operador (`ark-client/src/unilateral_exit.rs`):**
  1. **Desenrollado (Unroll) del árbol virtual a la cadena (`build_unilateral_exit_trees` + `broadcast_next_unilateral_exit_node`):**
     - `let branches: Vec<Vec<Transaction>> = alice.build_unilateral_exit_trees().await?;`
     - Para cada `branch` en `branches`, iterar llamando `alice.broadcast_next_unilateral_exit_node(&branch).await?`.
     - **Requisito importante verificado en `unilateral_exit.rs` (líneas 6885–6898):** Cada transacción virtual del árbol tiene fee cero y un output P2A (*Pay-to-Anchor*). `broadcast_next_unilateral_exit_node` llama internamente a `self.bump_tx(parent_tx).await?`, que selecciona UTXOs on-chain del `ark_bdk_wallet::Wallet` del cliente para construir una transacción hija CPFP (`ark_core::build_anchor_tx`) y transmite el paquete `[parent_tx, &child_tx]` mediante el método `submitpackage` de Bitcoin Core (`Blockchain::broadcast_package`). Cada nodo del árbol debe confirmarse en bloque antes de poder hacer bump del siguiente nodo hijo.
  2. **Reclamación on-chain tras vencer el timelock CSV (`send_on_chain`):**
     - Una vez que el VTXO hoja está confirmado on-chain (o si se rescata un `BoardingOutput` cuyo operador desapareció antes de hacer `settle`) y ha transcurrido el retardo relativo `OP_CSV` (`unilateral_exit_delay` o `boarding_exit_delay`, expresado en bloques o múltiplos de 512 segundos según la configuración de `arkd`), se invoca:
       `let spend_txid: Txid = alice.send_on_chain(to_onchain_address, to_amount).await?;`
     - Nota de implementación verificada en `ark-client/src/unilateral_exit.rs` (línea 6993): `create_send_on_chain_transaction_inner` aplica actualmente un fee fijo de `1_000 sats` (`Amount::from_sat(1_000)`).

---

## 6. Comando de Arranque Reproducible del Stack Regtest Aislado (#47 / #48)

El laboratorio Arkade regtest de este repositorio se gestionará mediante `deploy/ark/docker-compose.regtest.yml` y `scripts/ark/bootstrap-regtest.sh`, usando el proyecto Docker Compose exclusivo `swap-engine-ark-regtest`:

```bash
# 1. Verificar que los contenedores/procesos existentes de LQWD-SWAPS no se tocan
#    y levantar únicamente el stack regtest aislado de Arkade en puertos 127.0.0.1:3xxxx:
docker compose \
  -p swap-engine-ark-regtest \
  -f deploy/ark/docker-compose.regtest.yml \
  --env-file deploy/ark/ark.regtest.env.example \
  up -d

# 2. Ejecutar bootstrap determinista (minado inicial en Core aislado 127.0.0.1:38443,
#    creación/desbloqueo/fondeo de arkd-wallet en 127.0.0.1:37071 y verificación de /v1/info en 127.0.0.1:37070):
bash scripts/ark/bootstrap-regtest.sh

# 3. Verificar salud de arkd (network=regtest, signerPubkey, delays):
curl -sf http://127.0.0.1:37070/v1/info | jq .
```

---

## 7. Resumen de Estado de Verificación (#47)

| Elemento | Estado actual | Fuente / Evidencia |
| --- | --- | --- |
| Selección de `arkade-os/rust-sdk` (`v0.12.1`) y comparativa con `ts-sdk` (`0.5.8` / `v0.4.27`) | **VERIFICADO Y DOCUMENTADO (#47)** | GitHub API `repos/arkade-os/rust-sdk`, `repos/arkade-os/ts-sdk` |
| Pin de `arkade-os/arkd` (`v0.9.25` primario / `v0.9.26` patch) e imágenes GHCR | **VERIFICADO Y DOCUMENTADO (#47)** | `arkade-os/rust-sdk/.env.regtest` (`v0.12.1`), `repos/arkade-os/arkd/releases` |
| Detección y eliminación del contenedor `lnd` oculto en el perfil `base` de `arkade-regtest` | **VERIFICADO Y DOCUMENTADO (#47)** | `ArkLabsHQ/arkade-regtest/docker/compose.base.yml` (líneas 254–296) |
| Mapeo de APIs Rust (`OfflineClient`, `Client`, `SqliteContractStore`, `settle`, `send`, `collaborative_redeem`, `build_unilateral_exit_trees`, `send_on_chain`) | **VERIFICADO EN CÓDIGO FUENTE OFICIAL (#47)** | `ark-client/src/{lib,batch,send_vtxo,unilateral_exit}.rs` en tag `v0.12.1` |
| Despliegue de contenedores y bootstrap real (#48) | **PENDIENTE DE EJECUCIÓN (#48)** | Planificado en `docs/ark/implementation-plan.md` |
| Wallets A/B (#49), Boarding (#50), Transferencia A→B (#51), Offboarding (#52), Harness/Runbook (#53) y propuesta `ArkAdapter` (#54) | **PENDIENTE DE EJECUCIÓN (#49–#54)** | Planificado en `docs/ark/implementation-plan.md` |
