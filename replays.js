'use strict';

// Animated goal reconstructions. Each goal is a short script of keyframes: where the
// ball is, where the players directly involved are, and a caption. Everyone else
// moves with their team's shape relative to the ball. Scripts follow published match
// reports; exact player positions are approximations, not tracking data.
//
// Pitch coordinates are percentages: x 0-100 along the length (home attacks towards
// x = 100), y 0-100 across (top to bottom).

const REPLAY_SOURCES = [
  ['ESPN', 'https://www.espn.com/soccer/commentary/_/gameId/401915396'],
  ['beIN SPORTS', 'https://www.beinsports.com/en-us/soccer/uefa-champions-league/articles/all-goals-lille-vs-galatasaray-uefa-champions-league-2026-10-21'],
  ['VAVEL', 'https://www.vavel.com/en-us/soccer/2026/10/21/1276175-losc-lile-vs-galatasaray-live-score-uefa-champions-league.html'],
];

// keys: { t: seconds, ball?: [x, y], air?: ball travels in the air to this point,
//         shot?: this movement is a shot, caption?: text, p?: { personId: [x, y] } }
const REPLAYS = {
  'lille-galatasaray': [
    {
      min: 2, side: 'away', scorer: 'akgun', score: '0 - 1', title: 'Akgün',
      summary: 'Yılmaz’s cross from the left causes problems; Akgün finishes left-footed from the centre of the box.',
      keys: [
        { t: 0, ball: [60, 62], caption: 'Galatasaray win the ball early in midfield', p: { torreira: [60, 62], yilmaz: [46, 86], akgun: [46, 30], osimhen: [42, 50], goffi: [36, 82], ngoy: [30, 58], alexsandro: [30, 42] } },
        { t: 1.1, ball: [44, 84], caption: 'Torreira switches it out to Yılmaz on the left', p: { torreira: [58, 60], yilmaz: [44, 84], akgun: [40, 32], osimhen: [36, 48], goffi: [34, 80], ngoy: [26, 58], alexsandro: [26, 42] } },
        { t: 2.8, ball: [20, 82], caption: 'Yılmaz drives at Goffi down the flank', p: { torreira: [52, 58], yilmaz: [20, 82], akgun: [24, 40], osimhen: [16, 46], goffi: [22, 78], ngoy: [13, 56], alexsandro: [12, 44] } },
        { t: 3.8, ball: [11, 52], air: true, caption: 'The cross causes chaos in the Lille box', p: { yilmaz: [18, 82], akgun: [11, 52], osimhen: [8, 40], goffi: [18, 76], ngoy: [9, 58], alexsandro: [9, 45] } },
        { t: 4.4, ball: [0, 47], shot: true, caption: 'Akgün, left foot from the centre of the box — GOAL', p: { akgun: [10, 52], osimhen: [6, 41], ngoy: [8, 57], alexsandro: [8, 46] } },
      ],
    },
    {
      min: 7, side: 'home', scorer: 'diaoune', score: '1 - 1', title: 'Diaoune',
      summary: 'Diaoune races through on the left, rounds Çakır and rolls into the empty net.',
      keys: [
        { t: 0, ball: [26, 40], caption: 'Lille recover the ball in their own half', p: { alexsandro: [26, 40], haraldsson: [44, 46], diaoune: [50, 26], sanchez: [70, 38], bardakci: [72, 60], cakir: [95, 50] } },
        { t: 1.0, ball: [44, 46], caption: 'Played into Haraldsson between the lines', p: { alexsandro: [28, 40], haraldsson: [44, 46], diaoune: [55, 25], sanchez: [70, 36], bardakci: [72, 58] } },
        { t: 2.6, ball: [78, 28], caption: 'Ball in behind — Diaoune is away', p: { haraldsson: [50, 46], diaoune: [76, 28], sanchez: [74, 33], bardakci: [76, 52] } },
        { t: 3.6, ball: [87, 34], caption: 'He races clear as Çakır comes out', p: { diaoune: [87, 34], sanchez: [82, 35], bardakci: [84, 50], cakir: [90, 42] } },
        { t: 4.3, ball: [92, 30], caption: 'Diaoune rounds the goalkeeper', p: { diaoune: [92, 30], sanchez: [87, 36], cakir: [89, 38] } },
        { t: 5.0, ball: [100, 45], shot: true, caption: 'Left foot into the empty net — GOAL', p: { diaoune: [94, 33], sanchez: [92, 40], cakir: [89, 39] } },
      ],
    },
    {
      min: 39, side: 'home', scorer: 'diaoune', score: '2 - 1', title: 'Diaoune',
      summary: 'Diaoune pounces on a loose ball inside the area and fires right-footed into the top corner.',
      keys: [
        { t: 0, ball: [70, 84], caption: 'Bakwa attacks down the right', p: { bakwa: [70, 84], jakobs: [76, 82], diaoune: [72, 30], haraldsson: [72, 50], bardakci: [86, 58], sanchez: [87, 42], cakir: [96, 50] } },
        { t: 1.5, ball: [84, 86], caption: 'He gets to the byline area', p: { bakwa: [84, 86], jakobs: [83, 82], diaoune: [78, 34], haraldsson: [80, 50], bardakci: [88, 60], sanchez: [89, 44] } },
        { t: 2.3, ball: [88, 58], air: true, caption: 'The ball into the box is half-cleared', p: { bakwa: [85, 85], diaoune: [80, 42], haraldsson: [84, 52], bardakci: [88, 58], sanchez: [89, 46] } },
        { t: 3.0, ball: [83, 48], caption: 'It drops loose in the middle of the area', p: { diaoune: [83, 48], haraldsson: [86, 54], bardakci: [89, 58], sanchez: [88, 45] } },
        { t: 3.6, ball: [100, 45], shot: true, caption: 'Diaoune, right foot, top corner — GOAL', p: { diaoune: [84, 48], sanchez: [88, 46], cakir: [97, 51] } },
      ],
    },
    {
      min: 44, side: 'away', scorer: 'batrakov', score: '2 - 2', title: 'Batrakov',
      summary: 'Sallai delivers a superb cross and Batrakov heads in from point-blank range after slack Lille marking.',
      keys: [
        { t: 0, ball: [50, 30], caption: 'Galatasaray build through Torreira', p: { torreira: [50, 30], sallai: [42, 10], batrakov: [42, 50], osimhen: [26, 48], verdonk: [30, 16], alexsandro: [13, 44], ngoy: [13, 58], ozer: [3, 50] } },
        { t: 1.2, ball: [32, 10], caption: 'Sallai is found in space on the right', p: { torreira: [46, 30], sallai: [32, 10], batrakov: [32, 48], osimhen: [18, 50], verdonk: [26, 16] } },
        { t: 2.6, ball: [20, 10], caption: 'He carries it towards the box', p: { sallai: [20, 10], batrakov: [16, 46], osimhen: [10, 58], verdonk: [21, 15], alexsandro: [10, 52], ngoy: [11, 60] } },
        { t: 3.5, ball: [6, 46], air: true, caption: 'A superb cross — Batrakov is left unmarked', p: { sallai: [19, 11], batrakov: [6, 46], osimhen: [9, 60], alexsandro: [9, 56], ngoy: [10, 62], ozer: [3, 52] } },
        { t: 4.1, ball: [0, 49], shot: true, caption: 'Header from close range — GOAL', p: { batrakov: [5, 47], ozer: [2, 53] } },
      ],
    },
    {
      min: 52, side: 'away', scorer: 'ozer', ownGoal: true, score: '2 - 3', title: 'Özer (OG)',
      summary: 'From Sara’s corner, Torreira flicks at the near post and Özer can only help it into his own net (beIN SPORTS credits Bentaleb).',
      keys: [
        { t: 0, ball: [0.8, 2], caption: 'Corner to Galatasaray — Sara to take', p: { sara: [0.8, 1.5], torreira: [12, 38], osimhen: [9, 52], batrakov: [12, 60], sanchez: [9, 46], ozer: [2, 50], bentaleb: [8, 41], alexsandro: [6, 52], ngoy: [7, 59] } },
        { t: 1.4, ball: [5, 43], air: true, caption: 'Whipped in to the near post', p: { sara: [1.5, 3], torreira: [5, 43], osimhen: [6, 51], batrakov: [8, 58], sanchez: [7, 47], bentaleb: [6, 42], alexsandro: [5, 51], ngoy: [6, 57] } },
        { t: 2.0, ball: [2, 49], caption: 'Torreira’s flick catches Özer out', p: { torreira: [4, 44], ozer: [2, 49], bentaleb: [5, 43] } },
        { t: 2.5, ball: [0, 50], shot: true, caption: 'Özer can only help it in — own goal', p: { ozer: [1, 50] } },
      ],
    },
    {
      min: 61, side: 'away', scorer: 'osimhen', score: '2 - 4', title: 'Osimhen',
      summary: 'Galatasaray break; Yılmaz shows composure to slip Osimhen through and he finishes right-footed.',
      keys: [
        { t: 0, ball: [72, 40], caption: 'Lille push forward looking for an equaliser', p: { haraldsson: [72, 40], torreira: [75, 44], yilmaz: [62, 80], osimhen: [60, 50], alexsandro: [48, 40], ngoy: [50, 60], ozer: [10, 50] } },
        { t: 0.9, ball: [73, 45], caption: 'Torreira wins it back — counter-attack', p: { haraldsson: [73, 42], torreira: [73, 45], yilmaz: [60, 80], osimhen: [57, 50] } },
        { t: 1.7, ball: [58, 78], caption: 'Out to Yılmaz on the break', p: { torreira: [70, 46], yilmaz: [58, 78], osimhen: [52, 50], alexsandro: [46, 42], ngoy: [47, 58] } },
        { t: 3.3, ball: [38, 70], caption: 'Yılmaz carries it into the Lille half', p: { yilmaz: [38, 70], osimhen: [38, 47], alexsandro: [34, 44], ngoy: [36, 58] } },
        { t: 4.1, ball: [20, 50], caption: 'He slips Osimhen through on goal', p: { yilmaz: [33, 68], osimhen: [21, 50], alexsandro: [25, 44], ngoy: [25, 55], ozer: [6, 50] } },
        { t: 4.9, ball: [12, 51], caption: 'Osimhen bears down on Özer', p: { osimhen: [12, 51], alexsandro: [17, 46], ngoy: [17, 55], ozer: [5, 50] } },
        { t: 5.3, ball: [0, 52], shot: true, caption: 'Right foot from the centre of the box — GOAL', p: { osimhen: [11, 51], ozer: [4, 49] } },
      ],
    },
  ],
};

// ----- Automatic replays for researched matches -----
// Built from each goal's type (build-up, counter, set piece, direct, penalty, own goal), the
// assister and the reported shot location. Coordinates are written from the attacking
// team's view (attacking towards x = 100, y from their left touchline) and converted.

// Minutes a player was on the pitch, from starts, substitutions and red cards.
function pitchWindow(L, id) {
  const starter = [...L.home, ...L.away].some(p => p[0] === id);
  const on = L.events.find(e => e[1] === 'sub' && e[3] === id);
  const off = L.events.find(e => (e[1] === 'sub' && e[4] === id) || (e[1] === 'red' && e[3] === id));
  return [on ? on[0] : starter ? 0 : 999, off ? off[0] : 120];
}

function autoReplays(match) {
  const L = LINEUPS[match.id];
  if (!L || !L.goalInfo) return null;
  const goalEvents = L.events.filter(e => e[1] === 'goal' || e[1] === 'owngoal');
  if (!goalEvents.length) return null;
  const sideIds = side => [...(side === 'home' ? L.home : L.away), ...(side === 'home' ? L.homeSubs : L.awaySubs)].map(p => p[0]);
  return goalEvents.map(([min, type, side, who, score, extra]) => {
    const info = L.goalInfo[min] || {};
    const def = side === 'home' ? 'away' : 'home';
    const conv = ([x, y]) => (side === 'home' ? [x, y] : [100 - x, 100 - y]);
    const on = id => { const [a, b] = pitchWindow(L, id); return min >= a && min <= b; };
    const mates = sideIds(side).filter(on);
    const gk = (def === 'home' ? L.home : L.away)[0][0];
    const own = type === 'owngoal';
    const scorer = own ? null : who;
    const assist = info.assist && mates.includes(info.assist) ? info.assist : null;
    const helper = mates.find(id => id !== scorer && id !== assist && ['CM', 'DM', 'AM'].includes(PEOPLE[id].pos)) || mates.find(id => id !== scorer && id !== assist);
    const [sx0, sy0, header] = (L.goalShots || {})[min] || [88, 50, info.foot === 'header'];
    const S = [Math.max(70, Math.min(98, sx0)), Math.max(8, Math.min(92, sy0))];
    const goalY = Math.max(46, Math.min(54, 50 + (S[1] - 50) * 0.15));
    const wide = id => ({ LB: 14, LW: 16, RB: 86, RW: 84 }[PEOPLE[id] && PEOPLE[id].pos]);
    const name = id => (id && PEOPLE[id] ? PEOPLE[id].short : '');
    const k = [];
    const key = (t, ball, caption, p, extraFlags = {}) => {
      const pp = {};
      for (const [id, pos] of Object.entries(p)) if (id && id !== 'null') pp[id] = conv(pos);
      k.push({ t, ball: ball && conv(ball), caption, p: pp, ...extraFlags });
    };
    const gkAt = y => [99, y];

    if (own) {
      const d = assist || helper;
      key(0, [84, 14], `${name(d)} delivers into the box`, { [d]: [84, 14], [who]: [91, 46], [gk]: gkAt(50) });
      key(1.4, [93, 48], `${name(who)} gets a touch under pressure`, { [d]: [84, 15], [who]: [93, 48], [gk]: gkAt(49) }, { air: true });
      key(1.9, [100, 50], `Into his own net — own goal`, { [who]: [94, 49], [gk]: gkAt(47) }, { shot: true });
    } else if (extra === 'pen') {
      key(0, [89, 50], `Penalty to ${side === 'home' ? match.home : match.away}`, { [scorer]: [85, 50], [gk]: gkAt(50) });
      key(1.0, [89, 50], `${name(scorer)} steps up`, { [scorer]: [88, 50], [gk]: gkAt(50) });
      key(1.5, [100, goalY], `${name(scorer)} scores from the spot — GOAL`, { [scorer]: [89, 50], [gk]: gkAt(goalY > 50 ? 44 : 56) }, { shot: true });
    } else if (info.type === 'set') {
      const taker = assist || helper;
      key(0, [99.5, 1.5], `Set piece — ${name(taker)} to deliver`, { [taker]: [99.5, 1.5], [scorer]: [84, S[1]], [gk]: gkAt(50) });
      key(1.4, S, `${name(scorer)} meets it`, { [taker]: [98, 4], [scorer]: S, [gk]: gkAt(49) }, { air: true });
      key(2.0, [100, goalY], `${name(scorer)}${header ? ' heads in' : ' finishes'} — GOAL`, { [scorer]: S, [gk]: gkAt(goalY) }, { shot: true });
    } else if (info.type === 'counter') {
      const carrier = assist || helper;
      const ly = wide(carrier) || (S[1] < 50 ? 60 : 40);
      key(0, [32, ly], `${side === 'home' ? match.home : match.away} win it back and break`, { [carrier]: [32, ly], [scorer]: [42, S[1]], [gk]: gkAt(50) });
      key(1.6, [56, ly], `${name(carrier)} drives forward`, { [carrier]: [56, ly], [scorer]: [62, S[1]], [gk]: gkAt(50) });
      key(2.6, [S[0] - 8, S[1]], assist ? `${name(carrier)} slips ${name(scorer)} through` : `${name(scorer)} is away`, { [carrier]: [60, ly], [scorer]: [S[0] - 9, S[1]], [gk]: gkAt(50) });
      key(3.4, S, `${name(scorer)} bears down on goal`, { [scorer]: S, [gk]: gkAt(S[1] * 0.2 + 40) });
      key(3.9, [100, goalY], `${name(scorer)} finishes — GOAL`, { [scorer]: [S[0] + 1, S[1]], [gk]: gkAt(goalY) }, { shot: true });
    } else if (info.type === 'direct') {
      const passer = assist || helper;
      key(0, [28, 50], `${name(passer)} goes long`, { [passer]: [28, 50], [scorer]: [70, S[1]], [gk]: gkAt(50) });
      key(1.5, [S[0] - 6, S[1]], `${name(scorer)} runs onto it`, { [passer]: [30, 50], [scorer]: [S[0] - 6, S[1]], [gk]: gkAt(50) }, { air: true });
      key(2.4, S, `${name(scorer)} gets into the box`, { [scorer]: S, [gk]: gkAt(50) });
      key(2.9, [100, goalY], `${name(scorer)} finishes — GOAL`, { [scorer]: [S[0] + 1, S[1]], [gk]: gkAt(goalY) }, { shot: true });
    } else if (assist) {
      const ay = wide(assist) || (S[1] < 50 ? 62 : 38);
      const cross = header || wide(assist) !== undefined;
      key(0, [55, 50], `${name(helper)} starts the move`, { [helper]: [55, 50], [assist]: [70, ay], [scorer]: [74, S[1]], [gk]: gkAt(50) });
      key(1.2, [72, ay], `Into ${name(assist)}`, { [helper]: [57, 50], [assist]: [72, ay], [scorer]: [76, S[1]], [gk]: gkAt(50) });
      key(2.4, [cross ? 86 : 80, ay], `${name(assist)} carries it on`, { [assist]: [cross ? 86 : 80, ay], [scorer]: [S[0] - 3, S[1]], [gk]: gkAt(50) });
      key(3.2, S, cross ? `${name(assist)} crosses for ${name(scorer)}` : `${name(assist)} finds ${name(scorer)}`, { [assist]: [cross ? 86 : 80, ay], [scorer]: S, [gk]: gkAt(49) }, { air: cross });
      key(3.8, [100, goalY], `${name(scorer)}${header ? ' heads it in' : ' finishes'} — GOAL`, { [scorer]: S, [gk]: gkAt(goalY) }, { shot: true });
    } else {
      key(0, [70, S[1]], `${name(scorer)} picks it up`, { [scorer]: [70, S[1]], [gk]: gkAt(50) });
      key(1.8, S, `${name(scorer)} works the space`, { [scorer]: S, [gk]: gkAt(50) });
      key(2.3, [100, goalY], `${name(scorer)} finishes — GOAL`, { [scorer]: [S[0] + 1, S[1]], [gk]: gkAt(goalY) }, { shot: true });
    }
    return {
      min, side, scorer: own ? who : scorer, ownGoal: own, score: score.replace(' - ', ' - '),
      title: `${name(who)}${own ? ' (OG)' : extra === 'pen' ? ' (P)' : ''}`,
      summary: info.description || 'Reconstructed from the match events.',
      keys: k,
    };
  });
}

const goalReplaySet = match => REPLAYS[match.id] || autoReplays(match);

const HOLD = 1.6; // seconds the goal frame stays on screen before the next replay
const lerp = (a, b, f) => a + (b - a) * f;
const ease = f => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);
const clampX = v => Math.max(1.5, Math.min(98.5, v));

// Where an uninvolved player stands, given the ball: the team shape stretches towards
// the ball when it is in their attacking half and compresses towards goal when not.
function shapePosition(base, side, isGk, ball) {
  const [bx, by] = ball;
  if (side === 'home') {
    if (isGk) return [3 + bx * 0.06, 50 + (by - 50) * 0.25];
    const g = 0.6 + 1.2 * (bx / 100);
    return [clampX(3 + (base[0] - 3) * g), base[1] + (by - 50) * 0.25];
  }
  if (isGk) return [97 - (100 - bx) * 0.06, 50 + (by - 50) * 0.25];
  const g = 0.6 + 1.2 * ((100 - bx) / 100);
  return [clampX(97 - (97 - base[0]) * g), base[1] + (by - 50) * 0.25];
}

// Value of a keyframed track at time t, with easing between keys.
function track(points, t, easeFn = ease) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, a] = points[i], [t1, b] = points[i + 1];
    if (t <= t1) {
      const f = easeFn((t - t0) / (t1 - t0));
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    }
  }
  return points[points.length - 1][1];
}

function buildGoal(goal) {
  const ballPts = goal.keys.filter(k => k.ball).map(k => [k.t, k.ball]);
  const tracks = {};
  for (const k of goal.keys) for (const [id, pos] of Object.entries(k.p || {})) (tracks[id] = tracks[id] || []).push([k.t, pos]);
  const end = goal.keys[goal.keys.length - 1].t;
  return { ...goal, ballPts, tracks, end, total: end + HOLD };
}

function ballAt(g, t) {
  const pts = g.ballPts;
  if (t >= pts[pts.length - 1][0]) return { pos: pts[pts.length - 1][1], height: 0, key: g.keys[g.keys.length - 1] };
  for (let i = 0; i < pts.length - 1; i++) {
    if (t <= pts[i + 1][0]) {
      const key = g.keys.find(k => k.t === pts[i + 1][0]);
      const f = Math.max(0, (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
      const fe = key.shot ? f : ease(f);
      return {
        pos: [lerp(pts[i][1][0], pts[i + 1][1][0], fe), lerp(pts[i][1][1], pts[i + 1][1][1], fe)],
        height: key.air ? Math.sin(f * Math.PI) : 0,
        key,
      };
    }
  }
  return { pos: pts[0][1], height: 0, key: g.keys[0] };
}

// ---------------------------------------------------------------------------
// Card markup and the animation controller
// ---------------------------------------------------------------------------

const replayState = { goal: 0, t: 0, playing: !matchMedia('(prefers-reduced-motion: reduce)').matches, speed: 1, all: true };
let replayFrame = null;

function goalReplayCard(match) {
  const goals = goalReplaySet(match);
  if (!goals) return '';
  const L = LINEUPS[match.id];
  // Starters plus substitutes who came on; each is shown only while on the pitch.
  const used = side => (side === 'home' ? L.homeSubs : L.awaySubs).filter(p => L.events.some(e => e[1] === 'sub' && e[3] === p[0]));
  const people = [...L.home.map(p => [p[0], 'home']), ...used('home').map(p => [p[0], 'home']), ...L.away.map(p => [p[0], 'away']), ...used('away').map(p => [p[0], 'away'])];
  return `
    <div class="card replay" id="replay" data-match="${match.id}">
      ${sectionHead('Goal replays', match, 'Animated reconstruction of every goal')}
      <div class="replay-tabs" role="tablist">
        ${goals.map((g, i) => `
          <button role="tab" class="replay-tab ${g.side}" data-replay-goal="${i}" aria-selected="false">
            <b>${g.min}′</b> ${esc(g.title)} <small>${g.score}</small>
          </button>`).join('')}
      </div>
      <div class="replay-stage">
        <svg class="replay-pitch" viewBox="-2 -2 109 72" role="img" aria-label="Goal replay animation">
          <rect x="-2" y="-2" width="109" height="72" class="rp-turf"/>
          ${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 10.5}" y="0" width="5.25" height="68" class="rp-stripe"/>`).join('')}
          <g class="rp-lines">
            <rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><circle cx="52.5" cy="34" r="9.15"/>
            <rect x="0" y="13.85" width="16.5" height="40.3"/><rect x="88.5" y="13.85" width="16.5" height="40.3"/>
            <rect x="0" y="24.85" width="5.5" height="18.3"/><rect x="99.5" y="24.85" width="5.5" height="18.3"/>
            <rect x="-1.6" y="30.34" width="1.6" height="7.32" class="rp-goal"/><rect x="105" y="30.34" width="1.6" height="7.32" class="rp-goal"/>
          </g>
          <polyline class="rp-trail" points=""/>
          ${people.map(([id, side]) => `
            <g class="rp-player ${side} ${LINEUPS[match.id] && PEOPLE[id].pos === 'GK' ? 'gk' : ''}" data-id="${id}">
              <circle r="1.7"/><text class="rp-name" y="-2.6">${esc(PEOPLE[id].short)}</text>
            </g>`).join('')}
          <ellipse class="rp-ball-shadow" rx="0.9" ry="0.5"/>
          <circle class="rp-ball" r="0.85"/>
          <g class="rp-goal-flash"><rect x="30" y="26" width="45" height="16" rx="3"/><text x="52.5" y="36.6" text-anchor="middle" class="rp-goal-text">GOAL</text></g>
        </svg>
        <div class="replay-scoreline"><span class="rp-min"></span><span class="rp-score"></span></div>
      </div>
      <p class="replay-caption" aria-live="polite"></p>
      <div class="replay-controls">
        <button class="circle" data-replay="toggle" aria-label="Pause">❚❚</button>
        <button class="circle" data-replay="restart" aria-label="Restart this goal">↺</button>
        <input type="range" class="replay-progress" min="0" max="1000" value="0" aria-label="Replay position">
        <div class="seg"><button data-replay-speed="0.5">0.5×</button><button data-replay-speed="1">1×</button></div>
        <label class="toggle"><input type="checkbox" data-replay="all"> All goals</label>
      </div>
      <p class="muted card-note replay-summary"></p>
      <p class="muted card-note">Source: ${REPLAY_SOURCES.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(', ')}</p>
    </div>`;
}

function mountReplay() {
  cancelAnimationFrame(replayFrame);
  const card = document.getElementById('replay');
  if (!card) return;
  const match = MATCHES.find(m => m.id === card.dataset.match);
  const goals = goalReplaySet(match).map(buildGoal);
  const L = LINEUPS[match.id];
  const bases = Object.fromEntries([...L.home, ...L.away].map(([id, x, y]) => [id, [x, y]]));
  // Substitutes take the base position of the player they replaced.
  for (const e of L.events) if (e[1] === 'sub' && bases[e[4]]) bases[e[3]] = bases[e[4]];
  const windows = {};
  const players = [...card.querySelectorAll('.rp-player')].map(el => ({ el, id: el.dataset.id, side: el.classList.contains('home') ? 'home' : 'away', gk: el.classList.contains('gk') }));
  const ball = card.querySelector('.rp-ball'), shadow = card.querySelector('.rp-ball-shadow');
  const trail = card.querySelector('.rp-trail'), flash = card.querySelector('.rp-goal-flash');
  const caption = card.querySelector('.replay-caption'), summary = card.querySelector('.replay-summary');
  const progress = card.querySelector('.replay-progress'), toggle = card.querySelector('[data-replay="toggle"]');
  const minEl = card.querySelector('.rp-min'), scoreEl = card.querySelector('.rp-score');
  const P = ([x, y]) => [x * 1.05, y * 0.68]; // percent -> metres
  const history = [];

  function syncControls() {
    const g = goals[replayState.goal];
    card.querySelectorAll('.replay-tab').forEach((b, i) => { b.classList.toggle('on', i === replayState.goal); b.setAttribute('aria-selected', i === replayState.goal); });
    card.querySelectorAll('[data-replay-speed]').forEach(b => b.classList.toggle('on', +b.dataset.replaySpeed === replayState.speed));
    card.querySelector('[data-replay="all"]').checked = replayState.all;
    toggle.textContent = replayState.playing ? '❚❚' : '▶';
    toggle.setAttribute('aria-label', replayState.playing ? 'Pause' : 'Play');
    summary.textContent = g.summary;
    minEl.textContent = `${g.min}′`;
    scoreEl.textContent = `${match.home} ${g.score} ${match.away}`;
    scoreEl.className = `rp-score ${g.side}`;
  }

  function draw() {
    const g = goals[replayState.goal];
    const t = Math.min(replayState.t, g.end);
    const b = ballAt(g, t);
    for (const p of players) {
      const [from, to] = windows[p.id] || (windows[p.id] = pitchWindow(L, p.id));
      const onPitch = g.min >= from && g.min <= to;
      p.el.style.display = onPitch ? '' : 'none';
      if (!onPitch || !bases[p.id]) continue;
      const own = g.tracks[p.id];
      const pos = own ? track(own, t) : shapePosition(bases[p.id], p.side, p.gk, b.pos);
      const [x, y] = P(pos);
      p.el.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      p.el.classList.toggle('involved', !!own);
      p.el.classList.toggle('scorer', p.id === g.scorer);
    }
    const [bx, by] = P(b.pos);
    const lift = b.height * 3.2;
    ball.setAttribute('cx', bx.toFixed(2));
    ball.setAttribute('cy', (by - lift).toFixed(2));
    ball.setAttribute('r', (0.85 + b.height * 0.5).toFixed(2));
    shadow.setAttribute('cx', bx.toFixed(2));
    shadow.setAttribute('cy', (by + 0.5).toFixed(2));
    shadow.style.opacity = 0.45 - b.height * 0.25;
    history.push([bx, by - lift]);
    if (history.length > 26) history.shift();
    trail.setAttribute('points', history.map(p => p.map(n => n.toFixed(2)).join(',')).join(' '));
    trail.classList.toggle('shot', !!b.key.shot);
    const scored = replayState.t >= g.end;
    flash.classList.toggle('on', scored);
    flash.classList.toggle('home', g.side === 'home');
    const current = [...g.keys].reverse().find(k => k.t <= t && k.caption) || g.keys[0];
    if (caption.textContent !== current.caption) caption.textContent = current.caption;
    progress.value = Math.round((replayState.t / g.total) * 1000);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (replayState.playing) {
      replayState.t += dt * replayState.speed;
      const g = goals[replayState.goal];
      if (replayState.t >= g.total) {
        replayState.t = 0;
        history.length = 0;
        if (replayState.all) replayState.goal = (replayState.goal + 1) % goals.length;
        syncControls();
      }
    }
    draw();
    replayFrame = requestAnimationFrame(frame);
  }

  card.addEventListener('click', e => {
    const tab = e.target.closest('[data-replay-goal]');
    const speed = e.target.closest('[data-replay-speed]');
    const ctl = e.target.closest('[data-replay]');
    if (tab) { replayState.goal = +tab.dataset.replayGoal; replayState.t = 0; history.length = 0; replayState.playing = true; }
    else if (speed) replayState.speed = +speed.dataset.replaySpeed;
    else if (ctl && ctl.dataset.replay === 'toggle') replayState.playing = !replayState.playing;
    else if (ctl && ctl.dataset.replay === 'restart') { replayState.t = 0; history.length = 0; replayState.playing = true; }
    else if (ctl && ctl.dataset.replay === 'all') replayState.all = ctl.checked;
    else return;
    syncControls();
  });
  progress.addEventListener('input', () => {
    replayState.t = (progress.value / 1000) * goals[replayState.goal].total;
    history.length = 0;
    replayState.playing = false;
    syncControls();
  });

  syncControls();
  draw();
  replayFrame = requestAnimationFrame(frame);
}
