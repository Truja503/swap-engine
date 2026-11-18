export type ApplicationMode = 'simulation' | 'regtest';

const modeAliases: Record<string, ApplicationMode> = {
  simulation: 'simulation',
  simulated: 'simulation',
  regtest: 'regtest',
  'regtest-read-only': 'regtest',
  'regtest-readonly': 'regtest',
};

const rejectedMainnetModes = new Set(['mainnet', 'main', 'bitcoin', 'btc', 'live', 'production']);

export function applicationMode(value: string | undefined = process.env.APP_MODE): ApplicationMode {
  const normalized = (value ?? 'simulation').trim().toLowerCase();
  if (rejectedMainnetModes.has(normalized)) throw new Error('Mainnet is rejected; only simulation and regtest read-only modes are supported');
  const mode = modeAliases[normalized];
  if (!mode) throw new Error('Invalid application mode; expected simulation or regtest');
  return mode;
}

export function config(env: NodeJS.ProcessEnv = process.env) {
  if (env.ENABLE_LIVE_SWAPS && env.ENABLE_LIVE_SWAPS !== 'false') throw new Error('Live swap orchestration is unavailable in this component milestone');
  const mode = applicationMode(env.APP_MODE);
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const aliceUrl = env.ALICE_LND_REST_URL;
  const aliceCert = env.ALICE_LND_TLS_CERT_PATH;
  const aliceMacaroon = env.ALICE_LND_MACAROON_PATH;
  if ((aliceUrl || aliceCert || aliceMacaroon) && !(aliceUrl && aliceCert && aliceMacaroon)) {
    throw new Error('Alice LND requires a loopback HTTPS endpoint, TLS certificate path and read-only macaroon path');
  }
  return {
    mode, network: 'regtest' as const, readOnly: true as const,
    bitcoinUrl: env.BITCOIN_RPC_URL ?? 'http://127.0.0.1:18443',
    cookie: env.BITCOIN_COOKIE_PATH ?? '/home/truja/.bitcoin/regtest/.cookie',
    wallet: env.BITCOIN_WALLET ?? 'lqwd-lab',
    lndUrl: env.LND_REST_URL ?? 'https://127.0.0.1:8080',
    cert: env.LND_TLS_CERT_PATH ?? '/home/truja/.lnd/tls.cert',
    macaroon: env.LND_MACAROON_PATH ?? '/home/truja/.lnd/data/chain/bitcoin/regtest/readonly.macaroon',
    aliceLnd: aliceUrl && aliceCert && aliceMacaroon ? { url: aliceUrl, cert: aliceCert, macaroon: aliceMacaroon } : null,
    directory: env.DATA_DIR ?? './data', port,
  };
}
