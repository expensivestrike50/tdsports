// Build the TDsports read-only JSON API into api/v1/.
//
// Usage: node tools/build-api.js
//
// Reads the app's data files (data.js, match-data.js) and writes one JSON file per
// resource. They are plain static files, so they work on GitHub Pages as well as on
// tools/serve.py (which also answers without the .json extension). Live scores are in
// live.json at the site root, refreshed every 30 seconds by Agent Tom locally. Re-run after tools/build-match-data.py changes the data.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'api', 'v1');
const BASE = 'api/v1'; // paths are relative to the site root, so they work on any host or sub-path

const ctx = { console };
vm.createContext(ctx);
for (const f of ['data.js', 'match-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const D = vm.runInContext(`({ BASE_DATE, LEAGUES, COMPETITION, MATCHES, CLUB_LOGOS, CLUB_COUNTRY, PEOPLE, LINEUPS, VENUES,
  MATCH_UPDATES: typeof MATCH_UPDATES === 'undefined' ? {} : MATCH_UPDATES })`, ctx);

const generated = new Date().toISOString();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const slug = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const asset = p => p || null;

function write(rel, data) {
  const file = path.join(OUT, rel + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ generated, data }, null, 2) + '\n');
}

const club = name => ({ name, id: slug(name), crest: asset(D.CLUB_LOGOS[name]), country: D.CLUB_COUNTRY[name] || null });
const person = id => {
  const p = D.PEOPLE[id];
  return p ? { id, name: p.name, short: p.short, position: p.pos || null, photo: p.photo ? `assets/photos/people/${p.photo}.jpg` : null } : { id, name: id };
};

// ----- Matches -----
const matches = D.MATCHES.map(m => {
  const u = D.MATCH_UPDATES[m.id] || {};
  const L = D.LINEUPS[m.id];
  return {
    id: m.id,
    date: u.date || m.date || iso(D.BASE_DATE),
    kickoff: u.kickoff || m.kickoff,
    competition: u.competition || m.competition || 'UEFA Champions League',
    round: u.round || m.round || D.COMPETITION.round,
    status: 'FT',
    home: club(m.home),
    away: club(m.away),
    score: { home: (u.score || m.score)[0], away: (u.score || m.score)[1] },
    tv: m.tv || null,
    sample: !!(u.sample || m.sample),
    hasLineups: !!L,
    url: `${BASE}/matches/${m.id}.json`,
  };
});
write('matches', matches);

const EVENT_TYPES = { goal: 'goal', owngoal: 'own_goal', pen: 'penalty_goal', yellow: 'yellow_card', red: 'red_card', sub: 'substitution', var: 'var' };
for (const m of matches) {
  const L = D.LINEUPS[m.id];
  const venue = (L && L.venue) || D.VENUES[m.home.name] || null;
  const detail = { ...m };
  delete detail.url;
  detail.venue = venue && { name: venue.name, city: venue.city, capacity: venue.capacity || null };
  if (L) {
    const side = s => ({
      formation: L.formations[s === 'home' ? 0 : 1],
      coach: person(L.coaches[s === 'home' ? 0 : 1]),
      // x/y are 0-100 pitch coordinates (home attacks left to right); rating is a sample value.
      starting: L[s].map(([id, x, y, rating]) => ({ ...person(id), x, y, rating: rating ?? null })),
      bench: L[s + 'Subs'].map(([id, rating]) => ({ ...person(id), rating: rating ?? null })),
    });
    detail.lineups = { home: side('home'), away: side('away') };
    detail.events = L.events.map(([minute, type, team, who, extra]) => {
      const e = { minute, type: EVENT_TYPES[type] || type, team, player: person(who) };
      const info = (L.goalInfo || {})[minute];
      if (type === 'sub') e.replaced = person(extra);
      else if (type === 'goal' || type === 'owngoal') {
        if (extra && extra !== 'pen') e.scoreAfter = extra;
        e.penalty = extra === 'pen' || !!(info && info.penalty);
        if (info) {
          e.assist = info.assist ? person(info.assist) : null;
          e.goalType = info.type;
          e.description = info.description || null;
        }
      } else if (extra) e.detail = extra;
      return e;
    });
    detail.stats = L.stats;
    detail.attendance = L.attendance ?? null;
    detail.referee = Array.isArray(L.referee) ? { name: L.referee[0], country: L.referee[1] } : L.referee || null;
    detail.sources = L.sources || [];
    detail.provenance = {
      events: 'real',
      lineups: 'real',
      stats: L.researched ? 'real (ESPN / UEFA)' : 'sample',
      ratings: 'sample',
    };
  }
  write(`matches/${m.id}`, detail);
}

// ----- Competitions, clubs, people -----
write('competitions', D.LEAGUES.map(l => ({ id: slug(l.name), name: l.name, country: l.country, logo: asset(l.logo) })));
write('clubs', Object.keys(D.CLUB_LOGOS).sort().map(club));

const appearances = {};
for (const m of matches) {
  const L = D.LINEUPS[m.id];
  if (!L) continue;
  for (const s of ['home', 'away']) {
    const add = (id, role) => (appearances[id] ||= []).push({ match: m.id, date: m.date, team: m[s].name, role });
    L[s].forEach(([id]) => add(id, 'starter'));
    L[s + 'Subs'].forEach(([id]) => add(id, 'bench'));
    add(L.coaches[s === 'home' ? 0 : 1], 'coach');
  }
}
const people = Object.keys(D.PEOPLE).sort().map(id => ({ ...person(id), url: `${BASE}/people/${id}.json` }));
write('people', people);
for (const p of people) {
  const { url, ...rest } = p;
  write(`people/${p.id}`, { ...rest, matches: appearances[p.id] || [] });
}

// ----- Index -----
write('index', {
  name: 'TDsports API',
  version: 'v1',
  endpoints: {
    matches: `${BASE}/matches.json`,
    match: `${BASE}/matches/{id}.json`,
    live: 'live.json',
    competitions: `${BASE}/competitions.json`,
    clubs: `${BASE}/clubs.json`,
    people: `${BASE}/people.json`,
    person: `${BASE}/people/{id}.json`,
  },
  counts: { matches: matches.length, clubs: Object.keys(D.CLUB_LOGOS).length, people: people.length },
});
console.log(`API built: ${matches.length} matches, ${people.length} people → ${path.relative(ROOT, OUT)}`);
