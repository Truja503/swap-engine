# ArkAdapter: contrato propuesto para el laboratorio regtest

Entrega de [#54](https://github.com/Truja503/swap-engine/issues/54), bajo
[#46](https://github.com/Truja503/swap-engine/issues/46), en la rama
`ark-regtest-46-54`, sobre los flujos #50–#53. El
[contrato Rust](../../ark/ark-lab/src/adapter.rs) vive en `ark/ark-lab`; no es
una API pública ni un cambio al motor. El único cliente Ark del lab sigue
siendo [`arkade-os/rust-sdk` v0.12.1](https://github.com/arkade-os/rust-sdk/tree/v0.12.1)
(`352ca21bcaa01d3ddb535b0ebfb20cd9b028c357`), con `arkd` v0.9.25.

## API y responsabilidades

Una instancia está ligada a una identidad de wallet y un operador. `scope()`
expone `Regtest / Btc`; `Amount` representa satoshis enteros, `VtxoId` distingue
outpoints virtuales de outpoints Bitcoin. Identificar igualmente la cadena por
su genesis de regtest (`ark:status`) y, para una futura ejecución, fijar la
identidad del operador y verificarla antes de firmar. `tark1` por sí solo no
identifica regtest: también se usa en otras redes de prueba. Comparar el
firmante embebido en el destino Ark con el firmante activo del operador
verificado. Toda salida Bitcoin debe ser witness `bcrt1` validada; se excluye
Base58, cuyo prefijo puede coincidir con testnet.

| Operación | Wallet local | `arkd` / Bitcoin Core aislado | Demostrador |
| --- | --- | --- | --- |
| `balance()` | Deriva/lee contratos de la wallet elegida | `offchain_balance` consulta el indexador de `arkd` | Lectura real |
| `vtxos()` | Identifica los contratos de esa wallet | `list_vtxos` devuelve historial, incluidos gastados, con outpoint, importe, expiración y compromisos | Lectura real |
| `fee_policy()` | No requiere wallet ni claves | `GetInfo` público (gRPC): dust, mínimos/máximos, identidad y política de fees anunciada; ausencia de política no significa cero | Lectura real |
| `quote(intent, max_user_fee)` | Fija input, importe neto al destino y tope de fee | Necesita política vigente, estado del input y, cuando corresponda, una vista vigente de Core | Contrato |
| `submit(Transfer)` | Firma sobre un VTXO específico, envía a un destino Ark | `submit_offchain_tx` y finalización de **esa** transacción | Contrato; flujo #51 en CLI |
| `submit(Boarding)` | Usa un UTXO de boarding propio y existente; no crea ni fondea la transacción de depósito | Comprobar en Core salida, valor, confirmación y vigencia; `settle_vtxos` en el batch de `arkd` | Contrato; flujo #50 en CLI |
| `submit(Offboarding)` | Firma el intento sobre un VTXO específico y un destino Bitcoin | `collaborative_redeem_vtxo_selection` en `arkd`; Core valida el importe y script exactos del payout | Contrato; flujo #52 en CLI |
| `status(id)`, `proof(id)` | Buscan el intento original en el registro local | Correlacionan datos del indexador y, para confirmación Bitcoin, de la cadena activa en Core | Contrato |
| `recover(id)` | Reconcilia intento/inputs originales; no crea otro pago | Puede finalizar exclusivamente el TXID Ark original aún pendiente y conciliado | Contrato |

`RegtestReadAdapter` implementa exclusivamente las tres lecturas marcadas;
`quote`, `submit`, `status`, `proof` y `recover` devuelven
`UnsupportedCapability`. No se reutiliza el CLI de #50–#53 como ejecutor de
este contrato: carece del journal duradero y del mecanismo de cotización que
exige la interfaz. Las lecturas de wallet pueden abrir archivos locales de
lock/contratos, pero no firman, emiten transacciones ni necesitan Admin API.
`vtxos()` lista el historial del fixture, no es una API de paginación para
wallets con historial ilimitado. Los buckets de saldo son una vista de `arkd`:
`batch_confirmed` implica clasificación hoja de batch por el SDK, no una
verificación independiente en Core. `recoverable` y `pending_recovery` no son
fondos seleccionables para transferencia; `total` no es saldo disponible.

## Estado, evidencia y finalidad

- `Prepared`: intento reservado localmente; todavía no hay evidencia remota
  positiva. Un `Prepared` encontrado tras una caída puede haber cruzado el
  punto de envío: reconciliar, no reenviar.
- `Submitted`: TXID o ronda original observado. No demuestra pago. Para
  transfer usar el TXID Ark y reconciliar tanto el consumo del VTXO remitente
  como el VTXO receptor, su destino/importe y el fin del estado pendiente;
  solo entonces `Preconfirmed` y `TransferReceipt`. Que no esté pendiente no
  basta. No confundir `spent_by` (checkpoint/forfeit) con `ark_txid` (gasto Ark).
  La confirmación de un ancestro no convierte una transferencia en Bitcoin
  confirmado; incluirla después en otro batch es otra operación.
- `AwaitingConfirmations` / `Confirmed`: la política propuesta del lab pide
  al menos un bloque en la cadena activa (no finalidad irreversible). Boarding
  requiere enlazar funding original, compromiso en cadena y VTXO acreditado
  al importe prometido; offboarding requiere el outpoint exacto en el
  compromiso, con script e importe esperados. Sus evidencias incluyen TXID,
  block hash, altura y profundidad observada. Un reorg puede retirar la
  evidencia y revertir el estado a `AwaitingConfirmations` o `Uncertain`.
- `Uncertain` significa que pudo ocurrir un efecto remoto. `Rejected` exige
  evidencia concluyente de que el intento no se ejecutó. `proof == None`
  significa evidencia actual insuficiente para un intento **conocido**.
  Un ID no registrado es `UnknownOperation`, no `Rejected`.

El tipo `Proof` sólo contiene referencias de evidencia verificadas en un punto
del tiempo, no una prueba criptográfica portable ni una autorización de gasto.
La salida unilateral, sus árboles/checkpoints, CPFP y bloqueos CSV quedan
fuera del contrato; ver las [limitaciones del runbook](regtest-runbook.md#recovery-and-uncertainty).

## Cotización, plazos y recuperación

1. **Quote:** cotización indicativa en BTC sats, sin reservar liquidez.
   Ligada al ámbito wallet/operador, al input explícito, destino, importe y
   método exactos (en boarding el ámbito de wallet es el destino). TTL
   máximo 30 s, menor si vence antes la ronda, la política o la ventana segura
   del input. Sin ventana segura, rechazar. Validar `max(dust, min)` y máximo
   anunciado cuando corresponda por tipo de salida, importes no nulos,
   importe de entrada suficiente y cambio cero o válido; no seleccionar otro
   input, crear dust ni destruir cambio implícitamente. Aplicar además
   cualquier límite inferior de riesgo/inventario del ejecutor.
2. **Fees:** topes separados para fee del operador y fee Bitcoin imputable
   al usuario, cuya suma se comprueba sin overflow contra `max_user_fee`.
   El fee de la transacción compartida del batch no es necesariamente el
   coste del usuario. Al primer submit, verificar política y estado frescos,
   importe neto exacto y que ambos topes pueden respetarse incluyendo cambios
   programados de ronda; sin datos suficientes, rechazar/no ofrecer
   cotización. Los parámetros de `GetInfo` no constituyen estimación y no
   representan un precio garantizado.
3. **Idempotencia:** `OperationId` generado por el llamador, único dentro de
   una wallet y operador registrados. Comparar primero el payload canónico
   completo (tipo, input, destino, importe, quote ID). Mismo ID y payload
   devuelve el estado del original aunque expire el quote; ID igual con
   payload distinto → `IdempotencyConflict`. Para un intento nuevo, validar
   el quote y reservar el input y la clave en una transacción **duradera**
   antes del primer envío; mantener exclusión por input entre claves distintas.
   Persistir referencias remotas tan pronto se obtengan. La idempotencia sería
   local al adaptador, no una promesa de `arkd` ni de exactly-once distribuido.
4. **Plazos:** lectura 5 s; presupuestos propuestos de submit 30 s para
   transfer y 120 s para batch (boarding/offboarding), sin incluir la espera
   por profundidad en Bitcoin. `Timeout` antes del punto de envío; desde que
   pudo haberse enviado, timeout/desconexión/cancelación ⇒
   `SubmissionUncertain(id)` o intento pendiente de reconciliar. Cancelar una
   espera local no cancela una operación remota. Los límites de submit aquí
   son contractuales, no nuevos deadlines impuestos al CLI existente.
5. **Recuperación:** reabrir journal y consultar `status/proof`; conservar
   reserva hasta conclusión. Para transfer, consultar el pendiente exacto,
   luego reconciliar ambas wallets/destino y el input original; `recover`
   puede finalizarlo, no sustituirlo. Para boarding, cotejar el funding
   original (mempool y cadena), su estado y el compromiso/VTXO asociado; no
   volver a fondear. Para offboarding, comprobar el VTXO original (`settled_by`)
   y salida exacta en Core. Si los datos no permiten vincular el intento sin
   ambigüedad, mantener `Uncertain` y pedir revisión; no liberar ni sustituir
   por la mera ausencia de un registro. Un fallo de lectura de Core, `arkd`
   o almacenamiento no es evidencia de no ejecución.

Los errores tipados distinguen red/operador/asset incorrectos, input no
gastable, límites o quote inválido/vencido, wallet ocupada o inaccesible,
operador/cadena inaccesible, lectura SDK fallida, timeout pre-envío,
resultado incierto, conflicto, operación desconocida y capacidad no soportada.
La respuesta pública de diagnóstico no incluye seeds, PSBTs, datos de
autenticación, SQL ni errores crudos de SDK.

## Lightning ↔ Ark: solo diseño, sin atomicidad

- **Solver externo:** opción para una futura revisión: un solver con
  inventario/riesgo propio cotiza y gestiona ambas legs. LN → Ark: recibe el
  pago de una factura y entrega un VTXO al destino pactado; Ark → LN: recibe
  un VTXO y paga la factura del usuario. Correlacionar hash de factura,
  importe/expiración, `OperationId` Ark y evidencia de ambas legs. El solver
  no obtiene las claves de la wallet cliente. El estado comercial del solver
  no sustituye la verificación de cada leg. La dirección de ejecución y quién
  asume el riesgo de la primera leg deben acordarse explícitamente.
- **Composición de legs:** un coordinador futuro podría reservar inventario,
  ejecutar y reconciliar cada leg por separado, con estado durable, límites,
  expiraciones y estados explícitos de ejecución parcial o ambigua. Un
  reembolso/compensación es una **nueva operación**, no un rollback, y
  requiere política de autorización y fondos. No publicar una cotización si
  no se pueden acotar plazos, liquidez y riesgo; ante ambigüedad no repetir
  ciegamente el pago de ninguna leg.

Ni una preimagen de Lightning acredita entrega Ark, ni una preconfirmación
Ark acredita liquidación Lightning. No se garantiza atomicidad, compensación
automática ni liquidación conjunta. No se añade ningún solver, cliente
Lightning, API de swaps ni cambio en el motor.

## Reproducción y alcance de la evidencia

Desde la raíz del worktree:

```sh
# Mocks declarados: no necesitan servicios; journal y respuestas son sintéticos.
cargo test --manifest-path ark/Cargo.toml --locked -p ark-lab --test adapter_contract

# Lectura REAL (requiere el fixture de #53 completado en este mismo lab).
npm run ark:start
npm run ark:status
cargo test --manifest-path ark/Cargo.toml --locked -p ark-lab --test adapter_arkd_read -- --ignored --nocapture
npm run ark:stop
```

Si el fixture no existe, provisionarlo **una sola vez** con el
[runbook de #53](regtest-runbook.md). No repetir el fondeo si ya existe o su
estado es incierto. La prueba live consulta `GetInfo`, saldo de Alice y su
historial VTXO del fixture, sin minar, fondear, transferir ni renovar; se
excluye por defecto de las pruebas offline. Los mocks cubren cotización,
límites, reintento idempotente, conflicto de payload, recuperación ambigua,
separación del recibo Ark y confirmación Bitcoin, y pérdida de evidencia por
reorg. No prueban persistencia real, imposición de topes en `arkd` ni
mutaciones a través de `ArkAdapter`.

Resultado local (2026-11-18, rama `ark-regtest-46-54`): **4/4 mocks** y
**1/1 lectura real**, sin fallos. `arkd` v0.9.25 devolvió dust de 330 sats;
Alice reportó 125 000 sats totales y tres VTXOs, incluida la hoja de renovación
`0fcd7ad8f87aec0930ad1e0b88f391d33b073e4b3c24a58eb2bea9f55d54cc28:0`.
`ark:status` antes y después de la lectura mantuvo altura 110 y el mismo tip
de Core (`383f81797b2b45b53e09a9f652a8213cd099a9760a5016ec5a88df205105b3d1`).
