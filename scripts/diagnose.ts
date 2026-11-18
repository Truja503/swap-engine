import { BitcoinRpcClient } from '../src/bitcoin/BitcoinRpcClient.js';
import { LndClient } from '../src/lightning/LndClient.js';
import { runRegtestDiagnostics } from '../src/diagnostics/RegtestDiagnostics.js';

const env = process.env;

function lnd(url: string | undefined, cert: string | undefined, macaroon: string | undefined) {
  if (!url || !cert || !macaroon) return null;
  try { return new LndClient(url, cert, macaroon); } catch { return null; }
}

let bitcoin: BitcoinRpcClient | null = null;
try {
  bitcoin = new BitcoinRpcClient(
    env.BITCOIN_RPC_URL ?? 'http://127.0.0.1:18443',
    env.BITCOIN_COOKIE_PATH ?? '/home/truja/.bitcoin/regtest/.cookie',
    env.BITCOIN_WALLET ?? 'lqwd-lab',
  );
} catch { bitcoin = null; }

const report = await runRegtestDiagnostics({
  bitcoin,
  provider: lnd(
    env.LND_REST_URL ?? 'https://127.0.0.1:8080',
    env.LND_TLS_CERT_PATH ?? '/home/truja/.lnd/tls.cert',
    env.LND_MACAROON_PATH ?? '/home/truja/.lnd/data/chain/bitcoin/regtest/admin.macaroon',
  ),
  alice: lnd(env.ALICE_LND_REST_URL, env.ALICE_LND_TLS_CERT_PATH, env.ALICE_LND_MACAROON_PATH),
});

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
