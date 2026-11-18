import { api, quoteTotals, type Quote } from './api.js';
import { details, get, message, sats, text } from './ui.js';

export function mountQuote() {
  const form = get<HTMLFormElement>('quote-form');
  const amount = get<HTMLInputElement>('amount');
  const estimate = get<HTMLButtonElement>('estimate');
  const review = get<HTMLButtonElement>('review');
  const dialog = get<HTMLDialogElement>('review-dialog');
  let forward = false;
  let quote: Quote | undefined;
  let request: AbortController | undefined;
  let expiry: number | undefined;

  function invalidate() {
    const restoreFocus = dialog.open || document.activeElement === review;
    request?.abort();
    request = undefined;
    window.clearTimeout(expiry);
    quote = undefined;
    review.hidden = true;
    if (dialog.open) dialog.close();
    for (const id of ['service', 'claim', 'invoice', 'cost', 'received-preview']) text(id, '—');
    form.setAttribute('aria-busy', 'false');
    estimate.disabled = forward;
    if (restoreFocus && !forward) estimate.focus();
  }

  amount.addEventListener('input', () => {
    invalidate();
    amount.removeAttribute('aria-invalid');
    text('quote-status', forward ? 'On-chain to Lightning is unavailable.' : 'Amount changed. Request a fresh quote.');
  });

  function selectDirection(next: boolean) {
    if (next === forward) return;
    forward = next;
    invalidate();
    amount.removeAttribute('aria-invalid');
    text('source', forward ? 'On-chain' : 'Lightning');
    text('destination', forward ? 'Lightning' : 'On-chain');
    document.querySelectorAll('[data-icon]').forEach((icon, index) => {
      icon.textContent = (index === 0) === forward ? '₿' : 'ϟ';
    });
    form.dataset.direction = forward ? 'forward' : 'reverse';
    get('sculpture').dataset.rail = forward ? 'onchain' : 'lightning';
    get('rail-onchain').setAttribute('aria-pressed', String(forward));
    get('rail-lightning').setAttribute('aria-pressed', String(!forward));
    amount.disabled = forward;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      form.querySelectorAll('.asset-name').forEach((asset, index) => {
        asset.getAnimations().forEach(animation => animation.cancel());
        asset.animate([{ opacity: 0, transform: `translateY(${index ? -8 : 8}px)` }, { opacity: 1, transform: 'none' }], { duration: 190, easing: 'ease-out' });
      });
    }
    text('quote-status', forward ? 'On-chain to Lightning is unavailable.' : 'Lightning to on-chain quote preview. Execution is disabled.');
  }
  get('reverse').addEventListener('click', () => selectDirection(!forward));
  get('rail-onchain').addEventListener('click', () => selectDirection(true));
  get('rail-lightning').addEventListener('click', () => selectDirection(false));
  document.querySelector('.cube-onchain')?.addEventListener('click', () => get('rail-onchain').click());
  document.querySelector('.cube-lightning')?.addEventListener('click', () => get('rail-lightning').click());

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (forward) return;
    invalidate();
    const principal = Number(amount.value);
    if (!/^\d+$/.test(amount.value) || principal < 10000 || principal > 1000000) {
      amount.setAttribute('aria-invalid', 'true');
      text('quote-status', 'Enter a whole-sat amount from 10,000 to 1,000,000.');
      amount.focus();
      return;
    }
    const active = new AbortController();
    request = active;
    estimate.disabled = true;
    form.setAttribute('aria-busy', 'true');
    text('quote-status', 'Requesting quote…');
    try {
      const result = await api.quote(principal, active.signal);
      if (request !== active) return;
      const totals = quoteTotals(result, principal);
      quote = result;
      text('service', sats(result.serviceFeeSats));
      text('claim', sats(result.claimFeeSats));
      text('invoice', sats(result.invoiceSats));
      text('cost', sats(totals.lost));
      text('received-preview', sats(totals.received));
      review.hidden = false;
      text('quote-status', 'Quote expires at ' + new Date(result.expiresAt).toLocaleTimeString() + '.');
      expiry = window.setTimeout(() => {
        invalidate();
        text('quote-status', 'Quote expired. Request a fresh quote.');
      }, Math.max(0, result.expiresAt - Date.now()));
    } catch (error) {
      if (request === active) text('quote-status', message(error));
    } finally {
      if (request === active) {
        request = undefined;
        estimate.disabled = false;
        form.setAttribute('aria-busy', 'false');
      }
    }
  });

  review.addEventListener('click', () => {
    if (!quote || quote.expiresAt <= Date.now()) {
      invalidate();
      text('quote-status', 'Quote expired. Request a fresh quote.');
      return;
    }
    const totals = quoteTotals(quote, Number(amount.value));
    details(get('review-details'), [
      ['Route', 'Lightning → On-chain'],
      ['Quote principal', sats(quote.amountSats)],
      ['Service fee', sats(quote.serviceFeeSats)],
      ['Estimated claim fee', sats(quote.claimFeeSats)],
      ['Total Lightning payment', sats(quote.invoiceSats)],
      ['Estimated on-chain receipt', sats(totals.received)],
      ['Estimated cost', sats(totals.lost)],
      ['Lightning routing fee', 'Unknown'],
    ]);
    dialog.showModal();
  });
}
