import { config } from '../src/config.js';
import { BitcoinRpcClient } from '../src/bitcoin/BitcoinRpcClient.js';
import { LndClient } from '../src/lightning/LndClient.js';

const c = config();
const bitcoin = new BitcoinRpcClient(c.bitcoinUrl, c.cookie, c.wallet);
const lnd = new LndClient(c.lndUrl, c.cert, c.macaroon);
let failed = false;
for (const [name, check] of [
  ['bitcoin_regtest', () => bitcoin.assertRegtest()],
  ['lnd_regtest_synced', () => lnd.assertRegtest()],
  ['wallet_liquidity', () => bitcoin.liquidity()],
  ['incoming_liquidity', () => lnd.incomingLiquidity()],
] as const) {
  try { await check(); console.log(JSON.stringify({ check: name, status: 'ok' })); }
  catch (error) {
    failed = true;
    // Node/API messages can contain secrets: emit only classification.
    const code = (error as NodeJS.ErrnoException).code;
    console.log(JSON.stringify({ check: name, status: 'failed', errorType: error instanceof Error ? error.name : 'Unknown', errorCode: typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'REMOTE_OR_CONFIG_ERROR' }));
  }
}
process.exitCode = failed ? 1 : 0;
