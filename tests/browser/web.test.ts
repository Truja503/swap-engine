import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import axe from 'axe-core';
import { chromium, type Page } from 'playwright';
import { createApi } from '../../src/api/server.js';
import { preflight } from '../../src/diagnostics/preflight.js';
import { setup } from '../helpers.js';

const evidence = 'dist/web-verification';

async function waitForRails(page: Page, send: string, receive: string) {
  await page.waitForFunction(([send, receive]) => {
    return !document.getElementById('quote-form')?.hasAttribute('data-turning')
      && (document.getElementById('send-network') as HTMLSelectElement).value === send
      && (document.getElementById('receive-network') as HTMLSelectElement).value === receive;
  }, [send, receive]);
}

async function audit(page: Page) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => (await (window as Window & { axe?: typeof axe }).axe!.run()).violations);
  assert.deepEqual(violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), []);
}

test('three faces quote a real route and preserve keyboard, account and responsive accessibility', async context => {
  const f = await setup();
  context.after(f.cleanup);
  const server = createApi(f.manager, async () => { throw new Error('No nodes in browser test'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ channel: process.env.WEB_TEST_BROWSER_CHANNEL });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.clock.install();
  await page.route('**/v1/auth/session', route => route.fulfill({ status: 401, json: {} }));
  const quoteRequests: number[] = [];
  const swapRequests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/v1/quotes') quoteRequests.push(request.postDataJSON().amountSats);
    if (path.startsWith('/v1/swaps')) swapRequests.push(path);
  });

  await mkdir(evidence, { recursive: true });
  await page.goto(base);
  assert.equal(await page.locator('#opening-overlay').isVisible(), false);
  await page.waitForFunction(() => document.fonts.size >= 2);
  await page.getByText('REGTEST', { exact: true }).waitFor();
  await page.waitForFunction(() => document.getElementById('mode')?.dataset.mode === 'simulation');
  assert.equal(await page.locator('header.top').innerText(), 'SWAP\nACCOUNT\nOPERATIONS');
  assert.equal(await page.locator('.footer-squares i').count(), 3);
  await page.getByText('49,500', { exact: true }).waitFor();
  assert.deepEqual(quoteRequests, [50_000]);
  assert.equal(await page.locator('#quote-form .cube-unit').count(), 3);
  assert.equal(await page.locator('#swap .cube-send .plane-front #amount').count(), 1);
  assert.equal(await page.locator('#swap .cube-swap .plane-front #swap-action').count(), 1);
  assert.equal(await page.locator('#swap .cube-receive .plane-front #received-preview').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Get quote' }).count(), 0);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').textContent(), 'Skip to content');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'main');

  const amount = page.getByRole('textbox', { name: /quote principal/i });
  const swap = page.getByRole('button', { name: 'SWAP', exact: true });
  await amount.fill('50000.5');
  assert.equal(await swap.isDisabled(), true);
  assert.equal(await amount.getAttribute('aria-invalid'), 'true');
  await page.getByText(/Enter 10,000/).waitFor();
  assert.deepEqual(quoteRequests, [50_000]);
  await amount.fill('50000');
  await page.getByText('49,500', { exact: true }).waitFor();
  assert.equal(await page.locator('#service').textContent(), '750 sats');
  assert.equal(await page.locator('#claim').textContent(), '500 sats');
  assert.equal(await page.locator('#cost').textContent(), '1,250 sats');
  await amount.blur();
  await page.screenshot({ path: evidence + '/swap-desktop.png' });

  await swap.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Review quote' });
  await dialog.waitFor();
  await dialog.getByText('50,750 sats', { exact: true }).waitFor();
  await dialog.getByText('Unknown', { exact: true }).waitFor();
  await dialog.getByText(/Simulation.*Execution disabled/).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Start swap' }).isDisabled(), true);
  assert.equal(await page.locator(':focus').textContent(), 'Close review');
  await page.screenshot({ path: evidence + '/review.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'swap-action');

  await page.clock.fastForward(121_000);
  await page.getByText(/Quote expired/).waitFor();
  assert.equal(await page.locator('#received-preview').textContent(), '\u2014');
  await page.clock.setSystemTime(Date.now());

  let release!: () => void;
  const holding = new Promise<void>(resolve => { release = resolve; });
  let held!: () => void;
  const captured = new Promise<void>(resolve => { held = resolve; });
  await page.route('**/v1/quotes', async route => {
    const oldResponse = await route.fetch();
    held();
    await holding;
    await route.fulfill({ response: oldResponse }).catch(() => {});
  }, { times: 1 });
  await amount.fill('60000');
  await captured;
  await amount.fill('70000');
  await page.getByText('69,500', { exact: true }).waitFor();
  release();
  assert.deepEqual(quoteRequests, [50_000, 50_000, 60_000, 70_000]);
  assert.equal(await page.locator('#received-preview').textContent(), '69,500');

  await page.getByLabel('Send network').selectOption('onchain');
  await waitForRails(page, 'onchain', 'lightning');
  assert.equal(await swap.isDisabled(), true);
  await page.getByText('Route unavailable').waitFor();
  assert.equal(await page.locator('#cost').textContent(), '\u2014');
  await page.getByRole('button', { name: 'Rotate send cube' }).press('ArrowDown');
  await waitForRails(page, 'lightning', 'liquid');
  await page.getByLabel('Receive network').selectOption('onchain');
  await waitForRails(page, 'lightning', 'onchain');
  await page.getByText('69,500', { exact: true }).waitFor();
  assert.deepEqual(quoteRequests, [50_000, 50_000, 60_000, 70_000, 70_000]);

  await audit(page);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  assert.equal(await page.locator('.footer-squares').getAttribute('data-view-active'), 'account');
  assert.equal(await page.getByRole('button', { name: 'Sign in' }).isEnabled(), true);
  assert.equal(await page.locator('#account-dashboard').isVisible(), false);
  assert.equal(await page.locator(':focus').getAttribute('id'), 'account-title');
  await audit(page);
  await page.screenshot({ path: evidence + '/account.png' });
  await page.getByRole('link', { name: 'Swap status' }).click();
  await page.getByText('Transaction status requires verified swap ownership.').waitFor();
  await audit(page);

  await page.getByRole('link', { name: 'Operations' }).click();
  await page.getByText('Sign in with an administrator account.').waitFor();
  assert.equal(await page.locator('#admin-dashboard').isVisible(), false);
  await audit(page);
  await page.screenshot({ path: evidence + '/operations.png' });
  await page.getByRole('link', { name: 'Swap', exact: true }).click();
  for (const [width, height] of [[320, 700], [390, 844], [701, 844], [768, 844], [1024, 600], [1366, 768], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      buttonBottom: document.getElementById('swap-action')!.getBoundingClientRect().bottom,
      clippedFaces: [...document.querySelectorAll('.plane-front')].some(face => face.scrollHeight > face.clientHeight),
    }));
    assert.ok(bounds.width <= width, 'Horizontal overflow at ' + width);
    assert.equal(bounds.clippedFaces, false, 'Face content overflows at ' + width);
    if (width >= 768) {
      assert.ok(bounds.height <= height, 'Desktop workspace scrolls at ' + width);
      assert.ok(bounds.buttonBottom <= height);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidence + '/swap-mobile.png', fullPage: true });
  assert.deepEqual(swapRequests, []);
  assert.deepEqual(errors, []);
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
  assert.equal(await page.locator('#mode').getAttribute('data-mode'), 'regtest');
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

test('opening fills the viewport, draws six lines, fades and sequences a 3D entrance', async context => {
  const f = await setup();
  context.after(f.cleanup);
  const server = createApi(f.manager, async () => { throw new Error('Offline test ports'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const browser = await chromium.launch({ channel: process.env.WEB_TEST_BROWSER_CHANNEL });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 500);
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/';
  await page.goto(url);
  const opening = page.locator('#opening-overlay');
  await opening.waitFor();
  assert.deepEqual(await opening.boundingBox(), { x: 0, y: 0, width: 1440, height: 900 });
  assert.equal(await page.locator('#workspace-shell').evaluate(shell => (shell as HTMLElement).inert), true);
  await page.clock.runFor(390);
  const horizontalLines = await page.locator('#opening').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(Math.round(canvas.width / 2), 0, 1, canvas.height).data;
    let lines = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! > 80 && (i === 3 || pixels[i - 4]! <= 80)) lines++;
    }
    return lines;
  });
  assert.equal(horizontalLines, 6);
  await page.screenshot({ path: evidence + '/intro-lines.png' });
  await page.clock.runFor(500);
  await page.screenshot({ path: evidence + '/intro-waves.png' });
  await page.clock.runFor(1320);
  await page.screenshot({ path: evidence + '/intro-swaps.png' });
  await page.clock.runFor(1060);
  await opening.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#workspace-shell').evaluate(shell => (shell as HTMLElement).inert), false);
  assert.ok(await page.locator('.cube-send').evaluate(cube => cube.getAnimations().length > 0));
  await page.screenshot({ path: evidence + '/intro-entrance.png' });
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('link', { name: 'Swap', exact: true }).click();
  assert.equal(await opening.isVisible(), false);

  await page.reload();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'skip-intro');
  await page.keyboard.press('Enter');
  assert.equal(await opening.isVisible(), false);
  assert.equal(await page.locator(':focus').getAttribute('id'), 'main');
});

test('actual mouse and touch gestures rotate in both directions and linked animation batches quote requests', async context => {
  const f = await setup();
  context.after(f.cleanup);
  const server = createApi(f.manager, async () => { throw new Error('Offline test ports'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const browser = await chromium.launch({ channel: process.env.WEB_TEST_BROWSER_CHANNEL });
  context.after(() => browser.close());
  const desktop = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ...(process.env.WEB_TEST_RECORD === '1' ? { recordVideo: { dir: evidence, size: { width: 1366, height: 768 } } } : {}),
  });
  const page = await desktop.newPage();
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/';
  const observations: Array<Promise<[boolean, string, string]>> = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/v1/quotes') return;
    observations.push(page.evaluate(() => [
      document.getElementById('quote-form')!.hasAttribute('data-turning'),
      (document.getElementById('send-network') as HTMLSelectElement).value,
      (document.getElementById('receive-network') as HTMLSelectElement).value,
    ]));
  });
  await page.goto(url);
  await page.locator('#opening-overlay').waitFor({ state: 'hidden' });
  await page.locator('.cube-swap').evaluate(cube => Promise.all(cube.getAnimations().map(animation => animation.finished)));
  await page.getByText('49,500', { exact: true }).waitFor();

  const send = page.getByLabel('Send network');
  const receive = page.getByLabel('Receive network');
  await page.locator('#send-cube').evaluate(cube => {
    const observed: string[] = [];
    Object.assign(cube, { observed });
    new MutationObserver(() => observed.push(cube.getAttribute('data-rail')!))
      .observe(cube, { attributes: true, attributeFilter: ['data-rail'] });
  });
  await send.selectOption('onchain');
  const turning = await page.locator('#quote-form').evaluate(form => ({
    active: form.hasAttribute('data-turning'),
    rotors: [...form.querySelectorAll('.cube-rotor')].map(rotor => rotor.getAnimations().length),
    receiveNext: form.querySelector('.cube-receive .plane-bottom .turn-label')?.textContent,
  }));
  assert.equal(turning.active, true);
  assert.deepEqual(turning.rotors, [1, 1, 0]);
  assert.match(turning.receiveNext!, /LIGHTNING/);
  await page.waitForFunction(() => {
    const turns = [...document.querySelectorAll('.cube-rotor')].flatMap(rotor => rotor.getAnimations());
    return turns.length === 2 && turns.every(turn => typeof turn.currentTime === 'number' && turn.currentTime >= 78);
  });
  await page.screenshot({ path: evidence + '/linked-rotation.png' });
  await waitForRails(page, 'onchain', 'lightning');
  assert.deepEqual(await page.locator('#send-cube').evaluate(cube => Reflect.get(cube, 'observed')), ['liquid', 'onchain']);
  assert.equal(observations.length, 1);

  const sendGrip = page.getByRole('button', { name: 'Rotate send cube' });
  const drag = async (delta: number) => {
    const box = (await sendGrip.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + delta, { steps: 8 });
    assert.match(await page.locator('.cube-send .cube-rotor').evaluate(node => (node as HTMLElement).style.transform), /rotateX/);
    await page.mouse.up();
  };
  await drag(80);
  await waitForRails(page, 'lightning', 'liquid');
  await drag(-80);
  await waitForRails(page, 'onchain', 'liquid');
  await receive.selectOption('onchain');
  await waitForRails(page, 'lightning', 'onchain');
  await page.getByText('49,500', { exact: true }).waitFor();
  assert.equal(observations.length, 2);
  assert.deepEqual(await Promise.all(observations), [[false, 'lightning', 'onchain'], [false, 'lightning', 'onchain']]);

  await sendGrip.press('ArrowUp');
  await sendGrip.press('ArrowDown');
  await sendGrip.press('ArrowDown');
  await page.getByRole('button', { name: 'Rotate receive cube' }).press('ArrowUp');
  await waitForRails(page, 'onchain', 'liquid');
  assert.equal(await page.getByRole('button', { name: 'SWAP', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#received-preview').textContent(), '\u2014');
  assert.equal(observations.length, 2);
  const receiveGrip = page.getByRole('button', { name: 'Rotate receive cube' });
  await receiveGrip.hover();
  await page.mouse.wheel(0, 80);
  await page.mouse.wheel(0, 80);
  await waitForRails(page, 'lightning', 'onchain');
  await page.getByText('49,500', { exact: true }).waitFor();
  await receiveGrip.hover();
  await page.mouse.wheel(0, -80);
  await waitForRails(page, 'lightning', 'liquid');
  assert.equal(observations.length, 3);
  const video = page.video();
  await desktop.close();
  if (video) {
    await video.saveAs(evidence + '/cube-experience.webm');
    await video.delete();
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touchPage = await mobile.newPage();
  await touchPage.goto(url);
  await touchPage.getByRole('button', { name: 'Skip intro' }).tap();
  await touchPage.locator('.cube-send').evaluate(cube => Promise.all(cube.getAnimations().map(animation => animation.finished)));
  const cdp = await mobile.newCDPSession(touchPage);
  const stack = await touchPage.locator('.cube-scene').evaluate(scene => {
    const cubes = ['.cube-send', '.cube-swap', '.cube-receive'].map(selector => scene.querySelector<HTMLElement>(selector)!);
    return cubes.map(cube => [cube.offsetTop, cube.offsetHeight]);
  });
  assert.equal(stack[1]![0], stack[0]![0]! + stack[0]![1]!);
  assert.equal(stack[2]![0], stack[1]![0]! + stack[1]![1]!);

  async function swipe(dx: number, dy: number) {
    const face = (await touchPage.locator('.cube-send .face-header').boundingBox())!;
    const x = Math.round(face.x + face.width / 2);
    const y = Math.round(face.y + face.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const progress of [.48, 1]) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x + dx * progress, y: y + dy * progress }],
      });
    }
    if (dx) {
      const transform = await touchPage.locator('.cube-send .cube-rotor').evaluate(rotor => (rotor as HTMLElement).style.transform);
      assert.match(transform, /rotateY/);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await swipe(74, 0);
  await waitForRails(touchPage, 'liquid', 'onchain');
  await swipe(-74, 0);
  await waitForRails(touchPage, 'lightning', 'onchain');
  await touchPage.getByRole('button', { name: 'Rotate send cube' }).press('ArrowRight');
  await waitForRails(touchPage, 'liquid', 'onchain');
  await swipe(0, -95);
  await touchPage.waitForFunction(() => window.scrollY > 10);
  await waitForRails(touchPage, 'liquid', 'onchain');
  await mobile.close();
});
