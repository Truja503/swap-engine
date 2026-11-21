# Operador Arkade regtest (#48)

Desde la raíz de este worktree, con Docker Engine + Compose v2 o Podman +
`podman-compose`, Bash, `curl`, `jq`, `ss`, `flock` y `openssl`:

```sh
bash scripts/ark/bootstrap-regtest.sh
bash scripts/ark/status-regtest.sh
bash scripts/ark/stop-regtest.sh
```

El primer arranque descarga las imágenes fijadas, crea credenciales de prueba
en `data/ark/compose.env` (`0600`) y mina únicamente en el Bitcoin Core del
laboratorio. Guarda una copia **privada** del archivo si necesitas recuperar
este laboratorio: contiene la clave del signer y la contraseña del wallet del
operador. No ejecutes `docker compose config` con ese archivo ni compartas
`docker inspect` o logs sin redactar.

El proyecto es `swap-engine-ark-regtest`, en la red interna
`swap_engine_ark_net`; los scripts rechazan objetos con los mismos nombres si
pertenecen a otro worktree. Sólo se publican Core RPC `38443`, NBXplorer
`32838`, Esplora `33000`, arkd `37070` y admin `37071`, todos en `127.0.0.1`.
Los puertos de depuración opcionales del plan #47 quedan dentro de la red.
El puerto Esplora sirve sólo API, no una interfaz web. No uses
este stack en una máquina con usuarios locales no confiables: los puertos
admin y NBXplorer están habilitados sin autenticación.

Mempool sirve la API Esplora desde Core y Fulcrum, sin MariaDB. Con la
base de datos habilitada, esta versión requiere importar metadatos de
pools públicos de GitHub incluso en regtest y no arranca en la red interna.
Se publica la API directamente en vez de usar el proxy del harness, cuya
configuración requiere resolver upstreams públicos.
MariaDB queda en un perfil separado de depuración; Ark y NBXplorer
mantienen sus bases PostgreSQL persistentes.

`status` emite JSON sanitizado y retorna distinto de cero si falla una
comprobación. Verifica génesis y red de Core, sincronía de NBXplorer y el tip
de Esplora, PostgreSQL, Redis, signer, wallet del operador y `/v1/info`.
`stop` conserva contenedores y volúmenes; relanzar el bootstrap revalida el
estado sin recrearlos ni duplicar los fondos iniciales. No hay comando de
limpieza ni de borrado. No hay minero periódico.

Para verificar el reinicio en un laboratorio sin actividad concurrente:

```sh
bash scripts/ark/bootstrap-regtest.sh
bash scripts/ark/status-regtest.sh > data/ark/operator-before.json
bash scripts/ark/stop-regtest.sh
bash scripts/ark/bootstrap-regtest.sh
bash scripts/ark/status-regtest.sh > data/ark/operator-after.json
diff -u data/ark/operator-before.json data/ark/operator-after.json
```
