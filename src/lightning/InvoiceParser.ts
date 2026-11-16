import { z } from 'zod';
import type { Invoice } from './LndClient.js';

const integer = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
/** LND's InvoiceHTLC uses expiry_height, unlike channel HTLC expiration_height. */
export function parseLndInvoice(raw: unknown): Invoice {
  const parsed = z.object({ state: z.enum(['OPEN', 'ACCEPTED', 'SETTLED', 'CANCELED']), r_hash: z.string(),
    value: integer, amt_paid_sat: integer, payment_request: z.string(),
    htlcs: z.array(z.object({ state: z.enum(['ACCEPTED', 'SETTLED', 'CANCELED']),
      expiry_height: z.number().int().nonnegative().max(0xffffffff), amt_msat: integer })).optional(),
  }).parse(raw);
  return { ...parsed, htlcs: parsed.htlcs?.map(h => ({ state: h.state, expiration_height: h.expiry_height, amt_msat: h.amt_msat })) };
}
