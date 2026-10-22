// TV schedules (#/tv).
// tv.json is built by tools/fetch-tv.py (Agent Tom locally; the "Refresh feeds" GitHub
// Action for the hosted site, on the news-data branch). The app uses whichever copy is
// newer, and falls back to ESPN's scoreboard for today and tomorrow if neither loads.

const TV_REMOTE = 'https://raw.githubusercontent.com/expensivestrike50/tdsports/news-data/tv.json';
let tvFeed = null; // { updated, region, days, matches }

async function loadTv() {
  const grab = url => fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const copies = (await Promise.all([grab(`tv.json?t=${Date.now()}`), grab(TV_REMOTE)])).filter(d => d && Array.isArray(d.matches));
  if (copies.length) { tvFeed = copies.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0]; return; }
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
}

const tvDayOf = m => isoDay(new Date(m.start)); // in the viewer's time zone
const tvTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

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
        <div class="news-chips" role="group" aria-label="Filter by competition">
          ${chip('tv-league', '', 'All competitions', !state.tvLeague)}${leaguesToday.map(([l, n]) => chip('tv-league', l, `${l} · ${n}`, state.tvLeague === l, leagueLogo(l))).join('')}
        </div>
        <div class="news-chips" role="group" aria-label="Filter by channel">
          ${chip('tv-channel', '', 'All channels', !state.tvChannel)}${channelsToday.map(([c]) => chip('tv-channel', c, c, state.tvChannel === c)).join('')}
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

window.addEventListener('DOMContentLoaded', () => loadTv().then(() => { const r = route(); if (r && r.view === 'tv') render(); }));
setInterval(async () => {
  if (document.hidden) return;
  await loadTv();
  const r = route();
  if (r && r.view === 'tv') render();
}, 300000);
