import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setup } from './helpers.js';
import { createApi } from '../src/api/server.js';

const clientPath = new URL('../src/web/app.js', import.meta.url).href;
const { quoteTotals, mount } = await import(clientPath);
const quote = () => ({ amountSats: 50000, serviceFeeSats: 750, claimFeeSats: 500, invoiceSats: 50750, expiresAt: Date.now() + 120000 });

test('UI totals use API fees and count both service and claim fees as sats lost', () => {
  assert.deepEqual(quoteTotals(quote(), 50000), { received: 49500, lost: 1250 });
  assert.deepEqual(quoteTotals({ ...quote(), serviceFeeSats: 1234, claimFeeSats: 789, invoiceSats: 51234 }, 50000), { received: 49211, lost: 2023 });
  for (const invalid of [{ ...quote(), expiresAt: 0 }, { ...quote(), amountSats: 60000 }, { ...quote(), claimFeeSats: -1 }, { ...quote(), invoiceSats: 1 }, { ...quote(), claimFeeSats: 50001 }, {}]) {
    assert.throws(() => quoteTotals(invalid, 50000));
  }
});

function dom() {
  const elements = new Map<string, any>();
  for (const id of ['quote-form', 'amount', 'estimate', 'status', 'principal', 'service', 'claim', 'invoice', 'received', 'lost']) {
    elements.set(id, { textContent: '—', value: '50000', disabled: false, dataset: {}, handlers: {} as Record<string, Function>, addEventListener(name: string, fn: Function) { this.handlers[name] = fn; }, setAttribute() {} });
  }
  return { elements, document: { querySelector: (selector: string) => elements.get(selector.slice(1)), getElementById: (id: string) => elements.get(id) } };
}

test('client posts only an amount to quotes, clears edited estimates and handles errors', async () => {
  const { elements: e, document } = dom();
  const calls: any[] = [];
  let ok = true;
  mount(document, async (...args: any[]) => { calls.push(args); return { ok, json: async () => quote() }; });
  const submit = () => e.get('quote-form').handlers.submit({ preventDefault() {} });
  await submit();
  assert.equal(calls[0][0], '/v1/quotes');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { amountSats: 50000 });
  assert.equal(e.get('received').textContent, '49,500 sats');
  assert.equal(e.get('lost').textContent, '1,250 sats');
  e.get('amount').handlers.input();
  assert.equal(e.get('received').textContent, '—');
  ok = false;
  await submit();
  assert.match(e.get('status').textContent, /unavailable/);
  assert.equal(e.get('estimate').disabled, false);
  e.get('amount').value = '10000.5';
  await submit();
  assert.equal(calls.length, 2);
  assert.match(e.get('status').textContent, /whole-sat/);
});

test('an older response cannot overwrite an edited amount', async () => {
  const { elements: e, document } = dom();
  let resolve!: (value: unknown) => void;
  mount(document, () => new Promise(r => { resolve = r; }));
  const pending = e.get('quote-form').handlers.submit({ preventDefault() {} });
  e.get('amount').value = '60000';
  e.get('amount').handlers.input();
  resolve({ ok: true, json: async () => quote() });
  await pending;
  assert.equal(e.get('received').textContent, '—');
  assert.match(e.get('status').textContent, /changed/);
});

test('existing API serves the local UI and only allowlisted assets', async () => {
  const f = await setup();
  const server = createApi(f.manager, async () => ({ onchainSats: 0, incomingSats: 0 }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [path, mime] of [['/', 'text/html'], ['/app.css', 'text/css'], ['/app.js', 'text/javascript']]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, new RegExp(mime!));
      assert.match(response.headers.get('content-security-policy')!, /default-src 'self'/);
      const content = await response.text();
      if (path === '/') { assert.match(content, /NOT IMPLEMENTED/); assert.match(content, /REGTEST · SIMULATION/); }
    }
    assert.equal((await fetch(`${base}/config.ts`)).status, 404);
    assert.equal((await fetch(`${base}/app.js`, { method: 'POST' })).status, 404);
    const response = await fetch(`${base}/v1/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"amountSats":50000}' });
    assert.deepEqual(quoteTotals(await response.json(), 50000), { received: 49500, lost: 1250 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await f.cleanup();
  }
});
