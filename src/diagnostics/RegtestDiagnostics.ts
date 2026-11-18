import { z } from 'zod';
import type {
  BitcoinPreflightClient,
  DiagnosticCategory,
  DiagnosticStatus,
  LndPreflightClient,
} from './types.js';
import { bitcoinFailureCategory, bitcoinFailureMessage, lndFailureCategory, lndFailureMessage } from './runtime.js';

const ChainInfo = z.object({
  chain: z.string().min(1).optional(),
  blocks: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  headers: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  bestblockhash: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  initialblockdownload: z.boolean().optional(),
});

const NodeInfo = z.object({
  identity_pubkey: z.string().min(1).optional(),
  alias: z.string().optional(),
  version: z.string().optional(),
  chains: z.array(z.object({ chain: z.string().min(1), network: z.string().min(1) })).optional(),
  synced_to_chain: z.boolean().optional(),
  synced_to_graph: z.boolean().optional(),
  block_height: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  block_hash: z.string().optional(),
});

const StateInfo = z.object({ state: z.string().min(1).optional() });

const Int64 = z.union([z.string(), z.number()]);

const PeerInfo = z.object({
  pub_key: z.string().min(1),
  address: z.string().optional(),
});

const PeersInfo = z.object({ peers: z.array(PeerInfo).optional() });

const GraphNodeInfo = z.object({
  node: z.object({ alias: z.string().optional() }).optional(),
});

const PendingHtlcInfo = z.object({
  incoming: z.boolean(),
  amount: Int64.optional(),
});

const ChannelInfo = z.object({
  channel_point: z.string().optional(),
  active: z.boolean().optional(),
  remote_pubkey: z.string().optional(),
  capacity: Int64.optional(),
  local_balance: Int64.optional(),
  remote_balance: Int64.optional(),
  local_constraints: z.object({ chan_reserve_sat: Int64.optional() }).optional(),
  remote_constraints: z.object({ chan_reserve_sat: Int64.optional() }).optional(),
  pending_htlcs: z.array(PendingHtlcInfo).optional(),
});

const ChannelsInfo = z.object({ channels: z.array(ChannelInfo).optional() });

export type SanitizedFailure = {
  scope: string;
  category: DiagnosticCategory;
  message: string;
};

export type CoreReport = {
  status: DiagnosticStatus;
  network: string | null;
  height: number | null;
  headers: number | null;
  inInitialBlockDownload: boolean | null;
  tipHash: string | null;
  failures: SanitizedFailure[];
};

export type LndIdentity = {
  pubkey: string | null;
  alias: string | null;
  version: string | null;
};

export type LndNetworkState = {
  chains: Array<{ chain: string; network: string }> | null;
  onRegtest: boolean | null;
};

export type LndSyncState = {
  syncedToChain: boolean | null;
  syncedToGraph: boolean | null;
  blockHeight: number | null;
  blockHash: string | null;
};

export type LndWalletState = {
  state: string | null;
};

export type PeerReport = {
  pubkey: string;
  alias: string | null;
  connected: boolean;
  address: string | null;
};

export type PendingHtlcReport = {
  count: number;
  incomingSats: number | null;
  outgoingSats: number | null;
};

export type ChannelReport = {
  channelPoint: string | null;
  active: boolean | null;
  state: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  remotePubkey: string | null;
  capacitySats: number | null;
  localBalanceSats: number | null;
  remoteBalanceSats: number | null;
  localReserveSats: number | null;
  remoteReserveSats: number | null;
  pendingHtlcs: PendingHtlcReport;
  outboundLiquiditySats: number | null;
  inboundLiquiditySats: number | null;
  unknown: string[];
};

export type DirectionalLiquidity = {
  outboundSats: number | null;
  inboundSats: number | null;
  activeChannelCount: number;
  unknownChannels: string[];
};

export type LndNodeReport = {
  role: 'provider' | 'alice';
  status: DiagnosticStatus;
  identity: LndIdentity;
  network: LndNetworkState;
  sync: LndSyncState;
  wallet: LndWalletState;
  peers: PeerReport[] | null;
  channels: ChannelReport[] | null;
  liquidity: DirectionalLiquidity | null;
  failures: SanitizedFailure[];
};

export type RegtestDiagnosticsReport = {
  ok: boolean;
  mode: 'read-only';
  checkedAt: string;
  core: CoreReport;
  lnd: { provider: LndNodeReport; alice: LndNodeReport };
};

export type RegtestDiagnosticsClients = {
  bitcoin: BitcoinPreflightClient | null;
  provider: LndPreflightClient | null;
  alice: LndPreflightClient | null;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; failure: SanitizedFailure };

async function readBitcoin<T>(scope: string, schema: z.ZodType<T>, call: () => Promise<unknown>): Promise<Parsed<T>> {
  try {
    return { ok: true, value: schema.parse(await call()) };
  } catch (error) {
    const category = bitcoinFailureCategory(error);
    return { ok: false, failure: { scope, category, message: bitcoinFailureMessage(category) } };
  }
}

async function readLnd<T>(scope: string, schema: z.ZodType<T>, call: () => Promise<unknown>): Promise<Parsed<T>> {
  try {
    return { ok: true, value: schema.parse(await call()) };
  } catch (error) {
    const category = lndFailureCategory(error);
    return { ok: false, failure: { scope, category, message: lndFailureMessage(category) } };
  }
}

function toSats(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return Number.isSafeInteger(amount) ? amount : null;
}

const MAX_SAFE_SATS = BigInt(Number.MAX_SAFE_INTEGER);

function sum(values: Array<number | null>): number | null {
  let total = 0n;
  for (const value of values) {
    if (value === null || !Number.isSafeInteger(value) || value < 0) return null;
    total += BigInt(value);
    if (total > MAX_SAFE_SATS) return null;
  }
  return Number(total);
}

function channelReport(channel: z.infer<typeof ChannelInfo>): ChannelReport {
  const active = channel.active ?? null;
  const capacitySats = toSats(channel.capacity);
  const localBalanceSats = toSats(channel.local_balance);
  const remoteBalanceSats = toSats(channel.remote_balance);
  const localReserveSats = toSats(channel.local_constraints?.chan_reserve_sat);
  const remoteReserveSats = toSats(channel.remote_constraints?.chan_reserve_sat);
  const htlcs = channel.pending_htlcs ?? [];
  const incomingSats = sum(htlcs.filter(htlc => htlc.incoming).map(htlc => toSats(htlc.amount)));
  const outgoingSats = sum(htlcs.filter(htlc => !htlc.incoming).map(htlc => toSats(htlc.amount)));

  const unknown: string[] = [];
  if (channel.channel_point === undefined) unknown.push('channelPoint');
  if (active === null) unknown.push('active');
  if (channel.remote_pubkey === undefined) unknown.push('remotePubkey');
  if (capacitySats === null) unknown.push('capacity');
  if (localBalanceSats === null) unknown.push('localBalance');
  if (remoteBalanceSats === null) unknown.push('remoteBalance');
  if (localReserveSats === null) unknown.push('localReserve');
  if (remoteReserveSats === null) unknown.push('remoteReserve');
  if (incomingSats === null || outgoingSats === null) unknown.push('pendingHtlcs');

  let outboundLiquiditySats: number | null = null;
  let inboundLiquiditySats: number | null = null;
  if (active === false) {
    unknown.push('inactiveChannel');
  } else if (active === true) {
    if (localBalanceSats === null || localReserveSats === null || outgoingSats === null) {
      unknown.push('outboundLiquidity');
    } else {
      outboundLiquiditySats = Math.max(0, localBalanceSats - localReserveSats - outgoingSats);
    }
    if (remoteBalanceSats === null || remoteReserveSats === null || incomingSats === null) {
      unknown.push('inboundLiquidity');
    } else {
      inboundLiquiditySats = Math.max(0, remoteBalanceSats - remoteReserveSats - incomingSats);
    }
  } else {
    unknown.push('directionalLiquidity');
  }

  return {
    channelPoint: channel.channel_point ?? null,
    active,
    state: active === true ? 'ACTIVE' : active === false ? 'INACTIVE' : 'UNKNOWN',
    remotePubkey: channel.remote_pubkey ?? null,
    capacitySats,
    localBalanceSats,
    remoteBalanceSats,
    localReserveSats,
    remoteReserveSats,
    pendingHtlcs: { count: htlcs.length, incomingSats, outgoingSats },
    outboundLiquiditySats,
    inboundLiquiditySats,
    unknown: [...new Set(unknown)],
  };
}

function directionalLiquidity(channels: ChannelReport[]): DirectionalLiquidity {
  const active = channels.filter(channel => channel.active === true);
  const unknownChannels = active
    .filter(channel => channel.outboundLiquiditySats === null || channel.inboundLiquiditySats === null)
    .map(channel => channel.channelPoint ?? 'unknown');
  const hadUnknownChannel = unknownChannels.length > 0;
  const outboundSats = hadUnknownChannel ? null : sum(active.map(channel => channel.outboundLiquiditySats));
  const inboundSats = hadUnknownChannel ? null : sum(active.map(channel => channel.inboundLiquiditySats));
  if (!hadUnknownChannel && outboundSats === null) unknownChannels.push('aggregateOutboundOverflow');
  if (!hadUnknownChannel && inboundSats === null) unknownChannels.push('aggregateInboundOverflow');
  return {
    outboundSats,
    inboundSats,
    activeChannelCount: active.length,
    unknownChannels,
  };
}

function emptyNode(role: 'provider' | 'alice'): LndNodeReport {
  return {
    role,
    status: 'error',
    identity: { pubkey: null, alias: null, version: null },
    network: { chains: null, onRegtest: null },
    sync: { syncedToChain: null, syncedToGraph: null, blockHeight: null, blockHash: null },
    wallet: { state: null },
    peers: null,
    channels: null,
    liquidity: null,
    failures: [],
  };
}

async function collectPeers(
  client: LndPreflightClient,
  channels: ChannelReport[] | null,
  failures: SanitizedFailure[],
): Promise<PeerReport[] | null> {
  const result = await readLnd('peers', PeersInfo, () => client.call('/v1/peers'));
  if (!result.ok) {
    failures.push(result.failure);
    return null;
  }

  const peers = new Map<string, PeerReport>();
  for (const peer of result.value.peers ?? []) {
    peers.set(peer.pub_key, { pubkey: peer.pub_key, alias: null, connected: true, address: peer.address ?? null });
  }
  for (const channel of channels ?? []) {
    if (channel.remotePubkey && !peers.has(channel.remotePubkey)) {
      peers.set(channel.remotePubkey, { pubkey: channel.remotePubkey, alias: null, connected: false, address: null });
    }
  }

  const summaries = [...peers.values()];
  const aliases = await Promise.all(summaries.map(peer =>
    readLnd('peer.alias', GraphNodeInfo, () => client.call(`/v1/graph/node/${encodeURIComponent(peer.pubkey)}`))));
  summaries.forEach((peer, index) => {
    const alias = aliases[index];
    if (!alias) return;
    if (alias.ok) peer.alias = alias.value.node?.alias ?? null;
    else failures.push(alias.failure);
  });
  return summaries;
}

export async function collectCore(client: BitcoinPreflightClient | null): Promise<CoreReport> {
  const report: CoreReport = {
    status: 'error',
    network: null,
    height: null,
    headers: null,
    inInitialBlockDownload: null,
    tipHash: null,
    failures: [],
  };
  if (!client) {
    report.failures.push({ scope: 'config', category: 'BITCOIN_CONFIG_UNAVAILABLE', message: 'Bitcoin Core configuration is unavailable' });
    return report;
  }

  const result = await readBitcoin('chain', ChainInfo, () => client.call('getblockchaininfo'));
  if (!result.ok) {
    report.failures.push(result.failure);
    return report;
  }

  report.network = result.value.chain ?? null;
  report.height = result.value.blocks ?? null;
  report.headers = result.value.headers ?? null;
  report.inInitialBlockDownload = result.value.initialblockdownload ?? null;
  report.tipHash = result.value.bestblockhash ?? null;
  report.status = report.failures.length === 0
    && report.network === 'regtest'
    && report.height !== null
    && report.headers !== null
    && report.headers >= report.height
    && report.inInitialBlockDownload === false
    && report.tipHash !== null
    ? 'ok' : 'error';
  return report;
}

export async function collectLndNode(role: 'provider' | 'alice', client: LndPreflightClient | null): Promise<LndNodeReport> {
  const report = emptyNode(role);
  if (!client) {
    report.failures.push({ scope: 'config', category: 'LND_CONFIG_UNAVAILABLE', message: 'LND configuration is unavailable' });
    return report;
  }

  const [infoResult, stateResult, channelsResult] = await Promise.all([
    readLnd('identity', NodeInfo, () => client.call('/v1/getinfo')),
    readLnd('wallet', StateInfo, () => client.call('/v1/state')),
    readLnd('channels', ChannelsInfo, () => client.call('/v1/channels')),
  ]);

  if (infoResult.ok) {
    const info = infoResult.value;
    report.identity = {
      pubkey: info.identity_pubkey ?? null,
      alias: info.alias ?? null,
      version: info.version ?? null,
    };
    const chains = info.chains ?? null;
    report.network = {
      chains,
      onRegtest: chains === null ? null
        : chains.length === 1 && chains[0]?.chain === 'bitcoin' && chains[0]?.network === 'regtest',
    };
    report.sync = {
      syncedToChain: info.synced_to_chain ?? null,
      syncedToGraph: info.synced_to_graph ?? null,
      blockHeight: info.block_height ?? null,
      blockHash: info.block_hash ?? null,
    };
  } else {
    report.failures.push(infoResult.failure);
  }

  if (stateResult.ok) report.wallet.state = stateResult.value.state ?? null;
  else report.failures.push(stateResult.failure);

  if (channelsResult.ok) {
    report.channels = (channelsResult.value.channels ?? []).map(channelReport);
    report.liquidity = directionalLiquidity(report.channels);
  } else {
    report.failures.push(channelsResult.failure);
  }

  report.peers = await collectPeers(client, report.channels, report.failures);
  report.status = report.failures.length === 0
    && report.identity.pubkey !== null
    && report.network.onRegtest === true
    && report.sync.syncedToChain === true
    && report.wallet.state !== null
    ? 'ok' : 'error';
  return report;
}

export async function runRegtestDiagnostics(clients: RegtestDiagnosticsClients): Promise<RegtestDiagnosticsReport> {
  const [core, provider, alice] = await Promise.all([
    collectCore(clients.bitcoin),
    collectLndNode('provider', clients.provider),
    collectLndNode('alice', clients.alice),
  ]);
  return {
    ok: core.status === 'ok' && provider.status === 'ok' && alice.status === 'ok',
    mode: 'read-only',
    checkedAt: new Date().toISOString(),
    core,
    lnd: { provider, alice },
  };
}
