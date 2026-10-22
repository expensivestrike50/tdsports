// Match pages for live scores and results that aren't in the researched data.
// Clicking one in "Live now" or "Earlier results" opens #/match/espn-<league>-<event id>.
// The page loads ESPN's public match summary (lineups, formations, goals, cards,
// substitutions, team stats, venue and the league table), turns it into the same shape as
// the researched matches and renders the usual Facts, Stats, Players, Lineup, Events and
// Table tabs. Live matches are refreshed every 60 seconds while the page is open.
// Player ratings and the detailed per-player stats are sample values, as elsewhere.

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
    for (const [x, px, py] of espnSpots(starters, r.formation)) {
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
    const unused = r ? r.roster.filter(p => !p.starter).map(p => byAthlete[p.athlete.id]).filter(pid => !subsIn[h].includes(pid)) : [];
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

  const match = {
    id, espn: true, home, away, score, league, form,
    date: isoDay(start),
    kickoff: start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    competition: league, round: (sideOf('home').team.groups && sideOf('home').team.groups.name) || s.header.season && s.header.season.name || '',
    state: status.state, statusText: status.state === 'post' ? (status.description || 'Full time') : status.state === 'in' ? status.shortDetail : 'Not started',
  };
  const i = MATCHES.findIndex(m => m.id === id);
  if (i >= 0) MATCHES[i] = match; else MATCHES.push(match);
  for (const cache of [detailCache, analyticsCache, voteCache]) delete cache[id];
  return match;
}

async function loadEspnMatch(id) {
  const ref = parseEspnId(id);
  if (!ref) throw new Error('Unknown match');
  if (!espnLoading[id]) {
    espnLoading[id] = fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ref.code}/summary?event=${ref.event}`)
      .then(r => { if (!r.ok) throw new Error(`ESPN returned ${r.status}`); return r.json(); })
      .then(s => addEspnMatch(id, ref.code, s))
      .finally(() => { delete espnLoading[id]; });
  }
  return espnLoading[id];
}

// While a live ESPN match is open, refresh it every 60 seconds.
setInterval(async () => {
  const r = route();
  if (!r || r.view !== 'match' || document.hidden) return;
  const m = findMatch(r.id);
  if (!m || !m.espn || m.state !== 'in') return;
  try { await loadEspnMatch(r.id); render(); } catch { /* keep the last version */ }
}, 60000);
