'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const state = {
  league: COMPETITION.league,
  day: 0,
  live: false,
  tv: false,
  favsOnly: false,
  sort: 'time',
  query: '',
  favs: migrateFavs(store.get('tdsports-favs', store.get('popouts-favs', store.get('atlas-favs', [])))),
  votes: store.get('tdsports-votes', store.get('popouts-votes', store.get('atlas-votes', {}))),
  compare: {},
  styleTab: 'This match',
  styleRowsExpanded: false,
  heatScope: 'last10',
  styleTeam: 'home',
  table: { view: 'Summary', sort: 'rating', dir: -1, team: 'all', pos: 'all', per90: false },
};

// View choices that should survive a page reload (tabs, team, day, league), kept for the
// browser session only.
const SESSION_KEYS = ['league', 'day', 'styleTab', 'styleTeam', 'heatScope', 'shapePhase', 'apiLang', 'newsLeague', 'newsSource'];
try { Object.assign(state, JSON.parse(sessionStorage.getItem('tdsports-view')) || {}); } catch { /* storage unavailable */ }
function saveView() {
  try { sessionStorage.setItem('tdsports-view', JSON.stringify(Object.fromEntries(SESSION_KEYS.map(k => [k, state[k]])))); } catch { /* storage unavailable */ }
}

// Earlier versions stored favorites as match indexes.
function migrateFavs(favs) {
  return favs.map(f => (typeof f === 'number' ? MATCHES[f] && MATCHES[f].id : f)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);
const app = $('#app');

function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Deterministic pseudo-random numbers so generated sample data is stable per match.
function rng(seed) {
  let h = 1779033703;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const randInt = (r, min, max) => min + Math.floor(r() * (max - min + 1));
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const fmt = n => n.toLocaleString('en');
const findMatch = id => MATCHES.find(m => m.id === id) || PREDICTED[id]; // PREDICTED: upcoming-fixture predictions (espn-match.js)

function crest(team, size = 'sm') {
  const src = CLUB_LOGOS[team];
  return src
    ? `<img class="crest crest-${size}" src="${src}" alt="" loading="lazy">`
    : `<span class="crest crest-${size} crest-fallback" aria-hidden="true">${esc(initials(team))}</span>`;
}

function avatar(id, size = 'md') {
  const p = PEOPLE[id];
  if (!p.photo) return `<span class="avatar avatar-${size} avatar-fallback" aria-hidden="true">${esc(initials(p.name))}</span>`;
  // If the photo is missing, swap in the initials fallback.
  return `<img class="avatar avatar-${size}" src="${/^https?:/.test(p.photo) ? esc(p.photo) : `assets/photos/people/${p.photo}.jpg`}" alt="" loading="lazy" data-initials="${esc(initials(p.name))}" onerror="avatarFallback(this)">`;
}

function avatarFallback(img) {
  const span = document.createElement('span');
  span.className = img.className + ' avatar-fallback';
  span.textContent = img.dataset.initials;
  img.replaceWith(span);
}

function ratingClass(r) {
  return r >= 8 ? 'r-top' : r >= 7 ? 'r-good' : r >= 6 ? 'r-ok' : 'r-low';
}

function dayLabel(day) {
  if (day === 0) return 'Today';
  if (day === 1) return 'Tomorrow';
  if (day === -1) return 'Yesterday';
  const d = new Date(BASE_DATE);
  d.setDate(d.getDate() + day);
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

const icon = {
  goal: '<span class="ev-icon" aria-label="Goal">⚽</span>',
  owngoal: '<span class="ev-icon og" aria-label="Own goal">⚽</span>',
  yellow: '<span class="card-icon yellow" aria-label="Yellow card"></span>',
  red: '<span class="card-icon red" aria-label="Red card"></span>',
  var: '<span class="ev-icon var" aria-label="VAR">VAR</span>',
  sub: '<span class="ev-icon ev-sub" aria-label="Substitution">⇄</span>',
};

// ---------------------------------------------------------------------------
// Match details: hand-written for matches in LINEUPS, generated for the rest
// ---------------------------------------------------------------------------

const detailCache = {};

function details(match) {
  if (detailCache[match.id]) return detailCache[match.id];
  const r = rng(match.id);
  const lineup = LINEUPS[match.id];
  const [hg, ag] = match.score;
  let events, stats;

  if (lineup) {
    events = lineup.events.map(([min, type, side, who, detail, extra]) => ({ min, type, side, who, detail, extra }));
  } else {
    const minutes = new Set();
    while (minutes.size < hg + ag) minutes.add(randInt(r, 1, 90));
    const sides = [...Array(hg).fill('home'), ...Array(ag).fill('away')].sort(() => r() - 0.5);
    let h = 0, a = 0;
    events = [...minutes].sort((x, y) => x - y).map((min, i) => {
      sides[i] === 'home' ? h++ : a++;
      return { min, type: 'goal', side: sides[i], detail: `${h} - ${a}` };
    });
    for (let i = randInt(r, 1, 4); i > 0; i--) {
      events.push({ min: randInt(r, 10, 88), type: 'yellow', side: r() < 0.5 ? 'home' : 'away', detail: 'Foul' });
    }
    events.sort((x, y) => x.min - y.min);
  }

  // Modelled stats; for matches with researched data, real values replace them where known.
  // (A separate random stream keeps the rest of a researched match's sample data stable.)
  const rs = lineup ? rng('stats-' + match.id) : r;
  const xgM = [hg, ag].map(g => +(g * 0.55 + rs() * 1.3 + 0.2).toFixed(2));
  const shotsM = xgM.map(x => Math.round(x * 5 + 5 + rs() * 5));
  const possM = Math.max(32, Math.min(68, Math.round(50 + (xgM[0] - xgM[1]) * 6 + (rs() - 0.5) * 14)));
  const count = (type, s) => events.filter(e => e.type === type && e.side === s).length;
  stats = {
    possession: possM, xg: xgM, shots: shotsM,
    onTarget: shotsM.map((s, i) => Math.max(match.score[i], Math.round(s * (0.3 + rs() * 0.15)))),
    boxTouches: shotsM.map(s => Math.round(s * 1.6 + rs() * 8)),
    bigChances: xgM.map(x => Math.round(x * 1.4)),
    passes: [possM, 100 - possM].map(p => Math.round(p * 8.6 + rs() * 40)),
    corners: [randInt(rs, 2, 9), randInt(rs, 1, 8)],
    fouls: [randInt(rs, 7, 16), randInt(rs, 7, 16)],
    yellows: ['home', 'away'].map(s => count('yellow', s)),
  };
  if (lineup && lineup.stats) {
    for (const [k, v] of Object.entries(lineup.stats)) if (Array.isArray(v) && v.every(x => x != null)) stats[k] = v;
    if (typeof lineup.stats.possession === 'number') stats.possession = lineup.stats.possession;
    // Without researched pass counts, model them from the (real) possession share.
    if (!Array.isArray(lineup.stats.passes)) stats.passes = [stats.possession, 100 - stats.possession].map(p => Math.round(p * 8.6 + 20));
    // Without published xG, estimate it from the real shot profile: typical values of about
    // 0.06 per off-target shot, 0.16 per non-penalty shot on target and 0.76 per penalty.
    if (!(Array.isArray(lineup.stats.xg) && lineup.stats.xg.every(x => x != null))) {
      stats.xg = ['home', 'away'].map((s, i) => {
        const pens = events.filter(e => e.type === 'goal' && e.side === s && e.extra === 'pen').length;
        const onT = Math.max(0, stats.onTarget[i] - pens), off = Math.max(0, stats.shots[i] - stats.onTarget[i]);
        return +(off * 0.06 + onT * 0.16 + pens * 0.76).toFixed(2);
      });
    }
  }
  if (lineup) stats.yellows = ['home', 'away'].map(s => count('yellow', s));
  // Shots on target can't be fewer than goals scored from shots.
  stats.onTarget = stats.onTarget.map((v, i) => Math.max(v, events.filter(e => e.type === 'goal' && e.side === (i ? 'away' : 'home')).length));
  stats.shots = stats.shots.map((v, i) => Math.max(v, stats.onTarget[i]));

  // Momentum: one bar per two minutes, positive favours home, with spikes before goals.
  const momentum = Array.from({ length: 45 }, (_, i) => {
    let v = (r() - 0.5) * 0.9 + (stats.possession - 50) / 60;
    for (const e of events) {
      if ((e.type === 'goal' || e.type === 'owngoal') && Math.abs(e.min - i * 2) <= 4) v += e.side === 'home' ? 0.8 : -0.8;
    }
    return Math.max(-1, Math.min(1, v));
  });

  const venue = matchVenue(match, lineup);
  const modelledAttendance = venue && venue.capacity ? Math.round(venue.capacity * (0.82 + r() * 0.17)) : null;
  const attendance = lineup && lineup.attendance ? lineup.attendance : modelledAttendance;
  const referee = lineup && Array.isArray(lineup.referee) ? lineup.referee : REFEREES[lineup && typeof lineup.referee === 'number' ? lineup.referee : randInt(r, 0, REFEREES.length - 1)];
  const weather = { temp: randInt(r, 6, 17), sky: ['☁ Cloudy', '☀ Clear', '🌧 Light rain', '⛅ Partly cloudy'][randInt(r, 0, 3)] };
  const poll = (() => { const h = 30 + r() * 40, d = 15 + r() * 15; return [h, d, 100 - h - d].map(Math.round); })();

  const realStats = lineup && lineup.stats ? Object.keys(lineup.stats).filter(k => k === 'possession' ? typeof lineup.stats.possession === 'number' : Array.isArray(lineup.stats[k]) && lineup.stats[k].every(x => x != null)) : [];
  const attendanceEstimated = !(lineup && lineup.attendance);
  return (detailCache[match.id] = { lineup, events, stats, momentum, venue, attendance, attendanceEstimated, referee, weather, poll, realStats });
}

function personName(id) {
  return PEOPLE[id] ? PEOPLE[id].short : '';
}

function scorers(match, side) {
  const d = details(match);
  const goals = d.events.filter(e => (e.type === 'goal' || e.type === 'owngoal') && e.side === side);
  if (!d.lineup) return goals.map(e => `${e.min}′`).join(', ');
  const byPlayer = new Map();
  for (const e of goals) {
    const key = personName(e.who) + (e.type === 'owngoal' ? ' (OG)' : e.extra === 'pen' ? ' (P)' : '');
    byPlayer.set(key, [...(byPlayer.get(key) || []), `${e.min}′`]);
  }
  return [...byPlayer].map(([n, mins]) => `${esc(n)} ${mins.join(', ')}`).join('<br>');
}

// Minutes played and goals for a lineup member, derived from the events list.
function playerMatchStats(match, id) {
  const d = details(match);
  const L = d.lineup;
  const starter = [...L.home, ...L.away].some(p => p[0] === id);
  const subOn = d.events.find(e => e.type === 'sub' && e.who === id);
  const subOff = d.events.find(e => e.type === 'sub' && e.detail === id);
  let minutes = starter ? 90 : 0;
  if (subOn) minutes = 90 - subOn.min;
  if (subOff) minutes = subOff.min;
  const goals = d.events.filter(e => e.type === 'goal' && e.who === id).length;
  return { minutes, goals, subOn, subOff };
}

function lineupPeople(match) {
  const L = LINEUPS[match.id];
  if (!L) return [];
  const list = [];
  L.home.forEach(([id, x, y, rating]) => list.push({ id, side: 'home', x, y, rating }));
  L.away.forEach(([id, x, y, rating]) => list.push({ id, side: 'away', x, y, rating }));
  L.homeSubs.forEach(([id, rating]) => list.push({ id, side: 'home', rating, sub: true }));
  L.awaySubs.forEach(([id, rating]) => list.push({ id, side: 'away', rating, sub: true }));
  return list;
}

// ---------------------------------------------------------------------------
// Home view
// ---------------------------------------------------------------------------

// A match's date as YYYY-MM-DD; fixtures without a researched date fall on the base matchday.
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const matchDate = m => m.date || isoDay(BASE_DATE);
const leagueOf = m => m.league || COMPETITION.league; // fixtures in data.js are Champions League
function dayDate(day) {
  const d = new Date(BASE_DATE);
  d.setDate(d.getDate() + day);
  return isoDay(d);
}

// Matches in play in the selected league, from the live feed (the Live filter).
function liveEvents() {
  const feed = liveFeed && liveFeed.leagues.find(l => l.league === state.league);
  const q = state.query.trim().toLowerCase();
  return feed ? feed.events.filter(e => e.state === 'in' && (!q || `${e.home.name} ${e.away.name}`.toLowerCase().includes(q)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map(e => ({ e, code: feed.code })) : [];
}

function matchList(list) {
  if (state.live) {
    const live = liveEvents();
    return live.length ? live.map(({ e, code }) => feedRow(e, code)).join('')
      : `<div class="empty"><p>${liveFeed ? `No ${esc(state.league)} matches are live right now.` : 'Connecting to the live feed…'}</p><button class="pill" data-action="clear-filters">Show all matches</button></div>`;
  }
  const fixtures = dayFixtures();
  if (list.length || fixtures.length) return list.map(matchRow).join('') + fixtures.map(fixtureRow).join('');
  const [msg, btn, action] = emptyMessage();
  return `<div class="empty"><p>${esc(msg)}</p><button class="pill" data-action="${action}">${esc(btn)}</button></div>`;
}

// Keep the Live filter's list and count in step with the live feed.
function refreshLiveList() {
  const box = document.getElementById('matches');
  if (!box) return;
  box.innerHTML = matchList([]);
  const count = document.querySelector('.league-head .count');
  if (count) { const n = liveEvents().length; count.textContent = `${n} live`; }
}

function visibleMatches() {
  if (state.live) return [];
  const q = state.query.trim().toLowerCase();
  const date = dayDate(state.day);
  let list = MATCHES.filter(m =>
    leagueOf(m) === state.league && matchDate(m) === date &&
    (!state.tv || m.tv) &&
    (!state.favsOnly || state.favs.includes(m.id)) &&
    (!q || `${m.home} ${m.away}`.toLowerCase().includes(q)));
  if (state.sort === 'team') list = [...list].sort((a, b) => a.home.localeCompare(b.home));
  else list = [...list].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || MATCHES.indexOf(a) - MATCHES.indexOf(b));
  return list;
}

function emptyMessage() {
  if (!MATCHES.some(m => leagueOf(m) === state.league && matchDate(m) === dayDate(state.day))) {
    return [`No ${state.league} matches ${state.day === 0 ? 'today' : `on ${dayLabel(state.day)}`}. Earlier results are below.`, state.day === 0 ? 'Show Champions League' : 'Back to today', state.day === 0 ? 'league' : 'today'];
  }
  return ['No matches match your filters.', 'Clear filters', 'clear-filters'];
}

function matchRow(m) {
  const fav = state.favs.includes(m.id);
  return `
    <div class="match-row">
      <a class="match" href="#/match/${m.id}">
        <span class="status">FT</span>
        <span class="team home">${esc(m.home)}</span>${crest(m.home)}
        <span class="score">${m.score[0]} - ${m.score[1]}</span>
        ${crest(m.away)}<span class="team away">${esc(m.away)}</span>
        <span class="tv-tag">${m.tv ? `📺 ${esc(m.tv)}` : ''}</span>
      </a>
      <button class="star ${fav ? 'saved' : ''}" data-action="fav" data-id="${m.id}" aria-pressed="${fav}" aria-label="${fav ? 'Remove' : 'Add'} ${esc(m.home)} vs ${esc(m.away)} ${fav ? 'from' : 'to'} favorites">${fav ? '★' : '☆'}</button>
    </div>`;
}

// ----- Earlier results: finished matches from previous days, newest first -----

// results.json is kept by Agent Tom (last 21 days, every league). Without a recent copy
// (e.g. the hosted site, or the app opened as a file), the last week is fetched from ESPN
// directly, one day per request.
let resultsFeed = null; // { leagues: [{ league, events: [...] }] }
async function loadResults() {
  try {
    const r = await fetch(`results.json?t=${Date.now()}`, { cache: 'no-store' });
    // The hosted copy is only as new as the last deploy; past two hours old, ask ESPN instead.
    if (r.ok) { const d = await r.json(); if (d.leagues && d.leagues.length && !(Date.now() - Date.parse(d.updated) > 72e5)) { resultsFeed = d; return; } }
  } catch { /* fall through to ESPN */ }
  const days = Array.from({ length: 7 }, (_, i) => isoDay(new Date(Date.now() - (i + 1) * 864e5)).replace(/-/g, ''));
  const leagues = await Promise.all(LIVE_LEAGUES.map(async ([code, league]) => {
    const lists = await Promise.all(days.map(async d => {
      try {
        const data = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${d}`)).json();
        return (data.events || []).filter(ev => ev.status.type.state === 'post').map(ev => {
          const comp = (ev.competitions || [{}])[0];
          const side = h => { const c = (comp.competitors || []).find(x => x.homeAway === h) || {}; return { name: c.team && (c.team.shortDisplayName || c.team.displayName), logo: c.team && c.team.logo, score: c.score }; };
          return { id: ev.id, start: ev.date, state: 'post', detail: ev.status.type.shortDetail, home: side('home'), away: side('away') };
        });
      } catch { return []; }
    }));
    return { code, league, events: lists.flat() };
  }));
  resultsFeed = { leagues: leagues.filter(l => l.events.length) };
}

function dateLabel(iso) {
  for (const d of [0, -1, 1]) if (iso === dayDate(d)) return dayLabel(d);
  return new Date(iso + 'T12:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

function feedRow(e, code) {
  const href = feedHref(code, e);
  const logo = t => (t.logo ? `<img class="crest crest-sm" src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="crest crest-sm crest-fallback" aria-hidden="true">${esc(initials(t.name || '?'))}</span>`);
  return `
    <div class="match-row feed-row">
      <${href ? `a href="${href}"` : 'div'} class="match">
        <span class="status ${e.state === 'in' ? 'live' : ''}">${esc(e.state === 'in' ? e.detail || 'Live' : e.detail === 'FT' || !e.detail ? 'FT' : e.detail)}</span>
        <span class="team home">${esc(e.home.name)}</span>${logo(e.home)}
        <span class="score">${esc(e.home.score)} - ${esc(e.away.score)}</span>
        ${logo(e.away)}<span class="team away">${esc(e.away.name)}</span>
        ${e.state === 'in' ? '<span class="live-tag"><span class="live-pulse"></span>Live</span>' : '<span class="tv-tag">ESPN</span>'}
      </${href ? 'a' : 'div'}>
    </div>`;
}

function pastResults() {
  if (state.live) return '';
  const date = dayDate(state.day);
  const q = state.query.trim().toLowerCase();
  const hit = (h, a) => !q || `${h} ${a}`.toLowerCase().includes(q);
  const byDay = {};
  const add = (day, row) => (byDay[day] ||= []).push(row);
  const ours = new Set(MATCHES.filter(m => leagueOf(m) === state.league).map(matchDate));
  {
    MATCHES.filter(m => leagueOf(m) === state.league && matchDate(m) < date && (!state.tv || m.tv) && (!state.favsOnly || state.favs.includes(m.id)) && hit(m.home, m.away))
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
      .forEach(m => add(matchDate(m), matchRow(m)));
  }
  if (!state.tv && !state.favsOnly && resultsFeed) {
    const feed = resultsFeed.leagues.find(l => l.league === state.league);
    (feed ? feed.events : [])
      .map(e => ({ e, day: isoDay(new Date(e.start)) }))
      // Days the app has its own researched matches for (with full match pages) use those instead.
      .filter(({ e, day }) => day < date && !ours.has(day) && hit(e.home.name, e.away.name))
      .sort((a, b) => Date.parse(a.e.start) - Date.parse(b.e.start))
      .forEach(({ e, day }) => add(day, feedRow(e, feed.code)));
  }
  const days = Object.keys(byDay).sort().reverse();
  if (!days.length) return resultsFeed ? '' : '<p class="past-note muted">Loading earlier results…</p>';
  const shown = days.slice(0, state.pastDays || 5);
  return `
    <h2 class="past-title">Earlier results</h2>
    ${shown.map(d => `
      <div class="card">
        <div class="league-head past-head">
          <span><b>${dateLabel(d)}</b><span class="muted block">${new Date(d + 'T12:00').toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}</span></span>
          <span class="count">${byDay[d].length} ${byDay[d].length === 1 ? 'match' : 'matches'}</span>
        </div>
        ${byDay[d].join('')}
      </div>`).join('')}
    ${days.length > shown.length ? `<button class="pill past-more" data-action="past-more">Show earlier days (${days.length - shown.length} more)</button>` : ''}`;
}

// ----- Home sidebars: sample live scores, tomorrow's fixtures and top performers -----

// Live scores come from live.json, which Agent Tom (tools/agent-tom.py) refreshes from ESPN's
// public scoreboard every 30 seconds. If that file is missing or more than two minutes old
// (or the app is opened as a local file), the app asks ESPN directly.
const LIVE_LEAGUES = [['uefa.champions', 'Champions League'], ['eng.1', 'Premier League'], ['esp.1', 'LaLiga'], ['ger.1', 'Bundesliga'],
  ['ita.1', 'Serie A'], ['fra.1', 'Ligue 1'], ['uefa.europa', 'Europa League'], ['usa.1', 'MLS'], ['mex.1', 'Liga MX']];
let liveFeed = null; // { updated, source, leagues: [{ league, events: [...] }] }

async function loadLive() {
  try {
    const r = await fetch(`live.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) {
      const data = await r.json();
      if (Date.now() - Date.parse(data.updated) < 120000) { liveFeed = { ...data, via: 'Agent Tom' }; return; }
    }
  } catch { /* fall through to ESPN */ }
  const leagues = [];
  await Promise.all(LIVE_LEAGUES.map(async ([code, league]) => {
    try {
      const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard`)).json();
      leagues.push({ code, league, events: (d.events || []).map(ev => {
        const comp = (ev.competitions || [{}])[0];
        const side = h => { const c = (comp.competitors || []).find(x => x.homeAway === h) || {}; return { name: c.team && (c.team.shortDisplayName || c.team.displayName), logo: c.team && c.team.logo, score: c.score }; };
        return { id: ev.id, start: ev.date, state: ev.status.type.state, detail: ev.status.type.shortDetail, home: side('home'), away: side('away') };
      }) });
    } catch { /* skip a league that fails */ }
  }));
  if (leagues.length) liveFeed = { updated: new Date().toISOString(), source: 'ESPN public scoreboard', via: 'direct', leagues };
}

const feedCrest = t => (t.logo ? `<img class="crest crest-sm" src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="crest crest-sm crest-fallback">${esc(initials(t.name || '?'))}</span>`);

function liveCard() {
  if (!liveFeed) {
    return `<div class="card side-extra live-card"><div class="section-head"><h2 class="card-title"><span class="live-pulse"></span>Live now<span class="muted block">Connecting to the live feed…</span></h2></div></div>`;
  }
  // Live matches first, then the latest results across every league (upcoming fixtures
  // are in the "Coming up" card in the news column).
  const order = { in: 0, post: 1 };
  const finished = [...liveFeed.leagues, ...(resultsFeed ? resultsFeed.leagues : [])]
    .flatMap(l => l.events.filter(e => e.state !== 'pre').map(e => ({ ...e, league: l.league, code: l.code })));
  const seen = new Set();
  const rows = finished.filter(e => !seen.has(e.id) && seen.add(e.id))
    .sort((x, y) => order[x.state] - order[y.state] || Date.parse(y.start) - Date.parse(x.start));
  const liveCount = rows.filter(e => e.state === 'in').length;
  const groups = [];
  for (const e of rows) {
    const key = e.state === 'in' ? `Live · ${e.league}` : `${new Date(e.start).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })} · ${e.league}`;
    let g = groups.find(x => x.key === key);
    if (!g) groups.push(g = { key, league: e.league, events: [] });
    g.events.push(e);
  }
  const status = e => (e.state === 'pre' ? new Date(e.start).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : e.detail);
  return `
    <div class="card side-extra live-card">
      <div class="section-head"><h2 class="card-title"><span class="live-pulse ${liveCount ? '' : 'idle'}"></span>Live now</h2><span class="live-count">${liveCount ? `${liveCount} live` : 'none live'}</span></div>
      ${groups.map(g => `
        <div class="fit-group">
        <div class="side-league">${LEAGUES.find(l => l.name === g.league) ? `<img class="league-logo" src="${LEAGUES.find(l => l.name === g.league).logo}" alt="">` : ''}${esc(g.key)}</div>
        ${g.events.map(e => `
          <a class="side-match fit-item ${e.state}" href="${feedHref(e.code, e) || '#'}">
            <span class="live-min ${e.state}">${esc(status(e))}</span>
            <span class="sm-teams"><span>${feedCrest(e.home)} ${esc(e.home.name)}</span><span>${feedCrest(e.away)} ${esc(e.away.name)}</span></span>
            <span class="sm-score">${e.state === 'pre' ? '' : `<b>${esc(e.home.score)}</b><b>${esc(e.away.score)}</b>`}</span>
          </a>`).join('')}
        </div>`).join('')}
    </div>`;
}

// Refresh the live card in place every 30 seconds (and once on load).
// Only rebuild the card (and the Live filter's list) when a score or status changed, so the
// page doesn't flicker or jump every 30 seconds.
let liveSig = '';
async function refreshLive() {
  if (document.hidden) return;
  await loadLive();
  // Listings from tv.json follow the live scores (pages.js); redraw a page showing them.
  if (settleTv()) { const r = route(); if (r && (r.view === 'tv' || r.view === 'home')) render(); }
  const card = document.querySelector('.live-card');
  if (!card || !liveFeed) return;
  const sig = JSON.stringify(liveFeed.leagues.map(l => l.events.map(e => [e.id, e.state, e.detail, e.home.score, e.away.score])));
  if (sig !== liveSig || !card.querySelector('.fit-group')) {
    liveSig = sig;
    card.outerHTML = liveCard();
    const upcoming = document.querySelector('.upcoming-card');
    if (upcoming) upcoming.outerHTML = comingUpCard();
    if (state.live) refreshLiveList();
    fitSidebars();
  }
}
refreshLive();
setInterval(refreshLive, 30000);

async function refreshResults() {
  if (document.hidden && resultsFeed) return;
  const before = resultsFeed && JSON.stringify(resultsFeed.leagues.map(l => [l.league, l.events.length]));
  await loadResults();
  const after = JSON.stringify(resultsFeed.leagues.map(l => [l.league, l.events.length]));
  const box = document.getElementById('past');
  if (box && before !== after) {
    box.innerHTML = pastResults();
    const card = document.querySelector('.live-card');
    if (card && liveFeed) card.outerHTML = liveCard();
    fitSidebars();
  }
}
refreshResults();
setInterval(refreshResults, 600000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLive(); });
// Phones restore a page from the back/forward cache without a visibility change.
window.addEventListener('pageshow', e => { if (e.persisted) refreshLive(); });

// Upcoming fixtures from the live feed, grouped by day and league. As the last card in the
// news column it fills the space beside the match list; rows that don't fit are hidden.
function comingUpCard() {
  const rows = liveFeed ? liveFeed.leagues.flatMap(l => l.events.filter(e => e.state === 'pre').map(e => ({ ...e, league: l.league })))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)) : [];
  const groups = [];
  for (const e of rows) {
    const d = new Date(e.start);
    const key = `${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })} · ${e.league}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) groups.push(g = { key, league: e.league, events: [] });
    g.events.push(e);
  }
  const logo = name => { const l = LEAGUES.find(x => x.name === name); return l ? `<img class="league-logo" src="${l.logo}" alt="">` : ''; };
  return `
    <div class="card side-extra upcoming-card">
      <div class="section-head"><h2 class="card-title">Coming up<span class="muted block">${liveFeed ? `${rows.length} fixtures across ${new Set(rows.map(e => e.league)).size} leagues` : 'Loading fixtures…'}</span></h2></div>
      ${groups.map(g => `
        <div class="fit-group">
          <div class="side-league">${logo(g.league)}${esc(g.key)}</div>
          ${g.events.map(e => `
            <div class="side-match up-match fit-item">
              <span class="sm-teams"><span>${feedCrest(e.home)} ${esc(e.home.name)}</span><span>${feedCrest(e.away)} ${esc(e.away.name)}</span></span>
              <span class="badge up-time">${new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>`).join('')}
        </div>`).join('')}
    </div>`;
}

function topPerformersHome() {
  const match = MATCHES[0];
  const top = lineupPeople(match).filter(p => p.rating).sort((x, y) => y.rating - x.rating).slice(0, 8);
  return `
    <div class="card side-extra">
      <div class="section-head"><h2 class="card-title">Top performers<span class="muted block">${esc(match.home)} ${match.score[0]}-${match.score[1]} ${esc(match.away)}</span></h2></div>
      <div class="fit-group">${top.map((p, i) => `
        <button class="side-player fit-item" data-action="player" data-id="${p.id}" data-match="${match.id}">
          <span class="sp-rank">${i + 1}</span>${avatar(p.id, 'sm')}
          <span class="sp-name">${esc(PEOPLE[p.id].name)}<small class="muted block">${crest(p.side === 'home' ? match.home : match.away)} ${PEOPLE[p.id].pos}</small></span>
          <span class="badge ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</span>
        </button>`).join('')}</div>
      <a class="side-more" href="#/match/${match.id}/players">All player stats ❯</a>
    </div>`;
}

// The last card in each home sidebar fills the space left beside the match list; rows that
// don't fit are hidden (a league heading disappears with its last visible match).
function fitSidebars() {
  for (const card of document.querySelectorAll('.layout > aside > .card.side-extra:last-child')) {
    const items = [...card.querySelectorAll('.fit-item')];
    items.forEach(el => { el.hidden = false; });
    card.querySelectorAll('.fit-group').forEach(g => { g.hidden = false; });
    if (getComputedStyle(card).display === 'none') continue;
    for (let i = items.length - 1; i > 0 && card.scrollHeight > card.clientHeight + 1; i--) {
      items[i].hidden = true;
      const group = items[i].closest('.fit-group');
      if (group && ![...group.querySelectorAll('.fit-item')].some(el => !el.hidden)) group.hidden = true;
    }
  }
}
window.addEventListener('resize', () => { clearTimeout(fitSidebars.t); fitSidebars.t = setTimeout(fitSidebars, 100); });

function newsColumn() {
  const [lead, ...rest] = NEWS;
  return `
    <aside class="rightnews" id="news" aria-label="News">
      <div class="card">
        <h2 class="card-title">News</h2>
        <div class="news-items">${homeNewsItems() || `
        <button class="news-lead" data-action="news" data-index="0">
          <img src="${lead.photo}" alt="${esc(lead.alt)}" loading="lazy">
          <span class="news-title">${esc(lead.title)}</span>
          <span class="muted">TDsports · ${lead.hoursAgo} hr. ago</span>
        </button>
        ${rest.map((n, i) => `
          <button class="news-item" data-action="news" data-index="${i + 1}">
            <img src="${n.photo}" alt="${esc(n.alt)}" loading="lazy">
            <span><b>${esc(n.title)}</b><span class="muted">TDsports · ${n.hoursAgo} hr. ago</span></span>
          </button>`).join('')}`}</div>
      </div>
      ${topPerformersHome()}
      ${comingUpCard()}
    </aside>`;
}

function renderHome() {
  document.title = 'TDsports | Scores & player statistics';
  const list = visibleMatches();
  const league = LEAGUES.find(l => l.name === state.league);
  app.innerHTML = `
    <div class="layout">
      <aside class="leagues" aria-label="Leagues">
        <div class="card">
          <h2 class="card-title">Top leagues</h2>
          <div class="league-list">
            ${LEAGUES.map(l => `
              <button class="league ${l.name === state.league ? 'active' : ''}" data-action="league" data-league="${esc(l.name)}" aria-pressed="${l.name === state.league}">
                <img class="league-logo" src="${l.logo}" alt="" loading="lazy">${esc(l.name)}
              </button>`).join('')}
          </div>
        </div>
        <div class="card all-leagues"><button class="league" data-action="all-leagues"><b>All leagues</b><span class="chev">⌄</span></button></div>
        ${liveCard()}
      </aside>
      <section aria-label="Matches">
        <div class="card">
          <div class="dates">
            <button class="circle" data-action="day" data-delta="-1" aria-label="Previous day">❮</button>
            <button class="day-label" data-action="today" title="Jump to today"><b>${dayLabel(state.day)}</b></button>
            <button class="circle" data-action="day" data-delta="1" aria-label="Next day">❯</button>
          </div>
          <div class="filters">
            <button class="pill ${state.live ? 'selected' : ''}" data-action="toggle" data-key="live" aria-pressed="${state.live}"><span class="live-dot"></span>Live</button>
            <button class="pill ${state.tv ? 'selected' : ''}" data-action="toggle" data-key="tv" aria-pressed="${state.tv}">On TV</button>
            <button class="pill ${state.favsOnly ? 'selected' : ''}" data-action="toggle" data-key="favsOnly" aria-pressed="${state.favsOnly}">★ Favorites</button>
            <select class="pill" id="sort" aria-label="Sort matches">
              <option value="time" ${state.sort === 'time' ? 'selected' : ''}>By time</option>
              <option value="team" ${state.sort === 'team' ? 'selected' : ''}>By team</option>
            </select>
            <input class="filter" id="filter" type="search" placeholder="Filter teams" aria-label="Filter matches by team" value="${esc(state.query)}">
          </div>
        </div>
        <div class="card">
          <div class="league-head">
            <img class="league-logo" src="${league.logo}" alt="">
            <span><b>${esc(league.name)}</b><span class="muted block">${esc(league.country)}</span></span>
            <span class="count">${state.live ? `${liveEvents().length} live` : (n => `${n} ${n === 1 ? 'match' : 'matches'}`)(list.length + dayFixtures().length)}</span>
          </div>
          <div id="matches">
            ${matchList(list)}
          </div>
        </div>
        <div id="past">${pastResults()}</div>
      </section>
      ${newsColumn()}
    </div>`;
}

// ---------------------------------------------------------------------------
// Match view: a full-width dashboard of section cards in a three-column grid
// ---------------------------------------------------------------------------

const TABS = ['Facts', 'Stats', 'Players', 'Lineup', 'Events', 'Table'];

// Grid helpers. A card can span columns ('span-2', 'span-3') or two rows ('row-2').
const dash = cells => `<div class="dash">${cells.filter(Boolean).join('')}</div>`;
const cell = (html, cls) => `<div class="cell ${cls}">${html}</div>`;
const stack = (...cards) => `<div class="stack">${cards.filter(Boolean).join('')}</div>`;

function sectionHead(title, match, sub = '') {
  return `
    <div class="section-head">
      <h2 class="card-title">${title}${sub ? `<span class="muted block">${sub}</span>` : ''}</h2>
      ${match ? `<span class="section-teams">${crest(match.home)}<span class="vs">vs</span>${crest(match.away)}</span>` : ''}
    </div>`;
}

// One comparison row: home value, label, away value, with a split bar beneath.
function cmpRow(label, h, a, { text = v => v, lower = false, hint = '' } = {}) {
  const total = Math.abs(h) + Math.abs(a) || 1;
  const better = h === a ? '' : (h > a) !== lower ? 'home' : 'away';
  return `
    <div class="cmp" ${hint ? `title="${esc(hint)}"` : ''}>
      <div class="cmp-top">
        <b class="${better === 'home' ? 'lead home-lead' : ''}">${text(h, 0)}</b>
        <span>${label}${hint ? ' <span class="hint">ⓘ</span>' : ''}</span>
        <b class="${better === 'away' ? 'lead away-lead' : ''}">${text(a, 1)}</b>
      </div>
      <div class="cmp-bar"><i class="h ${better === 'home' ? 'on' : ''}" style="flex:${Math.abs(h) / total}"></i><i class="a ${better === 'away' ? 'on' : ''}" style="flex:${Math.abs(a) / total}"></i></div>
    </div>`;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const ratio = (accKey, attKey, teams) => (v, i) => `${teams[i][accKey]}/${teams[i][attKey]} <small>(${pct(teams[i][accKey], teams[i][attKey])}%)</small>`;

function possessionBar(p) {
  return `
    <p class="center small-title">Ball possession</p>
    <div class="bar" role="img" aria-label="Possession ${p}% to ${100 - p}%">
      <span style="flex:${p}">${p}%</span><span style="flex:${100 - p}">${100 - p}%</span>
    </div>`;
}

// Smooth a series of points into an SVG path (Catmull-Rom spline as cubic Béziers).
function smoothPath(points) {
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] || points[i], points[i], points[i + 1], points[i + 2] || points[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return path;
}

// Momentum as a shaded area: above the midline favours the home side, below the away side.
function momentumCard(match) {
  const d = details(match);
  const W = 400, H = 200, mid = H / 2, amp = mid - 12;
  const n = d.momentum.length;
  const X = i => (i / (n - 1)) * W;
  const points = d.momentum.map((v, i) => [X(i), mid - v * amp]);
  const curve = smoothPath(points);
  const area = `${curve} L${W},${mid} L0,${mid} Z`;
  const goals = d.events.filter(e => e.type === 'goal' || e.type === 'owngoal').map(e => {
    const x = Math.min(W - 6, Math.max(6, (e.min / 90) * W));
    const y = e.side === 'home' ? 9 : H - 9;
    return `<circle class="mo-goal ${e.side}" cx="${x.toFixed(1)}" cy="${y}" r="5"><title>${e.min}′ goal · ${esc(e.side === 'home' ? match.home : match.away)}</title></circle>`;
  }).join('');
  return `
    <div class="card">
      ${sectionHead('Momentum', match, 'Attacking pressure across the match · dots mark goals')}
      <svg class="momentum-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Momentum chart: shading above the line favours ${esc(match.home)}, below favours ${esc(match.away)}">
        <defs>
          <linearGradient id="mo-home" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--home);stop-opacity:.95"/><stop offset="1" style="stop-color:var(--home);stop-opacity:.12"/></linearGradient>
          <linearGradient id="mo-away" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--away);stop-opacity:.12"/><stop offset="1" style="stop-color:var(--away);stop-opacity:.95"/></linearGradient>
          <clipPath id="mo-top"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath>
          <clipPath id="mo-bottom"><rect x="0" y="${mid}" width="${W}" height="${mid}"/></clipPath>
        </defs>
        <line class="mo-ht" x1="${W / 2}" x2="${W / 2}" y1="0" y2="${H}"/>
        <path d="${area}" fill="url(#mo-home)" clip-path="url(#mo-top)"/>
        <path d="${area}" fill="url(#mo-away)" clip-path="url(#mo-bottom)"/>
        <line class="mo-axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>
        ${goals}
      </svg>
      <div class="momentum-axis muted"><span>0′</span><span>HT</span><span>FT</span></div>
      <div class="legend-row"><span><i class="key home"></i>${esc(match.home)} on top</span><span><i class="key away"></i>${esc(match.away)} on top</span></div>
    </div>`;
}

function topStatsCard(match) {
  const [h, a] = analytics(match).teams;
  return `
    <div class="card">
      ${sectionHead('Top stats', match)}
      ${possessionBar(h.possession)}
      ${cmpRow('Expected goals (xG)', h.xg, a.xg, { text: v => v.toFixed(2) })}
      ${cmpRow('Total shots', h.shots, a.shots)}
      ${cmpRow('Shots on target', h.onTarget, a.onTarget)}
      ${cmpRow('Big chances', h.bigChances, a.bigChances)}
      ${cmpRow('Accurate passes', h.passesAcc, a.passesAcc)}
      ${cmpRow('Corners', h.corners, a.corners)}
      ${cmpRow('Fouls committed', h.fouls, a.fouls, { lower: true })}
      <a class="all-stats" href="#/match/${match.id}/stats">All stats ❯</a>
    </div>`;
}

// Compact venue and officials card.
function matchInfoCard(match) {
  const d = details(match);
  const v = d.venue;
  const full = v && v.capacity ? Math.round((d.attendance / v.capacity) * 100) : null;
  const facts = [
    v && v.capacity && ['Capacity', fmt(v.capacity)],
    d.attendance && ['Attendance', `${fmt(d.attendance)}${full ? ` <small class="muted">(${full}%${d.attendanceEstimated ? ', est.' : ''})</small>` : ''}`],
    ['Referee', `${esc(d.referee[0])} <small class="muted">${esc(d.referee[1])}</small>`],
    ['Weather', `${d.weather.temp}°C ${d.weather.sky}`],
    ['Surface', 'Grass'],
    match.tv && ['Broadcast', `📺 ${esc(match.tv)}`],
  ].filter(Boolean);
  return `
    <div class="card venue-compact">
      <div class="venue-row">
        ${v && v.photo ? `<img class="venue-thumb" src="${v.photo}" alt="${esc(v.name)}" loading="lazy">` : ''}
        <div><h2 class="venue-name">${v ? esc(v.name) : 'Match info'}</h2>${v ? `<span class="muted">${esc(v.city)}</span>` : ''}</div>
      </div>
      <div class="venue-facts">${facts.map(([k, val]) => `<div><span class="muted">${k}</span><b>${val}</b></div>`).join('')}</div>
      ${v && v.photo ? `<p class="photo-credit">${photoCredit(v.photo)}</p>` : ''}
    </div>`;
}

// Player comparison radar: two players' per-90 percentile ranks among players in this match.
const RADAR_AXES = [
  ['xG', 'xg'], ['xA', 'xa'], ['Key passes', 'keyPasses'], ['Prog. passes', 'progPasses'], ['Prog. carries', 'progCarries'],
  ['Dribbles won', 'dribblesWon'], ['Pass %', 'passPct'], ['Duel %', 'duelPct'], ['Tackles + int.', 'defActions'], ['Recoveries', 'recoveries'],
];

function radarSvg(axes, series) {
  const S = 320, c = S / 2, R = 108;
  const pt = (i, v) => {
    const ang = -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
    return [c + Math.cos(ang) * R * v, c + Math.sin(ang) * R * v];
  };
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon class="ring" points="${axes.map((_, i) => pt(i, f).join(',')).join(' ')}"/>`).join('');
  const spokes = axes.map((_, i) => `<line class="spoke" x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}"/>`).join('');
  const labels = axes.map((label, i) => {
    const [x, y] = pt(i, 1.2);
    return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${Math.abs(x - c) < 8 ? 'middle' : x > c ? 'start' : 'end'}">${esc(label)}</text>`;
  }).join('');
  const shapes = series.map(s => `
    <polygon class="radar-shape ${s.cls}" points="${s.values.map((v, i) => pt(i, Math.max(v, 3) / 100).map(n => n.toFixed(1)).join(',')).join(' ')}"/>
    ${s.values.map((v, i) => `<circle class="radar-dot ${s.cls}" cx="${pt(i, Math.max(v, 3) / 100)[0].toFixed(1)}" cy="${pt(i, Math.max(v, 3) / 100)[1].toFixed(1)}" r="3"><title>${esc(s.name)} · ${esc(axes[i])}: ${ordinal(v)} percentile</title></circle>`).join('')}`).join('');
  return `<svg class="radar" viewBox="-40 -10 ${S + 80} ${S + 20}" role="img" aria-label="Radar comparison: ${series.map(s => esc(s.name)).join(' vs ')}">${rings}${spokes}${shapes}<g class="radar-labels">${labels}</g></svg>`;
}

function compareCard(match) {
  const { players, teams } = analytics(match);
  if (!players) {
    // No player data: compare the teams on the same kind of web, scaled to the higher value.
    const keys = [['xG', 'xg'], ['Shots', 'shots'], ['Possession', 'possession'], ['Prog. passes', 'progPasses'], ['Final third', 'finalThird'], ['Dribbles won', 'dribblesWon'], ['Duels won', 'duelsWon'], ['Tackles', 'tackles'], ['Recoveries', 'recoveries'], ['Distance', 'distance']];
    const scaled = side => keys.map(([, k]) => Math.round((teams[side][k] / (Math.max(teams[0][k], teams[1][k]) || 1)) * 100));
    return `
      <div class="card">
        ${sectionHead('Team comparison', match, 'Each axis scaled to the higher of the two teams')}
        ${radarSvg(keys.map(k => k[0]), [{ name: match.home, cls: 'a', values: scaled(0) }, { name: match.away, cls: 'b', values: scaled(1) }])}
        <div class="legend-row center-row"><span><i class="key home"></i>${esc(match.home)}</span><span><i class="key away"></i>${esc(match.away)}</span></div>
      </div>`;
  }
  const pool = players.filter(p => p.minutes >= 30 && p.group !== 'GK');
  const best = side => pool.filter(p => p.side === side).reduce((x, p) => (p.rating > x.rating ? p : x));
  const ids = state.compare[match.id] || [best('home').id, best('away').id];
  const [pa, pb] = ids.map(id => pool.find(p => p.id === id) || pool[0]);
  const values = p => RADAR_AXES.map(([, k]) => percentile(players, p, k));
  const select = (i, chosen) => `
    <select class="pill compare-select ${i ? 'b' : 'a'}" data-compare="${i}" data-match="${match.id}" aria-label="Player ${i + 1}">
      ${['home', 'away'].map(side => `<optgroup label="${esc(side === 'home' ? match.home : match.away)}">${pool.filter(p => p.side === side).map(p => `<option value="${p.id}" ${p.id === chosen.id ? 'selected' : ''}>${esc(PEOPLE[p.id].name)} · ${p.pos}</option>`).join('')}</optgroup>`).join('')}
    </select>`;
  const per90 = (p, v) => ((v * 90) / p.minutes).toFixed(2);
  const rows = [
    ['Rating', pa.rating.toFixed(1), pb.rating.toFixed(1)],
    ['Minutes', pa.minutes, pb.minutes],
    ['xG + xA per 90', per90(pa, pa.xg + pa.xa), per90(pb, pb.xg + pb.xa)],
    ['Progressive actions per 90', per90(pa, pa.progPasses + pa.progCarries), per90(pb, pb.progPasses + pb.progCarries)],
    ['Duels won', `${pa.duelsWon}/${pa.duels}`, `${pb.duelsWon}/${pb.duels}`],
  ];
  return `
    <div class="card">
      ${sectionHead('Player comparison', null, 'Per-90 percentile vs. outfield players in this match (30+ min)')}
      <div class="compare-pickers">${select(0, pa)}<span class="vs">vs</span>${select(1, pb)}</div>
      ${radarSvg(RADAR_AXES.map(a => a[0]), [{ name: PEOPLE[pa.id].name, cls: 'a', values: values(pa) }, { name: PEOPLE[pb.id].name, cls: 'b', values: values(pb) }])}
      <div class="compare-table">
        <div class="compare-head"><button data-action="player" data-id="${pa.id}" data-match="${match.id}">${avatar(pa.id, 'sm')} ${esc(PEOPLE[pa.id].short)}</button><span></span><button data-action="player" data-id="${pb.id}" data-match="${match.id}">${esc(PEOPLE[pb.id].short)} ${avatar(pb.id, 'sm')}</button></div>
        ${rows.map(([k, x, y]) => `<div class="statrow"><b class="ca">${x}</b><span class="muted">${k}</span><b class="cb">${y}</b></div>`).join('')}
      </div>
    </div>`;
}

// Cumulative xG over time as a step chart, with goals marked.
function xgRaceCard(match) {
  const { shots, teams } = analytics(match);
  const W = 400, H = 190, pad = 24;
  const max = Math.max(teams[0].xg, teams[1].xg, 1) * 1.1;
  const X = m => pad + (m / 92) * (W - pad * 2);
  const Y = v => H - pad - (v / max) * (H - pad * 2);
  const line = side => {
    let cum = 0;
    let path = `M${X(0)},${Y(0)}`;
    for (const s of shots.filter(x => x.side === side)) {
      path += ` H${X(s.min).toFixed(1)}`;
      cum += s.xg;
      path += ` V${Y(cum).toFixed(1)}`;
    }
    return path + ` H${X(92)}`;
  };
  const goalDots = side => {
    let cum = 0;
    return shots.filter(x => x.side === side).map(s => {
      cum += s.xg;
      return s.outcome === 'goal' ? `<circle class="goal-dot ${side}" cx="${X(s.min).toFixed(1)}" cy="${Y(cum).toFixed(1)}" r="4.5"><title>${s.min}′ goal${s.who ? ` · ${esc(personName(s.who))}` : ''} (xG ${s.xg.toFixed(2)})</title></circle>` : '';
    }).join('');
  };
  const ticks = [0, 15, 30, 45, 60, 75, 90].map(m => `<text x="${X(m)}" y="${H - 6}" text-anchor="middle">${m}′</text>`).join('');
  const grid = [0.5, 1, 1.5, 2, 2.5, 3].filter(v => v < max).map(v => `<line x1="${pad}" x2="${W - pad}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pad - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`).join('');
  return `
    <div class="card">
      ${sectionHead('xG race', match, 'Cumulative expected goals; dots mark goals')}
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative xG: ${esc(match.home)} ${teams[0].xg}, ${esc(match.away)} ${teams[1].xg}">
        <g class="grid">${grid}<line x1="${X(45)}" x2="${X(45)}" y1="${pad}" y2="${H - pad}" class="ht"/></g>
        <g class="ticks">${ticks}</g>
        <path class="xg-line home" d="${line('home')}"/><path class="xg-line away" d="${line('away')}"/>
        ${goalDots('home')}${goalDots('away')}
      </svg>
      <div class="legend-row"><span><i class="key home"></i>${esc(match.home)} ${teams[0].xg.toFixed(2)}</span><span><i class="key away"></i>${esc(match.away)} ${teams[1].xg.toFixed(2)}</span></div>
    </div>`;
}

// Full pitch: home shoots right, away shoots left. Size = xG.
function shotMapCard(match) {
  const { shots, teams } = analytics(match);
  const dots = shots.map(s => {
    const x = (s.side === 'home' ? s.x : 100 - s.x) * 1.05;
    const y = (s.side === 'home' ? s.y : 100 - s.y) * 0.68;
    const r = (0.9 + Math.sqrt(s.xg) * 2.6).toFixed(2);
    const label = `${s.min}′ ${s.who ? personName(s.who) : s.side === 'home' ? match.home : match.away} · xG ${s.xg.toFixed(2)} · ${{ goal: 'Goal', saved: 'Saved', blocked: 'Blocked', off: 'Off target' }[s.outcome]}${s.header ? ' · header' : ''}`;
    return `<circle class="shot ${s.side} ${s.outcome}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"><title>${esc(label)}</title></circle>`;
  }).join('');
  return `
    <div class="card">
      ${sectionHead('Shot map', match, 'Circle size = xG · hover a shot for details')}
      <svg class="shotmap" viewBox="-2 -2 109 72" role="img" aria-label="Shot map">
        <rect x="0" y="0" width="105" height="68" class="turf"/>
        <g class="lines">
          <rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><circle cx="52.5" cy="34" r="9.15"/>
          <rect x="0" y="13.85" width="16.5" height="40.3"/><rect x="88.5" y="13.85" width="16.5" height="40.3"/>
          <rect x="0" y="24.85" width="5.5" height="18.3"/><rect x="99.5" y="24.85" width="5.5" height="18.3"/>
        </g>
        ${dots}
      </svg>
      <div class="legend-row">
        <span><i class="key dot goal"></i>Goal</span><span><i class="key dot saved"></i>Saved</span><span><i class="key dot ring"></i>Off target / blocked</span>
      </div>
      <div class="two shot-summary">
        <div class="statrow"><span>${crest(match.home)} xG per shot</span><b>${(teams[0].xg / (teams[0].shots || 1)).toFixed(2)}</b></div>
        <div class="statrow"><span>${crest(match.away)} xG per shot</span><b>${(teams[1].xg / (teams[1].shots || 1)).toFixed(2)}</b></div>
      </div>
    </div>`;
}

function attackingCard(match) {
  const [h, a] = analytics(match).teams;
  return `
    <div class="card">
      ${sectionHead('Attacking', match)}
      ${cmpRow('Expected goals (xG)', h.xg, a.xg, { text: v => v.toFixed(2) })}
      ${cmpRow('xG on target (xGOT)', h.xgot, a.xgot, { text: v => v.toFixed(2), hint: 'Quality of shots that hit the target, based on where they were placed' })}
      ${cmpRow('Shots inside box', h.insideBox, a.insideBox)}
      ${cmpRow('Shots outside box', h.shots - h.insideBox, a.shots - a.insideBox)}
      ${cmpRow('Shots blocked by opponent', h.blockedShots, a.blockedShots, { lower: true })}
      ${cmpRow('Big chances missed', h.bigChancesMissed, a.bigChancesMissed, { lower: true })}
      ${cmpRow('Touches in opposition box', h.boxTouches, a.boxTouches)}
      ${cmpRow('Successful dribbles', h.dribblesWon, a.dribblesWon, { text: (v, i) => `${[h, a][i].dribblesWon}/${[h, a][i].dribbles}` })}
    </div>`;
}

function passingCard(match) {
  const teams = analytics(match).teams;
  const [h, a] = teams;
  return `
    <div class="card">
      ${sectionHead('Passing & build-up', match)}
      ${cmpRow('Accurate passes', h.passesAcc, a.passesAcc, { text: ratio('passesAcc', 'passesAtt', teams) })}
      ${cmpRow('Key passes', h.keyPasses, a.keyPasses)}
      ${cmpRow('Progressive passes', h.progPasses, a.progPasses, { hint: 'Passes that move the ball at least 10 m towards goal' })}
      ${cmpRow('Progressive carries', h.progCarries, a.progCarries)}
      ${cmpRow('Final-third entries', h.finalThird, a.finalThird)}
      ${cmpRow('Long balls', h.longAcc, a.longAcc, { text: ratio('longAcc', 'longAtt', teams) })}
      ${cmpRow('Crosses', h.crossesAcc, a.crossesAcc, { text: ratio('crossesAcc', 'crossesAtt', teams) })}
    </div>`;
}

function defendingCard(match) {
  const teams = analytics(match).teams;
  const [h, a] = teams;
  return `
    <div class="card">
      ${sectionHead('Defending', match)}
      ${cmpRow('Tackles won', h.tackles, a.tackles)}
      ${cmpRow('Interceptions', h.interceptions, a.interceptions)}
      ${cmpRow('Clearances', h.clearances, a.clearances)}
      ${cmpRow('Blocked shots', h.blocks, a.blocks)}
      ${cmpRow('Ball recoveries', h.recoveries, a.recoveries)}
      ${cmpRow('Duels won', h.duelsWon, a.duelsWon, { text: ratio('duelsWon', 'duels', teams) })}
      ${cmpRow('Aerial duels won', h.aerialsWon, a.aerialsWon, { text: ratio('aerialsWon', 'aerials', teams) })}
      ${cmpRow('Goalkeeper saves', h.saves, a.saves)}
    </div>`;
}

function physicalCard(match) {
  const [h, a] = analytics(match).teams;
  return `
    <div class="card">
      ${sectionHead('Physical', match)}
      ${cmpRow('Distance covered (km)', h.distance, a.distance, { text: v => v.toFixed(1) })}
      ${cmpRow('Sprints', h.sprints, a.sprints, { hint: 'Runs above 25 km/h' })}
      ${cmpRow('High-intensity runs', h.hiRuns, a.hiRuns, { hint: 'Runs above 20 km/h' })}
      ${cmpRow('Top speed (km/h)', h.topSpeed, a.topSpeed, { text: v => v.toFixed(1) })}
      ${h.topSpeedBy ? `<p class="muted card-note">Fastest: ${esc(personName(h.topSpeedBy))} (${h.topSpeed} km/h) · ${esc(personName(a.topSpeedBy))} (${a.topSpeed} km/h)</p>` : ''}
    </div>`;
}

function disciplineCard(match) {
  const [h, a] = analytics(match).teams;
  return `
    <div class="card">
      ${sectionHead('Discipline & set pieces', match)}
      ${cmpRow('Fouls committed', h.fouls, a.fouls, { lower: true })}
      ${cmpRow('Yellow cards', h.yellows, a.yellows, { lower: true })}
      ${cmpRow('Red cards', h.reds, a.reds, { lower: true })}
      ${cmpRow('Offsides', h.offsides, a.offsides, { lower: true })}
      ${cmpRow('Corners', h.corners, a.corners)}
      ${cmpRow('Headed shots', h.headers, a.headers)}
      ${cmpRow('Set-piece xG', h.setPieceXg, a.setPieceXg, { text: v => v.toFixed(2) })}
    </div>`;
}

function eventsCard(match) {
  const d = details(match);
  const name = (e, side) => (d.lineup ? esc(personName(e.who)) : esc(side === 'home' ? match.home : match.away));
  const line = e => {
    if (e.type === 'sub') {
      return `${icon.sub}<span><span class="sub-in">${esc(personName(e.who))}</span><small class="sub-out">${esc(personName(e.detail))}</small></span>`;
    }
    const label = e.type === 'var' ? esc(personName(e.who)) : e.type === 'owngoal' ? `${esc(personName(e.who))} (OG)` : `${name(e, e.side)}${e.extra === 'pen' ? ' (P)' : ''}`;
    return `${icon[e.type]}<span>${label}<small>${esc(e.type === 'goal' || e.type === 'owngoal' ? e.detail : e.type === 'yellow' ? 'Yellow card' : e.type === 'red' ? `Red card${e.detail ? ` · ${e.detail}` : ''}` : e.detail)}</small></span>`;
  };
  const ht = d.events.filter(e => e.min <= 45 && (e.type === 'goal' || e.type === 'owngoal'));
  const htScore = [ht.filter(e => e.side === 'home').length, ht.filter(e => e.side === 'away').length];
  let htShown = false;
  const rows = d.events.map(e => {
    let pre = '';
    if (!htShown && e.min > 45) { htShown = true; pre = `<div class="period">HT ${htScore[0]} - ${htScore[1]}</div>`; }
    return `${pre}
      <div class="event ${e.type === 'goal' || e.type === 'owngoal' ? 'is-goal' : ''}">
        <div class="left">${e.side === 'home' ? line(e) : ''}</div>
        <div class="time">${e.min}′</div>
        <div class="right">${e.side === 'away' ? line(e) : ''}</div>
      </div>`;
  }).join('');
  return `
    <div class="card events-card">
      ${sectionHead('Events', match)}
      <div class="period">Kick-off</div>
      ${rows}${htShown ? '' : `<div class="period">HT ${htScore[0]} - ${htScore[1]}</div>`}
      <div class="period">FT ${match.score[0]} - ${match.score[1]}</div>
    </div>`;
}

function noLineupCard(match) {
  return `
    <div class="card empty">
      <p>Lineups and player data for ${esc(match.home)} vs ${esc(match.away)} aren’t in the sample data yet.</p>
      <a class="pill" href="#/match/${MATCHES[0].id}/players">See Lille vs Galatasaray player data</a>
    </div>`;
}

function pitchCard(match) {
  const L = LINEUPS[match.id];
  if (!L) return noLineupCard(match);
  const people = lineupPeople(match);
  const playerBtn = p => `
    <button class="player" style="left:${p.x}%;top:${p.y}%" data-action="player" data-id="${p.id}" data-match="${match.id}">
      <span class="rating ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</span>
      ${avatar(p.id)}
      <span class="player-name">${esc(PEOPLE[p.id].short)}</span>
    </button>`;
  const subRow = p => {
    const s = playerMatchStats(match, p.id);
    return `
      <button class="sub" data-action="player" data-id="${p.id}" data-match="${match.id}">
        ${avatar(p.id, 'sm')}
        ${p.rating ? `<span class="badge ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</span>` : '<span class="badge r-none">–</span>'}
        <span>${esc(PEOPLE[p.id].name)}<small class="muted block">${PEOPLE[p.id].pos}</small></span>
        ${s.subOn ? `<span class="sub-min-badge" title="Came on at ${s.subOn.min}′">${s.subOn.min}′</span>` : '<span class="sub-min">Unused</span>'}
      </button>`;
  };
  const [hc, ac] = L.coaches;
  return `
    <div class="card">
      <div class="pitch-head">
        <span>${crest(match.home)} ${esc(match.home)} <b>${L.formations[0]}</b></span>
        <span><b>${L.formations[1]}</b> ${esc(match.away)} ${crest(match.away)}</span>
      </div>
      <div class="pitch-wrap"><div class="pitch"><span class="box left"></span><span class="box right"></span>${people.filter(p => !p.sub).map(playerBtn).join('')}</div></div>
      <div class="coaches">
        <button class="coach" data-action="coach" data-id="${hc}">${avatar(hc, 'sm')}<span>${esc(PEOPLE[hc].name)}<small class="muted block">Coach</small></span></button>
        <button class="coach right" data-action="coach" data-id="${ac}"><span>${esc(PEOPLE[ac].name)}<small class="muted block">Coach</small></span>${avatar(ac, 'sm')}</button>
      </div>
      <h3 class="card-title center">Substitutes</h3>
      <div class="two subs">
        <div>${people.filter(p => p.sub && p.side === 'home').map(subRow).join('')}</div>
        <div>${people.filter(p => p.sub && p.side === 'away').map(subRow).join('')}</div>
      </div>
    </div>`;
}

// Team sheet: squad-level numbers for each side.
function teamSheetCard(match) {
  const { players } = analytics(match);
  const L = LINEUPS[match.id];
  if (!players) return '';
  const avg = list => (list.length ? (list.reduce((a, p) => a + p.rating, 0) / list.length).toFixed(2) : '–');
  const col = (side, i) => {
    const xi = players.filter(p => p.side === side && !p.sub);
    const used = players.filter(p => p.side === side && p.sub && p.minutes);
    const unit = g => avg(xi.filter(p => p.group === g));
    return `<div>
      <h3 class="form-team">${crest(side === 'home' ? match.home : match.away)} ${esc(side === 'home' ? match.home : match.away)}</h3>
      <div class="statrow"><span>Formation</span><b>${L.formations[i]}</b></div>
      <div class="statrow"><span>Coach</span><b>${esc(PEOPLE[L.coaches[i]].name)}</b></div>
      <div class="statrow"><span>Starting XI avg rating</span><b>${avg(xi)}</b></div>
      <div class="statrow"><span>Defence / midfield / attack</span><b>${unit('DEF')} · ${unit('MID')} · ${unit('FWD')}</b></div>
      <div class="statrow"><span>Substitutes used</span><b>${used.length}</b></div>
      <div class="statrow"><span>Bench minutes</span><b>${used.reduce((a, p) => a + p.minutes, 0)}′</b></div>
    </div>`;
  };
  return `<div class="card">${sectionHead('Team sheets', null, 'Squad-level view for each side')}<div class="two">${col('home', 0)}${col('away', 1)}</div></div>`;
}

// Leaders across the categories scouts look at first.
function topPerformersCard(match) {
  const { players } = analytics(match);
  if (!players) return '';
  const played = players.filter(p => p.minutes);
  const motm = played.reduce((a, p) => (p.rating > a.rating ? p : a));
  const leader = (label, key, fmtV = v => v) => {
    const p = played.reduce((a, q) => ((q[key] || 0) > (a[key] || 0) ? q : a));
    return `<button class="leader" data-action="player" data-id="${p.id}" data-match="${match.id}">
      ${avatar(p.id, 'sm')}<span>${esc(PEOPLE[p.id].short)}<small class="muted block">${label}</small></span><b>${fmtV(p[key])}</b>
    </button>`;
  };
  const tklInt = played.map(p => ({ ...p, defActions: p.tackles + p.interceptions }));
  const defLeader = tklInt.reduce((a, p) => (p.defActions > a.defActions ? p : a));
  return `
    <div class="card">
      ${sectionHead('Top performers')}
      <button class="motm" data-action="player" data-id="${motm.id}" data-match="${match.id}">
        ${avatar(motm.id, 'lg')}
        <span><small class="muted block">Player of the match</small><b class="motm-name">${esc(PEOPLE[motm.id].name)}</b>
        <small class="muted block">${motm.goals} G · ${motm.assists} A · ${motm.xg.toFixed(2)} xG · ${motm.keyPasses} key passes</small></span>
        <span class="badge ${ratingClass(motm.rating)}">${motm.rating.toFixed(1)}</span>
      </button>
      <div class="leaders">
        ${leader('Expected goals', 'xg', v => v.toFixed(2))}
        ${leader('Expected assists', 'xa', v => v.toFixed(2))}
        ${leader('Progressive passes', 'progPasses')}
        ${leader('Progressive carries', 'progCarries')}
        ${leader('Duels won', 'duelsWon')}
        <button class="leader" data-action="player" data-id="${defLeader.id}" data-match="${match.id}">${avatar(defLeader.id, 'sm')}<span>${esc(PEOPLE[defLeader.id].short)}<small class="muted block">Tackles + interceptions</small></span><b>${defLeader.defActions}</b></button>
        ${leader('Distance (km)', 'distance', v => v.toFixed(1))}
        ${leader('Top speed (km/h)', 'topSpeed', v => v.toFixed(1))}
      </div>
    </div>`;
}

function goalkeepingCard(match) {
  const { players } = analytics(match);
  if (!players) return '';
  const gks = players.filter(p => p.pos === 'GK' && p.minutes);
  return `
    <div class="card">
      ${sectionHead('Goalkeeping', null, 'Goals prevented = xGOT faced − goals conceded')}
      <div class="two">${gks.map(g => `<div>
        <h3 class="form-team">${avatar(g.id, 'sm')} ${esc(PEOPLE[g.id].name)}</h3>
        <div class="statrow"><span>Saves</span><b>${g.saves}</b></div>
        <div class="statrow"><span>Goals conceded</span><b>${g.goalsConceded}</b></div>
        <div class="statrow"><span>xGOT faced</span><b>${(g.xgotFaced || 0).toFixed(2)}</b></div>
        <div class="statrow"><span>Goals prevented</span><b class="${g.goalsPrevented >= 0 ? 'pos-val' : 'neg-val'}">${g.goalsPrevented > 0 ? '+' : ''}${g.goalsPrevented.toFixed(2)}</b></div>
        <div class="statrow"><span>Passing</span><b>${g.passesAcc}/${g.passesAtt}</b></div>
        <div class="statrow"><span>Long balls</span><b>${g.longAcc}/${g.longAtt}</b></div>
      </div>`).join('')}</div>
    </div>`;
}

function benchImpactCard(match) {
  const { players } = analytics(match);
  if (!players) return '';
  const subs = players.filter(p => p.sub && p.minutes);
  return `
    <div class="card">
      ${sectionHead('Bench impact', null, 'What the substitutes added')}
      ${subs.map(p => `
        <button class="leader" data-action="player" data-id="${p.id}" data-match="${match.id}">
          ${avatar(p.id, 'sm')}
          <span>${esc(PEOPLE[p.id].name)}<small class="muted block">${(e => (e ? `On ${p.start}′ for ${esc(personName(e.detail))}` : `On ${p.start}′`))(details(match).events.find(e => e.type === 'sub' && e.who === p.id))} · ${p.minutes}′ played</small></span>
          <span class="leader-stats muted">${p.xg.toFixed(2)} xG · ${p.keyPasses} KP · ${p.duelsWon}/${p.duels} duels</span>
          ${p.rating ? `<span class="badge ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</span>` : ''}
        </button>`).join('')}
    </div>`;
}

// Sortable, filterable player table with grouped views and per-90 scaling.
const TABLE_VIEWS = {
  Summary: ['minutes', 'rating', 'goals', 'assists', 'xg', 'xa', 'shots', 'keyPasses', 'passPct', 'duelsWon', 'distance'],
  Attacking: ['minutes', 'goals', 'xg', 'xgot', 'shots', 'onTarget', 'bigChancesMissed', 'touchesBox', 'dribblesWon', 'progCarries'],
  Passing: ['minutes', 'assists', 'xa', 'keyPasses', 'passesAcc', 'passPct', 'progPasses', 'finalThird', 'longAcc', 'crossesAcc'],
  Defending: ['minutes', 'tackles', 'interceptions', 'clearances', 'blocks', 'recoveries', 'duelsWon', 'aerialsWon', 'fouls'],
  Physical: ['minutes', 'distance', 'sprints', 'hiRuns', 'topSpeed'],
  Goalkeeping: ['minutes', 'saves', 'goalsConceded', 'xgotFaced', 'goalsPrevented', 'passesAcc', 'longAcc'],
  Value: ['minutes', 'marketValue', 'transferValue', 'value1y', 'value3y', 'value5y', 'age', 'minutesShare', 'consistency'],
};
// [header, full label, decimals, per-90 eligible, ratio denominator key]
const COLUMNS = {
  minutes: ['Min', 'Minutes played', 0, false], rating: ['Rating', 'Match rating', 1, false],
  goals: ['G', 'Goals', 0, true], assists: ['A', 'Assists', 0, true], xg: ['xG', 'Expected goals', 2, true],
  xa: ['xA', 'Expected assists', 2, true], xgot: ['xGOT', 'xG on target', 2, true], shots: ['Sh', 'Shots', 0, true],
  onTarget: ['SoT', 'Shots on target', 0, true], keyPasses: ['KP', 'Key passes', 0, true],
  bigChancesMissed: ['BCM', 'Big chances missed', 0, true], touchesBox: ['Box', 'Touches in opposition box', 0, true],
  passesAcc: ['Passes', 'Accurate passes', 0, true, 'passesAtt'], passPct: ['Pass %', 'Pass accuracy', 0, false],
  progPasses: ['PrgP', 'Progressive passes', 0, true], finalThird: ['F3', 'Passes into final third', 0, true],
  longAcc: ['Long', 'Accurate long balls', 0, true, 'longAtt'], crossesAcc: ['Crs', 'Accurate crosses', 0, true, 'crossesAtt'],
  progCarries: ['PrgC', 'Progressive carries', 0, true], dribblesWon: ['Drb', 'Successful dribbles', 0, true, 'dribbles'],
  tackles: ['Tkl', 'Tackles won', 0, true], interceptions: ['Int', 'Interceptions', 0, true], clearances: ['Clr', 'Clearances', 0, true],
  blocks: ['Blk', 'Blocks', 0, true], recoveries: ['Rec', 'Ball recoveries', 0, true],
  duelsWon: ['Duels', 'Duels won', 0, true, 'duels'], aerialsWon: ['Aerial', 'Aerial duels won', 0, true, 'aerials'],
  fouls: ['Fls', 'Fouls committed', 0, true], distance: ['Km', 'Distance covered (km)', 1, true],
  sprints: ['Spr', 'Sprints', 0, true], hiRuns: ['HIR', 'High-intensity runs', 0, true], topSpeed: ['Top', 'Top speed (km/h)', 1, false],
  saves: ['Sv', 'Saves', 0, true], goalsConceded: ['GA', 'Goals conceded', 0, false], xgotFaced: ['xGOTA', 'xGOT faced', 2, false],
  goalsPrevented: ['GP', 'Goals prevented', 2, false],
  marketValue: ['Value', 'Market value (Transfermarkt)', 0, false], transferValue: ['Transfer', 'Predicted transfer value', 0, false],
  value1y: ['+1 yr', 'Predicted value in 1 year', 0, false], value3y: ['+3 yrs', 'Predicted value in 3 years', 0, false],
  value5y: ['+5 yrs', 'Predicted value in 5 years', 0, false], age: ['Age', 'Age', 0, false],
  minutesShare: ['Min %', "Share of the club's minutes, last 12 months", 0, false], consistency: ['Cons', 'Consistency: quarters of the year as a regular (of 4)', 0, false],
};

function tableValue(p, key, per90) {
  if (key === 'passPct') return pct(p.passesAcc, p.passesAtt);
  if (MARKET_COLUMNS[key]) return marketCell(p.id, key);
  const v = p[key] ?? 0;
  return per90 && COLUMNS[key][3] && p.minutes ? (v * 90) / p.minutes : v;
}

function tableRows(match) {
  const t = state.table;
  const { players } = analytics(match);
  return players
    .filter(p => p.minutes)
    .filter(p => t.team === 'all' || p.side === t.team)
    .filter(p => t.pos === 'all' || p.group === t.pos)
    .filter(p => t.view !== 'Goalkeeping' || p.pos === 'GK')
    .sort((a, b) => (tableValue(a, t.sort, t.per90) - tableValue(b, t.sort, t.per90)) * t.dir || b.minutes - a.minutes);
}

function playersTableCard(match) {
  const { players } = analytics(match);
  if (!players) return noLineupCard(match);
  const t = state.table;
  if (!TABLE_VIEWS[t.view].includes(t.sort)) t.sort = TABLE_VIEWS[t.view][1];
  const cols = TABLE_VIEWS[t.view];
  const rows = tableRows(match);
  const cellText = (p, key) => {
    const [, , dec, , denom] = COLUMNS[key];
    const v = tableValue(p, key, t.per90);
    if (key === 'rating') return `<span class="badge ${ratingClass(v)}">${v.toFixed(1)}</span>`;
    if (MARKET_COLUMNS[key]) return key === 'age' ? (v || '–') : key === 'minutesShare' ? (v ? `${v}%` : '–') : key === 'consistency' ? `${v}/4` : v ? euro(v) : '–';
    const shown = t.per90 && COLUMNS[key][3] ? v.toFixed(Math.max(dec, 1)) : v.toFixed(dec);
    return denom && !t.per90 ? `${shown}<small class="muted">/${p[denom]}</small>` : key === 'passPct' ? `${shown}%` : shown;
  };
  const max = Object.fromEntries(cols.map(k => [k, Math.max(...rows.map(p => tableValue(p, k, t.per90)))]));
  const seg = (key, values, label = v => v) => `<div class="seg" role="group">${values.map(v => `<button class="${t[key] === v ? 'on' : ''}" data-action="table" data-key="${key}" data-value="${v}" aria-pressed="${t[key] === v}">${label(v)}</button>`).join('')}</div>`;
  return `
    <div class="card">
      <div class="section-head">
        <h2 class="card-title">Player statistics<span class="muted block">${rows.length} players · click a column to sort · click a player for their profile</span></h2>
        <button class="pill" data-action="export-csv" data-match="${match.id}">⤓ Export CSV</button>
      </div>
      <div class="table-controls">
        ${seg('view', Object.keys(TABLE_VIEWS))}
        ${seg('team', ['all', 'home', 'away'], v => (v === 'all' ? 'Both teams' : esc(v === 'home' ? match.home : match.away)))}
        ${seg('pos', ['all', 'GK', 'DEF', 'MID', 'FWD'], v => (v === 'all' ? 'All' : v))}
        <label class="toggle"><input type="checkbox" data-action="table-per90" ${t.per90 ? 'checked' : ''}> Per 90</label>
      </div>
      <div class="table-wrap">
        <table class="table data-table">
          <thead><tr>
            <th class="sticky-col">Player</th>
            ${cols.map(k => `<th><button class="sort ${t.sort === k ? 'sorted' : ''}" data-action="table-sort" data-key="${k}" title="${COLUMNS[k][1]}">${COLUMNS[k][0]}${t.sort === k ? (t.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.map(p => `
              <tr>
                <td class="sticky-col"><button class="player-cell" data-action="player" data-id="${p.id}" data-match="${match.id}">
                  ${avatar(p.id, 'sm')}<span>${esc(PEOPLE[p.id].name)}<small class="muted block">${crest(p.side === 'home' ? match.home : match.away)} ${p.pos}${p.sub ? ' · sub' : ''}</small></span>
                </button></td>
                ${cols.map(k => `<td class="${max[k] > 0 && tableValue(p, k, t.per90) === max[k] && k !== 'minutes' ? 'best' : ''}">${cellText(p, k)}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted card-note">${cols.map(k => `<b>${COLUMNS[k][0]}</b> ${COLUMNS[k][1]}`).join(' · ')}</p>
    </div>`;
}

function exportCsv(match) {
  const keys = [...new Set(Object.values(TABLE_VIEWS).flat())];
  const head = ['Player', 'Team', 'Position', ...keys.map(k => COLUMNS[k][1])];
  const quote = v => `"${String(v).replace(/"/g, '""')}"`;
  const rows = analytics(match).players.filter(p => p.minutes).map(p => [
    PEOPLE[p.id].name, p.side === 'home' ? match.home : match.away, p.pos,
    ...keys.map(k => +tableValue(p, k, false).toFixed(2)),
  ]);
  const csv = [head, ...rows].map(r => r.map(quote).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `${match.id}-player-stats.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function standingsCard(match) {
  if (ESPN_TABLES[match.id]) return espnTableCard(match, ESPN_TABLES[match.id]);
  const league = leagueOf(match);
  const ucl = league === COMPETITION.league;
  const games = MATCHES.filter(m => leagueOf(m) === league);
  const teams = [...new Set(games.flatMap(m => [m.home, m.away]))];
  const rows = teams.map(team => {
    const r = rng('table-' + team);
    let w = 0, d = 0, l = 0, gf = 0, ga = 0;
    const record = (f, a) => { gf += f; ga += a; f > a ? w++ : f === a ? d++ : l++; };
    record(randInt(r, 0, 3), randInt(r, 0, 3));
    record(randInt(r, 0, 3), randInt(r, 0, 3));
    const today = games.find(m => m.home === team || m.away === team);
    record(...(today.home === team ? today.score : [...today.score].reverse()));
    return { team, w, d, l, gf, ga, pts: w * 3 + d };
  }).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team.localeCompare(b.team));
  return `
    <div class="card">
      ${sectionHead(league === COMPETITION.league ? `${league} · League stage` : league)}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>
            ${rows.map((t, i) => `
              <tr class="${t.team === match.home || t.team === match.away ? 'highlight' : ''} ${ucl && (i === 7 || i === 23) ? 'cutoff' : ''}">
                <td><span class="pos ${ucl ? (i < 8 ? 'q' : i < 24 ? 'po' : '') : ''}">${i + 1}</span></td>
                <td class="team-cell">${crest(t.team)} ${esc(t.team)}</td>
                <td>3</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.gf}</td><td>${t.ga}</td>
                <td>${t.gf - t.ga > 0 ? '+' : ''}${t.gf - t.ga}</td><td><b>${t.pts}</b></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="legend muted">${league === COMPETITION.league ? '<span class="pos q"></span> Round of 16 &nbsp; <span class="pos po"></span> Knockout play-offs · ' : ''}Sample standings</p>
    </div>`;
}

// Each team's real last five matches before this game (ESPN), most recent first.
function formCard(match) {
  const form = match.form || (typeof TEAM_FORM !== 'undefined' && TEAM_FORM[match.id]);
  const label = { w: 'Won', d: 'Drew', l: 'Lost' };
  const column = (team, games) => {
    if (!games || !games.length) return `<div><h3 class="form-team">${crest(team)} ${esc(team)}</h3><p class="muted">No recent results available.</p></div>`;
    const pts = games.reduce((t, g) => t + (g.res === 'w' ? 3 : g.res === 'd' ? 1 : 0), 0);
    return `<div>
      <h3 class="form-team">${crest(team)} ${esc(team)} <span class="muted form-pts">${pts}/${games.length * 3} pts</span></h3>
      ${games.map(g => `<div class="statrow" title="${label[g.res]} ${g.f}-${g.a} ${g.venue === 'H' ? 'at home' : 'away'} · ${esc(g.comp)} · ${esc(g.date)}"><span class="form-badge ${g.res}">${g.f} - ${g.a}</span><span class="form-opp">${g.logo ? `<img class="crest crest-sm" src="${esc(g.logo)}" alt="" loading="lazy">` : crest(g.opp)} ${esc(g.opp)} <small class="muted">${g.venue === 'H' ? '(H)' : '(A)'}</small></span></div>`).join('')}
    </div>`;
  };
  return `<div class="card">${sectionHead('Team form', null, 'Last five matches before this game, most recent first · score shown for the team')}<div class="two">${column(match.home, form && form.home)}${column(match.away, form && form.away)}</div></div>`;
}

// Sample vote origins for the poll map. Fans in each club's country lean heavily towards
// their club; elsewhere votes follow the neutral expectation. The overall result shown in
// the poll is the vote-weighted total of the countries, so map and percentages agree.
const voteCache = {};
function voteMap(match) {
  if (voteCache[match.id]) return voteCache[match.id];
  const d = details(match);
  const r = rng('votes-' + match.id);
  const home = CLUB_COUNTRY[match.home], away = CLUB_COUNTRY[match.away];
  const others = Object.keys(COUNTRIES).filter(c => c !== home && c !== away).sort(() => r() - 0.5).slice(0, 8);
  const total = 15000 + Math.round(r() * 45000);
  const weights = [[home, 0.24], [away, 0.24], ...others.map(c => [c, 0.02 + r() * 0.08])].filter(([c]) => COUNTRIES[c]);
  const wSum = weights.reduce((s, w) => s + w[1], 0);
  const norm = v => { const s = v.reduce((x, y) => x + y, 0); return v.map(x => Math.round((x / s) * 100)); };
  const rows = weights.map(([code, w]) => {
    const jitter = () => (r() - 0.5) * 10;
    const split = code === home && home !== away ? [72 + jitter(), 17, 11]
      : code === away && home !== away ? [11, 17, 72 + jitter()]
      : d.poll.map(p => Math.max(3, p + jitter()));
    return { code, votes: Math.round((w / wSum) * total), split: norm(split) };
  }).sort((x, y) => y.votes - x.votes);
  const overall = norm([0, 1, 2].map(k => rows.reduce((s, c) => s + c.votes * c.split[k], 0)));
  return (voteCache[match.id] = { rows, total, overall });
}

// Approximate location of the viewer from their time zone (no permission or network needed).
function viewerLocation() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const known = {
    'America/New_York': [40.7, -74], 'America/Chicago': [41.9, -87.6], 'America/Denver': [39.7, -105], 'America/Los_Angeles': [34, -118.2],
    'America/Toronto': [43.7, -79.4], 'America/Sao_Paulo': [-23.5, -46.6], 'America/Mexico_City': [19.4, -99.1], 'Europe/London': [51.5, -0.1],
    'Europe/Paris': [48.9, 2.35], 'Europe/Istanbul': [41, 29], 'Europe/Berlin': [52.5, 13.4], 'Europe/Madrid': [40.4, -3.7],
    'Europe/Rome': [41.9, 12.5], 'Europe/Amsterdam': [52.4, 4.9], 'Europe/Lisbon': [38.7, -9.1], 'Africa/Lagos': [6.5, 3.4],
    'Africa/Cairo': [30, 31.2], 'Asia/Kolkata': [22.6, 88.4], 'Asia/Tokyo': [35.7, 139.7], 'Asia/Jakarta': [-6.2, 106.8],
    'Australia/Sydney': [-33.9, 151.2],
  };
  if (known[tz]) return known[tz];
  const region = { America: [39, -98], Europe: [50, 10], Africa: [5, 20], Asia: [30, 100], Australia: [-25, 134], Pacific: [-15, 170] }[tz.split('/')[0]];
  return region || null;
}

function pollCard(match) {
  const vote = state.votes[match.id];
  const voted = vote !== undefined;
  const { rows, total, overall } = voteMap(match);
  const W = 144, H = 56;
  const P = (lat, lon) => [((lon + 180) / 360) * W, ((84 - lat) / 140) * H];
  const dots = WORLD_DOTS.split('|').map((row, y) => {
    let x = 0, land = false, out = '';
    for (const run of row.split('.').map(n => parseInt(n, 16))) {
      if (land) for (let i = 0; i < run; i++) out += `M${x + i + 0.5},${y + 0.5}h0`;
      x += run;
      land = !land;
    }
    return out;
  }).join('');
  const maxV = rows[0].votes;
  const pick = s => s.indexOf(Math.max(...s));
  const bubbles = rows.map(c => {
    const [name, flag, lat, lon] = COUNTRIES[c.code];
    const [x, y] = P(lat, lon);
    const lead = pick(c.split);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.3 + Math.sqrt(c.votes / maxV) * 4.2).toFixed(2)}" class="vm-bubble ${voted ? ['home', 'draw', 'away'][lead] : 'neutral'}"><title>${flag} ${name}: ${fmt(c.votes)} votes${voted ? ` · ${esc(match.home)} ${c.split[0]}% · Draw ${c.split[1]}% · ${esc(match.away)} ${c.split[2]}%` : ''}</title></circle>`;
  }).join('');
  const me = voted && viewerLocation();
  const youPin = me ? (() => { const [x, y] = P(me[0], me[1]); return `<g class="vm-you"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6"/><text x="${(x + 2.4).toFixed(1)}" y="${(y + 1.2).toFixed(1)}">You</text></g>`; })() : '';
  return `
    <div class="card poll-card">
      ${sectionHead('Who will win?', null, `${fmt(total + (voted ? 1 : 0))} votes worldwide`)}
      <div class="poll poll-row">
        ${[0, 1, 2].map(i => `
          <button class="poll-option ${voted && vote === i ? 'voted' : ''}" data-action="vote" data-id="${match.id}" data-choice="${i}" ${voted ? 'disabled' : ''}>
            ${voted ? `<span class="poll-fill ${['home', 'draw', 'away'][i]}" style="height:${overall[i]}%"></span>` : ''}
            <span class="poll-label">${i === 0 ? crest(match.home) : i === 2 ? crest(match.away) : '<span class="draw-x">X</span>'}<small>${i === 0 ? esc(match.home) : i === 2 ? esc(match.away) : 'Draw'}</small></span>
            ${voted ? `<b>${overall[i]}%</b>` : ''}
          </button>`).join('')}
      </div>
      <svg class="vote-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of where votes come from">
        <path d="${dots}" class="vm-land"/>
        ${bubbles}${youPin}
      </svg>
      <p class="vm-top muted">${rows.slice(0, 4).map(c => `${COUNTRIES[c.code][1]} ${Math.round((c.votes / total) * 100)}%`).join(' · ')}${voted ? '' : ' · <b>Vote to see each country’s pick</b>'}</p>
    </div>`;
}

function otherMatchesCard(match) {
  return `
    <div class="card">
      ${sectionHead(leagueOf(match), null, matchDate(match) === dayDate(0) ? 'Today’s results' : `Results · ${dateLabel(matchDate(match))}`)}
      <div class="mini-grid">
        ${MATCHES.filter(m => leagueOf(m) === leagueOf(match) && matchDate(m) === matchDate(match)).map(m => `
          <a class="mini-match ${m.id === match.id ? 'current' : ''}" href="#/match/${m.id}" ${m.id === match.id ? 'aria-current="page"' : ''}>
            <span>${crest(m.home)} ${esc(m.home)}</span><b>${m.score[0]}</b>
            <span>${crest(m.away)} ${esc(m.away)}</span><b>${m.score[1]}</b>
          </a>`).join('')}
      </div>
    </div>`;
}

// ----- Tabs -----

function factsTab(match) {
  const has = !!LINEUPS[match.id];
  return dash([
    stack(momentumCard(match), matchInfoCard(match)), topStatsCard(match), compareCard(match),
    xgRaceCard(match), shotMapCard(match), cell(eventsCard(match), 'row-2'),
    attackingCard(match), passingCard(match),
    cell(pitchCard(match), 'span-2'), has ? stack(topPerformersCard(match), goalReplayCard(match)) : defendingCard(match),
    has ? cell(playersTableCard(match), 'span-3') : '',
    cell(styleCard(match), 'span-2 fit-col'), stack(formCard(match), pollCard(match)),
    cell(otherMatchesCard(match), 'span-3'),
  ]);
}

function statsTab(match) {
  return dash([
    topStatsCard(match), attackingCard(match), passingCard(match),
    defendingCard(match), disciplineCard(match), xgRaceCard(match),
    cell(shotMapCard(match), 'span-2'), physicalCard(match),
    cell(styleCard(match), 'span-3'),
  ]);
}

function playersTab(match) {
  if (!LINEUPS[match.id]) return dash([cell(noLineupCard(match), 'span-3')]);
  return dash([
    compareCard(match), topPerformersCard(match), stack(goalkeepingCard(match), benchImpactCard(match)),
    cell(playersTableCard(match), 'span-3'),
  ]);
}

function lineupTab(match) {
  if (!LINEUPS[match.id]) return dash([cell(noLineupCard(match), 'span-3')]);
  return dash([cell(pitchCard(match), 'span-2'), stack(teamSheetCard(match), topPerformersCard(match))]);
}

function eventsTab(match) {
  return dash([cell(eventsCard(match), 'span-2'), stack(xgRaceCard(match), matchInfoCard(match))]);
}

function tableTab(match) {
  return dash([cell(standingsCard(match), 'span-2'), stack(formCard(match), otherMatchesCard(match))]);
}

// What on this page is real and what is estimated.
function provenance(match) {
  const d = details(match);
  const names = { possession: 'possession', shots: 'shots', onTarget: 'shots on target', corners: 'corners', fouls: 'fouls', xg: 'xG', passes: 'passes', boxTouches: 'box touches', bigChances: 'big chances' };
  const real = d.lineup ? ['score', 'lineups', 'goals', 'cards & subs', ...d.realStats.map(k => names[k] || k)] : ['score'];
  if (d.lineup && !d.attendanceEstimated) real.push('attendance');
  const est = [];
  if (!d.realStats.includes('xg')) est.push('xG (from shots)');
  if (!d.realStats.includes('passes')) est.push('passing');
  est.push('player ratings', 'physical & pressing data');
  if (d.attendanceEstimated) est.push('attendance');
  return `<p class="provenance"><span><b>Real:</b> ${real.join(', ')}</span><span><b>Estimated:</b> ${est.join(', ')}</span></p>`;
}

// The real league table that came with an ESPN match summary.
function espnTableCard(match, rows) {
  return `
    <div class="card">
      ${sectionHead(leagueOf(match))}
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>
            ${rows.map((t, i) => `
              <tr class="${t.team === match.home || t.team === match.away ? 'highlight' : ''}">
                <td><span class="pos">${t.rank || i + 1}</span></td>
                <td class="team-cell">${CLUB_LOGOS[t.team] ? crest(t.team) : `<img class="crest crest-sm" src="https://a.espncdn.com/i/teamlogos/soccer/500/${esc(t.id)}.png" alt="" loading="lazy">`} ${esc(t.team)}</td>
                <td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
                <td>${t.gd > 0 ? '+' : ''}${t.gd}</td><td><b>${t.pts}</b></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="legend muted">Source: ESPN</p>
    </div>`;
}

function renderMatch(id, tab) {
  const match = findMatch(id);
  if (!match && parseEspnId(id)) {
    // A live score or result from ESPN: load its summary, then render the page.
    app.innerHTML = `<div class="detail"><div class="card match-header"><div class="match-top"><a class="pill" href="#">❮ Matches</a></div><p class="meta espn-status">Loading the match from ESPN…</p></div></div>`;
    loadEspnMatch(id).then(() => { const r = route(); if (r && r.id === id) render(); })
      .catch(err => { const el = app.querySelector('.espn-status'); if (el) el.textContent = `Couldn't load this match from ESPN (${err.message}).`; });
    return;
  }
  if (!match) { location.hash = ''; return; }
  if (match.espn && match.state === 'pre') { renderPreview(match, tab); return; }
  const fav = state.favs.includes(match.id);
  const d = details(match);
  const [h, a] = analytics(match).teams;
  const kickoff = new Date(`${matchDate(match)}T12:00:00`).toLocaleDateString('en', { weekday: 'short', month: 'long', day: 'numeric' });
  const content = { Facts: factsTab, Stats: statsTab, Players: playersTab, Lineup: lineupTab, Events: eventsTab, Table: tableTab }[tab](match);
  document.title = `${match.home} ${match.score[0]}-${match.score[1]} ${match.away} | TDsports`;
  app.innerHTML = `
    <div class="detail">
      <div class="card match-header">
        <div class="match-top">
          <a class="pill" href="#">❮ Matches</a>
          <span class="competition"><img class="league-logo" src="${(LEAGUES.find(l => l.name === leagueOf(match)) || LEAGUES[1]).logo}" alt=""> ${esc(match.competition || COMPETITION.league)} · ${esc(match.round || COMPETITION.round)}${match.sample ? '<span class="sample-badge" title="This fixture could not be verified; its data is illustrative">Sample fixture</span>' : ''}</span>
          <button class="follow ${fav ? 'following' : ''}" data-action="fav" data-id="${match.id}" aria-pressed="${fav}">${fav ? 'Following ✓' : 'Follow'}</button>
        </div>
        <p class="meta">${kickoff}, ${match.kickoff}${d.venue ? ` · ${esc(d.venue.name)}` : ''}${match.tv ? ` · 📺 ${esc(match.tv)}` : ''}</p>
        <div class="scoreboard">
          <div class="teamname home">${esc(match.home)} ${crest(match.home, 'lg')}</div>
          <div class="bigscore">${match.score[0]} - ${match.score[1]}<small class="${match.state === 'in' ? 'live-status' : ''}">${esc(match.statusText || 'Full time')}</small></div>
          <div class="teamname away">${crest(match.away, 'lg')} ${esc(match.away)}</div>
        </div>
        <div class="scorers"><span>${scorers(match, 'home')}</span><span class="ball">⚽</span><span>${scorers(match, 'away')}</span></div>
        <div class="keystrip">
          ${[['xG', h.xg.toFixed(2), a.xg.toFixed(2)], ['Possession', `${h.possession}%`, `${a.possession}%`], ['Shots', `${h.shots} (${h.onTarget})`, `${a.shots} (${a.onTarget})`], ['Big chances', h.bigChances, a.bigChances], ['Pass accuracy', `${pct(h.passesAcc, h.passesAtt)}%`, `${pct(a.passesAcc, a.passesAtt)}%`], ['Field tilt', `${h.fieldTilt}%`, `${a.fieldTilt}%`], ['PPDA', h.ppda, a.ppda], ['Distance', `${h.distance} km`, `${a.distance} km`]]
            .map(([k, hv, av]) => `<div class="key-item"><span class="muted">${k}</span><b>${hv} <span class="muted">–</span> ${av}</b></div>`).join('')}
        </div>
        ${provenance(match)}
        <nav class="tabs" aria-label="Match sections">
          ${TABS.map(t => `<a class="tab ${tab === t ? 'active' : ''}" href="#/match/${match.id}/${t.toLowerCase()}" ${tab === t ? 'aria-current="page"' : ''}>${t}</a>`).join('')}
        </nav>
      </div>
      <div id="detail-content">${content}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

const overlay = $('#overlay');
let lastFocus = null;

function openModal(html, label, extraClass = '') {
  if (!overlay.innerHTML) lastFocus = document.activeElement;
  overlay.innerHTML = `
    <div class="modal-back" data-action="close-backdrop">
      <section class="modal ${extraClass}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <button class="modal-close" data-action="close" aria-label="Close">✕</button>
        ${html}
      </section>
    </div>`;
  document.body.classList.add('modal-open');
  $('.modal', overlay).focus({ preventScroll: true });
  ($('.modal [autofocus]', overlay) || $('.modal-close', overlay)).focus();
}

function closeModal() {
  if (!overlay.innerHTML) return;
  overlay.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function info(title, bodyHtml) {
  openModal(`<div class="modal-body"><h2>${esc(title)}</h2>${bodyHtml}<button class="green" data-action="close">Done</button></div>`, title);
}

function heatmap(p) {
  // Draw the heatmap with both sides attacking left to right.
  const x = p.side === 'away' ? 100 - p.x : p.x;
  const y = p.side === 'away' ? 100 - p.y : p.y;
  const r = rng('heat-' + p.id);
  const blobs = Array.from({ length: 4 }, (_, i) => {
    const bx = Math.max(4, Math.min(96, x + (r() - 0.4) * (i ? 34 : 10)));
    const by = Math.max(6, Math.min(94, y + (r() - 0.5) * (i ? 40 : 12)));
    const s = i ? 10 + r() * 8 : 16;
    return `radial-gradient(ellipse ${s * 1.3}% ${s * 1.6}% at ${bx}% ${by}%, #ff5a1f, #ffd23599 40%, #6ee39255 70%, transparent)`;
  });
  return blobs.join(',');
}

// Percentile of a player's per-90 value among outfield players in the match with 30+ minutes.
function percentile(players, p, key) {
  const pool = players.filter(q => q.minutes >= 30 && q.group !== 'GK');
  const val = q => (key === 'passPct' ? pct(q.passesAcc, q.passesAtt)
    : key === 'duelPct' ? pct(q.duelsWon, q.duels)
    : key === 'defActions' ? ((q.tackles + q.interceptions) * 90) / q.minutes
    : ((q[key] || 0) * 90) / q.minutes);
  const mine = val(p);
  return Math.round((pool.filter(q => val(q) < mine).length + 0.5 * pool.filter(q => val(q) === mine).length) / pool.length * 100);
}

function playerModal(id, matchId) {
  const match = findMatch(matchId);
  const { players } = analytics(match);
  const idx = players.findIndex(p => p.id === id);
  const p = players[idx];
  const person = PEOPLE[id];
  const people = lineupPeople(match);
  const team = p.side === 'home' ? match.home : match.away;
  const played = p.minutes > 0;
  const ms = playerMatchStats(match, id);
  const spot = people.find(q => q.id === id);
  const pos = spot.x !== undefined ? spot : { ...(people.find(q => q.id === (ms.subOn && ms.subOn.detail)) || { x: 50, y: 50 }), id, side: p.side };
  const prev = players[(idx + players.length - 1) % players.length].id;
  const next = players[(idx + 1) % players.length].id;

  const groups = !played ? [] : p.pos === 'GK' ? [
    ['Goalkeeping', [['Saves', p.saves], ['Goals conceded', p.goalsConceded], ['xGOT faced', (p.xgotFaced || 0).toFixed(2)], ['Goals prevented', `${p.goalsPrevented > 0 ? '+' : ''}${p.goalsPrevented.toFixed(2)}`]]],
    ['Distribution', [['Accurate passes', `${p.passesAcc}/${p.passesAtt} (${pct(p.passesAcc, p.passesAtt)}%)`], ['Long balls', `${p.longAcc}/${p.longAtt}`], ['Clearances', p.clearances], ['Recoveries', p.recoveries]]],
  ] : [
    ['Attacking', [['Goals', p.goals], ['Assists', p.assists], ['Expected goals (xG)', p.xg.toFixed(2)], ['xG on target (xGOT)', p.xgot.toFixed(2)], ['Shots (on target)', `${p.shots} (${p.onTarget})`], ['Touches in opposition box', p.touchesBox], ['Successful dribbles', `${p.dribblesWon}/${p.dribbles}`]]],
    ['Passing', [['Expected assists (xA)', p.xa.toFixed(2)], ['Key passes', p.keyPasses], ['Accurate passes', `${p.passesAcc}/${p.passesAtt} (${pct(p.passesAcc, p.passesAtt)}%)`], ['Progressive passes', p.progPasses], ['Progressive carries', p.progCarries], ['Long balls', `${p.longAcc}/${p.longAtt}`], ['Crosses', `${p.crossesAcc}/${p.crossesAtt}`]]],
    ['Defending', [['Tackles won', p.tackles], ['Interceptions', p.interceptions], ['Clearances', p.clearances], ['Blocks', p.blocks], ['Recoveries', p.recoveries], ['Duels won', `${p.duelsWon}/${p.duels}`], ['Aerial duels won', `${p.aerialsWon}/${p.aerials}`], ['Fouls committed', p.fouls]]],
    ['Physical', [['Distance covered', `${p.distance} km`], ['Sprints', p.sprints], ['High-intensity runs', p.hiRuns], ['Top speed', `${p.topSpeed} km/h`]]],
  ];
  const bars = played && p.pos !== 'GK' ? [
    ['xG', 'xg'], ['xA', 'xa'], ['Key passes', 'keyPasses'], ['Progressive passes', 'progPasses'], ['Progressive carries', 'progCarries'],
    ['Pass accuracy', 'passPct'], ['Tackles won', 'tackles'], ['Duel success', 'duelPct'], ['Recoveries', 'recoveries'], ['Distance', 'distance'],
  ].map(([label, key]) => {
    const v = percentile(players, p, key);
    return `<div class="pctl"><span>${label}</span><span class="pctl-bar"><i class="${v >= 70 ? 'hi' : v >= 40 ? 'mid' : 'lo'}" style="width:${Math.max(v, 3)}%"></i></span><b>${v}</b></div>`;
  }).join('') : '';

  openModal(`
    <div class="profile-head ${p.side}">
      <div class="profile-nav">
        <button class="circle" data-action="player" data-id="${prev}" data-match="${match.id}" aria-label="Previous player">❮</button>
        ${avatar(id, 'xl')}
        <button class="circle" data-action="player" data-id="${next}" data-match="${match.id}" aria-label="Next player" autofocus>❯</button>
      </div>
      <h2>${esc(person.name)} ${p.rating ? `<span class="badge ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</span>` : ''}</h2>
      <div class="profile-info">
        <span><b>${person.pos}</b><small class="muted block">Position</small></span>
        <span><b>${crest(team)} ${esc(team)}</b><small class="muted block">Team</small></span>
        <span><b>${played ? `${p.minutes}′` : '–'}</b><small class="muted block">${p.sub && played ? `On at ${p.start}′` : 'Played'}</small></span>
      </div>
    </div>
    ${marketSection(id)}
    ${played ? `
      <div class="modal-cols">
        <div>
          <h3 class="modal-h">Heatmap <span class="muted">Attacking →</span></h3>
          <div class="heat" style="background-image:${heatmap(pos)}"></div>
          ${bars ? `<h3 class="modal-h">Percentile rank <span class="muted">per 90, vs players in this match</span></h3><div class="pctls">${bars}</div>` : ''}
        </div>
        <div>
          ${groups.map(([title, rows]) => `<h3 class="modal-h">${title}</h3>${rows.map(([k, v]) => `<div class="statrow"><span>${k}</span><b>${v}</b></div>`).join('')}`).join('')}
        </div>
      </div>`
    : '<p class="empty">Unused substitute — no match data.</p>'}
    <p class="muted modal-note">Sample ratings and stats.</p>`, `${person.name} match statistics`, 'wide-xl');
}

function coachModal(id) {
  const c = PEOPLE[id];
  info(c.name, `<div class="center">${avatar(id, 'xl')}</div><p class="center muted">Head coach</p>${COACH_NOTES[id] ? `<p class="center">${esc(COACH_NOTES[id])}</p>` : ''}`);
}

function newsModal(i) {
  const n = NEWS[i];
  openModal(`
    <img class="article-photo" src="${n.photo}" alt="${esc(n.alt)}">
    <div class="modal-body">
      <p class="muted">TDsports · ${n.hoursAgo} hr. ago</p>
      <h2>${esc(n.title)}</h2>
      <p>Explore match statistics, expected goals, player ratings and lineups to see the story behind the score. Select a match to start exploring.</p>
      <p class="muted small">This is a demonstration article. ${photoCredit(n.photo)}</p>
      <a class="green" href="#/match/${MATCHES[0].id}" data-action="close">Open Lille vs Galatasaray</a>
    </div>`, n.title, 'wide');
}

// The researched venue for this match (neutral grounds, temporary homes), falling back to
// the home club's ground. The club's photo and capacity are kept when it's the same stadium.
function matchVenue(match, lineup) {
  const home = VENUES[match.home];
  const lv = lineup && lineup.venue && lineup.venue.name ? lineup.venue : null;
  if (!lv) return home;
  const words = s => new Set(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !/^(stadi|estadi|stade|arena)/.test(w)));
  const a = words(lv.name), same = home && [...words(home.name)].some(w => a.has(w));
  return { ...(same ? home : {}), ...lv, city: lv.city || (same ? home.city : '') };
}

function photoCredit(path) {
  const entry = PHOTO_CREDITS.find(c => c[0] === path);
  if (!entry) return '';
  const [, , author, license, url] = entry;
  return `Photo: ${esc(author)} · <a href="${url}" target="_blank" rel="noopener">${esc(license)}</a>, via Wikimedia Commons`;
}

function creditsModal() {
  info('Image credits', `
    <p class="muted">Photos listed below are from Wikimedia Commons under the licenses shown. Other player and coach headshots are linked from <a href="https://www.fotmob.com" target="_blank" rel="noopener">FotMob</a> and belong to their owners. Club and competition logos are from ESPN's public logo CDN and belong to their respective owners.</p>
    <ul class="credits">
      ${PHOTO_CREDITS.map(([, subject, author, license, url]) => `
        <li><a href="${url}" target="_blank" rel="noopener">${esc(subject)}</a><span class="muted">${esc(author)} · ${esc(license)}</span></li>`).join('')}
    </ul>`);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const searchInput = $('#search');
const searchResults = $('#search-results');
const teams = [...new Set(MATCHES.flatMap(m => [m.home, m.away]))].sort();

// The match whose lineup (or bench) includes this person.
function matchOfPerson(id) {
  for (const [mid, L] of Object.entries(LINEUPS)) {
    if ([...L.home, ...L.away, ...L.homeSubs, ...L.awaySubs].some(p => p[0] === id) || L.coaches.includes(id)) return mid;
  }
  return MATCHES[0].id;
}

function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { hideSearch(); return; }
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ı/g, 'i');
  const nq = norm(q);
  const people = Object.entries(PEOPLE).filter(([, p]) => norm(p.name).includes(nq)).slice(0, 6);
  const clubs = teams.filter(t => norm(t).includes(nq)).slice(0, 5);
  const items = [
    ...people.map(([id, p]) => `<button class="result" role="option" data-action="${p.pos === 'Coach' ? 'coach' : 'player'}" data-id="${id}" data-match="${matchOfPerson(id)}">${avatar(id, 'sm')}<span>${esc(p.name)}<small class="muted block">${p.pos === 'Coach' ? 'Coach' : `Player · ${p.pos}`}</small></span></button>`),
    ...clubs.map(t => {
      const m = MATCHES.find(x => x.home === t || x.away === t);
      return `<a class="result" role="option" href="#/match/${m.id}">${crest(t)}<span>${esc(t)}<small class="muted block">${esc(m.home)} ${m.score[0]} - ${m.score[1]} ${esc(m.away)}</small></span></a>`;
    }),
  ];
  searchResults.innerHTML = items.length ? items.join('') : '<p class="muted result-empty">No matching players or teams</p>';
  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

function hideSearch() {
  searchResults.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
}

searchInput.addEventListener('input', runSearch);
searchInput.addEventListener('focus', runSearch);
searchInput.addEventListener('keydown', e => {
  const options = [...searchResults.querySelectorAll('.result')];
  if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); options[0].focus(); }
  if (e.key === 'Enter' && options.length) { e.preventDefault(); options[0].click(); }
  if (e.key === 'Escape') { searchInput.value = ''; hideSearch(); }
});
searchResults.addEventListener('keydown', e => {
  const options = [...searchResults.querySelectorAll('.result')];
  const i = options.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); (options[i + 1] || options[0]).focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); i > 0 ? options[i - 1].focus() : searchInput.focus(); }
  if (e.key === 'Escape') { hideSearch(); searchInput.focus(); }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) hideSearch();
  else if (e.target.closest('.result')) { hideSearch(); searchInput.value = ''; }
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#theme-toggle');
  btn.textContent = theme === 'dark' ? '☀' : '☾';
  btn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
}
applyTheme(store.get('tdsports-theme', store.get('popouts-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')));

// ---------------------------------------------------------------------------
// Actions (event delegation)
// ---------------------------------------------------------------------------

const actions = {
  fav(el) {
    const id = el.dataset.id;
    state.favs = state.favs.includes(id) ? state.favs.filter(x => x !== id) : [...state.favs, id];
    store.set('tdsports-favs', state.favs);
    render();
  },
  league(el) { state.league = el.dataset.league || COMPETITION.league; closeModal(); render(); },
  'all-leagues'() {
    info('All leagues', `<div class="league-list">${LEAGUES.map(l => `
      <button class="league ${l.name === state.league ? 'active' : ''}" data-action="league" data-league="${esc(l.name)}">
        <img class="league-logo" src="${l.logo}" alt="">${esc(l.name)}<span class="muted" style="margin-left:auto">${esc(l.country)}</span>
      </button>`).join('')}</div>`);
  },
  day(el) { state.day += Number(el.dataset.delta); render(); },
  today() { state.day = 0; render(); },
  toggle(el) { state[el.dataset.key] = !state[el.dataset.key]; render(); },
  'clear-filters'() { Object.assign(state, { live: false, tv: false, favsOnly: false, query: '' }); render(); },
  player(el) { hideSearch(); playerModal(el.dataset.id, el.dataset.match); },
  coach(el) { hideSearch(); coachModal(el.dataset.id); },
  news(el) { newsModal(Number(el.dataset.index)); },
  'news-nav'() { location.hash = '#/news'; },
  'news-league'(el) { state.newsLeague = state.newsLeague === el.dataset.value ? '' : el.dataset.value; newsShown = NEWS_PAGE; render(); },
  'news-source'(el) { state.newsSource = state.newsSource === el.dataset.value ? '' : el.dataset.value; newsShown = NEWS_PAGE; render(); },
  'news-club'(el) { state.newsClub = state.newsClub === el.dataset.club ? '' : el.dataset.club; newsShown = NEWS_PAGE; if (route().view === 'news') { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } else location.hash = '#/news'; },
  'news-query-clear'() { state.newsQuery = ''; newsShown = NEWS_PAGE; render(); },
  'news-more'() { newsShown += NEWS_PAGE; render(); },
  'news-reset'() { Object.assign(state, { newsLeague: '', newsSource: '', newsClub: '', newsQuery: '' }); newsShown = NEWS_PAGE; render(); },
  tv() { location.hash = '#/tv'; },
  'tv-day'(el) { state.tvDay = el.dataset.value; render(); },
  'tv-league'(el) { state.tvLeague = state.tvLeague === el.dataset.value ? '' : el.dataset.value; render(); },
  'tv-channel'(el) { state.tvChannel = state.tvChannel === el.dataset.value ? '' : el.dataset.value; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'tv-reset'() { Object.assign(state, { tvLeague: '', tvChannel: '' }); render(); },
  credits: creditsModal,
  'past-more'() { state.pastDays = (state.pastDays || 5) + 5; const box = $('#past'); if (box) { box.innerHTML = pastResults(); fitSidebars(); } },
  api() { location.hash = '#/api'; },
  'api-try'(el) { apiTry(el); },
  'api-copy'(el) { apiCopy(el); },
  'api-copy-url'(el) { apiCopy(el); },
  'api-first'(el, e) { const h = $('#api-first'); if (h) { e.preventDefault(); h.scrollIntoView({ behavior: 'smooth' }); } },
  'api-lang'(el) { state.apiLang = el.dataset.value; render(); },
  theme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('tdsports-theme', next);
    applyTheme(next);
  },
  vote(el) {
    state.votes[el.dataset.id] = Number(el.dataset.choice);
    store.set('tdsports-votes', state.votes);
    render();
  },
  table(el) {
    state.table[el.dataset.key] = el.dataset.value;
    render();
  },
  'table-sort'(el) {
    const t = state.table;
    t.dir = t.sort === el.dataset.key ? -t.dir : -1;
    t.sort = el.dataset.key;
    render();
  },
  'style-rows'() { state.styleRowsExpanded = !state.styleRowsExpanded; render(); },
  'shape-phase'(el) { setShapePhase(el.dataset.value); },
  'style-tab'(el) { state.styleTab = el.dataset.value; render(); },
  'style-team'(el) { state.styleTeam = el.dataset.value; render(); },
  'table-per90'(el) { state.table.per90 = el.checked; render(); },
  'export-csv'(el) { exportCsv(findMatch(el.dataset.match)); },
  home() { location.hash = ''; },
  close: closeModal,
  'close-backdrop'(el, e) { if (e.target === el) closeModal(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  actions[el.dataset.action](el, e);
});

app.addEventListener('input', e => {
  if (e.target.id === 'api-filter' || e.target.dataset.param) {
    if (e.target.id === 'api-filter') state.apiFilter = e.target.value;
    else (apiParams[e.target.dataset.page] ||= {})[e.target.dataset.param] = e.target.value;
    const sel = e.target.id === 'api-filter' ? '#api-filter' : `[data-param="${e.target.dataset.param}"]`;
    const pos = e.target.selectionStart;
    render();
    const input = $(sel);
    input.focus();
    input.setSelectionRange(pos, pos);
    return;
  }
  if (e.target.id === 'news-search') {
    state.newsQuery = e.target.value;
    newsShown = NEWS_PAGE;
    const pos = e.target.selectionStart;
    render();
    const input = $('#news-search');
    input.focus();
    input.setSelectionRange(pos, pos);
    return;
  }
  if (e.target.id !== 'filter') return;
  state.query = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const input = $('#filter');
  input.focus();
  input.setSelectionRange(pos, pos);
});
app.addEventListener('change', e => {
  if (e.target.id === 'sort') { state.sort = e.target.value; render(); $('#sort').focus(); }
  if ('heatScope' in e.target.dataset) { state.heatScope = e.target.value; render(); $('[data-heat-scope]').focus(); return; }
  if (e.target.dataset.compare) {
    const { match: id, compare: i } = e.target.dataset;
    const current = [...$$('.compare-select')].map(s => s.value);
    current[i] = e.target.value;
    state.compare[id] = current;
    render();
    $(`.compare-select[data-compare="${i}"]`).focus();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && overlay.innerHTML) closeModal();
  if (e.key === 'Tab' && overlay.innerHTML) {
    // Keep focus inside the open dialog.
    const focusable = [...overlay.querySelectorAll('button:not([disabled]), a[href], input, select')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && !overlay.innerHTML) { e.preventDefault(); searchInput.focus(); }
});

// ---------------------------------------------------------------------------
// Routing: #/match/<id>/<tab>
// ---------------------------------------------------------------------------

function route() {
  const hash = location.hash;
  const legacy = hash.match(/^#match-(\d+)$/);
  if (legacy) { location.replace(`#/match/${(MATCHES[legacy[1]] || MATCHES[0]).id}`); return null; }
  const m = hash.match(/^#\/match\/([\w-]+)(?:\/(\w+))?/);
  const api = hash.match(/^#\/api(?:\/([\w-]+))?$/);
  if (api) return { view: 'api', page: api[1] || '' };
  if (hash === '#/news') return { view: 'news' };
  if (hash === '#/tv') return { view: 'tv' };
  if (!m) return { view: 'home' };
  const tab = TABS.find(t => t.toLowerCase() === (m[2] || 'facts')) || 'Facts';
  return { view: 'match', id: m[1], tab };
}

let lastView = '';
function render() {
  const r = route();
  if (!r) return;
  if (r.view === 'home') renderHome();
  else if (r.view === 'api') renderApi(r.page);
  else if (r.view === 'news') renderNews();
  else if (r.view === 'tv') renderTv();
  else renderMatch(r.id, r.tab);
  mountReplay();
  fitStyleRows();
  fitSidebars();
  mountStyleReview();
  const key = r.view === 'match' ? r.id : r.view === 'api' ? `api/${r.page}` : r.view;
  // Scroll to the top when moving to another page, but not on the first render, so a
  // reload keeps the browser's restored scroll position.
  if (lastView && key !== lastView) window.scrollTo(0, 0);
  lastView = key;
  saveView();
}

window.addEventListener('hashchange', () => { closeModal(); render(); });
render();
