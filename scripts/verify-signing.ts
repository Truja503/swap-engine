import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { BitcoinRpcClient } from '../src/bitcoin/BitcoinRpcClient.js';
import { runSigningProbe, signingPlanSchema } from '../src/bitcoin/SigningProbe.js';

const args = process.argv.slice(2);
if (args[0] !== '--approved-sign-only' || args.length !== 2) {
  console.error('Requires explicit operator approval: --approved-sign-only <reviewed-plan.json>. Never broadcasts.');
  process.exitCode = 1;
} else {
  const c = config();
  // This test-only transport cannot broadcast, mine, create/load wallets or pay invoices.
  const methods = new Set(['getblockchaininfo', 'getrawtransaction', 'getblockheader', 'getblockhash',
    'getaddressinfo', 'gettxout', 'listlockunspent', 'getrawmempool', 'walletcreatefundedpsbt', 'walletprocesspsbt', 'finalizepsbt', 'testmempoolaccept']);
  let lastMethod = 'none';
  class SigningOnlyRpc extends BitcoinRpcClient {
    override call<T>(method: string, params: unknown[] = [], wallet = false): Promise<T> {
      if (!methods.has(method)) return Promise.reject(new Error('Signing-only test operation denied'));
      lastMethod = method;
      return super.call<T>(method, params, wallet);
    }
  }
  try {
    const plan = signingPlanSchema.parse(JSON.parse(await readFile(args[1]!, 'utf8')));
    if (plan.wallet !== c.wallet) throw new Error('Configured wallet differs from approved plan');
    const result = await runSigningProbe(new SigningOnlyRpc(c.bitcoinUrl, c.cookie, c.wallet), plan);
    console.log(JSON.stringify({ check: 'approved_wallet_signing_only', status: 'passed', ...result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const safeReasons = new Set(['Signing probe differs from approved self-spend plan', 'Signing probe fee exceeds approved budget',
      'Input is not an available verified output', 'Consensus probe transaction mismatch', 'Unexpected wallet lock/mempool/input change during signing test']);
    const reason = /^Bitcoin RPC (\w+ error -?\d+|HTTP \d+)$/.test(message) || safeReasons.has(message) ? message : 'VALIDATION_OR_CONFIGURATION';
    const diagnostic = /private|password|macaroon|cookie|seed|preimage/i.test(message) ? 'Sensitive diagnostic omitted'
      : message.replace(/[A-Za-z0-9+/_=-]{40,}/g, '[opaque data omitted]').slice(0, 180);
    console.error(JSON.stringify({ check: 'approved_wallet_signing_only', status: 'failed', lastMethod, reason, diagnostic, errorType: error instanceof Error ? error.name : 'Unknown' }));
    process.exitCode = 1;
  }
}
