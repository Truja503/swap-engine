import * as z from 'zod/mini';
import type { HealthResponse, QuoteResponse } from '../api/schemas.js';

export type Quote = z.infer<typeof QuoteResponse>;
type Health = z.infer<typeof HealthResponse>;
const session = z.object({
  user: z.object({ id: z.string(), username: z.string(), role: z.enum(['USER', 'ADMIN']) }),
  csrfToken: z.string().check(z.minLength(1)),
  expiresAt: z.int(),
});
export type Session = z.infer<typeof session>;

const health = z.object({
  status: z.literal('components-only'), liveSwapsEnabled: z.literal(false),
  readOnly: z.literal(true), network: z.literal('regtest'),
  mode: z.enum(['simulation', 'regtest']),
}) satisfies z.ZodMiniType<Health>;
const amount = z.int().check(z.nonnegative());
const quote = z.object({
  id: z.uuid(), amountSats: amount, serviceFeeSats: amount, invoiceSats: amount,
  fundingReserveSats: amount, claimFeeSats: amount, expiresAt: z.int(),
}) satisfies z.ZodMiniType<Quote>;

const probe = z.enum(['ok', 'unavailable', 'invalid_response']);
const height = z.nullable(amount);
const preflight = z.object({
  network: z.literal('regtest'),
  mode: z.literal('regtest-read-only'),
  prerequisitesSatisfied: z.boolean(),
  blockers: z.array(z.string()),
  bitcoin: z.object({ rpc: probe, height, headers: height, initialBlockDownload: z.nullable(z.boolean()) }),
  lnd: z.object({ rest: probe, syncedToChain: z.nullable(z.boolean()), activeChannels: height, inactiveChannels: height }),
  tipsMatch: z.nullable(z.boolean()),
});

function fetchApi(path: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    cache: 'no-store',
    redirect: 'error',
    credentials: 'same-origin',
  });
}

async function parse<T>(response: Response, schema: z.ZodMiniType<T>) {
  const result = schema.safeParse(await response.json().catch(() => undefined));
  if (!result.success) throw new Error('The backend did not provide a valid response.');
  return result.data;
}

async function request<T>(path: string, schema: z.ZodMiniType<T>, options: RequestInit = {}, allowDiagnosticFailure = false) {
  const response = await fetchApi(path, options);
  if (!response.ok && !(allowDiagnosticFailure && response.status === 503)) {
    throw new Error('Backend unavailable. Try again.');
  }
  return parse(response, schema);
}

export const api = {
  health: () => request('/v1/health', health),
  quote: (amountSats: number, signal: AbortSignal) => request('/v1/quotes', quote, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountSats }), signal,
  }),
  preflight: () => request('/v1/preflight', preflight, {}, true),
  async session() {
    const response = await fetchApi('/v1/auth/session');
    if (response.status === 401) return null;
    if (!response.ok) throw new Error('The session service is unavailable.');
    const verified = await parse(response, session);
    return verified.expiresAt > Date.now() ? verified : null;
  },
  async login(username: string, password: string) {
    const response = await fetchApi('/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    });
    if (response.status === 401) return false;
    if (!response.ok) throw new Error('Sign-in is unavailable. Try again.');
    await parse(response, session);
    return true;
  },
  async logout(csrfToken: string) {
    const response = await fetchApi('/v1/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
    if (response.status !== 204 && response.status !== 401) throw new Error('Sign-out could not be confirmed.');
  },
};

export function quoteTotals(quote: Quote, amount: number, now = Date.now()) {
  const amounts = [quote.amountSats, quote.invoiceSats, quote.serviceFeeSats, quote.claimFeeSats];
  if (!amounts.every(n => Number.isSafeInteger(n) && n >= 0)
    || quote.amountSats !== amount || quote.invoiceSats !== quote.amountSats + quote.serviceFeeSats
    || quote.claimFeeSats > quote.amountSats || quote.expiresAt <= now) {
    throw new Error('The backend returned an invalid or expired estimate.');
  }
  return { received: quote.amountSats - quote.claimFeeSats, lost: quote.serviceFeeSats + quote.claimFeeSats };
}
