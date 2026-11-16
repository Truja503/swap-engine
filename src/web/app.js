// All fee values come from POST /v1/quotes. This client never creates a swap.
export function quoteTotals(quote, amount, now = Date.now()) {
  const fields = ['amountSats', 'serviceFeeSats', 'claimFeeSats', 'invoiceSats', 'expiresAt'];
  if (!quote || !fields.every(key => Number.isSafeInteger(quote[key]) && quote[key] >= 0)
    || quote.amountSats !== amount || quote.invoiceSats !== quote.amountSats + quote.serviceFeeSats
    || quote.claimFeeSats > quote.amountSats || quote.expiresAt <= now) {
    throw new Error('The API returned an invalid or expired estimate. Please try again.');
  }
  const received = quote.amountSats - quote.claimFeeSats;
  return { received, lost: quote.invoiceSats - received };
}

export function mount(document, request = fetch) {
  const form = document.querySelector('#quote-form');
  const amount = document.querySelector('#amount');
  const button = document.querySelector('#estimate');
  const status = document.querySelector('#status');
  const fields = ['principal', 'service', 'claim', 'invoice', 'received', 'lost'];
  let revision = 0;
  let expiry;
  let controller;
  const clear = () => fields.forEach(id => { document.getElementById(id).textContent = '—'; });
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  function invalidate() {
    revision++;
    controller?.abort();
    clearTimeout(expiry);
    clear();
    button.disabled = false;
    form.setAttribute('aria-busy', 'false');
  }
  amount.addEventListener('input', () => {
    invalidate();
    message('Amount changed. Calculate a new estimate.');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    invalidate();
    const value = Number(amount.value);
    if (!Number.isSafeInteger(value) || value < 10000 || value > 1000000) {
      message('Enter a whole-sat amount from 10,000 to 1,000,000.', true);
      return;
    }
    const current = revision;
    const activeController = new AbortController();
    controller = activeController;
    const timeout = setTimeout(() => activeController.abort(), 10000);
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    message('Requesting a regtest estimate…');
    try {
      const response = await request('/v1/quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountSats: value }), signal: activeController.signal,
      });
      if (!response.ok) throw new Error('Quote unavailable. Please try again.');
      const quote = await response.json();
      const totals = quoteTotals(quote, value);
      if (current !== revision) return;
      const values = [quote.amountSats, quote.serviceFeeSats, quote.claimFeeSats, quote.invoiceSats, totals.received, totals.lost];
      fields.forEach((id, index) => { document.getElementById(id).textContent = `${values[index].toLocaleString('en-US')} sats`; });
      message(`Estimate valid until ${new Date(quote.expiresAt).toLocaleTimeString()}. No funds move.`);
      expiry = setTimeout(() => { clear(); message('Estimate expired. Calculate a fresh quote.'); }, quote.expiresAt - Date.now());
    } catch (error) {
      if (current === revision) { clear(); message(error.name === 'AbortError' ? 'Quote request timed out. Please try again.' : error.message, true); }
    } finally {
      clearTimeout(timeout);
      if (current === revision) { button.disabled = false; form.setAttribute('aria-busy', 'false'); }
    }
  });
}

if (typeof document !== 'undefined') mount(document);
