"""Market values, 1-5 year value predictions and transfer values for every player.

Usage: python3 tools/build-market-values.py

Data: the open Transfermarkt datasets (github.com/dcaribou/transfermarkt-datasets, CC0):
players.csv (current market value, peak, birth date, position, contract), the full
valuation history (player_valuations.csv) and transfers with real fees (transfers.csv).
They are downloaded to .cache/transfermarkt/ (not committed).

1. Matching: each TDsports player is matched to a Transfermarkt player by name, using the
   club to pick between namesakes (and the surname plus club when the spelling differs).
2. Value predictions (1-5 years): for every horizon k a ridge regression is trained on
   real valuation histories since 2012: for each valuation, the target is
   log(value k years later / value now); the features are age (one-hot by year), position,
   position x age curve, value tier, last year's trend, distance from the career peak, and
   performance and consistency over the previous 12 months from the real appearances
   (appearances.csv, games.csv): share of the club's minutes played, share of games started
   (60+ minutes), consistency (in how many quarters of the year he played at least half
   his club's minutes), number of
   appearances and goal contributions per 90 by position (shrunk for few minutes).
   Trained on 80% of players, scored on the other 20% against "no change".
3. Transfer value: a ridge regression on real fees, log(fee / market value at the time),
   by age, position and value tier, then adjusted for the years left on the contract.
   Value ranges are the model's 80% interval; transfer ranges cover the middle half of real fees.

PARITY=<file.npy> also saves the held-out predictions (horizon, value then, actual, predicted,
age) for a parity plot; CALIBRATE=1 prints actual vs predicted change by value tier and age.

Writes market-values.js: MARKET_VALUES[name slug] = { v, at, peak, dob, pos, club, until,
p: [5 predicted values], lo: [...], hi: [...], tv: [transfer low, mid, high] } plus
MARKET_MODEL with the test scores. Re-run after updating the data.
"""
import bisect
import csv
import gzip
import json
import math
import os
import re
import subprocess
import sys
import unicodedata
import urllib.request
from datetime import date, datetime

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'transfermarkt')
BASE = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/'
TODAY = date.today()
HORIZONS = 5


def slug(name):
    s = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def words(name):
    return {w for w in slug(name).split('-') if len(w) > 2 and w not in {'fc', 'afc', 'cf', 'club', 'sc', 'de', 'city', 'united', 'calcio', 'the', 'ssc', 'spa'}}


CLUB_ALIASES = {'spurs': 'tottenham', 'man': 'manchester', 'nottm': 'nottingham', 'psg': 'paris', 'inter': 'internazionale',
                'gladbach': 'monchengladbach', 'bayern': 'bayern', 'atl': 'atletico', 'unam': 'pumas', 'c': 'crystal'}


def club_words(name):
    ws = words(name)
    return ws | {CLUB_ALIASES[w] for w in slug(name).split('-') if w in CLUB_ALIASES}


def load(name):
    path = os.path.join(CACHE, name + '.csv.gz')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        print('downloading', name, flush=True)
        urllib.request.urlretrieve(BASE + name + '.csv.gz', path)
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def parse_date(s):
    try:
        return datetime.strptime(s[:10], '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def years(a, b):
    return (b - a).days / 365.25


POS_GROUP = {'Goalkeeper': 0, 'Defender': 1, 'Midfield': 2, 'Attack': 3}
APP_POS_GROUP = {'GK': 0, 'CB': 1, 'LB': 1, 'RB': 1, 'DM': 2, 'CM': 2, 'AM': 2, 'LW': 3, 'RW': 3, 'ST': 3}
TIERS = [5e5, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8]


def tier(v):
    return sum(v >= t for t in TIERS)


def features(age, pos, value, trend, has_trend, peak_ratio):
    """Feature vector for one valuation (see the module docstring)."""
    a = int(min(37, max(17, round(age))))
    f = [1.0]
    f += [1.0 if a == k else 0.0 for k in range(17, 38)]                      # age, one-hot
    f += [1.0 if pos == k else 0.0 for k in range(4)]                         # position
    c = (age - 26) / 5
    f += [c if pos == k else 0.0 for k in range(4)] + [c * c if pos == k else 0.0 for k in range(4)]
    t = tier(value)
    f += [1.0 if t == k else 0.0 for k in range(len(TIERS) + 1)]              # value tier
    f += [max(-1.5, min(1.5, trend)) if has_trend else 0.0, 1.0 if has_trend else 0.0]
    f += [min(3.0, peak_ratio)]
    return f


class Performance:
    """Each player's real appearances (minutes, goals, assists) and each club's games, with
    prefix sums so any 12-month window is summarised in O(log n)."""

    def __init__(self, appearances, games):
        self.club_games = {}
        for g in games:
            d = parse_date(g['date'])
            if d:
                for c in (g['home_club_id'], g['away_club_id']):
                    self.club_games.setdefault(c, []).append(d)
        for v in self.club_games.values():
            v.sort()
        rows = {}
        for a in appearances:
            d = parse_date(a['date'])
            if d:
                m = int(float(a['minutes_played'] or 0))
                rows.setdefault(a['player_id'], []).append((d, m, int(a['goals'] or 0) + int(a['assists'] or 0), a['player_club_id']))
        self.players = {}
        for pid, r in rows.items():
            r.sort()
            dates, cm, cga, cst, clubs = [], [0], [0], [0], []
            for d, m, ga, club in r:
                dates.append(d); clubs.append(club)
                cm.append(cm[-1] + m); cga.append(cga[-1] + ga); cst.append(cst[-1] + (m >= 60))
            self.players[pid] = (dates, cm, cga, cst, clubs)
        self.last = max(max(v[0]) for v in self.players.values())

    def window(self, pid, end, days=365):
        """The 12 months before `end`, or None when the player has no appearances on record nearby."""
        rec = self.players.get(pid)
        if not rec:
            return None
        dates, cm, cga, cst, clubs = rec
        start = end.fromordinal(end.toordinal() - days)
        i0, i1 = bisect.bisect_right(dates, start), bisect.bisect_right(dates, end)
        # No appearances in the window but some within three years: benched or injured (informative).
        if i0 == i1 and not any(abs((d - end).days) < 1100 for d in dates[max(0, i0 - 1):i0 + 1]):
            return None
        club = clubs[i1 - 1] if i1 > i0 else clubs[max(0, i0 - 1)]
        cg = self.club_games.get(club, [])
        games_between = lambda a, b: bisect.bisect_right(cg, b) - bisect.bisect_right(cg, a)
        n = max(games_between(start, end), i1 - i0)
        if n < 10:  # the club's league isn't covered: no reliable performance data
            return None
        mins, ga, starts = cm[i1] - cm[i0], cga[i1] - cga[i0], cst[i1] - cst[i0]
        # Consistency: in how many of the four quarters of the year he played at least half of
        # his club's minutes (4 of 4 = a reliable regular; 0 of 4 = rarely played).
        quarters, regular = 0, 0
        for q in range(4):
            qs = start.fromordinal(start.toordinal() + q * days // 4)
            qe = end if q == 3 else start.fromordinal(start.toordinal() + (q + 1) * days // 4)
            g = games_between(qs, qe)
            if g < 2:
                continue
            a0, a1 = bisect.bisect_right(dates, qs), bisect.bisect_right(dates, qe)
            quarters += 1
            regular += (cm[a1] - cm[a0]) >= 0.5 * 90 * g
        return {'apps': i1 - i0, 'games': n, 'minutes': mins, 'ga': ga,
                'share': min(1.0, mins / (90 * n)), 'starts': min(1.0, starts / n),
                'consistency': regular / quarters if quarters else 0.0,
                'ga90': ga * 90 / mins if mins else 0.0, 'ga90s': ga / (mins / 90 + 5)}


AGE_GROUPS = [(0, 21), (22, 25), (26, 29), (30, 99)]


def perf_features(pf, pos, age):
    """Performance and consistency over the previous 12 months. Their effect differs by age
    (regular football at 20 lifts a value far more than at 32), so each measure is also given
    per age group."""
    n = 5 + 4 + 4 * len(AGE_GROUPS)
    if not pf:
        return [0.0] * n
    g = [1.0 if lo <= age <= hi else 0.0 for lo, hi in AGE_GROUPS]
    ga = min(1.5, pf['ga90s'])
    f = [1.0, pf['share'], pf['starts'], pf['consistency'], math.log1p(pf['apps']) / 4]
    f += [ga if pos == k else 0.0 for k in range(4)]
    f += [pf['share'] * x for x in g] + [pf['consistency'] * x for x in g] + [ga * x for x in g] + [pf['starts'] * x for x in g]
    return f


def ridge(X, y, lam=1.0):
    X, y = np.asarray(X), np.asarray(y)
    A = X.T @ X + lam * np.eye(X.shape[1])
    return np.linalg.solve(A, X.T @ y)


def app_players():
    """Every TDsports player with the club they played for in the app's matches."""
    js = r"""
const fs=require('fs'),vm=require('vm');const ctx={console};vm.createContext(ctx);
vm.runInContext(['data.js','match-data.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n')+';this.P=PEOPLE;this.L=LINEUPS;this.M=MATCHES;',ctx);
const club={};for(const m of ctx.M){const L=ctx.L[m.id];if(!L)continue;for(const [s,t] of [['home',m.home],['away',m.away]])for(const p of [...L[s],...(L[s+'Subs']||[])]) club[p[0]]??=t;}
console.log(JSON.stringify(Object.entries(ctx.P).filter(([,p])=>p.pos!=='Coach').map(([id,p])=>({id,name:p.name,pos:p.pos,club:club[id]||''}))));"""
    return json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout)


TREE_FEATURES = ['age', 'position', 'log10 value', 'trend 1y', 'has trend 1y', 'trend 2y', 'has trend 2y',
                 'log peak / value', 'years since peak', 'career length', 'league strength', 'has performance',
                 'minutes share', 'starts share', 'consistency', 'G+A per 90', 'appearances', 'month']


def tree_row(age, pos, v, prev1, prev2, peak, peak_date, first_date, d, league, pf):
    """Continuous inputs for the gradient-boosted model (see TREE_FEATURES)."""
    return [age, pos, math.log10(v),
            math.log(v / prev1) if prev1 else 0.0, 1.0 if prev1 else 0.0,
            math.log(v / prev2) if prev2 else 0.0, 1.0 if prev2 else 0.0,
            math.log(peak / v), years(peak_date, d), years(first_date, d), league,
            1.0 if pf else 0.0, pf['share'] if pf else 0.0, pf['starts'] if pf else 0.0,
            pf['consistency'] if pf else 0.0, min(1.5, pf['ga90s']) if pf else 0.0,
            math.log1p(pf['apps']) if pf else 0.0, d.month]


def metrics(y, pred):
    """Errors on the log scale and on values."""
    ratio = np.exp(pred - y)
    return {'mae_log': round(float(np.mean(np.abs(y - pred))), 4),
            'r2_log10': round(float(1 - np.sum((y - pred) ** 2) / np.sum((y - np.mean(y)) ** 2)), 4),
            'median_error_pct': round(float(np.median(np.abs(ratio - 1)) * 100), 1),
            'within_25pct': round(float(np.mean(np.abs(ratio - 1) <= 0.25) * 100), 1),
            'within_2x': round(float(np.mean((ratio >= 0.5) & (ratio <= 2)) * 100), 1)}


def main():
    from gbm import GBM
    players = load('players')
    valuations = load('player_valuations')
    transfers = load('transfers')
    perf = Performance(load('appearances'), load('games'))
    print(f'appearances: {len(perf.players)} players, data to {perf.last}', flush=True)
    info = {p['player_id']: p for p in players}
    history = {}
    for v in valuations:
        d, val = parse_date(v['date']), float(v['market_value_in_eur'] or 0)
        if d and val > 0:
            history.setdefault(v['player_id'], []).append((d, val, v['player_club_domestic_competition_id'] or ''))
    for h in history.values():
        h.sort()
    split = lambda pid: 'test' if int(pid) % 5 == 0 else 'val' if int(pid) % 10 == 1 else 'train'

    # League strength: the median log10 value of training players in each domestic league.
    by_league = {}
    for pid, hist in history.items():
        if split(pid) == 'train':
            for d, v, c in hist:
                if d.year >= 2012:
                    by_league.setdefault(c, []).append(math.log10(v))
    league_strength = {c: float(np.median(v)) for c, v in by_league.items() if len(v) >= 200}
    default_league = float(np.median([x for v in by_league.values() for x in v]))
    strength = lambda c: league_strength.get(c, default_league)

    def lookback(hist, i, days):
        d = hist[i][0]
        return next((pv for pd, pv, _ in reversed(hist[:i]) if days - 65 <= (d - pd).days <= days + 65), None)

    # ---- 1. Value prediction: one ridge baseline and one boosted model per horizon -----
    rows = {k: {'Xr': [], 'Xt': [], 'y': [], 'pid': [], 'v': [], 'age': []} for k in range(1, HORIZONS + 1)}
    for pid, hist in history.items():
        p = info.get(pid)
        dob = parse_date(p['date_of_birth']) if p else None
        pos = POS_GROUP.get(p['position']) if p else None
        if not dob or pos is None:
            continue
        dates = [d for d, _, _ in hist]
        peak, peak_date = 0.0, hist[0][0]
        for i, (d, v, comp) in enumerate(hist):
            if v >= peak:
                peak, peak_date = v, d
            if d.year < 2012:
                continue
            age = years(dob, d)
            prev1, prev2 = lookback(hist, i, 365), lookback(hist, i, 730)
            pf = perf.window(pid, d)
            xr = features(age, pos, v, math.log(v / prev1) if prev1 else 0.0, prev1 is not None, math.log(peak / v)) + perf_features(pf, pos, age)
            xt = tree_row(age, pos, v, prev1, prev2, peak, peak_date, hist[0][0], d, strength(comp), pf)
            for k in range(1, HORIZONS + 1):
                target = d.replace(year=d.year + k) if not (d.month == 2 and d.day == 29) else d.replace(year=d.year + k, day=28)
                q = bisect.bisect_left(dates, target)
                j = min((c for c in (q - 1, q) if 0 <= c < len(dates)), key=lambda c: abs((dates[c] - target).days), default=None)
                if j is not None and abs((dates[j] - target).days) <= 120:
                    r = rows[k]
                    r['Xr'].append(xr); r['Xt'].append(xt); r['y'].append(math.log(hist[j][1] / v))
                    r['pid'].append(pid); r['v'].append(v); r['age'].append(age)

    NBASE = len(features(26, 2, 1e6, 0.0, False, 0.0))
    models, report, parity = {}, {'horizons': {}}, []
    for k in range(1, HORIZONS + 1):
        r = rows[k]
        Xr, Xt, y = np.array(r['Xr']), np.array(r['Xt']), np.array(r['y'])
        part = np.array([split(i) for i in r['pid']])
        tr, va, te = part == 'train', part == 'val', part == 'test'
        fit = tr | va
        w_base = ridge(Xr[fit][:, :NBASE], y[fit])
        w_perf = ridge(Xr[fit], y[fit])
        gbm = GBM().fit(Xt[tr], y[tr], Xt[va], y[va], log=lambda m: print(m, flush=True))
        val_res = y[va] - gbm.predict(Xt[va])
        lo_q, hi_q = float(np.quantile(val_res, 0.1)), float(np.quantile(val_res, 0.9))
        models[k] = (gbm, lo_q, hi_q)
        pg = gbm.predict(Xt[te])
        res = {'samples': int(len(y)), 'train': int(tr.sum()), 'val': int(va.sum()), 'test': int(te.sum()), 'trees': len(gbm.trees),
               'no_change': metrics(y[te], np.zeros(int(te.sum()))),
               'ridge': metrics(y[te], Xr[te][:, :NBASE] @ w_base),
               'ridge_perf': metrics(y[te], Xr[te] @ w_perf),
               'gbm': metrics(y[te], pg),
               'interval_80_coverage': round(float(np.mean((y[te] - pg >= lo_q) & (y[te] - pg <= hi_q)) * 100), 1),
               'with_performance_data': round(float(np.mean(Xt[:, 11] == 1)), 2)}
        # Calibration: mean actual vs predicted change by age (test players).
        ages = np.array(r['age'])[te]
        res['calibration_by_age'] = [[a, int(((ages >= a) & (ages < a + 2)).sum()), round(float(np.mean(y[te][(ages >= a) & (ages < a + 2)])), 3),
                                      round(float(np.mean(pg[(ages >= a) & (ages < a + 2)])), 3)]
                                     for a in range(17, 37, 2) if ((ages >= a) & (ages < a + 2)).sum() >= 50]
        # Feature importance: how much each input reduces error when the trees split on it.
        imp = np.zeros(len(TREE_FEATURES))
        for tree in gbm.trees:
            for f in tree[0][tree[0] >= 0]:
                imp[f] += 1
        res['importance_splits'] = {n: int(c) for n, c in zip(TREE_FEATURES, imp)}
        report['horizons'][k] = res
        print(f"{k}y: n={len(y)} trees={len(gbm.trees)} · test MAE log: no change {res['no_change']['mae_log']} · ridge "
              f"{res['ridge']['mae_log']} · ridge+perf {res['ridge_perf']['mae_log']} · boosted {res['gbm']['mae_log']} · "
              f"80% interval covers {res['interval_80_coverage']}%", flush=True)
        if os.environ.get('PARITY'):
            v0 = np.array(r['v'])[te]
            parity.append(np.column_stack([np.full(int(te.sum()), k), v0, v0 * np.exp(y[te]), v0 * np.exp(pg), ages,
                                           v0 * np.exp(Xr[te] @ w_perf)]))
    if os.environ.get('PARITY'):
        np.save(os.environ['PARITY'], np.vstack(parity))
        print('held-out predictions saved to', os.environ['PARITY'], flush=True)

    # ---- 2. Transfer value: real fees against market value at the time ----------------
    T = {'Xr': [], 'Xt': [], 'y': [], 'pid': []}
    for t in transfers:
        fee, mv, d = float(t['transfer_fee'] or 0), float(t['market_value_in_eur'] or 0), parse_date(t['transfer_date'])
        p = info.get(t['player_id'])
        dob = parse_date(p['date_of_birth']) if p else None
        pos = POS_GROUP.get(p['position']) if p else None
        if fee <= 0 or mv <= 0 or not d or d > TODAY or not dob or pos is None or d.year < 2012:
            continue
        hist = history.get(t['player_id'], [])
        i = bisect.bisect_right([h[0] for h in hist], d)
        before = hist[:i]
        peak = max([mv] + [h[1] for h in before])
        peak_date = max(before, key=lambda h: h[1])[0] if before else d
        prev1 = next((pv for pd, pv, _ in reversed(before) if 300 <= (d - pd).days <= 430), None)
        prev2 = next((pv for pd, pv, _ in reversed(before) if 665 <= (d - pd).days <= 795), None)
        comp = before[-1][2] if before else ''
        pf = perf.window(t['player_id'], d)
        age = years(dob, d)
        T['Xr'].append(features(age, pos, mv, 0.0, False, 0.0) + perf_features(pf, pos, age))
        T['Xt'].append(tree_row(age, pos, mv, prev1, prev2, peak, peak_date, before[0][0] if before else d, d, strength(comp), pf))
        T['y'].append(math.log(fee / mv)); T['pid'].append(t['player_id'])
    TXr, TXt, Ty = np.array(T['Xr']), np.array(T['Xt']), np.array(T['y'])
    tpart = np.array([split(i) for i in T['pid']])
    ttr, tva, tte = tpart == 'train', tpart == 'val', tpart == 'test'
    tw = ridge(TXr[ttr | tva], Ty[ttr | tva])
    tg = GBM(depth=4, min_leaf=60, rate=0.05).fit(TXt[ttr], Ty[ttr], TXt[tva], Ty[tva])
    tres = Ty[tva] - tg.predict(TXt[tva])
    t_lo, t_hi = float(np.quantile(tres, 0.25)), float(np.quantile(tres, 0.75))  # the middle half of real fees
    report['transfer'] = {'fees': int(len(Ty)), 'test': int(tte.sum()), 'median_fee_to_value': round(math.exp(float(np.median(Ty))), 3),
                          'same_as_value': metrics(Ty[tte], np.zeros(int(tte.sum()))),
                          'ridge': metrics(Ty[tte], TXr[tte] @ tw), 'gbm': metrics(Ty[tte], tg.predict(TXt[tte])),
                          'interval_50_coverage': round(float(np.mean((Ty[tte] - tg.predict(TXt[tte]) >= t_lo) & (Ty[tte] - tg.predict(TXt[tte]) <= t_hi)) * 100), 1)}
    print(f"transfer: {len(Ty)} fees · test MAE log: fee = value {report['transfer']['same_as_value']['mae_log']} · ridge "
          f"{report['transfer']['ridge']['mae_log']} · boosted {report['transfer']['gbm']['mae_log']}", flush=True)

    # ---- 3. Match TDsports players and predict ---------------------------------------
    by_name, by_surname = {}, {}
    for p in players:
        by_name.setdefault(slug(p['name']), []).append(p)
        by_surname.setdefault(slug(p['last_name'] or p['name'].split()[-1]), []).append(p)
    recent = lambda p: (int(p['last_season'] or 0), float(p['market_value_in_eur'] or 0))

    def match(person):
        cw = club_words(person['club'])
        same_club = lambda p: bool(cw & club_words(p['current_club_name']))
        cands = by_name.get(slug(person['name']), [])
        hit = [p for p in cands if same_club(p)]
        if hit:
            return max(hit, key=recent)
        if len(cands) == 1 or (cands and max(recent(p)[0] for p in cands) >= 2025 and sum(recent(p)[0] >= 2025 for p in cands) == 1):
            return max(cands, key=recent)
        sur = slug(person['name'].split()[-1])
        hit = [p for p in by_surname.get(sur, []) if same_club(p) and int(p['last_season'] or 0) >= 2024
               and (words(person['name']) & words(p['name']))]
        return max(hit, key=recent) if len(hit) == 1 else None

    def nice(v):
        step = 25_000 if v < 1e6 else 100_000 if v < 1e7 else 500_000 if v < 5e7 else 1_000_000
        return int(round(v / step) * step)

    out, people = {}, app_players()
    for person in people:
        p = match(person)
        if not p:
            continue
        hist = history.get(p['player_id'], [])
        v = float(p['market_value_in_eur'] or 0) or (hist[-1][1] if hist else 0)
        dob = parse_date(p['date_of_birth'])
        if not v or not dob:
            continue
        at = hist[-1][0] if hist else TODAY
        pos = POS_GROUP.get(p['position'], APP_POS_GROUP.get(person['pos'], 2))
        hist_now = hist + [(at, v, hist[-1][2] if hist else '')] if not hist or hist[-1][1] != v else hist
        i = len(hist_now) - 1
        prev1, prev2 = lookback(hist_now, i, 365), lookback(hist_now, i, 730)
        peak = max([float(p['highest_market_value_in_eur'] or 0), v] + [x for _, x, _ in hist])
        peak_date = max(hist, key=lambda h: h[1])[0] if hist else at
        age = years(dob, TODAY)
        pf = perf.window(p['player_id'], min(TODAY, perf.last))
        x = np.array([tree_row(age, pos, v, prev1, prev2, peak, peak_date, hist[0][0] if hist else at, at,
                               strength(hist[-1][2] if hist else ''), pf)])
        proj, lo, hi = [], [], []
        for k in range(1, HORIZONS + 1):
            gbm, rl, rh = models[k]
            m = float(gbm.predict(x)[0])
            fade = 0.5 ** max(0.0, age + k - 36)  # past their late 30s most players retire; the history only keeps those who play on
            cap = v * 1.2 if v >= 1e8 else float('inf')  # too few examples above EUR 100m to extrapolate growth
            proj.append(nice(min(cap, v * math.exp(m) * fade)))
            lo.append(nice(min(cap, v * math.exp(m + rl) * fade)))
            hi.append(nice(min(cap * 1.15, v * math.exp(m + rh) * fade)))
        until = parse_date(p['contract_expiration_date'])
        left = years(TODAY, until) if until else None
        contract = 1.0 if left is None or left >= 2 else 0.85 if left >= 1 else 0.6
        tm = float(tg.predict(np.array([tree_row(age, pos, v, prev1, prev2, peak, peak_date, hist[0][0] if hist else at, at,
                                                strength(hist[-1][2] if hist else ''), pf)]))[0])
        tv = [nice(v * math.exp(tm + t_lo) * contract), nice(v * math.exp(tm) * contract), nice(v * math.exp(tm + t_hi) * contract)]
        out[slug(person['name'])] = {
            'v': int(v), 'at': at.isoformat(), 'peak': int(peak), 'dob': dob.isoformat(), 'club': p['current_club_name'],
            'until': until.isoformat() if until else None, 'p': proj, 'lo': lo, 'hi': hi, 'tv': tv,
            'form': {'apps': pf['apps'], 'games': pf['games'], 'min': pf['minutes'], 'share': round(pf['share'], 2),
                     'starts': round(pf['starts'], 2), 'cons': round(pf['consistency'], 2), 'ga90': round(pf['ga90'], 2),
                     'ga': pf['ga'], 'to': min(TODAY, perf.last).isoformat()} if pf else None,
        }
    h = report['horizons']
    model = {'source': 'Transfermarkt via transfermarkt-datasets (CC0)', 'data': max(r['at'] for r in out.values()),
             'built': TODAY.isoformat(), 'model': 'gradient-boosted trees',
             'horizons': {k: {'samples': h[k]['samples'], 'mae_model': h[k]['gbm']['mae_log'], 'mae_no_change': h[k]['no_change']['mae_log'],
                              'within_2x': h[k]['gbm']['within_2x']} for k in h},
             'transferFees': report['transfer']['fees'], 'appearancesTo': perf.last.isoformat()}
    with open(os.path.join(ROOT, 'market-values.js'), 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build-market-values.py. Do not edit by hand.\n')
        f.write('// Current market values (Transfermarkt) and model predictions: values 1-5 years ahead and transfer value ranges.\n')
        f.write(f'const MARKET_MODEL = {json.dumps(model)};\n')
        f.write(f'const MARKET_VALUES = {json.dumps(out, ensure_ascii=False, separators=(",", ":"))};\n')
    report.update({'matched': len(out), 'players': len(people), 'league_strength': {c: round(v, 3) for c, v in sorted(league_strength.items(), key=lambda x: -x[1])},
                   'data_to': model['data'], 'appearances_to': perf.last.isoformat()})
    if os.environ.get('REPORT'):
        with open(os.environ['REPORT'], 'w') as f:
            json.dump(report, f, indent=1)
    print(f'{len(out)} of {len(people)} players matched', flush=True)


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
