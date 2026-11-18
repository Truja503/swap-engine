import { api, type OperationsBalances } from './api.js';
import { get, sats, text } from './ui.js';

const nodes = ['core', 'provider', 'alice'] as const;
const maxFreshAge = 60_000;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const format = (value: number | null | undefined) => value == null ? 'Unavailable' : sats(value);

export function mountOperationsBalances() {
  const refresh = get<HTMLButtonElement>('balance-refresh');
  const chart = get('onchain-balances');
  const snapshotTime = get<HTMLTimeElement>('balance-time');
  let active = false;
  let pending: AbortController | undefined;
  let staleTimer: number | undefined;

  function showAge(capturedAt: string) {
    const age = Date.now() - Date.parse(capturedAt);
    if (age >= maxFreshAge) {
      chart.dataset.stale = '';
      text('balance-status', 'Regtest snapshot · at least 1 minute old');
    } else {
      text('balance-status', 'Regtest snapshot');
      staleTimer = window.setTimeout(() => showAge(capturedAt), Math.min(maxFreshAge - age, 2_147_483_647));
    }
  }

  function render(snapshot?: OperationsBalances, loading = false) {
    window.clearTimeout(staleTimer);
    delete chart.dataset.stale;
    const maxConfirmed = Math.max(0, ...nodes.map(node => snapshot?.[node]?.confirmedSats ?? 0));
    for (const node of nodes) {
      const wallet = snapshot?.[node];
      const confirmed = wallet?.confirmedSats;
      const pile = get(node + '-pile');
      pile.dataset.state = loading ? 'loading' : confirmed == null ? 'unavailable' : 'known';
      if (confirmed == null || maxConfirmed === 0) pile.style.removeProperty('--wallet-fill');
      else pile.style.setProperty('--wallet-fill', (confirmed / maxConfirmed * 100) + '%');
      text(node + '-confirmed', format(wallet?.confirmedSats));
      text(node + '-unconfirmed', format(wallet?.unconfirmedSats));
    }
    for (const node of ['provider', 'alice'] as const) {
      text(node + '-local', format(snapshot?.[node]?.localSats));
      text(node + '-remote', format(snapshot?.[node]?.remoteSats));
    }
    snapshotTime.hidden = !snapshot;
    snapshotTime.dateTime = snapshot?.capturedAt ?? '';
    snapshotTime.textContent = snapshot ? date.format(new Date(snapshot.capturedAt)) : '';
    if (snapshot) showAge(snapshot.capturedAt);
  }

  async function load() {
    if (!active || pending) return;
    const controller = new AbortController();
    pending = controller;
    refresh.disabled = true;
    render(undefined, true);
    text('balance-status', 'Loading balances…');
    try {
      const snapshot = await api.operationsBalances(controller.signal);
      if (pending !== controller) return;
      render(snapshot);
    } catch {
      if (pending === controller) {
        render();
        text('balance-status', 'Balance snapshot unavailable.');
      }
    } finally {
      if (pending === controller) {
        pending = undefined;
        refresh.disabled = false;
      }
    }
  }

  refresh.addEventListener('click', () => void load());

  return (enabled: boolean) => {
    if (active === enabled) return;
    active = enabled;
    if (active) {
      void load();
    } else {
      pending?.abort();
      pending = undefined;
      refresh.disabled = false;
      render();
      text('balance-status', 'Balance snapshot unavailable.');
    }
  };
}
