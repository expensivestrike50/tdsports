// TV schedules (#/tv) and About (#/about).
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

function renderAbout() {
  document.title = 'About | TDsports';
  const people = Object.keys(PEOPLE).length;
  const withPhoto = Object.values(PEOPLE).filter(p => p.photo).length;
  const features = [
    ['⚽', 'Live scores', 'Every match in play across the top competitions, refreshed every 30 seconds.', '#/'],
    ['📊', 'Match analytics', 'Momentum, xG race, shot maps, passing networks and style of play for every match.', `#/match/${MATCHES[0].id}/stats`],
    ['👥', 'Lineups and players', 'Formations, ratings and per-player stats, with photos for almost every player.', `#/match/${MATCHES[0].id}/lineup`],
    ['📰', 'News', 'Headlines from the biggest football publishers in one place, filtered by club.', '#/news'],
    ['📺', 'TV schedules', "This week's fixtures and the channels showing them.", '#/tv'],
    ['🔌', 'Open API', 'All of it as free JSON: no key, no sign-up.', '#/api'],
  ];
  app.innerHTML = `
    <div class="about">
      <section class="about-hero">
        <p class="about-kicker">About TDsports</p>
        <h1 class="about-title">Football, in detail.</h1>
        <p class="about-lead">TDsports brings live scores, deep match analysis, lineups, player stats, news and TV listings together in one fast, clean place, for fans who want to understand the game, not just follow the score.</p>
      </section>
      <section class="about-stats">
        <div><b>${LEAGUES.length}</b><span>competitions</span></div>
        <div><b>${MATCHES.length}</b><span>matches analysed</span></div>
        <div><b>${people.toLocaleString()}</b><span>players and coaches</span></div>
        <div><b>${(newsFeed ? newsFeed.sources.length : 11)}</b><span>news sources</span></div>
      </section>
      <section>
        <h2 class="about-h2">What you'll find</h2>
        <div class="about-grid">${features.map(([icon, title, text, href]) => `
          <a class="about-card" href="${href}"><span class="about-icon">${icon}</span><b>${title}</b><span>${text}</span></a>`).join('')}</div>
      </section>
      <section class="about-split">
        <div>
          <h2 class="about-h2">Where the data comes from</h2>
          <ul class="about-list">
            <li><b>Scores, lineups and events</b> ESPN's public data and UEFA match reports; every researched match lists its sources.</li>
            <li><b>Team form and league tables</b> ESPN.</li>
            <li><b>News</b> BBC Sport, The Guardian, Sky Sports, The Athletic, ESPN and other publishers. Every story links to the original article.</li>
            <li><b>TV listings</b> ESPN's US broadcast listings.</li>
            <li><b>Photos</b> FotMob headshots for ${withPhoto.toLocaleString()} players and coaches, and Wikimedia Commons for stadiums. See <button class="link" data-action="credits">Image credits</button>.</li>
          </ul>
        </div>
        <div>
          <h2 class="about-h2">How it stays up to date</h2>
          <ul class="about-list">
            <li><b>Every 30 seconds</b> live scores refresh.</li>
            <li><b>Every 10 minutes</b> news, TV listings and recent results refresh.</li>
            <li><b>After every round</b> research agents gather lineups, goals, cards and substitutions for the matches.</li>
          </ul>
          <h2 class="about-h2">Honest about the numbers</h2>
          <p class="about-p">Scores, lineups, goals, cards, substitutions, team stats and form are real. Player ratings and some detailed per-player stats are estimates, and each match page labels what's real and what's estimated.</p>
        </div>
      </section>
      <section class="about-contact">
        <div><h2 class="about-h2">Get in touch</h2><p class="about-p">Found a wrong score or a missing player? Have an idea? We'd like to hear it.</p></div>
        <div class="about-actions">
          <a class="about-btn primary" href="https://github.com/expensivestrike50/tdsports/issues" target="_blank" rel="noopener">Report an issue ↗</a>
          <a class="about-btn" href="#/api">Use the API</a>
        </div>
      </section>
    </div>`;
}

window.addEventListener('DOMContentLoaded', () => loadTv().then(() => { const r = route(); if (r && r.view === 'tv') render(); }));
setInterval(async () => {
  if (document.hidden) return;
  await loadTv();
  const r = route();
  if (r && r.view === 'tv') render();
}, 300000);
