import { createServer, type IncomingMessage } from 'node:http';
import { buildHtlc } from '../bitcoin/HtlcBuilder.js';
import { available, type Balances } from '../liquidity/LiquidityManager.js';
import type { SwapManager } from '../core/SwapManager.js';
import { QuoteRequest, QuoteResponse, ReverseRequest, SwapResponse, HealthResponse, LiquidityResponse, ErrorResponse } from './schemas.js';
import { ZodError } from 'zod';

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new SyntaxError('Expected application/json');
  let text = '';
  for await (const chunk of req) { text += chunk.toString(); if (Buffer.byteLength(text) > 8192) throw new SyntaxError('Body too large'); }
  return JSON.parse(text);
}
export function createApi(manager: SwapManager, liquidity: () => Promise<Balances>) {
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/v1/health') return send(200, HealthResponse.parse({ status: 'components-only', liveSwapsEnabled: false, network: 'regtest' }));
      if (req.method === 'POST' && path === '/v1/quotes') {
        const input = QuoteRequest.parse(await body(req));
        return send(201, QuoteResponse.parse(await manager.quote(input.amountSats)));
      }
      if (req.method === 'POST' && path === '/v1/swaps/reverse') {
        ReverseRequest.parse(await body(req));
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(String(req.headers['idempotency-key'] ?? ''))) return send(400, ErrorResponse.parse({ error: 'IDEMPOTENCY_KEY_REQUIRED' }));
        return send(503, ErrorResponse.parse({ error: 'LIVE_SWAPS_DISABLED_OBSERVER_AND_RECOVERY_NOT_VERIFIED' }));
      }
      if (req.method === 'GET' && path === '/v1/liquidity') {
        try { return send(200, LiquidityResponse.parse(available(manager.store.read(), await liquidity()))); }
        catch { return send(503, ErrorResponse.parse({ error: 'NODE_LIQUIDITY_UNAVAILABLE' })); }
      }
      if (req.method === 'GET' && /^\/v1\/swaps\/[a-f0-9-]{36}$/.test(path)) {
        const swap = manager.get(path.split('/').at(-1)!);
        if (!swap) return send(404, ErrorResponse.parse({ error: 'SWAP_NOT_FOUND' }));
        const contract = buildHtlc(swap.contract);
        return send(200, SwapResponse.parse({ id: swap.id, state: swap.state, quote: swap.quote, ...swap.contract, address: contract.address, witnessScript: contract.witnessScript.toString('hex'), invoice: swap.invoice, lockupTxid: swap.lockup?.txid, lockupVout: swap.lockup?.vout, claimTxid: swap.claimTxid, refundTxid: swap.refundTxid }));
      }
      return send(404, ErrorResponse.parse({ error: 'NOT_FOUND' }));
    } catch (error) {
      const invalid = error instanceof ZodError || error instanceof SyntaxError;
      return send(invalid ? 400 : 503, ErrorResponse.parse({ error: invalid ? 'INVALID_REQUEST' : 'SERVICE_UNAVAILABLE' }));
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  return server;
}
