export function config() {
  if (process.env.ENABLE_LIVE_SWAPS && process.env.ENABLE_LIVE_SWAPS !== 'false') throw new Error('Live swap orchestration is unavailable in this component milestone');
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  return {
    bitcoinUrl: process.env.BITCOIN_RPC_URL ?? 'http://127.0.0.1:18443',
    cookie: process.env.BITCOIN_COOKIE_PATH ?? '/home/truja/.bitcoin/regtest/.cookie',
    wallet: process.env.BITCOIN_WALLET ?? 'lqwd-lab',
    lndUrl: process.env.LND_REST_URL ?? 'https://127.0.0.1:8080',
    cert: process.env.LND_TLS_CERT_PATH ?? '/home/truja/.lnd/tls.cert',
    macaroon: process.env.LND_MACAROON_PATH ?? '/home/truja/.lnd/data/chain/bitcoin/regtest/admin.macaroon',
    directory: process.env.DATA_DIR ?? './data', port,
  };
}
