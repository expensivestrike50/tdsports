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


def main():
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
            history.setdefault(v['player_id'], []).append((d, val))
    for h in history.values():
        h.sort()

    # ---- 1. Value prediction models, one per horizon --------------------------------
    rows = {k: ([], [], []) for k in range(1, HORIZONS + 1)}  # X, y, player id
    for pid, hist in history.items():
        p = info.get(pid)
        dob = parse_date(p['date_of_birth']) if p else None
        pos = POS_GROUP.get(p['position']) if p else None
        if not dob or pos is None:
            continue
        dates = [d for d, _ in hist]
        peak = 0.0
        for i, (d, v) in enumerate(hist):
            peak = max(peak, v)
            if d.year < 2012:
                continue
            prev = next((pv for pd, pv in reversed(hist[:i]) if 300 <= (d - pd).days <= 430), None)
            x = features(years(dob, d), pos, v, math.log(v / prev) if prev else 0.0, prev is not None, math.log(peak / v))
            x = x + perf_features(perf.window(pid, d), pos, years(dob, d))
            for k in range(1, HORIZONS + 1):
                target = d.replace(year=d.year + k) if not (d.month == 2 and d.day == 29) else d.replace(year=d.year + k, day=28)
                q = bisect.bisect_left(dates, target)
                j = min((c for c in (q - 1, q) if 0 <= c < len(dates)), key=lambda c: abs((dates[c] - target).days), default=None)
                if j is not None and abs((dates[j] - target).days) <= 120:
                    rows[k][0].append(x)
                    rows[k][1].append(math.log(hist[j][1] / v))
                    rows[k][2].append(pid)
    models, scores = {}, {}
    NBASE = len(features(26, 2, 1e6, 0.0, False, 0.0))
    perf_mean = {}
    for k in range(1, HORIZONS + 1):
        X, y, ids = np.array(rows[k][0]), np.array(rows[k][1]), np.array(rows[k][2])
        test = np.array([int(i) % 5 == 0 for i in ids])  # the same 20% of players every run
        w = ridge(X[~test], y[~test])
        wb = ridge(X[~test][:, :NBASE], y[~test])          # the same model without performance, for comparison
        pred = X[test] @ w
        resid = y[~test] - X[~test] @ w
        models[k] = (w, float(np.quantile(resid, 0.1)), float(np.quantile(resid, 0.9)))
        has = X[:, NBASE] == 1
        scores[k] = {'samples': int(len(y)), 'mae_model': round(float(np.mean(np.abs(y[test] - pred))), 3),
                     'mae_without_performance': round(float(np.mean(np.abs(y[test] - X[test][:, :NBASE] @ wb))), 3),
                     'mae_no_change': round(float(np.mean(np.abs(y[test]))), 3), 'with_performance_data': round(float(has.mean()), 2)}
        ages = X[:, 1:22].argmax(axis=1) + 17
        if os.environ.get('CALIBRATE'):
            tiers = X[:, 1 + 21 + 12:1 + 21 + 12 + len(TIERS) + 1].argmax(axis=1)
            for lo_t, hi_t, a0, a1 in [(6, 8, 24, 27), (6, 8, 28, 31), (4, 5, 24, 27), (2, 3, 19, 22), (0, 2, 28, 32)]:
                sel = test & (tiers >= lo_t) & (tiers <= hi_t) & (ages >= a0) & (ages <= a1)
                if sel.sum():
                    print(f'   {k}y tier {lo_t}-{hi_t} age {a0}-{a1}: n={sel.sum()} actual {np.mean(y[sel]):+.2f} predicted {np.mean(X[sel] @ w):+.2f} median actual {np.median(y[sel]):+.2f}')
        young = test & has & (ages <= 23)
        scores[k]['mae_young_model'] = round(float(np.mean(np.abs(y[young] - X[young] @ w))), 3)
        scores[k]['mae_young_without_performance'] = round(float(np.mean(np.abs(y[young] - X[young][:, :NBASE] @ wb))), 3)
        if k == HORIZONS:  # the median performance contribution for each position and age group, for "effect of performance"
            contrib = X[:, NBASE:] @ w[NBASE:]
            for g in range(4):
                for ai, (lo_, hi_) in enumerate(AGE_GROUPS):
                    sel = has & (X[:, 1 + 21 + g] == 1) & (ages >= lo_) & (ages <= hi_)
                    perf_mean[g, ai] = float(np.median(contrib[sel]))
        print(f"{k}y: {len(y)} samples · test error (log) {scores[k]['mae_model']} · without performance "
              f"{scores[k]['mae_without_performance']} · no change {scores[k]['mae_no_change']} · age<=23: "
              f"{scores[k]['mae_young_model']} vs {scores[k]['mae_young_without_performance']}", flush=True)

    # ---- 2. Transfer value model: real fees against market value at the time ---------
    TX, Ty = [], []
    for t in transfers:
        fee, mv, d = float(t['transfer_fee'] or 0), float(t['market_value_in_eur'] or 0), parse_date(t['transfer_date'])
        p = info.get(t['player_id'])
        dob = parse_date(p['date_of_birth']) if p else None
        pos = POS_GROUP.get(p['position']) if p else None
        if fee <= 0 or mv <= 0 or not d or d > TODAY or not dob or pos is None or d.year < 2012:
            continue
        TX.append(features(years(dob, d), pos, mv, 0.0, False, 0.0) + perf_features(perf.window(t['player_id'], d), pos, years(dob, d)))
        Ty.append(math.log(fee / mv))
    TX, Ty = np.array(TX), np.array(Ty)
    tw = ridge(TX, Ty)
    tres = Ty - TX @ tw
    t_lo, t_hi = float(np.quantile(tres, 0.25)), float(np.quantile(tres, 0.75))  # the middle half of real fees
    print(f'transfer model: {len(Ty)} fees · median fee/value {math.exp(float(np.median(Ty))):.2f}', flush=True)

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

    out, matched = {}, 0
    for person in app_players():
        p = match(person)
        if not p:
            continue
        hist = history.get(p['player_id'], [])
        v = float(p['market_value_in_eur'] or 0) or (hist[-1][1] if hist else 0)
        dob = parse_date(p['date_of_birth'])
        if not v or not dob:
            continue
        matched += 1
        at = hist[-1][0] if hist else TODAY
        pos = POS_GROUP.get(p['position'], APP_POS_GROUP.get(person['pos'], 2))
        prev = next((pv for pd, pv in reversed(hist) if 300 <= (at - pd).days <= 430), None)
        peak = max([float(p['highest_market_value_in_eur'] or 0), v] + [x for _, x in hist])
        age = years(dob, TODAY)
        pf = perf.window(p['player_id'], min(TODAY, perf.last))
        pfx = perf_features(pf, pos, age)
        base = features(age, pos, v, math.log(v / prev) if prev else 0.0, prev is not None, math.log(peak / v))
        x = np.array(base + pfx)
        proj, lo, hi = [], [], []
        for k in range(1, HORIZONS + 1):
            w, rl, rh = models[k]
            m = float(x @ w)
            # Players past their late 30s mostly retire; the history only keeps those who play on.
            fade = 0.5 ** max(0.0, age + k - 36)
            # Almost nobody has been valued above about EUR 200m, so the model has little to learn
            # from at the very top: there, growth is capped at 20%.
            cap = v * 1.2 if v >= 1e8 else float('inf')
            proj.append(nice(min(cap, v * math.exp(m) * fade)))
            lo.append(nice(min(cap, v * math.exp(m + rl) * fade)))
            hi.append(nice(min(cap * 1.15, v * math.exp(m + rh) * fade)))
        until = parse_date(p['contract_expiration_date'])
        left = years(TODAY, until) if until else None
        contract = 1.0 if left is None or left >= 2 else 0.85 if left >= 1 else 0.6
        tm = float(np.array(features(age, pos, v, 0.0, False, 0.0) + pfx) @ tw)
        # How much this player's performance moves the 5-year value, against a typical player in his position.
        w5 = models[HORIZONS][0]
        group = next(i for i, (lo_, hi_) in enumerate(AGE_GROUPS) if lo_ <= min(37, max(17, round(age))) <= hi_)
        effect = math.exp(float(np.array(pfx) @ w5[len(base):]) - perf_mean[pos, group]) - 1 if pf else None
        tv = [nice(v * math.exp(tm + t_lo) * contract), nice(v * math.exp(tm) * contract), nice(v * math.exp(tm + t_hi) * contract)]
        out[slug(person['name'])] = {
            'v': int(v), 'at': at.isoformat(), 'peak': int(peak), 'dob': dob.isoformat(), 'club': p['current_club_name'],
            'until': until.isoformat() if until else None, 'p': proj, 'lo': lo, 'hi': hi, 'tv': tv,
            'form': {'apps': pf['apps'], 'games': pf['games'], 'min': pf['minutes'], 'share': round(pf['share'], 2),
                     'starts': round(pf['starts'], 2), 'cons': round(pf['consistency'], 2), 'ga90': round(pf['ga90'], 2),
                     'ga': pf['ga'], 'effect': round(effect, 3), 'to': min(TODAY, perf.last).isoformat()} if pf else None,
        }
    model = {'source': 'Transfermarkt via transfermarkt-datasets (CC0)', 'data': max(r['at'] for r in out.values()),
             'built': TODAY.isoformat(), 'horizons': scores, 'transferFees': int(len(Ty)), 'appearancesTo': perf.last.isoformat()}
    with open(os.path.join(ROOT, 'market-values.js'), 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build-market-values.py. Do not edit by hand.\n')
        f.write('// Current market values (Transfermarkt) and model predictions: values 1-5 years ahead and transfer value ranges.\n')
        f.write(f'const MARKET_MODEL = {json.dumps(model)};\n')
        f.write(f'const MARKET_VALUES = {json.dumps(out, ensure_ascii=False, separators=(",", ":"))};\n')
    print(f'{matched} of {len(app_players())} players matched', flush=True)


if __name__ == '__main__':
    sys.exit(main())
