'use strict';

// Style of play: this match, a style review, a next-match prediction (style + XI),
// the coach and key players. The prediction uses small models that run in the browser:
// a recency-weighted nearest-centroid classifier for style and a softmax selection
// model for the lineup. They work on this prototype's sample data, so predictions are
// indicative only; plugging in real match history would make them meaningful.

const STYLE_TABS = ['This match', 'Style review', 'Next match', 'Coach', 'Key players'];

// Style features, each normalised to 0-100.
const STYLE_FEATURES = [
  ['possession', 'Possession', 'Share of the ball'],
  ['press', 'Pressing', 'How aggressively they win the ball back (from PPDA)'],
  ['direct', 'Directness', 'Long-ball share and pass length'],
  ['tilt', 'Territory', 'Field tilt: time spent in the attacking third'],
  ['line', 'Defensive line', 'How high the back line holds'],
  ['tempo', 'Tempo', 'Progressive actions per possession share'],
];

// Archetype centroids in feature space.
const ARCHETYPES = [
  { name: 'Possession control', icon: 'possession', c: [78, 60, 22, 70, 68, 45], text: 'keeps the ball, builds patiently and pins the opponent back' },
  { name: 'High press', icon: 'press', c: [56, 88, 40, 66, 84, 70], text: 'hunts the ball high up the pitch and attacks quickly after winning it' },
  { name: 'Counter-attacking', icon: 'counter', c: [36, 42, 62, 40, 34, 78], text: 'concedes territory, defends compactly and breaks fast into space' },
  { name: 'Direct play', icon: 'direct', c: [42, 50, 88, 48, 46, 55], text: 'goes long early, targets second balls and the channels' },
  { name: 'Balanced', icon: 'balanced', c: [50, 55, 48, 50, 55, 52], text: 'mixes build-up and directness depending on the phase' },
];

// Stroke icons (24 x 24) drawn as inline SVG so they scale cleanly and follow the text colour.
const ICONS = {
  possession: '<circle cx="6" cy="17" r="2.2"/><circle cx="18" cy="17" r="2.2"/><circle cx="12" cy="6" r="2.2"/><path d="M7.2 15 10.9 8M13.1 8l3.7 7M8.4 17h7.2"/>',
  press: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  counter: '<path d="M4 6.5 9.5 12 4 17.5M11 6.5l5.5 5.5-5.5 5.5"/><path d="M19.5 6v12"/>',
  direct: '<path d="M12 21V4M6.5 9.5 12 4l5.5 5.5"/><path d="M8 21h8"/>',
  balanced: '<path d="M12 4v16M7 20h10M4.5 7.5h15"/><path d="M4.5 7.5 2 13h5zM19.5 7.5 17 13h5z"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="m12 7.5 3.4 2.5-1.3 4h-4.2l-1.3-4z"/><path d="M12 3.5v4M15.4 10l4-1.5M14.1 14l2.4 3.6M9.9 14l-2.4 3.6M8.6 10l-4-1.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  pie: '<path d="M12 3.5A8.5 8.5 0 1 0 20.5 12H12z"/><path d="M14.5 2.8A8.5 8.5 0 0 1 21.2 9.5h-6.7z"/>',
  arrowUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
};
const svgIcon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const clamp100 = v => Math.max(0, Math.min(100, v));

function styleVector(tm) {
  return [
    clamp100((tm.possession - 25) * 2),
    clamp100(100 - (tm.ppda - 5) * 9),
    clamp100(tm.directness * 3 + (tm.avgPassLength - 15) * 6),
    clamp100(tm.fieldTilt),
    clamp100((tm.defLine - 30) * 4),
    clamp100(((tm.progPasses + tm.progCarries) / (tm.possession || 1)) * 55),
  ].map(Math.round);
}

function classify(vec) {
  const d = ARCHETYPES.map(a => Math.sqrt(a.c.reduce((s, c, i) => s + (c - vec[i]) ** 2, 0)));
  const e = d.map(x => Math.exp(-x / 9));
  const sum = e.reduce((a, b) => a + b, 0);
  return ARCHETYPES.map((a, i) => ({ ...a, p: e[i] / sum })).sort((a, b) => b.p - a.p);
}

// This match plus nine earlier sample matches, most recent first.
function styleHistory(match, side) {
  const { teams } = analytics(match);
  const t = side === 'home' ? 0 : 1;
  const team = side === 'home' ? match.home : match.away;
  const now = styleVector(teams[t]);
  const r = rng('style-' + team);
  const identity = now.map(v => v + (r() - 0.5) * 14); // the team's long-run style
  const past = Array.from({ length: 9 }, () => identity.map(v => Math.round(clamp100(v + (r() - 0.5) * 22))));
  return [now, ...past];
}

function predictStyle(history) {
  // Recency-weighted mean with mild mean reversion towards the long-run average.
  const w = history.map((_, i) => Math.pow(0.62, i));
  const ws = w.reduce((a, b) => a + b, 0);
  const weighted = history[0].map((_, f) => history.reduce((s, h, i) => s + h[f] * w[i], 0) / ws);
  const longRun = history[0].map((_, f) => history.reduce((s, h) => s + h[f], 0) / history.length);
  return weighted.map((v, f) => Math.round(0.8 * v + 0.2 * longRun[f]));
}

// Predicted XI: each slot of today's formation gets a softmax over eligible players,
// scored on rating, minutes, starting today and a small seeded fitness term.
function predictLineup(match, side) {
  const { players } = analytics(match);
  const L = LINEUPS[match.id];
  const r = rng('xi-' + match.id + side);
  const squad = players.filter(p => p.side === side);
  const score = p => 1.25 * ((p.rating ?? 6.2) - 6.5) + 1.4 * (p.minutes / 90) + (p.sub ? 0 : 0.7) + (r() - 0.5) * 0.3;
  const scored = squad.map(p => ({ ...p, s: score(p) }));
  const slots = (side === 'home' ? L.home : L.away).map(([id, x, y]) => ({ starter: id, x, y, group: POSITION_GROUP[PEOPLE[id].pos] }));
  // Fill the most contested slots first so one player can't take two.
  const used = new Set();
  const filled = slots.map(slot => {
    const options = scored.filter(p => p.group === slot.group && (p.id === slot.starter || p.sub));
    const sum = options.reduce((a, p) => a + Math.exp(p.s), 0);
    return { ...slot, options: options.map(p => ({ id: p.id, prob: Math.exp(p.s) / sum })).sort((a, b) => b.prob - a.prob) };
  }).sort((a, b) => a.options[0].prob - b.options[0].prob);
  for (const slot of filled) {
    const pick = slot.options.find(o => !used.has(o.id)) || slot.options[0];
    used.add(pick.id);
    // Renormalise among players still available for this slot.
    const avail = slot.options.filter(o => o.id === pick.id || !used.has(o.id));
    const total = avail.reduce((a, o) => a + o.prob, 0);
    slot.pick = pick.id;
    slot.prob = Math.round((pick.prob / total) * 100);
  }
  return filled.sort((a, b) => a.x - b.x || a.y - b.y);
}

// Attacking lanes from shot locations and box entries (left / centre / right, attacker's view).
function attackLanes(match, side) {
  const { shots } = analytics(match);
  const mine = shots.filter(s => s.side === side);
  const lane = s => {
    const y = side === 'home' ? s.y : 100 - s.y; // attacker's left is low y for home
    return y < 36 ? 0 : y > 64 ? 2 : 1;
  };
  const counts = [0, 0, 0];
  mine.forEach(s => { counts[lane(s)]++; });
  const r = rng('lanes-' + match.id + side);
  const raw = counts.map(c => c + 2 + r() * 3);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(v => Math.round((v / sum) * 100));
}

// Role tags from percentile ranks within the match.
const ROLES = [
  ['Finisher', p => p.xg * 2 + p.shots * 0.3],
  ['Creator', p => p.xa * 2 + p.keyPasses * 0.6],
  ['Ball progressor', p => (p.progPasses + p.progCarries) / Math.max(p.minutes, 1) * 90 * 0.25],
  ['Ball winner', p => (p.tackles + p.interceptions + p.recoveries * 0.4) / Math.max(p.minutes, 1) * 90 * 0.3],
  ['Dribbler', p => p.dribblesWon * 0.8],
  ['Engine', p => p.distance * 0.25 + p.hiRuns * 0.03],
  ['Aerial presence', p => p.aerialsWon * 0.7 + p.clearances * 0.2],
];

// A player's role is the trait where they rank highest against everyone else in the match.
function roleOf(p, pool) {
  const ranked = ROLES.map(([name, f]) => {
    const mine = f(p);
    return [name, pool.filter(q => f(q) < mine).length / pool.length];
  });
  return ranked.sort((a, b) => b[1] - a[1])[0][0];
}

// Verified coach notes only, shown on the coach's profile (click the coach on the Coach tab).
const COACH_NOTES = {
  buruk: 'Galatasaray head coach since 2022. Won the Süper Lig in 2022–23, 2023–24 and 2024–25.',
};

// ----- Rendering -----

function teamSwitch(match) {
  return `<div class="seg style-team">${['home', 'away'].map(s => `<button class="${state.styleTeam === s ? 'on' : ''}" data-action="style-team" data-value="${s}" aria-pressed="${state.styleTeam === s}">${crest(s === 'home' ? match.home : match.away)} ${esc(s === 'home' ? match.home : match.away)}</button>`).join('')}</div>`;
}

// Extra style metrics for "This match", derived from the team numbers so they stay
// consistent with the rest of the page.
const styleExtrasCache = {};

function styleExtras(match) {
  if (styleExtrasCache[match.id]) return styleExtrasCache[match.id];
  const r = rng('stylex-' + match.id);
  const teams = analytics(match).teams;
  const out = teams.map(tm => {
    // Ball recoveries split by third (own, middle, final); higher pressing wins more up the pitch.
    const press = Math.max(0, Math.min(1, (14 - tm.ppda) / 8));
    const w = [0.5 - press * 0.15 + r() * 0.08, 0.35 + r() * 0.08, 0.12 + press * 0.15 + r() * 0.05];
    const sum = w.reduce((x, y) => x + y, 0);
    const thirds = w.map(x => Math.round((x / sum) * tm.recoveries));
    thirds[1] = tm.recoveries - thirds[0] - thirds[2];
    return {
      seqTime: +(6.5 + tm.possession / 12 + r() * 2).toFixed(1),
      seq10: Math.round(tm.possession / 6 + r() * 4),
      compactness: +(30 + r() * 8).toFixed(1), // metres from back line to front line out of possession
      recoveries: thirds,
    };
  });
  // Home possession in each 15-minute period, averaging exactly to the match figure.
  const periods = Array.from({ length: 6 }, () => teams[0].possession + (r() - 0.5) * 22);
  const shift = teams[0].possession - periods.reduce((x, y) => x + y, 0) / 6;
  out.periods = periods.map(p => Math.round(Math.max(25, Math.min(75, p + shift))));
  return (styleExtrasCache[match.id] = out);
}

function possessionDonut(match, h, a, ex) {
  const R = 42, C = 2 * Math.PI * R, hp = h.possession / 100;
  return `
    <div class="sn-panel">
      <h3 class="style-h">Possession</h3>
      <div class="donut-wrap">
        <svg class="donut" viewBox="0 0 110 110" role="img" aria-label="Possession ${h.possession}% to ${a.possession}%">
          <circle cx="55" cy="55" r="${R}" class="donut-away"/>
          <circle cx="55" cy="55" r="${R}" class="donut-home" stroke-dasharray="${(C * hp).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 55 55)"/>
          <text x="55" y="52" text-anchor="middle" class="donut-big">${h.possession}%</text>
          <text x="55" y="67" text-anchor="middle" class="donut-small">${esc(match.home)}</text>
        </svg>
        <div class="donut-side">
          <div><span class="muted">${esc(match.away)}</span><b class="away-text">${a.possession}%</b></div>
          <div><span class="muted">Avg. possession</span><b>${ex[0].seqTime}s <span class="muted">vs</span> ${ex[1].seqTime}s</b></div>
          <div><span class="muted">10+ pass sequences</span><b>${ex[0].seq10} <span class="muted">vs</span> ${ex[1].seq10}</b></div>
          <div><span class="muted">Pass accuracy</span><b>${pct(h.passesAcc, h.passesAtt)}% <span class="muted">vs</span> ${pct(a.passesAcc, a.passesAtt)}%</b></div>
        </div>
      </div>
      <div class="sn-bottom">${possessionTimeline(match, ex)}</div>
    </div>`;
}

// Home possession share per 15-minute period: above the 50% line favours the home side.
function possessionTimeline(match, ex) {
  const W = 300, H = 112, top = 16, bottom = 80;
  const X = min => 12 + (min / 90) * (W - 24);
  const Y = p => top + ((75 - p) / 50) * (bottom - top); // 25%-75% scale
  const pts = ex.periods.map((p, i) => [X(i * 15 + 7.5), Y(p)]); // each period plotted at its midpoint
  const line = smoothPath(pts);
  const area = `${line} L${pts[5][0]},${Y(50)} L${pts[0][0]},${Y(50)} Z`;
  const goals = details(match).events.filter(e => e.type === 'goal' || e.type === 'owngoal');
  const id = 'pt-' + match.id;
  return `
    <h3 class="style-h">Possession by period <span class="muted">${esc(match.home)} share, 15-min blocks</span></h3>
    <svg class="poss-time" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(match.home)} possession by period: ${ex.periods.join('%, ')}%">
      <defs>
        <clipPath id="${id}-a"><rect x="0" y="0" width="${W}" height="${Y(50)}"/></clipPath>
        <clipPath id="${id}-b"><rect x="0" y="${Y(50)}" width="${W}" height="${H}"/></clipPath>
      </defs>
      ${[15, 30, 45, 60, 75].map(m => `<line x1="${X(m)}" x2="${X(m)}" y1="${top - 6}" y2="${bottom + 4}" class="pt-grid ${m === 45 ? 'ht' : ''}"/>`).join('')}
      <path d="${area}" class="pt-fill home" clip-path="url(#${id}-a)"/>
      <path d="${area}" class="pt-fill away" clip-path="url(#${id}-b)"/>
      <line x1="${X(0)}" x2="${X(90)}" y1="${Y(50)}" y2="${Y(50)}" class="pt-mid"/>
      <text x="${X(90)}" y="${Y(50) - 3}" text-anchor="end" class="pt-tick">50%</text>
      <path d="${line}" class="pt-line"/>
      ${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3.2" class="pt-dot"><title>${i * 15}–${i * 15 + 15}′: ${esc(match.home)} ${ex.periods[i]}% · ${esc(match.away)} ${100 - ex.periods[i]}%</title></circle><text x="${x}" y="${y - 7}" text-anchor="middle" class="pt-val">${ex.periods[i]}</text>`).join('')}
      ${goals.map(e => `<circle cx="${X(Math.min(e.min, 90))}" cy="${bottom + 10}" r="3" class="pt-goal ${e.side}"><title>${e.min}′ goal · ${esc(e.side === 'home' ? match.home : match.away)}</title></circle>`).join('')}
      ${[0, 15, 30, 45, 60, 75, 90].map(m => `<text x="${X(m)}" y="${H - 2}" text-anchor="middle" class="pt-tick">${m === 45 ? 'HT' : `${m}′`}</text>`).join('')}
    </svg>
    <div class="legend-row pt-legend"><span><i class="key dot" style="background:var(--home)"></i>${esc(match.home)} goal</span><span><i class="key dot" style="background:var(--away)"></i>${esc(match.away)} goal</span></div>`;
}

// Passing network: each starter at an average position (shifted by possession),
// node size = passes completed, link width = passes between the pair.
function passNetwork(match) {
  const { players, teams } = analytics(match);
  const L = LINEUPS[match.id];
  const r = rng('net-' + match.id);
  const side = (list, s, t) => {
    const push = (teams[t].possession - 50) * 0.25; // the team with more of the ball sits higher
    const nodes = list.map(([id, x, y]) => {
      const p = players.find(q => q.id === id);
      const own = s === 'home' ? x : 100 - x; // distance from own goal
      const ax = Math.max(4, Math.min(52, own * 0.95 + push + (r() - 0.5) * 4));
      return { id, x: (s === 'home' ? ax : 100 - ax) * 1.05, y: (s === 'home' ? y : y) * 0.68, passes: p.passesAcc };
    });
    const links = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const w = Math.round((a.passes * b.passes) / 140 * Math.exp(-dist / 18) * (0.7 + r() * 0.6));
      if (w >= 4) links.push({ a, b, w });
    }
    return { nodes, links: links.sort((x, y) => y.w - x.w).slice(0, 16), side: s };
  };
  const nets = [side(L.home, 'home', 0), side(L.away, 'away', 1)];
  const maxW = Math.max(...nets.flatMap(n => n.links.map(l => l.w)));
  const maxP = Math.max(...nets.flatMap(n => n.nodes.map(x => x.passes)));
  const draw = n => `
    ${n.links.map(l => `<line x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}" class="pn-link ${n.side}" style="stroke-width:${(0.3 + (l.w / maxW) * 1.6).toFixed(2)};opacity:${(0.35 + (l.w / maxW) * 0.6).toFixed(2)}"><title>${esc(PEOPLE[l.a.id].short)} ↔ ${esc(PEOPLE[l.b.id].short)}: ${l.w} passes</title></line>`).join('')}
    ${n.nodes.map(x => `<g class="pn-node ${n.side}"><circle cx="${x.x.toFixed(1)}" cy="${x.y.toFixed(1)}" r="${(1.4 + (x.passes / maxP) * 2.2).toFixed(2)}"><title>${esc(PEOPLE[x.id].name)}: ${x.passes} passes completed</title></circle><text x="${x.x.toFixed(1)}" y="${(x.y + 5).toFixed(1)}" text-anchor="middle">${esc(PEOPLE[x.id].short)}</text></g>`).join('')}`;
  const top = side => {
    const n = nets[side === 'home' ? 0 : 1];
    const l = n.links[0];
    return l ? `${esc(PEOPLE[l.a.id].short)} ↔ ${esc(PEOPLE[l.b.id].short)} (${l.w})` : '—';
  };
  return `
    <div class="pn-wrap">
      <h3 class="style-h">Passing network <span class="muted">average positions · line width = passes</span></h3>
      <svg class="pass-net" viewBox="-1 -1 107 70" role="img" aria-label="Passing networks for both teams">
        <rect x="0" y="0" width="105" height="68" class="bp-turf"/>
        <g class="bp-lines"><rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><circle cx="52.5" cy="34" r="9.15"/><rect x="0" y="13.85" width="16.5" height="40.3"/><rect x="88.5" y="13.85" width="16.5" height="40.3"/></g>
        ${nets.map(draw).join('')}
      </svg>
      <div class="bp-legend">
        <span><i class="key home"></i>${esc(match.home)} · strongest link ${top('home')}</span>
        <span><i class="key away"></i>${esc(match.away)} · strongest link ${top('away')}</span>
      </div>
    </div>`;
}

// For matches without lineups: share of attacks down the left, centre and right for each team.
function buildUpRoutes(match) {
  const lanes = [attackLanes(match, 'home'), attackLanes(match, 'away')];
  const arrow = (side, i, share) => {
    const y = side === 'home' ? [14, 34, 54][i] : [54, 34, 14][i]; // attacker's left differs by direction
    const w = (0.8 + (share / 60) * 3.4).toFixed(1);
    const [x1, x2] = side === 'home' ? [8, 48] : [97, 57];
    return `<line x1="${x1}" y1="${y + (side === 'home' ? -3 : 3)}" x2="${x2}" y2="${y + (side === 'home' ? -3 : 3)}" class="route ${side}" style="stroke-width:${w}" marker-end="url(#arrow-${side})"/><text x="${(x1 + x2) / 2}" y="${y + (side === 'home' ? -6.5 : 9.5)}" text-anchor="middle" class="route-val">${share}%</text>`;
  };
  return `
    <div class="pn-wrap">
      <h3 class="style-h">Build-up routes <span class="muted">share of attacks by channel</span></h3>
      <svg class="pass-net" viewBox="-1 -1 107 70" role="img" aria-label="Attacking routes by channel">
        <defs>
          <marker id="arrow-home" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="route-head home"/></marker>
          <marker id="arrow-away" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="route-head away"/></marker>
        </defs>
        <rect x="0" y="0" width="105" height="68" class="bp-turf"/>
        <g class="bp-lines"><rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><line x1="0" y1="22.7" x2="105" y2="22.7" class="third"/><line x1="0" y1="45.3" x2="105" y2="45.3" class="third"/></g>
        ${lanes[0].map((v, i) => arrow('home', i, v)).join('')}
        ${lanes[1].map((v, i) => arrow('away', i, v)).join('')}
      </svg>
      <div class="bp-legend">
        <span><i class="key home"></i>${esc(match.home)} attacking →</span>
        <span><i class="key away"></i>${esc(match.away)} attacking ←</span>
      </div>
    </div>`;
}

// Out-of-possession blocks: each team's defensive line and front line, on one pitch.
function blockPanel(match, h, a, ex) {
  const hl = h.defLine, al = a.defLine;
  const hFront = Math.min(100, hl + ex[0].compactness), aFront = Math.min(100, al + ex[1].compactness);
  return `
    <div class="sn-panel">
      <div class="block-top">
      <h3 class="style-h">Block &amp; press <span class="muted">out of possession</span></h3>
      <svg class="block-pitch" viewBox="-1 -1 107 50" role="img" aria-label="Defensive line heights: ${esc(match.home)} ${hl} metres, ${esc(match.away)} ${al} metres">
        <rect x="0" y="0" width="105" height="48" class="bp-turf"/>
        <g class="bp-lines"><rect x="0" y="0" width="105" height="48"/><line x1="52.5" y1="0" x2="52.5" y2="48"/><rect x="0" y="12" width="16.5" height="24"/><rect x="88.5" y="12" width="16.5" height="24"/></g>
        <rect x="${hl}" y="3" width="${hFront - hl}" height="19" class="bp-block home"/>
        <rect x="${105 - aFront}" y="26" width="${aFront - al}" height="19" class="bp-block away"/>
        <line x1="${hl}" x2="${hl}" y1="1" y2="24" class="bp-line home"/>
        <line x1="${105 - al}" x2="${105 - al}" y1="24" y2="47" class="bp-line away"/>
        <text x="${hl + 1.2}" y="9" class="bp-text">${hl.toFixed(0)} m</text>
        <text x="${105 - al - 1.2}" y="42" text-anchor="end" class="bp-text">${al.toFixed(0)} m</text>
      </svg>
      <div class="bp-legend">
        <span><i class="key home"></i>${esc(match.home)} · PPDA <b>${h.ppda}</b> · ${ex[0].compactness} m deep</span>
        <span><i class="key away"></i>${esc(match.away)} · PPDA <b>${a.ppda}</b> · ${ex[1].compactness} m deep</span>
      </div>
      </div>
      <div class="sn-bottom">${recoveryMap(match, h, a, ex)}</div>
    </div>`;
}

// Where each team won the ball back, by third of the pitch (bubble size = recoveries).
function recoveryMap(match, h, a, ex) {
  const max = Math.max(...ex[0].recoveries, ...ex[1].recoveries);
  const r = n => (4 + Math.sqrt(n / max) * 11).toFixed(1);
  const cx = [17.5, 52.5, 87.5];
  // Home attacks left to right; the away side's own third is on the right.
  const row = (vals, side, y, flip) => vals.map((n, i) => {
    const x = cx[flip ? 2 - i : i];
    return `<circle cx="${x}" cy="${y}" r="${r(n)}" class="rc ${side}"><title>${n} recoveries in ${['own', 'middle', 'final'][i]} third</title></circle><text x="${x}" y="${y + 3.4}" text-anchor="middle" class="rc-val">${n}</text>`;
  }).join('');
  const highShare = side => Math.round((ex[side].recoveries[2] / ([h, a][side].recoveries || 1)) * 100);
  return `
    <h3 class="style-h">Ball recoveries <span class="muted">where possession was won back</span></h3>
    <svg class="rec-map" viewBox="0 0 105 68" role="img" aria-label="Ball recoveries by third">
      <rect x="0" y="0" width="105" height="68" class="bp-turf"/>
      <g class="bp-lines"><rect x="0" y="0" width="105" height="68"/><line x1="35" y1="0" x2="35" y2="68" class="third"/><line x1="70" y1="0" x2="70" y2="68" class="third"/></g>
      ${row(ex[0].recoveries, 'home', 19, false)}
      ${row(ex[1].recoveries, 'away', 50, true)}
    </svg>
    <div class="bp-legend">
      <span><i class="key home"></i>${esc(match.home)} · ${h.recoveries} recoveries · ${highShare(0)}% in the final third</span>
      <span><i class="key away"></i>${esc(match.away)} · ${a.recoveries} recoveries · ${highShare(1)}% in the final third</span>
    </div>`;
}

function styleNowTab(match) {
  const [h, a] = analytics(match).teams;
  const ex = styleExtras(match);
  return `
    <div class="style-now">
      ${possessionDonut(match, h, a, ex)}
      <div class="sn-panel sn-rows">
        <div class="sn-rows-list">
        ${cmpRow('Possession', h.possession, a.possession, { text: v => `${v}%` })}
        ${cmpRow('Field tilt', h.fieldTilt, a.fieldTilt, { text: v => `${v}%`, hint: 'Share of final-third passes: who spent more time in the attacking third' })}
        ${cmpRow('PPDA', h.ppda, a.ppda, { lower: true, text: v => v.toFixed(1), hint: 'Opponent passes allowed per defensive action. Lower = more intense pressing' })}
        ${cmpRow('Average pass length (m)', h.avgPassLength, a.avgPassLength, { text: v => v.toFixed(1) })}
        ${cmpRow('Directness (long-ball share)', h.directness, a.directness, { text: v => `${v}%` })}
        ${cmpRow('Defensive line height (m)', h.defLine, a.defLine, { text: v => v.toFixed(1) })}
        ${cmpRow('Progressive passes', h.progPasses, a.progPasses)}
        ${cmpRow('Progressive carries', h.progCarries, a.progCarries)}
        ${cmpRow('Final-third entries', h.finalThird, a.finalThird)}
        ${cmpRow('Key passes', h.keyPasses, a.keyPasses)}
        ${cmpRow('Crosses', h.crossesAcc, a.crossesAcc, { text: (v, i) => `${[h, a][i].crossesAcc}/${[h, a][i].crossesAtt}` })}
        ${cmpRow('Successful dribbles', h.dribblesWon, a.dribblesWon, { text: (v, i) => `${[h, a][i].dribblesWon}/${[h, a][i].dribbles}` })}
        ${cmpRow('Duels won', h.duelsWon, a.duelsWon, { text: (v, i) => `${pct([h, a][i].duelsWon, [h, a][i].duels)}%` })}
        ${cmpRow('Big chances', h.bigChances, a.bigChances)}
        </div>
        <button class="sn-more" data-action="style-rows" hidden></button>
        <div class="sn-bottom">${LINEUPS[match.id] ? passNetwork(match) : buildUpRoutes(match)}</div>
      </div>
      ${blockPanel(match, h, a, ex)}
    </div>`;
}

// ----- Style review: editorial layout with heatmaps and an animated shape pitch -----

// Default 4-3-3 for matches without lineup data (home attacking right).
const DEFAULT_SHAPE = [['GK', 5, 50], ['LB', 18, 14], ['CB', 18, 38], ['CB', 18, 62], ['RB', 18, 86], ['CM', 31, 30], ['DM', 30, 50], ['CM', 31, 70], ['LW', 44, 18], ['ST', 46, 50], ['RW', 44, 82]];

// The side's XI as [label, x, y, pos], normalised so the team attacks left to right.
function reviewXI(match, side) {
  const L = LINEUPS[match.id];
  if (!L) return DEFAULT_SHAPE.map(([pos, x, y]) => [pos, x, y, pos]);
  return (side === 'home' ? L.home : L.away).map(([id, x, y]) => [PEOPLE[id].short, side === 'home' ? x : 100 - x, side === 'home' ? y : 100 - y, PEOPLE[id].pos]);
}

// In- and out-of-possession shapes anchored to the team's measured back line: out of
// possession the back four hold that line and the block sits compactly in front of it;
// in possession everyone steps up and the full-backs push on.
function shapes(match, side) {
  const tm = analytics(match).teams[side === 'home' ? 0 : 1];
  const line = tm.defLine / 1.05; // back line height as % of pitch length
  return reviewXI(match, side).map(([label, x, y, pos]) => {
    if (pos === 'GK') return { label, pos, inP: [12, y], outP: [6, y] };
    const fb = pos === 'LB' || pos === 'RB';
    const depth = x - 18; // distance in front of the back line in the base formation
    const inX = Math.min(92, line + 6 + depth * 1.35 + (fb ? 10 : 0));
    const inY = fb ? (y < 50 ? Math.max(10, y - 6) : Math.min(90, y + 6)) : y;
    const outX = Math.min(85, line + depth * 0.62);
    const outY = 50 + (y - 50) * 0.78;
    return { label, pos, inP: [inX, inY], outP: [outX, outY] };
  });
}

// Touch and recovery samples for the heatmaps, in pitch % (attacking left to right).
// scope 'last10' combines this match with nine earlier ones (sample data); 'g<k>' is a single
// match, k matches ago. Earlier matches use the same shape shifted a little
// up or down the pitch and with different volumes, as a team's games naturally vary.
function heatSamples(match, side, kind, scope = 'match') {
  const list = scope === 'last10' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [Number(String(scope).replace('g', '')) || 0];
  const games = list.length;
  const pts = [];
  for (const gIdx of list) {
    const r = rng(`heat-${kind}-${match.id}-${side}-${gIdx}`);
    const gauss = () => (r() + r() + r() - 1.5) * 1.2;
    const shiftX = gIdx ? (r() - 0.5) * 10 : 0;
    const volume = gIdx ? 0.75 + r() * 0.5 : 1;
    if (kind === 'touch') {
      const { players } = analytics(match);
      shapes(match, side).forEach(p => {
        const pl = players && players.find(q => q.side === side && PEOPLE[q.id] && PEOPLE[q.id].short === p.label);
        const n = Math.round((((pl ? pl.passesAcc : 30) / 4) + 6) * volume);
        for (let k = 0; k < n; k++) {
          const t = r(); // blend between out- and in-possession positions
          pts.push([p.outP[0] + (p.inP[0] - p.outP[0]) * t + shiftX + gauss() * 9, p.outP[1] + (p.inP[1] - p.outP[1]) * t + gauss() * 8, 1]);
        }
      });
    } else {
      // Recoveries happen around where players defend: sample near the out-of-possession
      // positions, with the count per third taken from the match recoveries.
      const ex = styleExtras(match)[side === 'home' ? 0 : 1];
      const outfield = shapes(match, side).filter(p => p.pos !== 'GK');
      ex.recoveries.forEach((n, third) => {
        const lo = third * 33.3, hi = lo + 33.3;
        for (let k = 0; k < Math.round(n * volume); k++) {
          const p = outfield[Math.floor(r() * outfield.length)];
          const x = Math.max(lo - 6, Math.min(hi + 6, p.outP[0] + (third - 1) * 14 + shiftX + gauss() * 10));
          pts.push([x, p.outP[1] + gauss() * 10, 1.4]);
        }
      });
    }
  }
  return pts.map(([x, y, w]) => [Math.max(1, Math.min(99, x)), Math.max(1, Math.min(99, y)), w / games]);
}

// The side's last ten matches, most recent first: today plus nine earlier sample results.
// Uses the same generator as the Team form card, so its five games match the first five here.
function recentGames(match, side) {
  const team = side === 'home' ? match.home : match.away;
  const t = side === 'home' ? 0 : 1;
  const opponents = FORM_POOL;
  const r = rng('form-' + team);
  const earlier = Array.from({ length: 9 }, () => {
    let opp; do { opp = opponents[randInt(r, 0, opponents.length - 1)]; } while (opp === team);
    return { opp, f: randInt(r, 0, 4), a: randInt(r, 0, 2) };
  });
  return [{ opp: t ? match.home : match.away, f: match.score[t], a: match.score[1 - t] }, ...earlier]
    .map((g, k) => ({ ...g, k, res: g.f > g.a ? 'W' : g.f === g.a ? 'D' : 'L' }));
}

function scopeLabel(match, side) {
  if (state.heatScope === 'last10') return 'last 10 matches';
  const g = recentGames(match, side)[Number(state.heatScope.replace('g', '')) || 0];
  return `${g.k === 0 ? 'today' : `${g.k} match${g.k > 1 ? 'es' : ''} ago`} vs ${esc(g.opp)} (${g.res} ${g.f}-${g.a})`;
}

const PITCH_LINES = `
  <rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><circle cx="52.5" cy="34" r="9.15"/>
  <rect x="0" y="13.85" width="16.5" height="40.3"/><rect x="88.5" y="13.85" width="16.5" height="40.3"/>
  <rect x="0" y="24.85" width="5.5" height="18.3"/><rect x="99.5" y="24.85" width="5.5" height="18.3"/>`;

function heatFigure(match, side, kind) {
  return `
    <div class="rv-pitch rv-pitch-plain">
      <canvas class="rv-heat" data-heat="${kind}" data-side="${side}" data-match="${match.id}" data-scope="${state.heatScope}" width="420" height="272"></canvas>
      <svg class="rv-lines" viewBox="-1 -1 107 70" aria-hidden="true">${PITCH_LINES}</svg>
      <span class="rv-dir">Attacking →</span>
    </div>
    <div class="rv-scale"><span>Low</span><i></i><span>High</span></div>`;
}

// Team shape: a static pitch that switches between the in- and out-of-possession shapes.
function shapeFigure(match, side) {
  const phase = state.shapePhase || 'in';
  return `
    <div class="rv-pitch rv-pitch-plain rv-shape" data-side="${side}" data-match="${match.id}">
      <svg viewBox="-1 -1 107 70" role="img" aria-label="Team shape ${phase === 'in' ? 'in' : 'out of'} possession">
        <g class="rv-lines-g">${PITCH_LINES}</g>
        <line class="rv-defline" x1="0" x2="0" y1="0" y2="68"/>
        <g class="rv-players"></g>
      </svg>
    </div>`;
}

// Pizza chart: one slice per style trait, slice length = the team's 0-100 score; the
// opponent's score is marked with a dashed arc in each slice.
function pizzaChart(names, mine, theirs, side, hints) {
  const S = 300, c = S / 2, r0 = 26, r1 = 118, n = names.length, gap = 0.035;
  const rad = v => r0 + (r1 - r0) * (v / 100);
  const pt = (a, r) => [c + Math.sin(a) * r, c - Math.cos(a) * r];
  const arc = (a0, a1, r) => { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
  const wedge = (a0, a1, rOut) => {
    const [ix0, iy0] = pt(a0, r0), [ix1, iy1] = pt(a1, r0), [ox0, oy0] = pt(a0, rOut), [ox1, oy1] = pt(a1, rOut);
    return `M${ix0.toFixed(1)},${iy0.toFixed(1)} L${ox0.toFixed(1)},${oy0.toFixed(1)} A${rOut},${rOut} 0 0 1 ${ox1.toFixed(1)},${oy1.toFixed(1)} L${ix1.toFixed(1)},${iy1.toFixed(1)} A${r0},${r0} 0 0 0 ${ix0.toFixed(1)},${iy0.toFixed(1)} Z`;
  };
  const slices = names.map((name, i) => {
    const a0 = (i / n) * Math.PI * 2 + gap, a1 = ((i + 1) / n) * Math.PI * 2 - gap, mid = (a0 + a1) / 2;
    const [lx, ly] = pt(mid, r1 + 12);
    const [vx, vy] = pt(mid, Math.max(rad(mine[i]) - 12, r0 + 10));
    return `
      <path d="${wedge(a0, a1, r1)}" class="pz-bg"/>
      <path d="${wedge(a0, a1, rad(mine[i]))}" class="pz-slice ${side}" style="opacity:${(0.55 + mine[i] / 220).toFixed(2)}"><title>${esc(name)}: ${mine[i]} — ${esc(hints[i])}</title></path>
      <path d="${arc(a0 + 0.02, a1 - 0.02, rad(theirs[i]))}" class="pz-them"><title>Opponent ${esc(name)}: ${theirs[i]}</title></path>
      <text x="${vx.toFixed(1)}" y="${(vy + 4).toFixed(1)}" text-anchor="middle" class="pz-val">${mine[i]}</text>
      <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${Math.abs(Math.sin(mid)) < 0.3 ? 'middle' : Math.sin(mid) > 0 ? 'start' : 'end'}" class="pz-label">${esc(name)}</text>`;
  }).join('');
  const rings = [25, 50, 75].map(v => `<circle cx="${c}" cy="${c}" r="${rad(v)}" class="pz-ring"/>`).join('');
  return `<svg class="pizza" viewBox="-115 -26 ${S + 230} ${S + 52}" role="img" aria-label="Style profile pizza chart">${slices}${rings}<circle cx="${c}" cy="${c}" r="${r0 - 4}" class="pz-hub"/></svg>`;
}

function styleReviewTab(match) {
  const side = state.styleTeam;
  const t = side === 'home' ? 0 : 1;
  const other = side === 'home' ? 'away' : 'home';
  const team = side === 'home' ? match.home : match.away;
  const opp = side === 'home' ? match.away : match.home;
  const me = analytics(match).teams[t];
  const mine = styleHistory(match, side)[0];
  const theirs = styleHistory(match, other)[0];
  const [hv, av] = side === 'home' ? [mine, theirs] : [theirs, mine];
  const probs = classify(mine);
  const lanes = attackLanes(match, side);
  const lane = lanes.indexOf(Math.max(...lanes));
  const phase = state.shapePhase || 'in';
  return `
    <div class="style-now style-review">
      <div class="sn-panel">
        <h3 class="style-h"><span class="sh-t">Style profile</span> <span class="muted">vs ${esc(opp)} (dashed)</span></h3>
        ${pizzaChart(STYLE_FEATURES.map(f => f[1]), mine, theirs, side, STYLE_FEATURES.map(f => f[2]))}
        <div class="donut-side">
          <div><span class="muted">Style</span><b class="${side}-text">${probs[0].name}</b></div>
          <div><span class="muted">Style match</span><b>${Math.round(probs[0].p * 100)}%</b></div>
          <div><span class="muted">Field tilt</span><b>${me.fieldTilt}%</b></div>
          <div><span class="muted">Main channel</span><b>${['Left', 'Centre', 'Right'][lane]} <span class="muted">${lanes[lane]}%</span></b></div>
        </div>
        <div class="sn-bottom">
          <h3 class="style-h">Closest styles <span class="muted">this match</span></h3>
          <div class="sc-list">${probs.map(a => `
            <div class="sc-row"><span>${a.name}</span><span class="sc-bar"><i class="${side}" style="width:${Math.round(a.p * 100)}%"></i></span><b>${Math.round(a.p * 100)}%</b></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="sn-panel sn-rows">
        <h3 class="style-h sn-pad">Style traits <span class="muted">${esc(match.home)} · ${esc(match.away)}</span></h3>
        ${STYLE_FEATURES.map(([, name, hint], i) => cmpRow(name, hv[i], av[i], { hint })).join('')}
        <div class="sn-bottom pn-wrap">
          <h3 class="style-h"><span class="sh-t">Touch map</span>
            <label class="scope-pick scope-sm">
              <select data-heat-scope aria-label="Choose which match to review">
                <option value="last10" ${state.heatScope === 'last10' ? 'selected' : ''}>Last 10 matches</option>
                ${recentGames(match, side).map(g => `<option value="g${g.k}" ${state.heatScope === `g${g.k}` ? 'selected' : ''}>${g.k === 0 ? 'Today' : `−${g.k}`} · vs ${esc(g.opp)} · ${g.res} ${g.f}-${g.a}</option>`).join('')}
              </select>
            </label>
          </h3>
          ${heatFigure(match, side, 'touch')}
        </div>
      </div>
      <div class="sn-panel">
        <h3 class="style-h"><span class="sh-t">Team shape</span> <span class="muted">average positions</span></h3>
        <div class="seg shape-seg">${[['in', 'In possession'], ['out', 'Out of possession']].map(([v, l]) => `<button class="${phase === v ? 'on' : ''}" aria-pressed="${phase === v}" data-action="shape-phase" data-value="${v}">${l}</button>`).join('')}</div>
        ${shapeFigure(match, side)}
        <div class="bp-legend">
          <span><i class="key ${side}"></i>${esc(team)}</span>
          <span><i class="rv-line-key"></i>Back line · ${me.defLine.toFixed(0)} m from goal out of possession</span>
        </div>
        <div class="sn-bottom">
          <h3 class="style-h">Ball recoveries <span class="muted">${scopeLabel(match, side)}</span></h3>
          ${heatFigure(match, side, 'recovery')}
        </div>
      </div>
    </div>`;
}

// Draw heatmaps (canvas) and start the shape animation after each render.
function mountStyleReview() {
  for (const canvas of document.querySelectorAll('.rv-heat')) {
    const match = MATCHES.find(m => m.id === canvas.dataset.match);
    drawHeat(canvas, heatSamples(match, canvas.dataset.side, canvas.dataset.heat, canvas.dataset.scope));
  }
  const box = document.querySelector('.rv-shape');
  if (!box) return;
  const match = MATCHES.find(m => m.id === box.dataset.match);
  const side = box.dataset.side;
  const pts = shapes(match, side);
  const g = box.querySelector('.rv-players');
  // Place each name above, below, left or right of its dot, whichever spot doesn't collide
  // with a name already placed or another dot (checked on the compact out-of-possession shape).
  const placed = [];
  const dots = pts.map(p => [p.outP[0] * 1.05, p.outP[1] * 0.68]);
  const spot = (p, i) => {
    const [x, y] = dots[i];
    const w = p.label.length * 1.15 + 0.6, h = 2.4;
    const options = [[0, -2.9, 'middle'], [0, 4.9, 'middle'], [2.6 + w / 2, 0.8, 'start'], [-2.6 - w / 2, 0.8, 'end']];
    const box = ([dx, dy]) => [x + dx - w / 2, y + dy - h + 0.4, w, h];
    const hits = b => placed.some(o => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3])
      || dots.some(([dx, dy], j) => j !== i && dx > b[0] - 1.9 && dx < b[0] + b[2] + 1.9 && dy > b[1] - 1.9 && dy < b[1] + b[3] + 1.9);
    const choice = options.find(o => !hits(box(o))) || options[0];
    placed.push(box(choice));
    const [dx, dy, anchor] = choice;
    return `x="${anchor === 'middle' ? 0 : (dx > 0 ? 2.6 : -2.6)}" y="${dy}" text-anchor="${anchor}"`;
  };
  g.innerHTML = pts.map((p, i) => `<g class="rv-player ${side} ${p.pos === 'GK' ? 'gk' : ''}"><circle r="2.3"/><text ${spot(p, i)}>${esc(p.label)}</text></g>`).join('');
  placeShape(box, pts, state.shapePhase || 'in');
}

// Move the players to the chosen phase; CSS transitions animate the change once.
function placeShape(box, pts, phase) {
  const key = phase === 'in' ? 'inP' : 'outP';
  [...box.querySelectorAll('.rv-player')].forEach((el, i) => {
    el.style.transform = `translate(${(pts[i][key][0] * 1.05).toFixed(2)}px, ${(pts[i][key][1] * 0.68).toFixed(2)}px)`;
  });
  const defs = pts.filter(p => ['CB', 'LB', 'RB'].includes(p.pos));
  const bl = (defs.reduce((s, p) => s + p[key][0], 0) / (defs.length || 1)) * 1.05;
  const line = box.querySelector('.rv-defline');
  line.style.transform = `translateX(${bl.toFixed(2)}px)`;
}

function setShapePhase(phase) {
  state.shapePhase = phase;
  saveView();
  const box = document.querySelector('.rv-shape');
  if (!box) return;
  document.querySelectorAll('.shape-seg button').forEach(b => {
    b.classList.toggle('on', b.dataset.value === phase);
    b.setAttribute('aria-pressed', b.dataset.value === phase);
  });
  placeShape(box, shapes(MATCHES.find(m => m.id === box.dataset.match), box.dataset.side), phase);
}

// Kernel-density heatmap: accumulate Gaussian kernels on a float grid (one cell ≈ 0.75 m),
// colour it by intensity, then scale it smoothly onto the canvas.
function drawHeat(canvas, pts) {
  const gw = 140, gh = 91, R = 10, sigma2 = 2 * 4.2 * 4.2;
  const grid = new Float32Array(gw * gh);
  const kernel = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 <= R * R) kernel.push([dx, dy, Math.exp(-d2 / sigma2)]);
  }
  for (const [x, y, w] of pts) {
    const cx = Math.round((x / 100) * (gw - 1)), cy = Math.round((y / 100) * (gh - 1));
    for (const [dx, dy, k] of kernel) {
      const gx = cx + dx, gy = cy + dy;
      if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) grid[gy * gw + gx] += k * w;
    }
  }
  let max = 0;
  for (const v of grid) if (v > max) max = v;
  const ramp = [[0, [45, 110, 225, 0]], [0.1, [45, 110, 225, 0]], [0.22, [45, 110, 225, 150]], [0.45, [45, 175, 90, 195]], [0.7, [250, 215, 45, 220]], [1, [220, 30, 40, 240]]];
  const colour = v => {
    for (let i = 1; i < ramp.length; i++) if (v <= ramp[i][0]) {
      const [a, ca] = ramp[i - 1], [z, cz] = ramp[i], f = (v - a) / (z - a);
      return ca.map((c, k) => c + (cz[k] - c) * f);
    }
    return ramp[ramp.length - 1][1];
  };
  const small = document.createElement('canvas');
  small.width = gw; small.height = gh;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(gw, gh);
  for (let i = 0; i < grid.length; i++) {
    const [r, g, b, a] = colour(grid[i] / (max || 1));
    img.data.set([r, g, b, a], i * 4);
  }
  sctx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}

// Ring chart of the style odds: one segment per style in the team colour, strongest first.
function styleDonut(probs, side, now) {
  const R = 42, C = 2 * Math.PI * R;
  const shown = probs.filter(a => Math.round(a.p * 100) > 0);
  let at = 0;
  const segs = shown.map((a, i) => {
    const len = a.p * C;
    const seg = `<circle cx="55" cy="55" r="${R}" class="sd-seg ${side === 'mix' ? (i ? 'away' : 'home') : side}" style="opacity:${side === 'mix' ? [1, 1, .6, .35, .2][i] : [1, .55, .3, .18, .1][i]}" stroke-dasharray="${Math.max(len - 1.5, 0.5).toFixed(1)} ${C.toFixed(1)}" transform="rotate(${(-90 + (at / C) * 360).toFixed(1)} 55 55)"><title>${a.name}: ${Math.round(a.p * 100)}%</title></circle>`;
    at += len;
    return seg;
  }).join('');
  const top = probs[0];
  return `
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 110 110" role="img" aria-label="${probs.map(a => `${a.name} ${Math.round(a.p * 100)}%`).join(', ')}">
        <circle cx="55" cy="55" r="${R}" class="sd-track"/>
        ${segs}
        <text x="55" y="52" text-anchor="middle" class="donut-big">${Math.round(top.p * 100)}%</text>
        <text x="55" y="67" text-anchor="middle" class="donut-small">most likely</text>
      </svg>
      <div class="donut-side">
        <div><span class="muted">Most likely</span><b class="${side === 'mix' ? 'home' : side}-text">${top.name}</b></div>
        <div><span class="muted">Today</span><b>${now.name}</b></div>
        ${probs.slice(1, 3).map(a => `<div><span class="muted">${a.name}</span><b>${Math.round(a.p * 100)}%</b></div>`).join('')}
      </div>
    </div>`;
}

// How closely each of the last ten matches fitted the predicted style, then the prediction.
function styleTrend(hist, top, side) {
  const W = 300, H = 112, t = 16, btm = 80;
  const vals = hist.map(v => Math.round(classify(v).find(a => a.name === top.name).p * 100)).reverse();
  vals.push(Math.round(top.p * 100));
  const X = i => 14 + (i / (vals.length - 1)) * (W - 28);
  const Y = v => t + ((100 - v) / 100) * (btm - t);
  const pts = vals.map((v, i) => [X(i), Y(v)]);
  const past = pts.slice(0, -1);
  const [tx, ty] = past[past.length - 1], [nx, ny] = pts[pts.length - 1];
  const labels = { 0: '−9', 3: '−6', 6: '−3', 9: 'Today', 10: 'Next' };
  return `
    <h3 class="style-h">Style trend <span class="muted">${top.name.toLowerCase()} fit, last 10</span></h3>
    <svg class="poss-time" viewBox="0 0 ${W} ${H}" role="img" aria-label="${top.name} fit over the last ten matches: ${vals.slice(0, -1).join('%, ')}%; next match ${vals[vals.length - 1]}%">
      ${[25, 75].map(v => `<line x1="${X(0)}" x2="${X(10)}" y1="${Y(v)}" y2="${Y(v)}" class="pt-grid"/>`).join('')}
      <line x1="${X(9.5)}" x2="${X(9.5)}" y1="${t - 6}" y2="${btm + 4}" class="pt-grid ht"/>
      <defs>
        <clipPath id="st-a"><rect x="0" y="0" width="${W}" height="${Y(50)}"/></clipPath>
        <clipPath id="st-b"><rect x="0" y="${Y(50)}" width="${W}" height="${H}"/></clipPath>
      </defs>
      <path d="${smoothPath(past)} L${tx},${Y(50)} L${past[0][0]},${Y(50)} Z" class="pt-fill home" clip-path="url(#st-a)"/>
      <path d="${smoothPath(past)} L${tx},${Y(50)} L${past[0][0]},${Y(50)} Z" class="pt-fill away" clip-path="url(#st-b)"/>
      <line x1="${X(0)}" x2="${X(10)}" y1="${Y(50)}" y2="${Y(50)}" class="pt-mid"/>
      <path d="${smoothPath(past)}" class="pt-line"/>
      <line x1="${tx}" y1="${ty}" x2="${nx}" y2="${ny}" class="pt-line st-next"/>
      ${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === pts.length - 1 ? 4 : 3}" class="pt-dot ${i === pts.length - 1 ? `st-pred ${side === 'mix' ? (vals[i] >= 50 ? 'home' : 'away') : side}` : ''}"/>${i % 3 === 0 || i >= 9 ? `<text x="${x}" y="${y - 7}" text-anchor="middle" class="pt-val">${vals[i]}</text>` : ''}`).join('')}
      ${Object.entries(labels).map(([i, l]) => `<text x="${X(+i)}" y="${H - 14}" text-anchor="middle" class="pt-tick">${l}</text>`).join('')}
    </svg>`;
}

// Predicted value as a filled meter, with a notch where the team was today.
function predictRow(name, next, today, hint, side) {
  return `
    <div class="cmp" title="${esc(hint)}">
      <div class="cmp-top"><b class="lead ${side}-lead">${next}</b><span>${name}</span><b>${today}</b></div>
      <div class="pr-meter"><i class="${side}" style="width:${next}%"></i><b style="left:${today}%"></b></div>
    </div>`;
}

function xiPitch(match, xi, side) {
  const fx = x => (side === 'home' ? x : 100 - x);
  const X = x => 8 + ((fx(x) - 5) / 39) * 86; // own half stretched across the pitch
  const Y = y => 4 + y * 0.6;
  return `
    <svg class="pass-net xi-net" viewBox="-1 -1 107 70" role="img" aria-label="Predicted starting eleven with each player's chance to start">
      ${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 10.5}" y="0" width="10.6" height="68" class="xi-turf ${i % 2 ? 'b' : 'a'}"/>`).join('')}
      <g class="bp-lines xi-lines"><rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><circle cx="52.5" cy="34" r="9.15"/><rect x="0" y="13.85" width="16.5" height="40.3"/><rect x="88.5" y="13.85" width="16.5" height="40.3"/></g>
      ${xi.map(s => {
        const x = X(s.x).toFixed(1), y = Y(s.y).toFixed(1), change = s.pick !== s.starter;
        return `<g class="xi-node ${side}" data-action="player" data-id="${s.pick}" data-match="${match.id}">
          ${change ? `<circle cx="${x}" cy="${y}" r="5.9" class="xi-new"/>` : ''}
          <circle cx="${x}" cy="${y}" r="4.6"><title>${esc(PEOPLE[s.pick].name)}: ${s.prob}% to start${change ? ` (in for ${esc(PEOPLE[s.starter].name)})` : ''}</title></circle>
          <text x="${x}" y="${(+y + 1.3).toFixed(1)}" text-anchor="middle" class="xi-val">${s.prob}</text>
          <text x="${x}" y="${(+y + 7.9).toFixed(1)}" text-anchor="middle" class="xi-name">${esc(PEOPLE[s.pick].short)}</text>
        </g>`;
      }).join('')}
    </svg>`;
}

function xiPersonRow(match, id, note, prob) {
  return `
    <button class="nx-row" data-action="player" data-id="${id}" data-match="${match.id}">
      ${avatar(id, 'sm')}
      <span class="nx-row-name"><b>${esc(PEOPLE[id].name)}</b><small>${note}</small></span>
      <span class="nx-row-prob"><b>${prob}%</b><i style="--p:${prob}"></i></span>
    </button>`;
}

function styleNextTab(match) {
  const side = state.styleTeam;
  const team = side === 'home' ? match.home : match.away;
  const hist = styleHistory(match, side);
  const nextVec = predictStyle(hist);
  const probs = classify(nextVec);
  const now = classify(hist[0])[0];
  const L = LINEUPS[match.id];
  const formation = L.formations[side === 'home' ? 0 : 1];
  const xi = predictLineup(match, side);
  const changes = xi.filter(s => s.pick !== s.starter);
  const byChance = [...xi].sort((a, b) => a.prob - b.prob);
  const confidence = Math.round(xi.reduce((a, s) => a + s.prob, 0) / xi.length);
  return `
    <div class="style-now style-next">
      <div class="sn-panel">
        <h3 class="style-h">Predicted style <span class="muted">next match</span></h3>
        ${styleDonut(probs, 'mix', now)}
        <div class="sn-bottom">${styleTrend(hist, probs[0], 'mix')}</div>
      </div>
      <div class="sn-panel sn-rows">
        <h3 class="style-h sn-pad">Expected profile <span class="muted">predicted · today</span></h3>
        ${STYLE_FEATURES.map(([, name, hint], i) => predictRow(name, nextVec[i], hist[0][i], hint, side)).join('')}
        <div class="sn-bottom pn-wrap">
          <h3 class="style-h">Predicted XI · ${formation} <span class="muted">% chance to start</span></h3>
          ${xiPitch(match, xi, side)}
          <div class="bp-legend">
            <span><i class="key ${side}"></i>${esc(team)} · ${confidence}% avg. chance to start</span>
            <span><i class="key dot ring"></i>New in the XI</span>
          </div>
        </div>
      </div>
      <div class="sn-panel">
        <h3 class="style-h">Lineup changes <span class="muted">vs today’s XI</span></h3>
        ${changes.length ? changes.map(s => xiPersonRow(match, s.pick, `In for ${esc(PEOPLE[s.starter].name)}`, s.prob)).join('') : '<p class="nx-empty">No changes expected.</p>'}
        <div class="sn-bottom">
          <h3 class="style-h">Starting chances <span class="muted">least certain first</span></h3>
          <div class="sc-list">${byChance.map(s => `
            <button class="sc-row" data-action="player" data-id="${s.pick}" data-match="${match.id}">
              <span>${esc(PEOPLE[s.pick].short)}</span>
              <span class="sc-bar"><i class="${side}" style="width:${s.prob}%"></i></span>
              <b>${s.prob}%</b>
            </button>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
}

function styleCoachTab(match) {
  const side = state.styleTeam;
  const L = LINEUPS[match.id];
  const i = side === 'home' ? 0 : 1;
  const coach = L.coaches[i];
  const team = side === 'home' ? match.home : match.away;
  const d = details(match);
  const { teams, players } = analytics(match);
  const [h, a] = teams;
  const subsOf = s => d.events.filter(e => e.type === 'sub' && e.side === s);
  const subs = subsOf(side);
  const goals = d.events.filter(e => e.type === 'goal' || e.type === 'owngoal');
  const goalsFor = match.score[i], goalsAgainst = match.score[1 - i];
  const result = goalsFor > goalsAgainst ? 'Win' : goalsFor === goalsAgainst ? 'Draw' : 'Loss';
  const style = classify(styleHistory(match, side)[0])[0];
  const attacking = s => subsOf(s).filter(e => ['ST', 'LW', 'RW', 'AM'].includes(PEOPLE[e.who].pos)).length;
  const first = s => (subsOf(s)[0] ? subsOf(s)[0].min : 90);
  const scoreAt = min => {
    let f = 0, g = 0;
    for (const e of goals) if (e.min <= min) (e.side === side ? f++ : g++);
    return `${f}-${g}`;
  };
  const bench = players.filter(p => p.side === side && p.sub && p.minutes > 0).sort((x, y) => (y.rating || 0) - (x.rating || 0));
  return `
    <div class="style-now style-coach">
      <div class="sn-panel">
        <h3 class="style-h">Head coach <span class="muted">${esc(team)}</span></h3>
        <button class="cx-photo" data-action="coach" data-id="${coach}">${avatar(coach, 'xl')}<b>${esc(PEOPLE[coach].name)}</b><span class="muted">${crest(team)} ${esc(team)}</span></button>
        <div class="donut-side">
          <div><span class="muted">Result</span><b class="${goalsFor > goalsAgainst ? 'cx-win' : goalsFor < goalsAgainst ? 'cx-loss' : ''}">${result} ${goalsFor}-${goalsAgainst}</b></div>
          <div><span class="muted">Formation</span><b>${L.formations[i]}</b></div>
          <div><span class="muted">Style today</span><b>${style.name}</b></div>
          <div><span class="muted">Changes</span><b>${subs.length}${subs.length ? ` <span class="muted">from ${subs[0].min}′</span>` : ''}</b></div>
        </div>
        <div class="sn-bottom">
          <h3 class="style-h">Tactical fingerprint <span class="muted">this match</span></h3>
          <div class="cx-facts">${fingerprint(match, side).slice(0, 5).map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('')}</div>
        </div>
      </div>
      <div class="sn-panel sn-rows">
        <h3 class="style-h sn-pad">Management <span class="muted">${esc(match.home)} · ${esc(match.away)}</span></h3>
        ${cmpRow('Substitutions', subsOf('home').length, subsOf('away').length)}
        ${cmpRow('Attacking changes', attacking('home'), attacking('away'))}
        ${cmpRow('First change (min)', first('home'), first('away'), { lower: true, text: v => (v >= 90 ? '—' : `${v}′`) })}
        ${cmpRow('Possession', h.possession, a.possession, { text: v => `${v}%` })}
        ${cmpRow('PPDA', h.ppda, a.ppda, { lower: true, text: v => v.toFixed(1), hint: 'Opponent passes allowed per defensive action. Lower = more intense pressing' })}
        ${cmpRow('Defensive line height (m)', h.defLine, a.defLine, { text: v => v.toFixed(1) })}
        <div class="sn-bottom pn-wrap">
          <h3 class="style-h">In-game timeline <span class="muted">0–90′</span></h3>
          <div class="cx-line" role="img" aria-label="Timeline of substitutions and goals">
            <i class="cx-ht"></i>
            ${goals.map(g => `<span class="cx-goal ${g.side}" style="left:${Math.min(g.min, 95) / 95 * 100}%" title="${g.min}′ ${esc(g.side === 'home' ? match.home : match.away)} goal">${svgIcon('ball')}</span>`).join('')}
            ${subWindows(subs).map(at => `<span class="cx-sub" style="left:${Math.min(at[0].min, 95) / 95 * 100}%" title="${at.map(e => `${e.min}′ ${esc(PEOPLE[e.who].name)} for ${esc(PEOPLE[e.detail].name)}`).join(', ')}">${at.length}</span>`).join('')}
            <span class="cx-tick" style="left:0">0′</span><span class="cx-tick" style="left:47.4%">HT</span><span class="cx-tick" style="left:100%">90′</span>
          </div>
          <div class="bp-legend">
            <span><i class="cx-key"></i>${esc(team)} substitutions (number made)</span>
            <span><i class="key home"></i>${esc(match.home)} goal &nbsp; <i class="key away"></i>${esc(match.away)} goal</span>
          </div>
        </div>
      </div>
      <div class="sn-panel">
        <h3 class="style-h">Substitutions <span class="muted">score when made</span></h3>
        ${subs.length ? subs.map(e => `
          <button class="nx-row cx-row" data-action="player" data-id="${e.who}" data-match="${match.id}">
            ${avatar(e.who, 'sm')}
            <span class="nx-row-name"><b>${esc(PEOPLE[e.who].name)}</b><small>In for ${esc(PEOPLE[e.detail].name)}</small></span>
            <span class="cx-when"><b>${e.min}′</b><small>at ${scoreAt(e.min)}</small></span>
          </button>`).join('') : '<p class="nx-empty">No substitutions made.</p>'}
        <div class="sn-bottom">
          <h3 class="style-h">Bench impact <span class="muted">rating</span></h3>
          <div class="sc-list">${bench.length ? bench.map(p => `
            <button class="sc-row" data-action="player" data-id="${p.id}" data-match="${match.id}">
              <span>${esc(PEOPLE[p.id].short)} <small class="muted">${p.minutes}′</small></span>
              <span class="sc-bar"><i class="${side}" style="width:${Math.max(0, Math.min(100, ((p.rating || 6) - 5) * 25))}%"></i></span>
              <span class="badge ${ratingClass(p.rating || 6)}">${(p.rating || 6).toFixed(1)}</span>
            </button>`).join('') : '<p class="nx-empty">No substitutes played.</p>'}
          </div>
        </div>
      </div>
    </div>`;
}

// Group substitutions made within three minutes of each other, so timeline labels don't collide.
function subWindows(subs) {
  const groups = [];
  for (const e of subs) {
    const g = groups[groups.length - 1];
    if (g && e.min - g[0].min <= 3) g.push(e); else groups.push([e]);
  }
  return groups;
}

// Plain-language tactical read-outs derived from the style vector and events.
function fingerprint(match, side) {
  const v = styleHistory(match, side)[0];
  const lanes = attackLanes(match, side);
  const i = side === 'home' ? 0 : 1;
  const subs = details(match).events.filter(e => e.type === 'sub' && e.side === side);
  const level = (x, lo, mid, hi) => (x >= 65 ? hi : x >= 40 ? mid : lo);
  const laneName = ['the left', 'the centre', 'the right'][lanes.indexOf(Math.max(...lanes))];
  const trailingAt = subs.length ? (() => {
    let h = 0, a = 0;
    for (const e of details(match).events) {
      if (e.min > subs[0].min) break;
      if (e.type === 'goal' || e.type === 'owngoal') e.side === 'home' ? h++ : a++;
    }
    const diff = i === 0 ? h - a : a - h;
    return diff < 0 ? 'while trailing' : diff > 0 ? 'while leading' : 'with the score level';
  })() : '';
  return [
    ['Build-up', level(v[2], 'Short, patient passing', 'Mixed short and long', 'Direct, early long balls')],
    ['Out of possession', level(v[1], 'Low block', 'Mid-block press', 'High press')],
    ['Defensive line', level(v[4], 'Deep', 'Medium', 'High')],
    ['Attacking focus', `Through ${laneName} (${Math.max(...lanes)}%)`],
    ['Tempo', level(v[5], 'Slow, controlled', 'Moderate', 'Fast, vertical')],
    ['In-game changes', subs.length ? `First change at ${subs[0].min}′ ${trailingAt}` : 'No substitutions'],
  ];
}

// Ranked bars for one stat across the team's players (top six).
function statBars(match, list, side, value, label) {
  const top = [...list].sort((a, b) => value(b) - value(a)).slice(0, 6);
  const max = Math.max(...top.map(value), 0.01);
  return `<div class="sc-list">${top.map(p => `
    <button class="sc-row sc-photo" data-action="player" data-id="${p.id}" data-match="${match.id}">
      ${avatar(p.id, 'sm')}<span>${esc(PEOPLE[p.id].short)}</span>
      <span class="sc-bar"><i class="${side}" style="width:${(value(p) / max) * 100}%"></i></span>
      <b>${label(p)}</b>
    </button>`).join('')}</div>`;
}

function styleKeyPlayersTab(match) {
  const side = state.styleTeam;
  const team = side === 'home' ? match.home : match.away;
  const { players } = analytics(match);
  const pool = players.filter(p => p.minutes >= 30 && p.group !== 'GK');
  const mine = pool.filter(p => p.side === side);
  const top = [...mine].sort((a, b) => b.rating - a.rating);
  const best = top[0];
  const leader = f => [...mine].sort((a, b) => f(b) - f(a))[0];
  const leaders = [
    ['Finisher', leader(p => p.xg), p => `${p.xg.toFixed(2)} xG`],
    ['Creator', leader(p => p.xa + p.keyPasses * 0.05), p => `${p.keyPasses} key pass${p.keyPasses === 1 ? '' : 'es'}`],
    ['Ball winner', leader(p => p.tackles + p.interceptions + p.recoveries * 0.4), p => `${p.tackles + p.interceptions} tackles + int.`],
    ['Dribbler', leader(p => p.dribblesWon), p => `${p.dribblesWon}/${p.dribbles} dribbles`],
  ];
  return `
    <div class="style-now style-keys">
      <div class="sn-panel">
        <h3 class="style-h">Best performer <span class="muted">${esc(team)}</span></h3>
        <button class="cx-photo" data-action="player" data-id="${best.id}" data-match="${match.id}">
          <span class="kx-photo">${avatar(best.id, 'xl')}<span class="badge ${ratingClass(best.rating)}">${best.rating.toFixed(1)}</span></span>
          <b>${esc(PEOPLE[best.id].name)}</b><span class="muted">${best.pos} · ${best.minutes}′ · ${roleOf(best, pool)}</span>
        </button>
        <div class="donut-side">
          <div><span class="muted">xG</span><b>${best.xg.toFixed(2)}</b></div>
          <div><span class="muted">xA</span><b>${best.xa.toFixed(2)}</b></div>
          <div><span class="muted">Progressive actions</span><b>${best.progPasses + best.progCarries}</b></div>
          <div><span class="muted">Duels won</span><b>${best.duelsWon}/${best.duels}</b></div>
        </div>
        <div class="sn-bottom">
          <h3 class="style-h">Who did what <span class="muted">team leader</span></h3>
          <div class="cx-facts">${leaders.map(([k, p, t]) => `<div><span class="muted">${k}</span><button class="kx-lead" data-action="player" data-id="${p.id}" data-match="${match.id}">${avatar(p.id, 'sm')}<span><b>${esc(PEOPLE[p.id].short)}</b><small class="muted">${t(p)}</small></span></button></div>`).join('')}</div>
        </div>
      </div>
      <div class="sn-panel">
        <h3 class="style-h">Top performers <span class="muted">match rating</span></h3>
        ${top.slice(0, 5).map((p, n) => `
          <button class="kx-row" data-action="player" data-id="${p.id}" data-match="${match.id}">
            <span class="kx-rank">${n + 1}</span>
            ${avatar(p.id, 'sm')}
            <span class="kx-who"><b>${esc(PEOPLE[p.id].name)}</b><small>${p.pos} · ${p.minutes}′ · <em>${roleOf(p, pool)}</em></small></span>
            <span class="badge ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</span>
          </button>`).join('')}
        <div class="sn-bottom">
          <h3 class="style-h">Chances <span class="muted">xG + xA</span></h3>
          ${statBars(match, mine, side, p => p.xg + p.xa, p => (p.xg + p.xa).toFixed(2))}
        </div>
      </div>
      <div class="sn-panel">
        <h3 class="style-h">Ball progression <span class="muted">passes + carries</span></h3>
        ${statBars(match, mine, side, p => p.progPasses + p.progCarries, p => p.progPasses + p.progCarries)}
        <div class="sn-bottom">
          <h3 class="style-h">Defending <span class="muted">tackles + interceptions</span></h3>
          ${statBars(match, mine, side, p => p.tackles + p.interceptions, p => p.tackles + p.interceptions)}
        </div>
      </div>
    </div>`;
}

function styleCard(match) {
  const hasLineup = !!LINEUPS[match.id];
  const tabs = hasLineup ? STYLE_TABS : STYLE_TABS.slice(0, 2);
  if (!tabs.includes(state.styleTab)) state.styleTab = tabs[0];
  const body = {
    'This match': styleNowTab, 'Style review': styleReviewTab, 'Next match': styleNextTab, Coach: styleCoachTab, 'Key players': styleKeyPlayersTab,
  }[state.styleTab](match);
  return `
    <div class="card style-card">
      <div class="section-head">
        <h2 class="card-title">Style of play<span class="muted block">How each side played, and what comes next</span></h2>
        ${state.styleTab !== 'This match' ? teamSwitch(match) : `<span class="section-teams">${crest(match.home)}<span class="vs">vs</span>${crest(match.away)}</span>`}
      </div>
      <div class="style-tabs" role="tablist">
        ${tabs.map(t => `<button role="tab" class="style-tab ${state.styleTab === t ? 'on' : ''}" aria-selected="${state.styleTab === t}" data-action="style-tab" data-value="${t}">${t}</button>`).join('')}
      </div>
      <div class="style-body">${body}</div>
    </div>`;
}

// Fit the stat rows in "This match" to the height of the Block & press panel beside them:
// rows spread to fill it, and if they can't all fit, the last ones wait behind a
// "+N more stats" button that expands the list in place.
function fitStyleRows() {
  for (const grid of document.querySelectorAll('.style-now')) {
    const list = grid.querySelector('.sn-rows-list'), block = grid.querySelector('.block-top'), more = grid.querySelector('.sn-more');
    if (!list || !block) continue;
    const rows = [...list.children];
    rows.forEach(r => { r.hidden = false; });
    list.style.height = '';
    more.hidden = true;
    if (getComputedStyle(grid).gridTemplateColumns.split(' ').length < 3) continue; // stacked layouts
    if (state.styleRowsExpanded) {
      more.hidden = false;
      more.textContent = 'Show fewer stats ❮';
      continue;
    }
    const target = block.getBoundingClientRect().bottom - list.getBoundingClientRect().top;
    const room = () => target - (more.hidden ? 0 : more.offsetHeight + 6);
    let hidden = 0;
    while (list.scrollHeight > room() + 1 && hidden < rows.length - 4) {
      rows[rows.length - 1 - hidden].hidden = true;
      hidden++;
      more.hidden = false;
      more.textContent = `+${hidden} more stat${hidden > 1 ? 's' : ''} ❯`;
    }
    list.style.height = `${Math.max(room(), 0)}px`;
  }
}
window.addEventListener('resize', () => { clearTimeout(fitStyleRows.t); fitStyleRows.t = setTimeout(fitStyleRows, 100); });
