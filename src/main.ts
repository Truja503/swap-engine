import { createApi } from './api/server.js';
import { BitcoinRpcClient } from './bitcoin/BitcoinRpcClient.js';
import { LndClient } from './lightning/LndClient.js';
import { Store } from './persistence/Store.js';
import { SwapManager } from './core/SwapManager.js';
import { config } from './config.js';

const c = config();
const store = await Store.open(c.directory);
const bitcoin = new BitcoinRpcClient(c.bitcoinUrl, c.cookie, c.wallet);
const lnd = new LndClient(c.lndUrl, c.cert, c.macaroon);
const server = createApi(new SwapManager(store), async () => {
  await Promise.all([bitcoin.assertRegtest(), lnd.assertRegtest()]);
  const [onchainSats, incomingSats] = await Promise.all([bitcoin.liquidity(), lnd.incomingLiquidity()]);
  return { onchainSats, incomingSats };
});
server.listen(c.port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'api_listening', host: '127.0.0.1', port: c.port, liveSwapsEnabled: false })));
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return; closing = true;
  server.close(() => { void store.close().then(() => process.exit(0)); });
});
