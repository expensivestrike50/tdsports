// News page (#/news): football news aggregated from the top sources.
// news.json is built by tools/fetch-news.py (Agent Tom every 10 minutes locally; a GitHub
// Action every 30 minutes for the hosted site, on the news-data branch). The app uses
// whichever copy is newer. If neither loads, it falls back to ESPN's news API directly.
// Stories link out to the publisher; only the headline, the feed's summary and a
// thumbnail are shown here.

const NEWS_REMOTE = 'https://raw.githubusercontent.com/expensivestrike50/tdsports/news-data/news.json';
const NEWS_PAGE = 30;
let newsFeed = null; // { updated, sources, articles }
let newsShown = NEWS_PAGE;

async function loadNews() {
  const grab = url => fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const copies = (await Promise.all([grab(`news.json?t=${Date.now()}`), grab(NEWS_REMOTE)]))
    .filter(d => d && Array.isArray(d.articles) && d.articles.length);
  if (copies.length) {
    newsFeed = copies.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0];
    return;
  }
  // Fallback: ESPN's news for each league, straight from the browser.
  const lists = await Promise.all(LIVE_LEAGUES.map(async ([code, league]) => {
    try {
      const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/news?limit=25`)).json();
      return (d.articles || []).filter(a => a.links && a.links.web).map(a => ({
        id: String(a.id), title: a.headline, summary: a.description || '', url: a.links.web.href, source: 'ESPN',
        image: ((a.images || [])[0] || {}).url || '', published: a.published, clubs: [], leagues: [league],
      }));
    } catch { return []; }
  }));
  const seen = new Set();
  const articles = lists.flat().filter(a => !seen.has(a.url) && seen.add(a.url)).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  if (articles.length) newsFeed = { updated: new Date().toISOString(), sources: [{ name: 'ESPN', url: 'https://www.espn.com/soccer/' }], articles };
}

const timeAgo = iso => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m || 1} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} d ago`;
};
const sourceIcon = source => {
  const s = newsFeed && newsFeed.sources.find(x => x.name === source);
  const host = s ? new URL(s.url).hostname : '';
  return host ? `<img class="news-src-icon" src="https://www.google.com/s2/favicons?domain=${host}&sz=32" alt="" loading="lazy">` : '';
};

function filteredNews() {
  if (!newsFeed) return [];
  const q = (state.newsQuery || '').trim().toLowerCase();
  return newsFeed.articles.filter(a =>
    (!state.newsSource || a.source === state.newsSource) &&
    (!state.newsLeague || a.leagues.includes(state.newsLeague)) &&
    (!state.newsClub || a.clubs.includes(state.newsClub)) &&
    (!q || `${a.title} ${a.summary} ${a.clubs.join(' ')}`.toLowerCase().includes(q)));
}

const newsImage = (a, cls = '') => (a.image
  ? `<img class="news-img ${cls}" src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'news-img news-img-empty ${cls}',textContent:'${esc(a.source).replace(/'/g, '')}'}))">`
  : `<span class="news-img news-img-empty ${cls}">${esc(a.source)}</span>`);

const newsMeta = a => `<span class="news-meta">${sourceIcon(a.source)}<b>${esc(a.source)}</b> · ${timeAgo(a.published)}</span>`;
const newsTags = a => (a.clubs.length ? `<span class="news-tags">${a.clubs.slice(0, 3).map(c => `<button class="news-tag" data-action="news-club" data-club="${esc(c)}">${crest(c)}${esc(c)}</button>`).join('')}</span>` : '');

function newsCard(a) {
  return `
    <article class="news-card">
      <a href="${esc(a.url)}" target="_blank" rel="noopener" class="news-link">
        ${newsImage(a)}
        <span class="news-body">
          ${newsMeta(a)}
          <h3 class="news-h">${esc(a.title)}</h3>
          ${a.summary ? `<p class="news-sum">${esc(a.summary)}</p>` : ''}
        </span>
      </a>
      ${newsTags(a)}
    </article>`;
}

function renderNews() {
  document.title = 'Football news | TDsports';
  if (!newsFeed) {
    app.innerHTML = `<div class="news-page"><div class="card news-empty"><p class="muted">Loading the latest football news…</p></div></div>`;
    loadNews().then(() => { if (route().view === 'news') render(); });
    return;
  }
  const list = filteredNews();
  const filtered = state.newsSource || state.newsLeague || state.newsClub || state.newsQuery;
  const [lead, ...rest] = list;
  const side = filtered ? [] : rest.slice(0, 6);
  const grid = (filtered ? rest : rest.slice(6)).slice(0, newsShown);
  const sources = newsFeed.sources.map(s => ({ ...s, n: newsFeed.articles.filter(a => a.source === s.name).length })).filter(s => s.n);
  const clubCount = {};
  newsFeed.articles.forEach(a => a.clubs.forEach(c => { clubCount[c] = (clubCount[c] || 0) + 1; }));
  const trending = Object.entries(clubCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const leagues = LEAGUES.filter(l => newsFeed.articles.some(a => a.leagues.includes(l.name)));
  const chip = (action, value, label, active, extra = '') => `<button class="pill ${active ? 'selected' : ''}" data-action="${action}" data-value="${esc(value)}" aria-pressed="${active}">${extra}${esc(label)}</button>`;

  app.innerHTML = `
    <div class="news-page">
      <div class="card news-head">
        <div class="news-title-row">
          <div>
            <h1 class="news-page-title">Football news</h1>
            <p class="muted">${newsFeed.articles.length} stories from ${sources.length} sources · updated ${timeAgo(newsFeed.updated)}</p>
          </div>
          <input class="filter news-search" id="news-search" type="search" placeholder="Search news" aria-label="Search news" value="${esc(state.newsQuery || '')}">
        </div>
        <div class="news-chips" role="group" aria-label="Filter by competition">
          ${chip('news-league', '', 'All competitions', !state.newsLeague)}
          ${leagues.map(l => chip('news-league', l.name, l.name, state.newsLeague === l.name, `<img class="league-logo" src="${l.logo}" alt="">`)).join('')}
        </div>
        <div class="news-chips" role="group" aria-label="Filter by source">
          ${chip('news-source', '', 'All sources', !state.newsSource)}
          ${sources.map(s => chip('news-source', s.name, s.name, state.newsSource === s.name, sourceIcon(s.name))).join('')}
        </div>
        ${state.newsClub ? `<div class="news-chips"><button class="pill selected" data-action="news-club" data-club="">${crest(state.newsClub)} ${esc(state.newsClub)} ✕</button></div>` : ''}
      </div>
      <div class="news-layout">
        <section aria-label="Stories">
          ${!lead ? `<div class="card news-empty"><p>No stories match these filters.</p><button class="pill" data-action="news-reset">Show all news</button></div>` : `
          <div class="news-top ${side.length ? '' : 'solo'}">
            <article class="card news-lead-card">
              <a href="${esc(lead.url)}" target="_blank" rel="noopener" class="news-link">
                ${newsImage(lead, 'lead')}
                <span class="news-body">
                  ${newsMeta(lead)}
                  <h2 class="news-lead-h">${esc(lead.title)}</h2>
                  ${lead.summary ? `<p class="news-sum">${esc(lead.summary)}</p>` : ''}
                </span>
              </a>
              ${newsTags(lead)}
            </article>
            ${side.length ? `<div class="card news-side-list">${side.map(a => `
              <a class="news-mini" href="${esc(a.url)}" target="_blank" rel="noopener">
                ${newsImage(a, 'mini')}
                <span>${newsMeta(a)}<b>${esc(a.title)}</b></span>
              </a>`).join('')}</div>` : ''}
          </div>
          <div class="news-grid">${grid.map(newsCard).join('')}</div>
          ${grid.length < (filtered ? rest.length : rest.length - 6) ? `<button class="pill news-more" data-action="news-more">Load more stories</button>` : ''}`}
        </section>
        <aside class="news-aside">
          <div class="card">
            <h2 class="card-title">Trending clubs</h2>
            ${trending.map(([c, n], i) => `<button class="news-trend" data-action="news-club" data-club="${esc(c)}"><span class="muted">${i + 1}</span>${crest(c)}<b>${esc(c)}</b><span class="muted">${n}</span></button>`).join('')}
          </div>
          <div class="card">
            <h2 class="card-title">Sources</h2>
            ${sources.map(s => `<a class="news-trend" href="${esc(s.url)}" target="_blank" rel="noopener">${sourceIcon(s.name)}<b>${esc(s.name)}</b><span class="muted">${s.n}</span></a>`).join('')}
            <p class="muted news-note">Headlines and summaries link to the publisher's own article.</p>
          </div>
        </aside>
      </div>
    </div>`;
}

// The home page's News card: the latest real headlines when the feed has loaded.
function homeNewsItems() {
  if (!newsFeed) return null;
  const [lead, ...rest] = newsFeed.articles.filter(a => a.image);
  return `
    <a class="news-lead" href="${esc(lead.url)}" target="_blank" rel="noopener">
      <img src="${esc(lead.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span class="news-title">${esc(lead.title)}</span>
      <span class="muted">${esc(lead.source)} · ${timeAgo(lead.published)}</span>
    </a>
    ${rest.slice(0, 4).map(a => `
      <a class="news-item" href="${esc(a.url)}" target="_blank" rel="noopener">
        <img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span><b>${esc(a.title)}</b><span class="muted">${esc(a.source)} · ${timeAgo(a.published)}</span></span>
      </a>`).join('')}
    <a class="side-more" href="#/news">All football news ❯</a>`;
}

// Load once the app has started (for the home card) and refresh every 10 minutes.
window.addEventListener('DOMContentLoaded', () => loadNews().then(() => {
  const r = route();
  if (r && r.view === 'news') render();
  const box = document.querySelector('#news .news-items');
  if (box && newsFeed) { box.innerHTML = homeNewsItems(); fitSidebars(); }
}));
setInterval(async () => {
  if (document.hidden) return;
  await loadNews();
  const r = route();
  if (r && r.view === 'news' && !document.activeElement.matches('#news-search')) render();
}, 600000);
