import { api, type OperationsBalances } from './api.js';
import { get, sats, text } from './ui.js';

const nodes = ['core', 'provider', 'alice'] as const;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const format = (value: number | null | undefined) => value == null ? 'Unavailable' : sats(value);

export function mountOperationsBalances() {
  const refresh = get<HTMLButtonElement>('balance-refresh');
  const snapshotTime = get<HTMLTimeElement>('balance-time');
  let active = false;
  let pending: AbortController | undefined;

  function render(snapshot?: OperationsBalances) {
    for (const node of nodes) {
      const wallet = snapshot?.[node];
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
  }

  async function load() {
    if (!active || pending) return;
    const controller = new AbortController();
    pending = controller;
    refresh.disabled = true;
    render();
    text('balance-status', 'Loading balances…');
    try {
      const snapshot = await api.operationsBalances(controller.signal);
      if (pending !== controller) return;
      render(snapshot);
      text('balance-status', 'Regtest snapshot');
    } catch {
      if (pending === controller) text('balance-status', 'Balance snapshot unavailable.');
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
