// TV schedules (#/tv).
// tv.json is built by tools/fetch-tv.py (Agent Tom locally; the "Refresh feeds" GitHub
// Action for the hosted site, on the news-data branch). The app uses whichever copy is
// newer, and falls back to ESPN's scoreboard for today and tomorrow if neither loads.

const TV_REMOTE = 'https://raw.githubusercontent.com/expensivestrike50/tdsports/news-data/tv.json';
let tvFeed = null; // { updated, region, days, matches }

async function loadTv() {
  const grab = url => fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const copies = (await Promise.all([grab(`tv.json?t=${Date.now()}`), grab(TV_REMOTE)])).filter(d => d && Array.isArray(d.matches));
  if (copies.length) { tvFeed = copies.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0]; settleTv(); return; }
  const days = [0, 1].map(d => isoDay(new Date(Date.now() + d * 864e5)));
  const lists = await Promise.all(LIVE_LEAGUES.flatMap(([code, league]) => days.map(async day => {
    try {
      const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${day.replace(/-/g, '')}`)).json();
      return (d.events || []).map(ev => {
        const comp = (ev.competitions || [{}])[0];
        const side = h => { const c = (comp.competitors || []).find(x => x.homeAway === h) || {}; return { name: c.team && (c.team.shortDisplayName || c.team.displayName), logo: c.team && c.team.logo, score: c.score }; };
        const channels = [...new Set((comp.broadcasts || []).flatMap(b => b.names || []))];
        return { id: ev.id, league, code, start: ev.date, state: ev.status.type.state, detail: ev.status.type.shortDetail, venue: (comp.venue || {}).fullName, channels, home: side('home'), away: side('away') };
      });
    } catch { return []; }
  })));
  const matches = lists.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (matches.length) tvFeed = { updated: new Date().toISOString(), region: 'US', days, matches };
  settleTv();
}

// tv.json is a snapshot up to half an hour old (more when GitHub delays the Action), so a
// match it caught in play would stay "live". Each listing takes its state and score from the
// live scoreboard or the results when they have the match, and one still in play three
// hours after kickoff counts as finished. Returns whether anything changed.
function settleTv() {
  if (!tvFeed) return false;
  const fresh = {};
  for (const f of [typeof resultsFeed !== 'undefined' && resultsFeed, typeof liveFeed !== 'undefined' && liveFeed]) {
    for (const l of (f && f.leagues) || []) for (const e of l.events) fresh[e.id] = e;
  }
  let changed = false;
  for (const m of tvFeed.matches) {
    const e = fresh[m.id];
    const next = e ? { state: e.state, detail: e.detail, home: { ...m.home, score: e.home.score }, away: { ...m.away, score: e.away.score } }
      : m.state === 'in' && Date.now() - Date.parse(m.start) > 3 * 36e5 ? { state: 'post', detail: 'FT' } : null;
    if (next && (next.state !== m.state || next.detail !== m.detail || (e && (e.home.score !== m.home.score || e.away.score !== m.away.score)))) {
      Object.assign(m, next);
      changed = true;
    }
  }
  return changed;
}

const tvDayOf = m => isoDay(new Date(m.start)); // in the viewer's time zone
const tvTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// Fixtures for the home page's day view: the selected league's matches on that day from
// the TV listings that the app doesn't already have its own page for.
function dayFixtures() {
  if (!tvFeed || state.live || state.favsOnly) return [];
  const date = dayDate(state.day);
  const q = state.query.trim().toLowerCase();
  return tvFeed.matches.filter(m => m.league === state.league && tvDayOf(m) === date
    && !/^#\/match\/(?!espn-)/.test(feedHref(m.code, m) || '')
    && (!state.tv || m.channels.length) && (!q || `${m.home.name} ${m.away.name}`.toLowerCase().includes(q)));
}

function fixtureRow(m) {
  const status = m.state === 'pre' ? tvTime(m.start) : m.state === 'in' ? m.detail || 'Live' : 'FT';
  return `
    <div class="match-row feed-row">
      <a href="${feedHref(m.code, m) || '#'}" class="match">
        <span class="status ${m.state === 'in' ? 'live' : m.state === 'pre' ? 'pre' : ''}">${esc(status)}</span>
        <span class="team home">${esc(m.home.name)}</span>${feedCrest(m.home)}
        <span class="score">${m.state === 'pre' ? '<span class="muted">vs</span>' : `${esc(m.home.score)} - ${esc(m.away.score)}`}</span>
        ${feedCrest(m.away)}<span class="team away">${esc(m.away.name)}</span>
        ${m.state === 'in' ? '<span class="live-tag"><span class="live-pulse"></span>Live</span>' : `<span class="tv-tag" title="${esc(m.channels.join(', '))}">${m.channels.length ? `📺 ${esc(m.channels[0])}` : ''}</span>`}
      </a>
    </div>`;
}

function renderTv() {
  document.title = 'TV schedules | TDsports';
  if (!tvFeed) {
    app.innerHTML = `<div class="news-page"><div class="card news-empty"><p class="muted">Loading this week's TV listings…</p></div></div>`;
    loadTv().then(() => { if (route().view === 'tv') render(); });
    return;
  }
  const today = isoDay(new Date());
  const days = [...new Set([today, ...tvFeed.matches.map(tvDayOf)])].filter(d => d >= today).sort().slice(0, 7);
  const day = days.includes(state.tvDay) ? state.tvDay : today;
  const onDay = tvFeed.matches.filter(m => tvDayOf(m) === day);
  const list = onDay.filter(m => (!state.tvLeague || m.league === state.tvLeague) && (!state.tvChannel || m.channels.includes(state.tvChannel)));
  const count = (arr, key) => { const c = {}; arr.forEach(m => [].concat(key(m)).forEach(k => { c[k] = (c[k] || 0) + 1; })); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const channelsToday = count(onDay, m => m.channels);
  const leaguesToday = count(onDay, m => m.league);
  const week = tvFeed.matches.filter(m => tvDayOf(m) >= today);
  const label = d => {
    const dt = new Date(d + 'T12:00');
    return d === today ? 'Today' : d === isoDay(new Date(Date.now() + 864e5)) ? 'Tomorrow' : dt.toLocaleDateString('en', { weekday: 'short' });
  };
  // Kickoff slots: matches starting at the same time sit together.
  const slots = [];
  list.forEach(m => { const t = tvTime(m.start); let s = slots.find(x => x.t === t); if (!s) slots.push(s = { t, matches: [] }); s.matches.push(m); });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const chip = (action, value, text, active, extra = '') => `<button class="pill ${active ? 'selected' : ''}" data-action="${action}" data-value="${esc(value)}" aria-pressed="${active}">${extra}${esc(text)}</button>`;
  const leagueLogo = name => { const l = LEAGUES.find(x => x.name === name); return l ? `<img class="league-logo" src="${l.logo}" alt="">` : ''; };
  const status = m => (m.state === 'in' ? `<span class="tv-live"><span class="live-pulse"></span>${esc(m.detail || 'Live')}</span>`
    : m.state === 'post' ? `<span class="tv-ft">FT</span>` : '');
  const score = m => (m.state === 'pre' ? '<span class="tv-vs">vs</span>' : `<b class="tv-score">${esc(m.home.score)} - ${esc(m.away.score)}</b>`);

  app.innerHTML = `
    <div class="news-page tvp">
      <div class="card news-head">
        <div class="news-title-row">
          <div>
            <h1 class="news-page-title">TV schedules</h1>
            <p class="muted">Where to watch football this week · ${week.length} matches · US TV listings from ESPN · times in your time zone (${esc(zone)})</p>
          </div>
        </div>
        <div class="tv-days" role="tablist" aria-label="Day">
          ${days.map(d => `<button role="tab" class="tv-day ${d === day ? 'on' : ''}" aria-selected="${d === day}" data-action="tv-day" data-value="${d}">
            <b>${label(d)}</b><span>${new Date(d + 'T12:00').toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span><small>${(n => `${n} ${n === 1 ? 'match' : 'matches'}`)(tvFeed.matches.filter(m => tvDayOf(m) === d).length)}</small></button>`).join('')}
        </div>
        <div class="news-chips tv-filters">
          <span class="tv-filter-label">Competition</span>
          <span class="tv-filter-group" role="group" aria-label="Filter by competition">${chip('tv-league', '', 'All', !state.tvLeague)}${leaguesToday.map(([l, n]) => chip('tv-league', l, `${l} · ${n}`, state.tvLeague === l, leagueLogo(l))).join('')}</span>
          <span class="tv-filter-sep" aria-hidden="true"></span>
          <span class="tv-filter-label">Channel</span>
          <span class="tv-filter-group" role="group" aria-label="Filter by channel">${chip('tv-channel', '', 'All', !state.tvChannel)}${channelsToday.map(([c]) => chip('tv-channel', c, c, state.tvChannel === c)).join('')}</span>
        </div>
      </div>
      <div class="news-layout">
        <section aria-label="Schedule">
          ${slots.length ? slots.map(s => `
            <div class="card tv-slot">
              <div class="tv-time">${s.t}</div>
              <div class="tv-rows">${s.matches.map(m => {
                const href = feedHref(m.code, m);
                return `
                <a class="tv-row" href="${href || '#'}">
                  <span class="tv-comp">${leagueLogo(m.league)}<span>${esc(m.league)}</span></span>
                  <span class="tv-match"><span class="tv-team home">${esc(m.home.name)}${feedCrest(m.home)}</span>${score(m)}<span class="tv-team">${feedCrest(m.away)}${esc(m.away.name)}</span></span>
                  <span class="tv-ch">${status(m)}${m.channels.length ? m.channels.map(c => `<span class="tv-chan">📺 ${esc(c)}</span>`).join('') : '<span class="muted small">No US TV listed</span>'}</span>
                </a>`;
              }).join('')}</div>
            </div>`).join('') : `<div class="card news-empty"><p>No matches${state.tvLeague || state.tvChannel ? ' match these filters' : ' on this day'}.</p>${state.tvLeague || state.tvChannel ? '<button class="pill" data-action="tv-reset">Show all</button>' : ''}</div>`}
        </section>
        <aside class="news-aside">
          <div class="card">
            <h2 class="card-title">Channels ${day === today ? 'today' : 'this day'}</h2>
            ${channelsToday.map(([c, n]) => `<button class="news-trend tv-trend" data-action="tv-channel" data-value="${esc(c)}"><b>📺 ${esc(c)}</b><span class="muted">${n} ${n === 1 ? 'match' : 'matches'}</span></button>`).join('') || '<p class="muted news-note">No listings yet.</p>'}
          </div>
          <div class="card">
            <h2 class="card-title">Where to watch</h2>
            ${count(week, m => m.league).map(([l]) => {
              const top = count(week.filter(m => m.league === l), m => m.channels).slice(0, 3).map(([c]) => c);
              return `<div class="news-trend tv-where">${leagueLogo(l)}<b>${esc(l)}</b><span class="muted">${top.length ? esc(top.join(', ')) : '—'}</span></div>`;
            }).join('')}
            <p class="muted news-note">US broadcasters this week, from ESPN's listings. Coverage differs by country; check your local listings.</p>
          </div>
        </aside>
      </div>
    </div>`;
}

window.addEventListener('DOMContentLoaded', () => loadTv().then(() => {
  const r = route();
  // The home day view lists fixtures from it, and match previews show the TV channels.
  if (r && (r.view === 'tv' || r.view === 'home' || (r.view === 'match' && /^espn-/.test(r.id)))) render();
}));
setInterval(async () => {
  if (document.hidden) return;
  await loadTv();
  const r = route();
  if (r && r.view === 'tv') render();
}, 300000);
