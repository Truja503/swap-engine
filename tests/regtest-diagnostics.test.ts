import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRegtestDiagnostics } from '../src/diagnostics/RegtestDiagnostics.js';

type Response = unknown | Error | (() => unknown);

function bitcoinClient(responses: Record<string, Response>) {
  return {
    async call<T>(method: string, _params: unknown[] = [], _wallet = false): Promise<T> {
      const response = responses[method];
      if (response === undefined && !(method in responses)) throw new Error(`Unexpected Bitcoin RPC method: ${method}`);
      if (response instanceof Error) throw response;
      if (typeof response === 'function') return await (response as () => T | Promise<T>)() as T;
      return response as T;
    },
  };
}

function lndClient(responses: Record<string, Response>) {
  return {
    async call<T>(path: string, _body?: unknown): Promise<T> {
      const response = responses[path];
      if (response === undefined && !(path in responses)) throw new Error(`Unexpected LND path: ${path}`);
      if (response instanceof Error) throw response;
      if (typeof response === 'function') return await (response as () => T | Promise<T>)() as T;
      return response as T;
    },
  };
}

const TIP = 'ab'.repeat(32);
const PROVIDER = 'provider-pubkey';
const ALICE = 'alice-pubkey';

function coreResponses(): Record<string, Response> {
  return {
    getblockchaininfo: {
      chain: 'regtest', blocks: 128, headers: 128, bestblockhash: TIP, initialblockdownload: false,
      macaroon: 'super-secret-macaroon', cookie: 'super-secret-cookie', tls_cert_path: '/secret/path',
    },
  };
}

function providerResponses(): Record<string, Response> {
  return {
    '/v1/getinfo': {
      identity_pubkey: PROVIDER, alias: 'provider', version: '0.21.6-beta',
      chains: [{ chain: 'bitcoin', network: 'regtest' }], synced_to_chain: true, synced_to_graph: true,
      block_height: 128, block_hash: 'cd'.repeat(32), macaroon: 'super-secret-macaroon', cookie: 'super-secret-cookie',
    },
    '/v1/state': { state: 'SERVER_ACTIVE', tls_cert_path: '/secret/path' },
    '/v1/peers': { peers: [{ pub_key: ALICE, address: '127.0.0.1:9735' }] },
    '/v1/channels': {
      channels: [{
        channel_point: 'abc123:0', active: true, remote_pubkey: ALICE, capacity: '5000000',
        local_balance: '3000000', remote_balance: '2000000',
        local_constraints: { chan_reserve_sat: '50000' }, remote_constraints: { chan_reserve_sat: '50000' },
        pending_htlcs: [{ incoming: false, amount: '1000' }, { incoming: true, amount: '2000' }],
        private_key: 'super-secret-private-key',
      }],
    },
    [`/v1/graph/node/${ALICE}`]: { node: { alias: 'alice', color: '#000000' } },
  };
}

function aliceResponses(): Record<string, Response> {
  return {
    '/v1/getinfo': {
      identity_pubkey: ALICE, alias: 'alice', version: '0.21.6-beta',
      chains: [{ chain: 'bitcoin', network: 'regtest' }], synced_to_chain: true, synced_to_graph: true,
      block_height: 128, block_hash: 'cd'.repeat(32),
    },
    '/v1/state': { state: 'SERVER_ACTIVE' },
    '/v1/peers': { peers: [{ pub_key: PROVIDER, address: '127.0.0.1:9736' }] },
    '/v1/channels': {
      channels: [{
        channel_point: 'abc123:0', active: true, remote_pubkey: PROVIDER, capacity: '5000000',
        local_balance: '2000000', remote_balance: '3000000',
        local_constraints: { chan_reserve_sat: '50000' }, remote_constraints: { chan_reserve_sat: '50000' },
        pending_htlcs: [{ incoming: true, amount: '1000' }, { incoming: false, amount: '2000' }],
      }],
    },
    [`/v1/graph/node/${PROVIDER}`]: { node: { alias: 'provider' } },
  };
}

test('healthy provider and Alice expose identities, peers, channels and directional liquidity', async () => {
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient(coreResponses()),
    provider: lndClient(providerResponses()),
    alice: lndClient(aliceResponses()),
  });

  assert.equal(report.ok, true);
  assert.equal(report.mode, 'read-only');
  assert.deepEqual(
    { network: report.core.network, height: report.core.height, ibd: report.core.inInitialBlockDownload, tip: report.core.tipHash },
    { network: 'regtest', height: 128, ibd: false, tip: TIP },
  );

  const provider = report.lnd.provider;
  assert.equal(provider.status, 'ok');
  assert.deepEqual(provider.identity, { pubkey: PROVIDER, alias: 'provider', version: '0.21.6-beta' });
  assert.equal(provider.network.onRegtest, true);
  assert.equal(provider.sync.syncedToChain, true);
  assert.equal(provider.sync.syncedToGraph, true);
  assert.equal(provider.wallet.state, 'SERVER_ACTIVE');
  assert.deepEqual(provider.peers, [{ pubkey: ALICE, alias: 'alice', connected: true, address: '127.0.0.1:9735' }]);
  assert.equal(provider.channels?.length, 1);
  const providerChannel = provider.channels?.[0];
  assert.ok(providerChannel);
  assert.deepEqual({
    point: providerChannel.channelPoint,
    active: providerChannel.active,
    state: providerChannel.state,
    capacity: providerChannel.capacitySats,
    local: providerChannel.localBalanceSats,
    remote: providerChannel.remoteBalanceSats,
    pending: providerChannel.pendingHtlcs,
    outbound: providerChannel.outboundLiquiditySats,
    inbound: providerChannel.inboundLiquiditySats,
  }, {
    point: 'abc123:0', active: true, state: 'ACTIVE', capacity: 5_000_000,
    local: 3_000_000, remote: 2_000_000,
    pending: { count: 2, incomingSats: 2_000, outgoingSats: 1_000 },
    outbound: 2_949_000, inbound: 1_948_000,
  });
  assert.deepEqual(provider.liquidity, { outboundSats: 2_949_000, inboundSats: 1_948_000, activeChannelCount: 1, unknownChannels: [] });

  assert.equal(report.lnd.alice.status, 'ok');
  assert.deepEqual(report.lnd.alice.peers, [{ pubkey: PROVIDER, alias: 'provider', connected: true, address: '127.0.0.1:9736' }]);
  assert.deepEqual(report.lnd.alice.liquidity, { outboundSats: 1_948_000, inboundSats: 2_949_000, activeChannelCount: 1, unknownChannels: [] });

  const serialized = JSON.stringify(report).toLowerCase();
  for (const forbidden of ['super-secret', '/secret/path', 'macaroon', 'cookie', 'private_key', 'privatekey']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('per-channel pending HTLC sum overflow becomes unknown instead of an unsafe number', async () => {
  const max = String(Number.MAX_SAFE_INTEGER);
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient(coreResponses()),
    provider: lndClient({
      ...providerResponses(),
      '/v1/peers': {},
      '/v1/channels': {
        channels: [{
          channel_point: 'overflow:0', active: true, remote_pubkey: ALICE, capacity: max,
          local_balance: '1000000', remote_balance: '1000000',
          local_constraints: { chan_reserve_sat: '0' }, remote_constraints: { chan_reserve_sat: '0' },
          pending_htlcs: [
            { incoming: true, amount: max }, { incoming: true, amount: '1' },
            { incoming: false, amount: max }, { incoming: false, amount: '1' },
          ],
        }],
      },
    }),
    alice: null,
  });

  const channel = report.lnd.provider.channels?.[0];
  assert.ok(channel);
  assert.equal(channel.pendingHtlcs.incomingSats, null);
  assert.equal(channel.pendingHtlcs.outgoingSats, null);
  assert.ok(channel.unknown.includes('pendingHtlcs'));
  assert.equal(channel.outboundLiquiditySats, null);
  assert.equal(channel.inboundLiquiditySats, null);
  assert.deepEqual(report.lnd.provider.liquidity, {
    outboundSats: null, inboundSats: null, activeChannelCount: 1, unknownChannels: ['overflow:0'],
  });
});

test('multi-channel directional liquidity aggregate overflow returns unknown totals', async () => {
  const max = String(Number.MAX_SAFE_INTEGER);
  const channel = (point: string) => ({
    channel_point: point, active: true, remote_pubkey: ALICE, capacity: max,
    local_balance: max, remote_balance: max,
    local_constraints: { chan_reserve_sat: '0' }, remote_constraints: { chan_reserve_sat: '0' },
    pending_htlcs: [],
  });
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient(coreResponses()),
    provider: lndClient({
      ...providerResponses(),
      '/v1/peers': {},
      '/v1/channels': { channels: [channel('first:0'), channel('second:0')] },
    }),
    alice: null,
  });

  assert.equal(report.lnd.provider.channels?.[0]?.outboundLiquiditySats, Number.MAX_SAFE_INTEGER);
  assert.equal(report.lnd.provider.channels?.[0]?.inboundLiquiditySats, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(report.lnd.provider.liquidity, {
    outboundSats: null, inboundSats: null, activeChannelCount: 2,
    unknownChannels: ['aggregateOutboundOverflow', 'aggregateInboundOverflow'],
  });
});

test('offline and missing-config nodes report sanitized categories without error text', async () => {
  const offline = new Error('connect ECONNREFUSED 127.0.0.1:18443 super-secret-cookie');
  (offline as NodeJS.ErrnoException).code = 'ECONNREFUSED';
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient({ getblockchaininfo: offline }),
    provider: lndClient({
      '/v1/getinfo': offline, '/v1/state': offline, '/v1/peers': offline, '/v1/channels': offline,
    }),
    alice: null,
  });

  assert.equal(report.ok, false);
  assert.equal(report.core.failures[0]?.category, 'BITCOIN_RPC_UNREACHABLE');
  assert.ok(report.lnd.provider.failures.some(failure => failure.category === 'LND_UNREACHABLE'));
  assert.equal(report.lnd.provider.peers, null);
  assert.equal(report.lnd.provider.channels, null);
  assert.equal(report.lnd.alice.failures[0]?.category, 'LND_CONFIG_UNAVAILABLE');

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('super-secret-cookie'), false);
  assert.equal(serialized.includes('ECONNREFUSED'), false);
});

test('missing credential files are classified as configuration failures without paths', async () => {
  const missing = new Error('ENOENT: no such file or directory, open /home/truja/secret/cookie');
  (missing as NodeJS.ErrnoException).code = 'ENOENT';
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient({ getblockchaininfo: missing }),
    provider: lndClient({ '/v1/getinfo': missing, '/v1/state': missing, '/v1/peers': missing, '/v1/channels': missing }),
    alice: null,
  });

  assert.equal(report.core.failures[0]?.category, 'BITCOIN_CONFIG_UNAVAILABLE');
  assert.ok(report.lnd.provider.failures.some(failure => failure.category === 'LND_CONFIG_UNAVAILABLE'));
  assert.equal(JSON.stringify(report).includes('/home/truja'), false);
});

test('unsynchronized Core and LND values are reported without suppressing data', async () => {
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient({ getblockchaininfo: { chain: 'regtest', blocks: 128, headers: 130, bestblockhash: TIP, initialblockdownload: true } }),
    provider: lndClient({
      ...providerResponses(),
      '/v1/getinfo': {
        identity_pubkey: PROVIDER, alias: 'provider', chains: [{ chain: 'bitcoin', network: 'regtest' }],
        synced_to_chain: false, synced_to_graph: false, block_height: 120,
      },
    }),
    alice: null,
  });

  assert.equal(report.ok, false);
  assert.equal(report.core.status, 'error');
  assert.equal(report.core.inInitialBlockDownload, true);
  assert.equal(report.core.headers, 130);
  assert.equal(report.lnd.provider.status, 'error');
  assert.equal(report.lnd.provider.sync.syncedToChain, false);
  assert.equal(report.lnd.provider.sync.syncedToGraph, false);
  assert.equal(report.lnd.provider.sync.blockHeight, 120);
  assert.equal(report.lnd.provider.failures.length, 0);
});

test('missing fields remain null and propagate into channel/liquidity unknowns', async () => {
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient({ getblockchaininfo: { chain: 'regtest', blocks: 128, initialblockdownload: false } }),
    provider: lndClient({
      '/v1/getinfo': { identity_pubkey: PROVIDER, alias: 'provider' },
      '/v1/state': {},
      '/v1/peers': {},
      '/v1/channels': { channels: [{ active: true }] },
    }),
    alice: null,
  });

  assert.equal(report.core.status, 'error');
  assert.equal(report.core.headers, null);
  assert.equal(report.core.tipHash, null);
  assert.equal(report.lnd.provider.status, 'error');
  assert.equal(report.lnd.provider.network.chains, null);
  assert.equal(report.lnd.provider.network.onRegtest, null);
  assert.equal(report.lnd.provider.sync.syncedToChain, null);
  assert.equal(report.lnd.provider.wallet.state, null);
  assert.deepEqual(report.lnd.provider.peers, []);
  assert.equal(report.lnd.provider.channels?.[0]?.capacitySats, null);
  assert.equal(report.lnd.provider.channels?.[0]?.outboundLiquiditySats, null);
  assert.equal(report.lnd.provider.channels?.[0]?.inboundLiquiditySats, null);
  assert.ok(report.lnd.provider.channels?.[0]?.unknown.includes('capacity'));
  assert.ok(report.lnd.provider.channels?.[0]?.unknown.includes('outboundLiquidity'));
  assert.deepEqual(report.lnd.provider.liquidity, {
    outboundSats: null, inboundSats: null, activeChannelCount: 1, unknownChannels: ['unknown'],
  });
});

test('malformed shapes produce sanitized malformed-response failures', async () => {
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient({ getblockchaininfo: { chain: 123 } }),
    provider: lndClient({
      '/v1/getinfo': { chains: 'regtest', synced_to_chain: 'yes', identity_pubkey: 'super-secret' },
      '/v1/state': { state: 42 },
      '/v1/peers': { peers: [{ pub_key: 123 }] },
      '/v1/channels': { channels: [{ active: 'yes' }] },
    }),
    alice: null,
  });

  assert.equal(report.ok, false);
  assert.equal(report.core.failures[0]?.category, 'BITCOIN_MALFORMED_RESPONSE');
  assert.equal(report.core.network, null);
  assert.ok(report.lnd.provider.failures.every(failure => failure.category === 'LND_MALFORMED_RESPONSE'));
  assert.equal(report.lnd.provider.identity.pubkey, null);
  assert.equal(report.lnd.provider.peers, null);
  assert.equal(report.lnd.provider.channels, null);
  assert.equal(JSON.stringify(report).includes('super-secret'), false);
});

test('peer alias lookup failures are sanitized and leave alias unknown', async () => {
  const secretError = new Error('LND HTTP 500 /home/truja/secret/path');
  const provider = providerResponses();
  provider[`/v1/graph/node/${ALICE}`] = secretError;
  const report = await runRegtestDiagnostics({
    bitcoin: bitcoinClient(coreResponses()),
    provider: lndClient(provider),
    alice: lndClient(aliceResponses()),
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.lnd.provider.peers, [{ pubkey: ALICE, alias: null, connected: true, address: '127.0.0.1:9735' }]);
  assert.ok(report.lnd.provider.failures.some(failure => failure.scope === 'peer.alias' && failure.category === 'LND_RPC_ERROR'));
  assert.equal(JSON.stringify(report).includes('/home/truja'), false);
});
