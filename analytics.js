'use strict';

// Advanced match analytics derived from the sample match data: shot-level data,
// per-player numbers (matches with a lineup only) and team metrics. Values are
// generated deterministically per match, and they always add up to the headline
// numbers in data.js (score, xG, shots, shots on target, accurate passes, fouls).

const POSITION_GROUP = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', DM: 'MID', CM: 'MID', AM: 'MID', LW: 'FWD', RW: 'FWD', ST: 'FWD' };

// Per-90 baselines by position. shoot/create weight who takes and sets up shots.
const PROFILES = {
  GK: { passes: 32, acc: .76, prog: 1, carries: .2, dribbles: 0, tackles: .1, ints: .5, clears: 1.6, recov: 4, duels: 1.2, aerials: 1, long: 9, crosses: 0, km: 5.4, sprints: 2, hi: 6, top: 27, shoot: 0, create: .02 },
  CB: { passes: 56, acc: .88, prog: 4, carries: 1.5, dribbles: .2, tackles: 1.5, ints: 1.8, clears: 4.2, recov: 5, duels: 7, aerials: 4, long: 5, crosses: .1, km: 9.9, sprints: 12, hi: 32, top: 31.5, shoot: .4, create: .2 },
  LB: { passes: 48, acc: .82, prog: 5, carries: 3, dribbles: 1, tackles: 2.2, ints: 1.2, clears: 1.6, recov: 5, duels: 9, aerials: 1.5, long: 3, crosses: 3, km: 11, sprints: 26, hi: 58, top: 33.5, shoot: .6, create: 1 },
  RB: { passes: 48, acc: .82, prog: 5, carries: 3, dribbles: 1, tackles: 2.2, ints: 1.2, clears: 1.6, recov: 5, duels: 9, aerials: 1.5, long: 3, crosses: 3, km: 11, sprints: 26, hi: 58, top: 33.5, shoot: .6, create: 1 },
  DM: { passes: 62, acc: .89, prog: 6, carries: 2, dribbles: .6, tackles: 2.5, ints: 1.6, clears: 1.2, recov: 7, duels: 10, aerials: 2, long: 4, crosses: .2, km: 11.4, sprints: 14, hi: 48, top: 31, shoot: .7, create: .8 },
  CM: { passes: 52, acc: .85, prog: 5, carries: 3, dribbles: 1.2, tackles: 1.8, ints: 1, clears: .6, recov: 6, duels: 9, aerials: 1.5, long: 3, crosses: .6, km: 11.6, sprints: 18, hi: 56, top: 32, shoot: 1.2, create: 1.4 },
  AM: { passes: 40, acc: .8, prog: 4, carries: 4, dribbles: 2, tackles: 1, ints: .5, clears: .2, recov: 4, duels: 10, aerials: 1, long: 1.5, crosses: 1, km: 10.9, sprints: 22, hi: 60, top: 32.5, shoot: 2.4, create: 2.4 },
  LW: { passes: 30, acc: .78, prog: 3, carries: 5, dribbles: 3, tackles: 1, ints: .4, clears: .2, recov: 3.5, duels: 12, aerials: 1, long: 1, crosses: 2.5, km: 10.6, sprints: 30, hi: 64, top: 34.5, shoot: 2.8, create: 2 },
  RW: { passes: 30, acc: .78, prog: 3, carries: 5, dribbles: 3, tackles: 1, ints: .4, clears: .2, recov: 3.5, duels: 12, aerials: 1, long: 1, crosses: 2.5, km: 10.6, sprints: 30, hi: 64, top: 34.5, shoot: 2.8, create: 2 },
  ST: { passes: 22, acc: .72, prog: 1.5, carries: 2, dribbles: 1.5, tackles: .5, ints: .2, clears: .6, recov: 2, duels: 13, aerials: 5, long: .5, crosses: .3, km: 10, sprints: 24, hi: 52, top: 33.5, shoot: 4, create: 1 },
};

const analyticsCache = {};

function pickWeighted(r, list, weight) {
  const weights = list.map(weight);
  let x = r() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) if ((x -= weights[i]) <= 0) return list[i];
  return list[list.length - 1];
}

// Split an exact team total across players in proportion to a weight.
function distribute(total, list, weight, key) {
  const weights = list.map(weight);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest-- > 0) out[i]++; });
  list.forEach((p, i) => { p[key] = out[i]; });
}

// When each lineup member was on the pitch, from the substitution events.
function onPitch(match, people) {
  return people.map(p => {
    const s = playerMatchStats(match, p.id);
    const start = s.subOn ? s.subOn.min : p.sub ? null : 0;
    return { ...p, start, end: s.subOff ? s.subOff.min : 90, minutes: s.minutes };
  });
}

function buildShots(d, side, r, squad) {
  const t = side === 'home' ? 0 : 1;
  const goals = d.events.filter(e => e.type === 'goal' && e.side === side);
  const total = Math.max(d.stats.shots[t], goals.length);
  const onTarget = Math.min(total, Math.max(d.stats.onTarget[t], goals.length));
  const blocked = Math.round((total - onTarget) * (0.25 + r() * 0.15));
  const outcomes = [
    ...goals.map(() => 'goal'),
    ...Array(onTarget - goals.length).fill('saved'),
    ...Array(blocked).fill('blocked'),
    ...Array(total - onTarget - blocked).fill('off'),
  ];
  // Zones are [x0, x1, y0, y1] in percent of the pitch, attacking towards x = 100.
  const zones = { goal: [85, 97, 34, 66], saved: [74, 95, 24, 76], blocked: [72, 90, 22, 78], off: [66, 96, 14, 86] };
  const shooters = squad && squad.filter(p => p.side === side && p.start !== null);

  const shots = outcomes.map((outcome, i) => {
    const [x0, x1, y0, y1] = zones[outcome];
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
    const dist = Math.hypot((100 - x) * 1.05, (50 - y) * 0.68); // metres on a 105 x 68 pitch
    const shot = {
      side, outcome, x, y,
      raw: Math.min(0.8, Math.max(0.02, 0.9 * Math.exp(-dist / 7.5))),
      inBox: x >= 84 && y >= 20 && y <= 80,
      header: r() < 0.14,
    };
    if (outcome === 'goal') {
      shot.min = goals[i].min;
      shot.who = goals[i].who;
      const known = d.lineup && d.lineup.goalShots && d.lineup.goalShots[shot.min];
      if (known) {
        [shot.x, shot.y, shot.header] = known;
        const kd = Math.hypot((100 - shot.x) * 1.05, (50 - shot.y) * 0.68);
        shot.raw = Math.min(0.8, Math.max(0.02, 0.9 * Math.exp(-kd / 7.5)));
        shot.inBox = true;
      }
    } else if (shooters) {
      const p = pickWeighted(r, shooters, q => PROFILES[PEOPLE[q.id].pos].shoot * (q.end - q.start));
      shot.who = p.id;
      shot.min = randInt(r, p.start + 1, p.end);
    } else {
      shot.min = randInt(r, 1, 90);
    }
    return shot;
  });

  // Scale to the team's xG, then fix rounding so the shots sum exactly to it.
  const target = d.stats.xg[t];
  const rawSum = shots.reduce((a, s) => a + s.raw, 0) || 1;
  shots.forEach(s => { s.xg = +Math.min(0.95, Math.max(0.01, (s.raw * target) / rawSum)).toFixed(2); });
  if (shots.length) {
    const diff = +(target - shots.reduce((a, s) => a + s.xg, 0)).toFixed(2);
    const biggest = shots.reduce((a, s) => (s.xg > a.xg ? s : a));
    biggest.xg = +(biggest.xg + diff).toFixed(2);
  }
  shots.forEach(s => {
    const onFrame = s.outcome === 'goal' || s.outcome === 'saved';
    s.xgot = onFrame ? +Math.min(0.97, s.xg * (1.1 + r() * 0.6) + (s.outcome === 'goal' ? 0.12 : 0)).toFixed(2) : 0;
  });

  if (shooters) {
    for (const s of shots) {
      if (r() > 0.72) continue; // unassisted: solo runs, rebounds, set pieces
      const options = shooters.filter(p => p.id !== s.who && s.min > p.start && s.min <= p.end);
      if (options.length) s.assist = pickWeighted(r, options, p => PROFILES[PEOPLE[p.id].pos].create).id;
    }
  }
  return shots.sort((a, b) => a.min - b.min);
}

function buildPlayers(match, d, shots, squad, r) {
  const poss = [d.stats.possession, 100 - d.stats.possession];
  const players = squad.map(p => {
    const pos = PEOPLE[p.id].pos;
    const base = { id: p.id, side: p.side, pos, group: POSITION_GROUP[pos], rating: p.rating ?? null, minutes: p.minutes, sub: !!p.sub, start: p.start, end: p.end };
    if (!p.minutes) return base;

    const t = p.side === 'home' ? 0 : 1;
    const prof = PROFILES[pos];
    const f = p.minutes / 90;
    const q = 0.85 + ((p.rating || 6.5) - 6.5) * 0.12; // better-rated players did more
    const v = (per90, spread = 0.5) => Math.max(0, Math.round(per90 * f * q * (1 - spread / 2 + r() * spread)));
    const share = (total, rate) => Math.min(total, Math.round(total * rate));

    const mine = shots.filter(s => s.who === p.id);
    const created = shots.filter(s => s.assist === p.id);
    const passesAtt = v(prof.passes * (poss[t] / 50), 0.4);
    const longAtt = v(prof.long), crossesAtt = v(prof.crosses), dribbles = v(prof.dribbles, 0.8);
    const duels = v(prof.duels), aerials = v(prof.aerials);

    return {
      ...base,
      goals: mine.filter(s => s.outcome === 'goal').length,
      assists: created.filter(s => s.outcome === 'goal').length,
      shots: mine.length,
      onTarget: mine.filter(s => s.outcome === 'goal' || s.outcome === 'saved').length,
      xg: +mine.reduce((a, s) => a + s.xg, 0).toFixed(2),
      xgot: +mine.reduce((a, s) => a + s.xgot, 0).toFixed(2),
      xa: +created.reduce((a, s) => a + s.xg, 0).toFixed(2),
      keyPasses: created.length,
      bigChancesMissed: mine.filter(s => s.xg >= 0.3 && s.outcome !== 'goal').length,
      touchesBox: mine.filter(s => s.inBox).length + v(prof.shoot * 1.4, 0.8),
      passesAtt,
      passesAcc: share(passesAtt, prof.acc + (r() - 0.5) * 0.1),
      progPasses: v(prof.prog, 0.7),
      finalThird: v(prof.prog * 1.3, 0.7),
      longAtt, longAcc: share(longAtt, 0.45 + r() * 0.3),
      crossesAtt, crossesAcc: share(crossesAtt, 0.15 + r() * 0.3),
      progCarries: v(prof.carries, 0.7),
      dribbles, dribblesWon: share(dribbles, 0.35 + r() * 0.4),
      tackles: v(prof.tackles, 0.8),
      interceptions: v(prof.ints, 0.8),
      clearances: v(prof.clears, 0.7),
      blocks: 0,
      recoveries: v(prof.recov, 0.6),
      duels, duelsWon: share(duels, 0.35 + r() * 0.35),
      aerials, aerialsWon: share(aerials, 0.3 + r() * 0.45),
      distance: +(prof.km * f * (0.94 + r() * 0.12)).toFixed(1),
      sprints: v(prof.sprints, 0.4),
      hiRuns: v(prof.hi, 0.4),
      topSpeed: +(prof.top - 1.5 + r() * 3).toFixed(1),
      yellow: d.events.filter(e => e.type === 'yellow' && e.who === p.id).length,
      saves: 0, goalsConceded: 0, goalsPrevented: 0,
    };
  });

  for (const side of ['home', 'away']) {
    const t = side === 'home' ? 0 : 1;
    const team = players.filter(p => p.side === side && p.minutes);

    // Scale passing so the team's accurate passes match the headline figure.
    const acc = team.reduce((a, p) => a + p.passesAcc, 0) || 1;
    const k = d.stats.passes[t] / acc;
    team.forEach(p => { p.passesAtt = Math.round(p.passesAtt * k); });
    distribute(d.stats.passes[t], team, p => p.passesAcc, 'passesAcc');
    team.forEach(p => { p.passesAtt = Math.max(p.passesAtt, p.passesAcc); });
    distribute(d.stats.fouls[t], team, p => p.duels + 1, 'fouls');

    // Goalkeeping: shots faced on target by the opposition.
    const gk = team.find(p => p.pos === 'GK');
    const faced = shots.filter(s => s.side !== side && (s.outcome === 'goal' || s.outcome === 'saved'));
    if (gk) {
      gk.saves = faced.filter(s => s.outcome === 'saved').length;
      gk.goalsConceded = (side === 'home' ? match.score[1] : match.score[0]);
      gk.xgotFaced = +faced.reduce((a, s) => a + s.xgot, 0).toFixed(2);
      gk.goalsPrevented = +(gk.xgotFaced - faced.filter(s => s.outcome === 'goal').length).toFixed(2);
    }
    // Blocked opposition shots go to an outfield player on the pitch at the time.
    for (const s of shots.filter(x => x.side !== side && x.outcome === 'blocked')) {
      const options = team.filter(p => p.group !== 'GK' && p.group !== 'FWD' && s.min > p.start && s.min <= p.end);
      if (options.length) pickWeighted(r, options, p => (p.group === 'DEF' ? 3 : 1)).blocks++;
    }
  }
  return players;
}

function buildTeam(match, d, side, shots, players, r) {
  const t = side === 'home' ? 0 : 1;
  const mine = shots.filter(s => s.side === side);
  const opp = shots.filter(s => s.side !== side);
  const squad = players && players.filter(p => p.side === side && p.minutes);
  const sum = key => squad.reduce((a, p) => a + (p[key] || 0), 0);
  const gen = (base, spread = 0.4) => Math.round(base * (1 - spread / 2 + r() * spread));
  const possession = t ? 100 - d.stats.possession : d.stats.possession;
  const passesAcc = d.stats.passes[t];
  const fromSquad = (key, fallback) => (squad ? sum(key) : fallback);

  const team = {
    possession,
    xg: d.stats.xg[t],
    xgot: +mine.reduce((a, s) => a + s.xgot, 0).toFixed(2),
    shots: mine.length,
    onTarget: mine.filter(s => s.outcome === 'goal' || s.outcome === 'saved').length,
    blockedShots: mine.filter(s => s.outcome === 'blocked').length,
    insideBox: mine.filter(s => s.inBox).length,
    headers: mine.filter(s => s.header).length,
    bigChances: mine.filter(s => s.xg >= 0.3).length,
    bigChancesMissed: mine.filter(s => s.xg >= 0.3 && s.outcome !== 'goal').length,
    boxTouches: d.stats.boxTouches[t],
    keyPasses: squad ? sum('keyPasses') : Math.round(mine.length * 0.7),
    passesAcc,
    passesAtt: fromSquad('passesAtt', Math.round(passesAcc / (0.78 + r() * 0.1))),
    progPasses: fromSquad('progPasses', gen(possession * 0.8)),
    finalThird: fromSquad('finalThird', gen(possession * 1.05)),
    longAtt: fromSquad('longAtt', gen(50)),
    crossesAtt: fromSquad('crossesAtt', gen(16)),
    progCarries: fromSquad('progCarries', gen(possession * 0.55)),
    dribbles: fromSquad('dribbles', gen(18)),
    tackles: fromSquad('tackles', gen(16)),
    interceptions: fromSquad('interceptions', gen(10)),
    clearances: fromSquad('clearances', gen(20)),
    blocks: opp.filter(s => s.outcome === 'blocked').length,
    recoveries: fromSquad('recoveries', gen(52)),
    duels: fromSquad('duels', gen(110)),
    aerials: fromSquad('aerials', gen(30)),
    saves: opp.filter(s => s.outcome === 'saved').length,
    distance: squad ? +sum('distance').toFixed(1) : +(108 + r() * 9).toFixed(1),
    sprints: fromSquad('sprints', gen(210, 0.2)),
    hiRuns: fromSquad('hiRuns', gen(560, 0.2)),
    fouls: d.stats.fouls[t],
    yellows: d.stats.yellows[t],
    reds: d.events.filter(e => e.type === 'red' && e.side === side).length,
    corners: d.stats.corners[t],
    offsides: randInt(r, 0, 4),
    setPieceXg: +(mine.filter(s => s.header).reduce((a, s) => a + s.xg, 0) + r() * 0.15).toFixed(2),
    avgPassLength: +(16 + r() * 5 - possession / 20).toFixed(1),
    defLine: +(32 + possession / 5 + r() * 6).toFixed(1),
  };
  team.longAcc = fromSquad('longAcc', Math.round(team.longAtt * (0.45 + r() * 0.2)));
  team.crossesAcc = fromSquad('crossesAcc', Math.round(team.crossesAtt * (0.2 + r() * 0.15)));
  team.dribblesWon = fromSquad('dribblesWon', Math.round(team.dribbles * (0.45 + r() * 0.2)));
  team.duelsWon = fromSquad('duelsWon', Math.round(team.duels * (0.42 + r() * 0.16)));
  team.aerialsWon = fromSquad('aerialsWon', Math.round(team.aerials * (0.4 + r() * 0.2)));
  if (squad) {
    const fastest = squad.reduce((a, p) => (p.topSpeed > a.topSpeed ? p : a));
    team.topSpeed = fastest.topSpeed;
    team.topSpeedBy = fastest.id;
  } else {
    team.topSpeed = +(33.5 + r() * 2.5).toFixed(1);
  }
  return team;
}

function analytics(match) {
  if (analyticsCache[match.id]) return analyticsCache[match.id];
  const d = details(match);
  const r = rng('adv-' + match.id);
  const squad = d.lineup ? onPitch(match, lineupPeople(match)) : null;
  const shots = [...buildShots(d, 'home', r, squad), ...buildShots(d, 'away', r, squad)].sort((a, b) => a.min - b.min);
  const players = squad ? buildPlayers(match, d, shots, squad, r) : null;
  const teams = ['home', 'away'].map(side => buildTeam(match, d, side, shots, players, r));

  // Metrics that need both sides.
  teams.forEach((tm, i) => {
    const other = teams[1 - i];
    tm.fieldTilt = Math.round((tm.finalThird / (tm.finalThird + other.finalThird || 1)) * 100);
    // Passes allowed per defensive action in the opponent's build-up zone; lower means a more intense press.
    tm.ppda = +Math.min(22, Math.max(5, (other.passesAtt * 0.55) / (tm.tackles + tm.interceptions + tm.fouls * 0.6 || 1))).toFixed(1);
    tm.directness = Math.round((tm.longAtt / (tm.passesAtt || 1)) * 100);
  });
  return (analyticsCache[match.id] = { shots, players, teams });
}
