export function config(env: NodeJS.ProcessEnv = process.env) {
  if (env.ENABLE_LIVE_SWAPS && env.ENABLE_LIVE_SWAPS !== 'false') throw new Error('Live swap orchestration is unavailable in this component milestone');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  if (env.ENABLE_READ_ONLY_RECOVERY && !['true', 'false'].includes(env.ENABLE_READ_ONLY_RECOVERY)) throw new Error('Invalid read-only recovery flag');
  let recovery: { payerUrl: string; payerCert: string; payerMacaroon: string; payerNode: string; providerNode: string } | undefined;
  if (env.ENABLE_READ_ONLY_RECOVERY === 'true') {
    const required = (name: string) => { const value = env[name]; if (!value?.trim()) throw new Error('Read-only recovery configuration incomplete'); return value; };
    recovery = { payerUrl: required('RECOVERY_PAYER_REST_URL'), payerCert: required('RECOVERY_PAYER_TLS_CERT_PATH'),
      payerMacaroon: required('RECOVERY_PAYER_MACAROON_PATH'), payerNode: required('RECOVERY_PAYER_NODE_PUBKEY'),
      providerNode: required('RECOVERY_PROVIDER_NODE_PUBKEY') };
    let endpoint: URL;
    try { endpoint = new URL(recovery.payerUrl); } catch { throw new Error('Read-only recovery configuration invalid'); }
    if (endpoint.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
      !/^(02|03)[a-f0-9]{64}$/.test(recovery.payerNode) || !/^(02|03)[a-f0-9]{64}$/.test(recovery.providerNode) ||
      recovery.payerNode === recovery.providerNode) throw new Error('Read-only recovery configuration invalid');
  }
  return {
    bitcoinUrl: env.BITCOIN_RPC_URL ?? 'http://127.0.0.1:18443',
    cookie: env.BITCOIN_COOKIE_PATH ?? '/home/truja/.bitcoin/regtest/.cookie',
    wallet: env.BITCOIN_WALLET ?? 'lqwd-lab',
    lndUrl: env.LND_REST_URL ?? 'https://127.0.0.1:8080',
    cert: env.LND_TLS_CERT_PATH ?? '/home/truja/.lnd/tls.cert',
    macaroon: env.LND_MACAROON_PATH ?? '/home/truja/.lnd/data/chain/bitcoin/regtest/readonly.macaroon',
    directory: env.DATA_DIR ?? './data', port, recovery,
  };
}
