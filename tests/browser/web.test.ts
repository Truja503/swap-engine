import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import axe from 'axe-core';
import { chromium } from 'playwright';
import { createApi } from '../../src/api/server.js';
import { preflight } from '../../src/diagnostics/preflight.js';
import { setup } from '../helpers.js';

test('browser verifies quotes, restricted workspaces and responsive accessibility', async context => {
  const f = await setup();
  context.after(f.cleanup);
  const server = createApi(f.manager, async () => { throw new Error('No nodes in browser test'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ channel: process.env.WEB_TEST_BROWSER_CHANNEL });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await page.clock.install();
  await page.route('**/v1/auth/session', route => route.fulfill({ status: 401, json: {} }));
  const failed: string[] = [];
  const requests: string[] = [];
  const swapRequests: string[] = [];
  page.on('pageerror', error => failed.push(error.message));
  page.on('console', entry => {
    if (entry.type() === 'error' && !/\/(?:v1\/auth\/session|favicon.ico)$/.test(entry.location().url)) failed.push(entry.text());
  });
  page.on('request', request => { if (request.method() === 'POST') requests.push(new URL(request.url()).pathname); });
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/v1/swaps')) swapRequests.push(path);
  });
  await page.goto(base);
  assert.equal(await page.locator('#opening').isVisible(), false);
  assert.equal(await page.locator('.blocks').isVisible(), true);
  await page.waitForFunction(() => document.fonts.check('15px "Manrope Variable"') && document.fonts.size >= 2);
  await page.getByText('Simulation', { exact: true }).first().waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').textContent(), 'Skip to content');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'main');

  const amount = page.getByRole('textbox', { name: /quote principal/ });
  await amount.fill('50000.5');
  await amount.press('Enter');
  await page.getByText(/Enter a whole-sat amount/).waitFor();
  assert.deepEqual(requests, []);
  await amount.fill('50000');
  await amount.press('Enter');
  await page.getByText('49,500 sats', { exact: true }).waitFor();
  assert.deepEqual(requests, ['/v1/quotes']);
  assert.equal(await page.locator('#invoice').textContent(), '50,750 sats');
  const review = page.getByRole('button', { name: 'Review quote' });
  await review.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Review quote' });
  await dialog.waitFor();
  await dialog.getByText('1,250 sats', { exact: true }).waitFor();
  await dialog.getByText('Unknown', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Start swap' }).isDisabled(), true);
  assert.equal(await page.locator(':focus').textContent(), 'Close review');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(':focus').textContent(), 'Review quote');
  await mkdir('dist/web-verification', { recursive: true });
  await page.screenshot({ path: 'dist/web-verification/swap-desktop.png', fullPage: true });
  await page.clock.fastForward(121_000);
  await page.getByText('Quote expired. Request a fresh quote.').waitFor();
  assert.equal(await review.isVisible(), false);
  assert.equal(await page.locator(':focus').getAttribute('id'), 'estimate');

  let finishQuote!: () => void;
  const delay = new Promise<void>(resolve => { finishQuote = resolve; });
  let onQuoteStarted!: () => void;
  const started = new Promise<void>(resolve => { onQuoteStarted = resolve; });
  await page.route('**/v1/quotes', async route => {
    onQuoteStarted();
    await delay;
    await route.continue().catch(() => {}); // Editing aborts the in-flight request.
  }, { times: 1 });
  await amount.press('Enter');
  await started;
  await amount.fill('60000');
  finishQuote();
  await page.getByText('Amount changed. Request a fresh quote.').waitFor();
  assert.equal(await page.locator('#received-preview').textContent(), '—');

  await page.getByRole('button', { name: 'On-chain', exact: true }).press('Enter');
  assert.equal(await page.getByRole('button', { name: 'Get quote' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'On-chain', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Liquid', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#received-preview').textContent(), '—');
  await page.getByText('On-chain to Lightning is unavailable.').waitFor();
  await page.getByRole('button', { name: 'Reverse swap direction' }).click();
  assert.equal(await page.getByRole('button', { name: 'Get quote' }).isEnabled(), true);

  async function audit() {
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => (await (window as Window & { axe?: typeof axe }).axe!.run()).violations);
    assert.deepEqual(violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), []);
  }

  await audit();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Sign in' }).isEnabled(), true);
  assert.equal(await page.locator('#account-dashboard').isVisible(), false);
  assert.equal(await page.locator(':focus').getAttribute('id'), 'account-title');
  await audit();
  await page.screenshot({ path: 'dist/web-verification/account.png', fullPage: true });
  await page.getByRole('link', { name: 'Swap status' }).click();
  await page.getByText('Transaction status requires verified swap ownership.').waitFor();
  await audit();

  await page.getByRole('link', { name: 'Operations' }).click();
  await page.getByText('Sign in with an administrator account.').waitFor();
  assert.equal(await page.locator('#admin-dashboard').isVisible(), false);
  await audit();
  await page.screenshot({ path: 'dist/web-verification/operations.png', fullPage: true });
  await page.getByRole('link', { name: 'Swap', exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollWidth <= width, `Horizontal overflow at ${width}px: ${scrollWidth}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'dist/web-verification/swap-mobile.png', fullPage: true });
  assert.deepEqual(swapRequests, []);
  assert.deepEqual(failed, []);
});

test('regtest page renders a real preflight 503 report with offline test ports', async context => {
  const f = await setup();
  context.after(f.cleanup);
  const offline = { call: async () => { throw new Error('Offline test port'); } };
  const diagnostics = () => preflight(offline, offline, 'test-wallet', 'regtest');
  const server = createApi(f.manager, async () => { throw new Error('Offline test port'); }, diagnostics, 'regtest');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const browser = await chromium.launch({ channel: process.env.WEB_TEST_BROWSER_CHANNEL });
  context.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.route('**/v1/auth/session', route => route.fulfill({ json: session('ADMIN') }));
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#operations`);
  await page.getByText('Regtest setup requires attention.').waitFor();
  assert.equal(await page.locator('#mode').textContent(), ' REGTEST READ-ONLY');
  assert.equal(await page.locator('#core').textContent(), 'Unavailable');
  assert.equal(await page.locator('#height').textContent(), '—');
  assert.equal(await page.locator('#lnd').textContent(), 'Unavailable');
  await page.locator('#blockers').getByText('no active channels', { exact: true }).count().then(count => assert.equal(count, 0));
  await page.locator('#blockers').getByText('channel status unavailable', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByText('Regtest setup requires attention.').waitFor();
  await page.screenshot({ path: 'dist/web-verification/admin.png', fullPage: true });
});

function session(role: 'USER' | 'ADMIN') {
  return { user: { id: 'test-user', username: 'test operator', role }, csrfToken: 'test-csrf', expiresAt: Date.now() + 60_000 };
}

test('login success requires independent session verification and logout is CSRF protected', async context => {
  const f = await setup();
  context.after(f.cleanup);
  const server = createApi(f.manager, async () => { throw new Error('Offline test port'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const browser = await chromium.launch({ channel: process.env.WEB_TEST_BROWSER_CHANNEL });
  context.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  let signedIn = false;
  let loginCount = 0;
  await page.route('**/v1/auth/session', route => signedIn
    ? route.fulfill({ json: session('USER') })
    : route.fulfill({ status: 401, json: {} }));
  await page.route('**/v1/auth/login', async route => {
    assert.equal(route.request().method(), 'POST');
    assert.deepEqual(route.request().postDataJSON(), { username: 'test operator', password: 'test-only' });
    loginCount++;
    if (loginCount === 1) { await route.fulfill({ status: 401, json: {} }); return; }
    signedIn = true;
    await route.fulfill({ json: session('ADMIN') }); // The subsequent GET returns USER.
  });
  let csrf = '';
  await page.route('**/v1/auth/logout', async route => {
    csrf = route.request().headers()['x-csrf-token'] ?? '';
    assert.equal(route.request().method(), 'POST');
    signedIn = false;
    await route.fulfill({ status: 204 });
  });
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/#account`);
  await page.getByLabel('Username').fill('test operator');
  await page.getByLabel('Password').fill('test-only');
  await page.getByLabel('Password').press('Enter');
  await page.getByText('Sign-in failed. Check your credentials.').waitFor();
  assert.equal(await page.getByLabel('Password').inputValue(), '');
  await page.getByLabel('Password').fill('test-only');
  await page.getByLabel('Password').press('Enter');
  await page.getByRole('heading', { name: 'Account overview' }).waitFor();
  assert.equal(await page.locator('#account-role').textContent(), 'User');
  await page.screenshot({ path: 'dist/web-verification/user.png', fullPage: true });
  await page.getByRole('link', { name: 'Operations' }).click();
  await page.getByText('Administrator role required.').waitFor();
  assert.equal(await page.locator('#admin-dashboard').isVisible(), false);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByText('Signed out.', { exact: true }).waitFor();
  assert.equal(csrf, 'test-csrf');
  assert.equal(await page.locator('#account-dashboard').isVisible(), false);
  const local = await page.evaluate(() => [localStorage.length, sessionStorage.length]);
  assert.deepEqual(local, [0, 0]);
});

test('opening animates the six lines into SWAPS and reveals the block composition', async context => {
  const f = await setup();
  context.after(f.cleanup);
  const server = createApi(f.manager, async () => { throw new Error('Offline test port'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const browser = await chromium.launch({ channel: process.env.WEB_TEST_BROWSER_CHANNEL });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 500);
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  const opening = page.locator('#opening');
  await opening.waitFor();
  await page.clock.runFor(390);
  const horizontalLines = await opening.evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(Math.round(canvas.width / 2), 0, 1, canvas.height).data;
    let lines = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! > 80 && (i === 3 || pixels[i - 4]! <= 80)) lines++;
    }
    return lines;
  });
  assert.equal(horizontalLines, 6);
  await opening.screenshot({ path: 'dist/web-verification/intro-lines.png' });
  await page.clock.runFor(500);
  await opening.screenshot({ path: 'dist/web-verification/intro-waves.png' });
  await page.clock.runFor(1320);
  await opening.screenshot({ path: 'dist/web-verification/intro-swaps.png' });
  await page.clock.runFor(850);
  await opening.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.cube').count(), 3);
  assert.equal(await page.getByRole('button', { name: 'Get quote' }).isEnabled(), true);
});
