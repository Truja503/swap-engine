import { createApi } from './api/server.js';
import { ReadOnlyBitcoinClient, ReadOnlyLndClient } from './diagnostics/ReadOnlyClients.js';
import { preflight } from './diagnostics/preflight.js';
import { Store } from './persistence/Store.js';
import { SwapManager } from './core/SwapManager.js';
import { config } from './config.js';

const c = config();
const store = await Store.open(c.directory);
const bitcoin = new ReadOnlyBitcoinClient(c.bitcoinUrl, c.cookie, c.wallet);
const lnd = new ReadOnlyLndClient(c.lndUrl, c.cert, c.macaroon);
const server = createApi(new SwapManager(store), async () => {
  await Promise.all([bitcoin.assertRegtest(), lnd.assertRegtest()]);
  const [onchainSats, incomingSats] = await Promise.all([bitcoin.liquidity(), lnd.incomingLiquidity()]);
  return { onchainSats, incomingSats };
}, () => preflight(bitcoin, lnd, c.wallet));
server.listen(c.port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'api_listening', host: '127.0.0.1', port: c.port, mode: 'simulation-read-only', liveSwapsEnabled: false })));
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return; closing = true;
  server.close(() => { void store.close().then(() => process.exit(0)); });
});
