// Match pages for live scores and results that aren't in the researched data.
// Clicking one in "Live now" or "Earlier results" opens #/match/espn-<league>-<event id>.
// The page loads ESPN's public match summary (lineups, formations, goals, cards,
// substitutions, team stats, venue and the league table), turns it into the same shape as
// the researched matches and renders the usual Facts, Stats, Players, Lineup, Events and
// Table tabs. Live matches are refreshed every 60 seconds while the page is open.
// Player ratings and the detailed per-player stats are sample values, as elsewhere.

const PREDICTED = {};         // "<match id>-pred" -> predicted match for an upcoming fixture
const ESPN_TABLES = {};       // match id -> [{ team, id, p, w, d, l, gd, pts, rank }]
const espnLoading = {};       // match id -> pending Promise

const espnMatchId = (code, eventId) => `espn-${code.replace('.', '_')}-${eventId}`;
const parseEspnId = id => { const m = id.match(/^espn-([a-z]+_[a-z0-9]+)-(\d+)$/); return m && { code: m[1].replace('_', '.'), event: m[2] }; };

// A feed event links to the researched match when the app has one for the same teams and
// day, otherwise to the ESPN-built page.
function feedHref(code, e) {
  const day = isoDay(new Date(e.start));
  const ours = MATCHES.find(m => m.home === e.home.name && m.away === e.away.name && matchDate(m) === day && !m.espn);
  return ours ? `#/match/${ours.id}` : code ? `#/match/${espnMatchId(code, e.id)}` : null;
}

// ESPN position abbreviations -> the app's positions, depth (own goal -> attack) and side.
function espnPosition(abbr) {
  const a = (abbr || '').toUpperCase();
  // 0 = right touchline ... 4 = left touchline (CD-R and AM-R sit inside RB and RW).
  const side = /^R/.test(a) ? 0 : /-R$/.test(a) ? 1 : /-L$/.test(a) ? 3 : /^L/.test(a) ? 4 : 2;
  if (a === 'G' || a === 'GK') return { pos: 'GK', depth: 0, side };
  if (/^(CD|CB)/.test(a)) return { pos: 'CB', depth: 1, side };
  if (/^[LR]B$/.test(a)) return { pos: side > 2 ? 'LB' : 'RB', depth: 1, side };
  if (/WB$/.test(a)) return { pos: side > 2 ? 'LB' : 'RB', depth: 1.5, side };
  if (/^(DM|CDM)/.test(a)) return { pos: 'DM', depth: 2, side };
  if (/^AM-?[LR]$|^[LR]W$/.test(a)) return { pos: side > 2 ? 'LW' : 'RW', depth: 4, side };
  if (/^(AM|CAM)/.test(a)) return { pos: 'AM', depth: 4, side };
  if (/^(F|CF|ST|S)/.test(a)) return { pos: 'ST', depth: 5, side };
  return { pos: 'CM', depth: 3, side }; // M, CM, LM, RM
}

const lineYs = k => ({ 1: [50], 2: [30, 70], 3: [23, 50, 78], 4: [12, 38, 64, 88], 5: [8, 29, 50, 71, 92] })[k]
  || Array.from({ length: k }, (_, i) => Math.round(8 + i * 84 / (k - 1)));

// Pitch spots for a starting eleven (home attacking left to right, its left side at the
// bottom), using the formation's lines and each player's position.
function espnSpots(starters, formation) {
  const gk = starters.find(p => p.role.pos === 'GK') || starters[0];
  const outfield = starters.filter(p => p !== gk).sort((a, b) => a.role.depth - b.role.depth || a.place - b.place);
  let lines = (formation || '').split('-').map(Number).filter(n => n > 0);
  if (lines.reduce((s, n) => s + n, 0) !== outfield.length) lines = outfield.length === 10 ? [4, 3, 3] : [outfield.length];
  const xs = lines.length === 1 ? [18] : lines.map((_, i) => Math.round(18 + i * (46 - 18) / (lines.length - 1)));
  const spots = [[gk, 5, 50]];
  let i = 0;
  lines.forEach((k, li) => {
    const line = outfield.slice(i, i + k).sort((a, b) => a.role.side - b.role.side);
    lineYs(k).forEach((y, j) => line[j] && spots.push([line[j], xs[li], y]));
    i += k;
  });
  return spots;
}

const minuteOf = ev => parseInt((ev.clock && ev.clock.displayValue) || '0', 10) || 0;

// Turn an ESPN summary into a MATCHES entry, PEOPLE and a LINEUPS entry.
function addEspnMatch(id, code, s) {
  const comp = s.header.competitions[0];
  const sideOf = h => comp.competitors.find(c => c.homeAway === h);
  const team = h => sideOf(h).team.shortDisplayName || sideOf(h).team.displayName;
  const home = team('home'), away = team('away');
  const teamSide = {};
  for (const h of ['home', 'away']) {
    const c = sideOf(h);
    teamSide[c.team.id] = h;
    const logo = (c.team.logos || [])[0];
    if (logo && !CLUB_LOGOS[team(h)]) CLUB_LOGOS[team(h)] = logo.href;
  }
  const score = [+sideOf('home').score || 0, +sideOf('away').score || 0];
  const status = comp.status.type;
  const league = (LIVE_LEAGUES.find(([c]) => c === code) || [])[1] || s.header.league.name;
  const start = new Date(comp.date);

  // People: ESPN athlete ids keep them unique; reuse a researched photo for the same name.
  const photoFor = name => { const p = Object.values(PEOPLE).find(x => x.photo && x.name === name); return p && p.photo; };
  const person = (athlete, pos) => {
    const pid = 'espn-' + athlete.id;
    if (!PEOPLE[pid]) {
      const name = athlete.displayName;
      PEOPLE[pid] = { name, short: athlete.lastName || name.split(' ').slice(-1)[0], pos };
      const photo = photoFor(name);
      if (photo) PEOPLE[pid].photo = photo;
    }
    return pid;
  };

  const L = { formations: ['', ''], coaches: [null, null], home: [], away: [], homeSubs: [], awaySubs: [], events: [], goalShots: {}, goalInfo: {}, stats: {}, researched: true };
  const byAthlete = {};
  for (const r of s.rosters || []) {
    const h = r.homeAway;
    L.formations[h === 'home' ? 0 : 1] = r.formation || '';
    const roster = (r.roster || []).map(p => ({ p, role: espnPosition(p.position && p.position.abbreviation), place: +p.formationPlace || 99 }));
    const starters = roster.filter(x => x.p.starter);
    // Before lineups are announced the roster is empty (or has no starters).
    for (const [x, px, py] of starters.length ? espnSpots(starters, r.formation) : []) {
      const pid = person(x.p.athlete, x.role.pos);
      byAthlete[x.p.athlete.id] = pid;
      L[h].push(h === 'home' ? [pid, px, py] : [pid, 100 - px, 100 - py]);
    }
    roster.filter(x => !x.p.starter).forEach(x => {
      byAthlete[x.p.athlete.id] = person(x.p.athlete, x.role.pos === 'GK' ? 'GK' : 'CM');
    });
  }
  // ESPN's summary has no coaches: reuse the coach from a researched match of the same club.
  const knownCoach = name => {
    for (const m of MATCHES) {
      const R = !m.espn && LINEUPS[m.id];
      if (R && R.coaches && (m.home === name || m.away === name)) return R.coaches[m.home === name ? 0 : 1];
    }
    return null;
  };
  L.coaches = ['home', 'away'].map(h => {
    const known = knownCoach(team(h));
    if (known) return known;
    const cid = `${id}-coach-${h}`;
    PEOPLE[cid] = { name: `${team(h)} coach`, short: 'Coach', pos: 'Coach' };
    return cid;
  });

  // Events in time order, with the running score on goals.
  let hs = 0, as = 0;
  const subsIn = { home: [], away: [] };
  const who = ev => (ev.participants || []).map(x => byAthlete[x.athlete.id] || person(x.athlete, 'CM'));
  for (const ev of [...(s.keyEvents || [])].sort((a, b) => minuteOf(a) - minuteOf(b))) {
    const side = ev.team && teamSide[ev.team.id];
    const type = ev.type.type || '';
    const min = minuteOf(ev);
    if (!side) continue;
    if (type.startsWith('goal') || type === 'own-goal' || type.startsWith('penalty---scored')) {
      const own = /own/.test(type) || /own goal/i.test(ev.text || '');
      // ESPN's team on an own goal is the team that benefits.
      if (side === 'home') hs++; else as++;
      const [scorer, assist] = who(ev);
      const e = [min, own ? 'owngoal' : 'goal', side, scorer, `${hs} - ${as}`];
      const pen = /penalty/.test(type) || /penalty/i.test(ev.text || '');
      if (pen) e.push('pen');
      L.events.push(e);
      if (!own && ev.fieldPositionX != null) L.goalShots[min] = [Math.round(ev.fieldPositionX), Math.round(100 - ev.fieldPositionY), /header/.test(type)];
      L.goalInfo[min] = { assist: own ? null : assist || null, type: pen ? 'penalty' : 'build', foot: /header/.test(type) ? 'header' : null, description: ev.text || '', penalty: pen, ownGoal: own };
    } else if (type === 'substitution') {
      const [on, off] = who(ev);
      if (on && off) { L.events.push([min, 'sub', side, on, off]); subsIn[side].push(on); PEOPLE[on].pos = PEOPLE[off].pos; }
    } else if (type === 'yellow-card' || type === 'red-card') {
      const [p] = who(ev);
      if (p) L.events.push([min, type === 'yellow-card' ? 'yellow' : 'red', side, p, type === 'yellow-card' ? 'Foul' : 'Sent off']);
    }
  }

  // Sample ratings (as for the researched matches), nudged by goals, assists and cards.
  const seeded = key => { let h = 2166136261; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
  const rating = (pid, side) => {
    let r = 6.1 + seeded(pid + id) * 1.4;
    r += 0.9 * L.events.filter(e => e[3] === pid && e[1] === 'goal').length;
    r += 0.5 * Object.values(L.goalInfo).filter(g => g.assist === pid).length;
    r -= 0.8 * L.events.filter(e => e[3] === pid && e[1] === 'owngoal').length;
    r -= 1.0 * L.events.filter(e => e[3] === pid && e[1] === 'red').length;
    if (side === 'home' ? score[0] > score[1] : score[1] > score[0]) r += 0.2;
    return Math.round(Math.max(4.5, Math.min(9.6, r)) * 10) / 10;
  };
  for (const h of ['home', 'away']) {
    L[h] = L[h].map(([pid, x, y]) => [pid, x, y, rating(pid, h)]);
    const r = (s.rosters || []).find(x => x.homeAway === h);
    const unused = r && r.roster ? r.roster.filter(p => !p.starter).map(p => byAthlete[p.athlete.id]).filter(pid => !subsIn[h].includes(pid)) : [];
    L[h + 'Subs'] = [...subsIn[h].map(pid => [pid, rating(pid, h)]), ...unused.map(pid => [pid])];
  }

  // Team stats.
  const stat = (h, name) => {
    const t = ((s.boxscore && s.boxscore.teams) || []).find(x => x.homeAway === h || teamSide[x.team.id] === h);
    const v = t && (t.statistics || []).find(x => x.name === name);
    return v ? parseFloat(v.displayValue) : null;
  };
  for (const [key, name] of [['shots', 'totalShots'], ['onTarget', 'shotsOnTarget'], ['corners', 'wonCorners'], ['fouls', 'foulsCommitted']]) {
    const v = [stat('home', name), stat('away', name)];
    if (v.every(x => x != null && !isNaN(x))) L.stats[key] = v;
  }
  const poss = stat('home', 'possessionPct');
  if (poss != null && !isNaN(poss)) L.stats.possession = Math.round(poss);

  const gi = s.gameInfo || {};
  if (gi.venue) L.venue = { name: gi.venue.fullName, city: [gi.venue.address && gi.venue.address.city, gi.venue.address && gi.venue.address.country].filter(Boolean).join(', ') };
  if (gi.attendance) L.attendance = gi.attendance;
  const ref = (gi.officials || []).find(o => /referee/i.test((o.position && o.position.name) || '') || o.order === 1);
  L.referee = ref ? [ref.displayName || ref.fullName, ''] : null;
  L.sources = [`https://www.espn.com/soccer/match/_/gameId/${s.header.id}`];
  L.notes = 'Built live from ESPN\'s match summary. Ratings and detailed player stats are sample values.';
  if (!L.home.length || !L.away.length) { delete L.home; delete L.away; } // no lineups yet
  if (L.home) LINEUPS[id] = L;

  // League table from the summary.
  const group = ((s.standings && s.standings.groups) || []).find(g => (g.standings.entries || []).some(e => teamSide[e.id])) || ((s.standings && s.standings.groups) || [])[0];
  if (group) {
    const v = (e, n) => { const x = e.stats.find(st => st.name === n || st.type === n); return x ? +x.value : 0; };
    ESPN_TABLES[id] = group.standings.entries.map(e => ({
      team: e.team, id: e.id, p: v(e, 'gamesPlayed'), w: v(e, 'wins'), d: v(e, 'ties'), l: v(e, 'losses'),
      gd: v(e, 'pointDifferential'), pts: v(e, 'points'), rank: v(e, 'rank'),
    })).map(r => ({ ...r, team: Object.keys(teamSide).includes(r.id) ? team(teamSide[r.id]) : r.team }))
      .sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.pts - a.pts);
  }

  // Each team's last five matches before this one, from the team's side.
  const form = {};
  for (const t of s.lastFiveGames || []) {
    const h = teamSide[t.team.id];
    if (!h) continue;
    form[h] = (t.events || []).map(g => {
      const atHome = g.atVs !== '@';
      const hs = +g.homeTeamScore || 0, as = +g.awayTeamScore || 0;
      const [f, a] = atHome ? [hs, as] : [as, hs];
      const opp = g.opponent || {};
      return { date: (g.gameDate || '').slice(0, 10), opp: opp.displayName || '?', logo: g.opponentLogo || opp.logo || '', f, a,
        res: (g.gameResult || (f > a ? 'W' : f === a ? 'D' : 'L')).toLowerCase(), comp: g.leagueAbbreviation || g.leagueName || '', venue: atHome ? 'H' : 'A' };
    }).sort((x, y) => y.date.localeCompare(x.date));
  }

  // For predictions: season goals for/against, each side's latest match and team ids.
  const season = {};
  for (const t of (s.boxscore && s.boxscore.teams) || []) {
    const h = teamSide[t.team.id];
    const st = Object.fromEntries((t.statistics || []).map(x => [x.name, parseFloat(x.displayValue)]));
    if (h && !isNaN(st.totalGoals)) season[h] = { gf: st.totalGoals, ga: st.goalsConceded };
  }
  const lastGames = {};
  for (const t of s.lastFiveGames || []) {
    const h = teamSide[t.team.id];
    const latest = [...(t.events || [])].sort((x, y) => String(y.gameDate).localeCompare(String(x.gameDate)))[0];
    if (h && latest) lastGames[h] = latest.id;
  }

  const match = {
    id, espn: true, home, away, score, league, form, season, lastGames, coachIds: L.coaches,
    teamIds: { home: sideOf('home').team.id, away: sideOf('away').team.id },
    date: isoDay(start),
    kickoff: start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    competition: league, // Cup phases come as the team's group ("League Phase"); league games carry the season name, which repeats the competition.
    round: ((sideOf('home').team.groups || {}).name || '').replace(/^\d{4}-\d{2}\b.*/, ''),
    start: comp.date, venue: L.venue || null,
    state: status.state, statusText: status.state === 'post' ? (status.description || 'Full time') : status.state === 'in' ? status.shortDetail : 'Not started',
  };
  const i = MATCHES.findIndex(m => m.id === id);
  if (i >= 0) MATCHES[i] = match; else MATCHES.push(match);
  for (const cache of [detailCache, analyticsCache, voteCache]) delete cache[id];
  return match;
}

// A fixture that hasn't kicked off uses the same match page as a played match: the same
// header, key-stats strip, tabs and cards in the same places. Cards that need the match
// itself say "No data"; real pre-match information fills its usual slot (venue and TV,
// team form, league table, the fan poll, and the lineups once announced).
function renderPreview(match, tab = 'Facts') {
  const fav = state.favs.includes(match.id);
  const start = new Date(match.start);
  const listing = typeof tvFeed !== 'undefined' && tvFeed && tvFeed.matches.find(m => `espn-${m.code.replace('.', '_')}-${m.id}` === match.id);
  const channels = (listing && listing.channels) || [];
  const L = LINEUPS[match.id];
  const days = Math.round((new Date(isoDay(start)) - new Date(isoDay(new Date()))) / 864e5);
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
  const v = matchVenue(match, { venue: match.venue });
  document.title = `${match.home} v ${match.away} | TDsports`;

  const none = (title, sub = '') => `<div class="card">${sectionHead(title, match, sub)}<p class="no-data">No data</p></div>`;
  // Predicted cards: the usual card drawn from the prediction, tagged, with links kept on this page.
  const P = match.prediction && PREDICTED[match.prediction.id];
  const pred = (fn, title, sub) => (P ? fn(P).replace('<h2 class="card-title">', '<h2 class="card-title"><span class="pred-tag">Prediction</span>')
    .split(`#/match/${P.id}`).join(`#/match/${match.id}`) : none(title, sub));
  const predLineup = P ? `<div class="pred-lineup"><span class="pred-tag pred-float">Predicted lineup · each side's last XI</span>${pred(pitchCard)}</div>` : null;
  const info = `
    <div class="card venue-compact">
      <div class="venue-row">
        ${v && v.photo ? `<img class="venue-thumb" src="${v.photo}" alt="${esc(v.name)}" loading="lazy">` : ''}
        <div><h2 class="venue-name">${v ? esc(v.name) : 'Match info'}</h2>${v && v.city ? `<span class="muted">${esc(v.city)}</span>` : ''}</div>
      </div>
      <div class="venue-facts">${[
        ['Kickoff', `${start.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}, ${match.kickoff}`],
        ['Capacity', v && v.capacity ? fmt(v.capacity) : 'No data'],
        ['Attendance', 'No data'], ['Referee', 'No data'], ['Weather', 'No data'],
        ['Broadcast', channels.length ? `📺 ${esc(channels.join(', '))}` : 'No data'],
      ].map(([k, val]) => `<div><span class="muted">${k}</span><b>${val}</b></div>`).join('')}</div>
      ${v && v.photo ? `<p class="photo-credit">${photoCredit(v.photo)}</p>` : ''}
    </div>`;
  const lineup = L ? cell(pitchCard(match), 'span-2') : cell(predLineup || none('Lineups', 'Usually announced about an hour before kickoff'), 'span-2');
  const tabs = {
    Facts: () => dash([
      stack(none('Momentum', 'Attacking pressure across the match · dots mark goals'), info), pred(topStatsCard, 'Top stats'), pred(compareCard, 'Player comparison'),
      pred(xgRaceCard, 'xG race', 'Cumulative expected goals; dots mark goals'), none('Shot map', 'Circle size = xG · hover a shot for details'), cell(none('Events'), 'row-2'),
      pred(attackingCard, 'Attacking'), pred(passingCard, 'Passing & build-up'),
      lineup, stack(none('Top performers'), none('Goal replays')),
      cell(none('Player statistics'), 'span-3'),
      cell(pred(styleCard, 'Style of play', 'How each side played, and what comes next'), 'span-2 fit-col'), stack(formCard(match), pollCard(match)),
      cell(otherMatchesCard(match), 'span-3'),
    ]),
    Stats: () => dash([
      pred(topStatsCard, 'Top stats'), pred(attackingCard, 'Attacking'), pred(passingCard, 'Passing & build-up'),
      pred(defendingCard, 'Defending'), none('Discipline & set pieces'), pred(xgRaceCard, 'xG race', 'Cumulative expected goals; dots mark goals'),
      cell(none('Shot map', 'Circle size = xG · hover a shot for details'), 'span-2'), pred(physicalCard, 'Physical'),
      cell(pred(styleCard, 'Style of play', 'How each side played, and what comes next'), 'span-3'),
    ]),
    Players: () => dash([
      pred(compareCard, 'Player comparison'), none('Top performers'), stack(none('Goalkeeping'), none('Bench impact')),
      cell(none('Player statistics'), 'span-3'),
    ]),
    Lineup: () => dash([lineup, stack(L ? teamSheetCard(match) : none('Team sheets', 'Squad-level view for each side'), none('Top performers'))]),
    Events: () => dash([cell(none('Events'), 'span-2'), stack(pred(xgRaceCard, 'xG race', 'Cumulative expected goals; dots mark goals'), info)]),
    Table: () => dash([cell(standingsCard(match), 'span-2'), stack(formCard(match), otherMatchesCard(match))]),
  };
  app.innerHTML = `
    <div class="detail">
      <div class="card match-header">
        <div class="match-top">
          <a class="pill" href="#">❮ Matches</a>
          <span class="competition"><img class="league-logo" src="${(LEAGUES.find(l => l.name === match.league) || LEAGUES[1]).logo}" alt=""> ${esc(match.competition)}${match.round ? ` · ${esc(match.round)}` : ''}</span>
          <button class="follow ${fav ? 'following' : ''}" data-action="fav" data-id="${match.id}" aria-pressed="${fav}">${fav ? 'Following ✓' : 'Follow'}</button>
        </div>
        <p class="meta">${start.toLocaleDateString('en', { weekday: 'short', month: 'long', day: 'numeric' })}, ${match.kickoff}${v ? ` · ${esc(v.name)}` : ''}${channels.length ? ` · 📺 ${esc(channels.join(', '))}` : ''}</p>
        <div class="scoreboard">
          <div class="teamname home">${esc(match.home)} ${crest(match.home, 'lg')}</div>
          <div class="bigscore preview-time">${match.kickoff}<small>${when} · not started</small></div>
          <div class="teamname away">${crest(match.away, 'lg')} ${esc(match.away)}</div>
        </div>
        ${match.prediction ? `<div class="pred-result"><span class="pred-tag">Prediction</span>
          <span><b>${Math.round(match.prediction.home * 100)}%</b> ${esc(match.home)} win</span><span><b>${Math.round(match.prediction.draw * 100)}%</b> draw</span><span><b>${Math.round(match.prediction.away * 100)}%</b> ${esc(match.away)} win</span>
          <span class="muted">Likely score <b>${match.prediction.score.join(' - ')}</b></span></div>` : '<div class="scorers"><span></span><span class="ball">⚽</span><span></span></div>'}
        <div class="keystrip">
          ${(() => {
            if (!P) return ['xG', 'Possession', 'Shots', 'Big chances', 'Pass accuracy', 'Field tilt', 'PPDA', 'Distance'].map(k => `<div class="key-item"><span class="muted">${k}</span><b class="muted">No data</b></div>`).join('');
            const [h, a] = analytics(P).teams;
            return [['xG', h.xg.toFixed(2), a.xg.toFixed(2)], ['Possession', `${h.possession}%`, `${a.possession}%`], ['Shots', `${h.shots} (${h.onTarget})`, `${a.shots} (${a.onTarget})`], ['Big chances', h.bigChances, a.bigChances], ['Pass accuracy', `${pct(h.passesAcc, h.passesAtt)}%`, `${pct(a.passesAcc, a.passesAtt)}%`], ['Field tilt', `${h.fieldTilt}%`, `${a.fieldTilt}%`], ['PPDA', h.ppda, a.ppda], ['Distance', `${h.distance} km`, `${a.distance} km`]]
              .map(([k, hv, av]) => `<div class="key-item pred"><span class="muted">${k} · predicted</span><b>${hv} <span class="muted">–</span> ${av}</b></div>`).join('');
          })()}
        </div>
        <p class="provenance"><span><b>Real:</b> kickoff, venue, broadcast, team form, league table${L ? ', lineups' : ''}</span>${P ? `<span><b>Prediction:</b> ${L ? '' : 'lineups (each side\'s last XI), '}result, xG and team stats (season scoring rates)</span>` : ''}<span><b>No data yet:</b> events and player ratings, until the match kicks off</span></p>
        <nav class="tabs" aria-label="Match sections">
          ${TABS.map(t => `<a class="tab ${tab === t ? 'active' : ''}" href="#/match/${match.id}/${t.toLowerCase()}" ${tab === t ? 'aria-current="page"' : ''}>${t}</a>`).join('')}
        </nav>
      </div>
      <div id="detail-content">${(tabs[tab] || tabs.Facts)()}</div>
    </div>`;
}

// Prediction for an upcoming fixture.
// Lineups: each team's starting XI and formation from its most recent match.
// Score: a Poisson model from season scoring rates. Expected goals for each side are
// (its goals per game) x (the opponent's conceded per game) / league average, with a
// small home edge; win/draw/loss chances and the likeliest score follow from that.
// Possession, shots, corners and fouls are scaled from the expected goals. The existing
// cards then draw these numbers; each one is labelled as a prediction.
async function predictFixture(match) {
  const table = ESPN_TABLES[match.id] || [];
  const games = h => ((table.find(t => t.team === match[h]) || {}).p) || ((match.form || {})[h] || []).length || 1;
  const rate = h => {
    const sn = match.season[h];
    if (sn && games(h)) return { gf: sn.gf / games(h), ga: sn.ga / games(h) };
    const f = (match.form || {})[h] || [];
    return f.length ? { gf: f.reduce((t, g) => t + g.f, 0) / f.length, ga: f.reduce((t, g) => t + g.a, 0) / f.length } : { gf: 1.35, ga: 1.35 };
  };
  const AVG = 1.35;
  const [rh, ra] = [rate('home'), rate('away')];
  const lh = Math.max(0.25, Math.min(3.5, rh.gf * ra.ga / AVG * 1.1));
  const la = Math.max(0.25, Math.min(3.5, ra.gf * rh.ga / AVG * 0.92));
  const pois = (l, k) => Math.exp(-l) * l ** k / [1, 1, 2, 6, 24, 120, 720, 5040, 40320][k];
  let pH = 0, pD = 0, pA = 0, best = [0, 0], bestP = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const p = pois(lh, i) * pois(la, j);
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    if (p > bestP) { bestP = p; best = [i, j]; }
  }
  const tot = pH + pD + pA;

  // Predicted lineups from each side's latest match.
  const summaries = await Promise.all(['home', 'away'].map(h => (match.lastGames[h]
    ? fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${match.lastGames[h]}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    : null)));
  const xi = { home: [], away: [] }, formations = ['', ''];
  const seeded = key => { let h = 2166136261; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
  ['home', 'away'].forEach((h, i) => {
    const sum = summaries[i];
    const r = sum && (sum.rosters || []).find(x => x.team && x.team.id === match.teamIds[h]);
    if (!r || !r.roster) return;
    formations[i] = r.formation || '';
    const starters = r.roster.filter(p => p.starter).map(p => ({ p, role: espnPosition(p.position && p.position.abbreviation), place: +p.formationPlace || 99 }));
    if (!starters.length) return;
    for (const [x, px, py] of espnSpots(starters, r.formation)) {
      const pid = espnPerson(x.p.athlete, x.role.pos);
      const rating = Math.round((6.4 + seeded(pid + match.id) * 1.0) * 10) / 10;
      xi[h].push(h === 'home' ? [pid, px, py, rating] : [pid, 100 - px, 100 - py, rating]);
    }
  });
  if (!xi.home.length || !xi.away.length) return;

  const poss = Math.round(Math.max(36, Math.min(64, 50 + 14 * (lh - la) / (lh + la) + 2)));
  const shots = [lh, la].map(l => Math.round(l * 7 + 4));
  const pm = {
    id: match.id + '-pred', predictedFor: match.id, home: match.home, away: match.away, score: [0, 0],
    league: match.league, competition: match.competition, round: match.round, date: match.date, kickoff: match.kickoff,
  };
  PREDICTED[pm.id] = pm;
  LINEUPS[pm.id] = {
    predicted: true, formations, coaches: match.coachIds, home: xi.home, away: xi.away, homeSubs: [], awaySubs: [],
    events: [], goalShots: {}, goalInfo: {}, researched: true,
    stats: { xg: [+lh.toFixed(2), +la.toFixed(2)], shots, onTarget: shots.map(x => Math.round(x * 0.36)), possession: poss,
      corners: shots.map(x => Math.round(x * 0.42)), fouls: [11, 11], bigChances: [lh, la].map(l => Math.max(1, Math.round(l * 1.3))) },
  };
  for (const cache of [detailCache, analyticsCache]) delete cache[pm.id];
  // Big chances come from single shots worth 0.3+ xG; predicted shots are spread evenly, so set them from the xG.
  analytics(pm).teams.forEach((t, i) => { t.bigChances = LINEUPS[pm.id].stats.bigChances[i]; t.bigChancesMissed = t.bigChances; });
  match.prediction = { id: pm.id, home: pH / tot, draw: pD / tot, away: pA / tot, score: best, xg: [lh, la] };
}

// A person from an ESPN athlete: ids stay unique, and known photos are reused by name.
function espnPerson(athlete, pos) {
  const pid = 'espn-' + athlete.id;
  if (!PEOPLE[pid]) {
    const name = athlete.displayName;
    PEOPLE[pid] = { name, short: athlete.lastName || name.split(' ').slice(-1)[0], pos };
    const known = Object.values(PEOPLE).find(x => x.photo && x.name === name);
    if (known) PEOPLE[pid].photo = known.photo;
  }
  return pid;
}

async function loadEspnMatch(id) {
  const ref = parseEspnId(id);
  if (!ref) throw new Error('Unknown match');
  if (!espnLoading[id]) {
    espnLoading[id] = fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ref.code}/summary?event=${ref.event}`)
      .then(r => { if (!r.ok) throw new Error(`ESPN returned ${r.status}`); return r.json(); })
      .then(s => addEspnMatch(id, ref.code, s))
      .then(m => (m.state === 'pre' ? predictFixture(m).catch(() => {}).then(() => m) : m))
      .finally(() => { delete espnLoading[id]; });
  }
  return espnLoading[id];
}

// While a live or upcoming ESPN match is open, refresh it every 60 seconds.
setInterval(async () => {
  const r = route();
  if (!r || r.view !== 'match' || document.hidden) return;
  const m = findMatch(r.id);
  if (!m || !m.espn || m.state === 'post') return;
  try { await loadEspnMatch(r.id); render(); } catch { /* keep the last version */ }
}, 60000);
