// Player market values: the current value (Transfermarkt), the predicted value for each of
// the next five years and a transfer value range, from market-values.js (built by
// tools/build-market-values.py and loaded after the page has drawn, as it is large).

// The same slug as the build script: accents dropped, other non-ASCII letters removed.
const nameSlug = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function marketOf(personId) {
  if (typeof MARKET_VALUES === 'undefined') return null;
  const p = PEOPLE[personId];
  return (p && MARKET_VALUES[nameSlug(p.name)]) || null;
}

const euro = v => (v >= 1e6 ? `€${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}m` : v >= 1e3 ? `€${Math.round(v / 1e3)}k` : '€0');
const ageOn = (dob, when = new Date()) => Math.floor((when - new Date(dob)) / 31557600000);

// The market value block on a player's card.
function marketSection(personId) {
  if (typeof MARKET_VALUES === 'undefined') return `<div class="mv"><p class="muted mv-none">Loading market value…</p></div>`;
  const m = marketOf(personId);
  if (!m) return `<div class="mv"><p class="muted mv-none">No market value on record for this player.</p></div>`;
  const year = new Date().getFullYear();
  const pts = [m.v, ...m.p], lo = [m.v, ...m.lo], hi = [m.v, ...m.hi];
  const W = 520, H = 170, pad = { l: 8, r: 8, t: 26, b: 26 };
  const max = Math.max(...hi) * 1.08 || 1;
  const x = i => pad.l + (i * (W - pad.l - pad.r)) / 5;
  const y = v => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const band = [...hi.map((v, i) => `${x(i)},${y(v)}`), ...lo.map((v, i) => `${x(i)},${y(v)}`).reverse()].join(' ');
  const line = pts.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const change = m.p[4] / m.v - 1;
  return `
    <div class="mv">
      <div class="mv-tiles">
        <div><span class="muted">Market value</span><b>${euro(m.v)}</b><small class="muted">Transfermarkt · ${new Date(m.at).toLocaleDateString('en', { month: 'short', year: 'numeric' })}</small></div>
        <div><span class="muted"><span class="pred-tag">Prediction</span>Transfer value</span><b>${euro(m.tv[1])}</b><small class="muted">likely ${euro(m.tv[0])} – ${euro(m.tv[2])}</small></div>
        <div><span class="muted">Age · contract</span><b>${ageOn(m.dob)}</b><small class="muted">${m.until ? `until ${new Date(m.until).toLocaleDateString('en', { month: 'short', year: 'numeric' })}` : 'contract unknown'}</small></div>
        <div><span class="muted">Career peak</span><b>${euro(m.peak)}</b><small class="muted">${esc(m.club || '')}</small></div>
      </div>
      <h3 class="modal-h"><span class="pred-tag">Prediction</span>Market value, next 5 years <span class="muted">${change >= 0 ? '+' : ''}${Math.round(change * 100)}% by ${year + 5}</span></h3>
      <svg class="mv-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Predicted market value for the next five years">
        <polygon points="${band}" class="mv-band"/>
        <polyline points="${line}" class="mv-line"/>
        ${pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i ? 4 : 5}" class="${i ? 'mv-dot' : 'mv-now'}"/>
          <text x="${x(i)}" y="${y(v) - 10}" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}" class="mv-val">${euro(v)}</text>
          <text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}" class="mv-yr">${i ? year + i : 'Now'}</text>`).join('')}
      </svg>
      <p class="muted mv-note">Market value from Transfermarkt. Predictions come from TDsports models trained on ${(MARKET_MODEL.horizons[1].samples / 1000).toFixed(0)}k real valuation changes (age, position, value level, recent trend) and ${MARKET_MODEL.transferFees.toLocaleString()} real transfer fees, adjusted for contract length; shaded = likely range. Over five years the model's error is ${Math.round((1 - MARKET_MODEL.horizons[5].mae_model / MARKET_MODEL.horizons[5].mae_no_change) * 100)}% lower than assuming no change.</p>
    </div>`;
}

// Columns for the player statistics table's "Value" view.
const MARKET_COLUMNS = {
  marketValue: m => m.v, transferValue: m => m.tv[1], value1y: m => m.p[0], value3y: m => m.p[2], value5y: m => m.p[4], age: m => ageOn(m.dob),
};
const marketCell = (personId, key) => { const m = marketOf(personId); return m ? MARKET_COLUMNS[key](m) : 0; };
