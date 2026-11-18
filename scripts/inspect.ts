import { config } from '../src/config.js';
import { ReadOnlyBitcoinClient, ReadOnlyLndClient } from '../src/diagnostics/ReadOnlyClients.js';
import { preflight } from '../src/diagnostics/preflight.js';

const c = config();
const bitcoin = new ReadOnlyBitcoinClient(c.bitcoinUrl, c.cookie, c.wallet);
const lnd = new ReadOnlyLndClient(c.lndUrl, c.cert, c.macaroon);
const report = await preflight(bitcoin, lnd, c.wallet);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.prerequisitesSatisfied ? 0 : 1;
