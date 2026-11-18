import { api, quoteTotals, type Quote } from './api.js';
import { mountCubes } from './cubes.js';
import { canQuote, defaultPair, railLabel, type Pair } from './rails.js';
import { details, get, integer, message, sats, text } from './ui.js';

export function mountQuote() {
  const form = get<HTMLFormElement>('quote-form');
  const amount = get<HTMLInputElement>('amount');
  const action = get<HTMLButtonElement>('swap-action');
  const dialog = get<HTMLDialogElement>('review-dialog');
  const status = (message: string) => text('quote-status', message);
  const numbers = ['service', 'claim', 'cost', 'received-preview'];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let pair = defaultPair;
  let aligned = true;
  let visible = false;
  let revision = 0;
  let quote: Quote | undefined;
  let pending: { controller: AbortController; work: Promise<Quote | undefined> } | undefined;
  let debounce: number | undefined;
  let expiry: number | undefined;

  function invalidate() {
    revision++;
    pending?.controller.abort();
    pending = undefined;
    window.clearTimeout(debounce);
    window.clearTimeout(expiry);
    quote = undefined;
    delete form.dataset.loading;
    if (dialog.open) dialog.close();
    for (const id of numbers) text(id, '—');
  }

  function principal() {
    const value = Number(amount.value);
    if (/^\d+$/.test(amount.value) && value >= 10_000 && value <= 1_000_000) return value;
    return undefined;
  }

  function animateValues(values: string[]) {
    numbers.forEach((id, index) => {
      const element = get(id);
      element.textContent = values[index]!;
      if (motion.matches) return;
      element.getAnimations().forEach(animation => animation.cancel());
      element.animate([{ opacity: .35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], {
        duration: 210, easing: 'ease-out',
      });
    });
  }

  function load(value: number) {
    if (pending) return pending.work;
    const active = new AbortController();
    const version = revision;
    form.dataset.loading = 'true';
    status('Quoting route…');
    const work = api.quote(value, active.signal).then(result => {
      if (version !== revision) return;
      const totals = quoteTotals(result, value);
      quote = result;
      animateValues([sats(result.serviceFeeSats), sats(result.claimFeeSats), sats(totals.lost), integer(totals.received)]);
      status('Quote ready · execution off');
      expiry = window.setTimeout(() => {
        invalidate();
        status('Quote expired · press Swap');
      }, Math.min(Math.max(0, result.expiresAt - Date.now()), 2_147_483_647));
      return result;
    }).catch(error => {
      if (version === revision) status(message(error));
      return undefined;
    }).finally(() => {
      if (pending?.controller === active) {
        pending = undefined;
        delete form.dataset.loading;
      }
    });
    pending = { controller: active, work };
    return work;
  }

  function schedule(delay: number) {
    if (!visible) return;
    const value = principal();
    action.disabled = !aligned || !canQuote(pair) || value === undefined;
    if (value === undefined) amount.setAttribute('aria-invalid', 'true');
    else amount.removeAttribute('aria-invalid');
    if (!aligned) { status('Aligning rails…'); return; }
    if (!canQuote(pair)) { status('Route unavailable'); return; }
    if (value === undefined) { status('Enter 10,000–1,000,000 sats'); return; }
    status('Updating quote…');
    debounce = window.setTimeout(() => void load(value), delay);
  }

  mountCubes(() => {
    aligned = false;
    invalidate();
    schedule(0);
  }, finalPair => {
    pair = finalPair;
    aligned = true;
    schedule(0);
  });

  amount.addEventListener('input', () => {
    invalidate();
    schedule(290);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const value = principal();
    if (!aligned || !canQuote(pair) || value === undefined || dialog.open) return;
    window.clearTimeout(debounce);
    if (quote && quote.expiresAt <= Date.now()) invalidate();
    const version = revision;
    const current = quote ?? await load(value);
    if (!current || version !== revision || dialog.open || get('swap').hidden) return;
    const now = Date.now();
    if (current.expiresAt <= now) {
      invalidate();
      status('Quote expired · press Swap');
      return;
    }
    const totals = quoteTotals(current, value, now);
    details(get('review-details'), [
      ['Route', railLabel[pair.send] + ' → ' + railLabel[pair.receive]],
      ['Quote principal', sats(current.amountSats)],
      ['Service fee', sats(current.serviceFeeSats)],
      ['Estimated network claim fee', sats(current.claimFeeSats)],
      ['Lightning routing fee', 'Unknown'],
      ['Total Lightning payment', sats(current.invoiceSats)],
      ['Estimated on-chain receipt', sats(totals.received)],
      ['Estimated cost', sats(totals.lost)],
    ]);
    const mode = get('mode').dataset.mode;
    text('execution-status', mode === 'simulation'
      ? 'Simulation · Execution disabled.'
      : mode === 'regtest' ? 'Regtest not ready · Execution disabled.' : 'Execution unavailable.');
    dialog.showModal();
  });

  return (next: boolean) => {
    if (visible === next) return;
    visible = next;
    if (!visible) {
      if (!quote) invalidate();
      return;
    }
    if (quote && quote.expiresAt > Date.now()) return;
    invalidate();
    schedule(0);
  };
}
