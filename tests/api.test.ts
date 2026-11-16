import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setup } from './helpers.js';
import { createApi } from '../src/api/server.js';
import { config } from '../src/config.js';
import { BitcoinRpcClient } from '../src/bitcoin/BitcoinRpcClient.js';
import { LndClient } from '../src/lightning/LndClient.js';

test('HTTP schemas, quotes, status, health, liquidity and live funding gate', async () => {
  const f = await setup(); const server = createApi(f.manager, async () => ({ onchainSats: 1e6, incomingSats: 1e6 }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await (await fetch(`${url}/v1/health`)).json()).liveSwapsEnabled, false);
    const quote = await fetch(`${url}/v1/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountSats: 50_000 }) });
    assert.equal(quote.status, 201); assert.equal((await quote.json()).invoiceSats, 50_750);
    assert.equal((await fetch(`${url}/v1/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"amountSats":50000,"preimage":"secret"}' })).status, 400);
    const status = await (await fetch(`${url}/v1/swaps/${f.swap.id}`)).json();
    assert.equal(status.state, 'QUOTED'); assert(!('idempotencyKey' in status)); assert(!('lockup' in status));
    assert.equal(status.display.tone, 'pending'); assert.equal(status.display.terminal, false);
    assert.equal((await fetch(`${url}/v1/swaps/${'0'.repeat(36)}`)).status, 404);
    assert.equal((await fetch(`${url}/v1/liquidity`)).status, 200);
    const request = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'api-request-1' }, body: JSON.stringify({ quoteId: f.quote.id, paymentHash: f.contract.paymentHash, claimPublicKey: f.contract.claimPublicKey }) };
    const disabled = await fetch(`${url}/v1/swaps/reverse`, request); assert.equal(disabled.status, 503);
    assert.match((await disabled.json()).error, /LIVE_SWAPS_DISABLED/);
    assert.equal(Object.keys(f.store.read().swaps).length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await f.cleanup(); }
});
test('live mode cannot be enabled through environment flag', () => {
  const saved = process.env.ENABLE_LIVE_SWAPS;
  try { process.env.ENABLE_LIVE_SWAPS = 'true'; assert.throws(config, /unavailable/); }
  finally { if (saved === undefined) delete process.env.ENABLE_LIVE_SWAPS; else process.env.ENABLE_LIVE_SWAPS = saved; }
});
test('node clients reject public endpoints and insecure LND TLS', () => {
  assert.throws(() => new BitcoinRpcClient('http://example.com:18443', 'cookie'));
  assert.throws(() => new LndClient('http://127.0.0.1:8080', 'cert', 'macaroon'));
  assert.throws(() => new LndClient('https://example.com', 'cert', 'macaroon'));
});
