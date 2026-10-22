"""Agent Tom: admin and supervisor for TDsports.

Usage: python3 tools/agent-tom.py          (runs until stopped; Ctrl+C to stop)

Every 30 seconds Tom:
  1. Pulls live scores from ESPN's public scoreboard for each league in the app and
     writes live.json (atomically) for the app's "Live now" card.
  2. Checks the app (localhost:8000) and the workstation (localhost:8781) respond.
  3. Re-stamps the script and stylesheet links in index.html (tools/stamp-assets.py), so
     edited files get a new ?v= hash and browsers load the new version.
Every 10 minutes Tom also audits the scouts' research files: valid JSON, 11 players per
lineup, and goals that add up to the final score.
Results: Tom keeps results.json with finished matches from the last 21 days for every
league. ESPN only serves one day per request, so finished days are cached and fetched
once (a few per cycle until the backlog is filled); today and yesterday are refreshed.

Tom reports to the agent workstation through workstation/status/agent-tom.json, using
the same shape as the scouts plus a "checks" list (name, ok, detail) and live counts.
"""
import datetime as dt
import glob
import subprocess
import sys
import json
import os
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.path.join(ROOT, 'live.json')
RESULTS = os.path.join(ROOT, 'results.json')
RESULT_DAYS = 21
BACKFILL_PER_CYCLE = 30
STATUS = os.path.join(ROOT, 'workstation', 'status', 'agent-tom.json')
LEAGUES = [  # ESPN code, name as used in the app
    ('uefa.champions', 'Champions League'), ('eng.1', 'Premier League'), ('esp.1', 'LaLiga'),
    ('ger.1', 'Bundesliga'), ('ita.1', 'Serie A'), ('fra.1', 'Ligue 1'), ('uefa.europa', 'Europa League'),
    ('usa.1', 'MLS'), ('mex.1', 'Liga MX'), ('fifa.world', 'FIFA World Cup'),
]
INTERVAL = 30
AUDIT_EVERY = 600
UA = {'User-Agent': 'TDsportsAgentTom/1.0'}
log = []


def now():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def note(msg):
    log.append({'t': now(), 'msg': msg})
    del log[:-25]
    print(f'[{now()}] {msg}', flush=True)


def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)  # atomic: readers never see a half-written file


def fetch(url, timeout=15):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def team(c):
    t = c.get('team', {})
    return {'name': t.get('shortDisplayName') or t.get('displayName'), 'logo': t.get('logo'), 'score': c.get('score')}


def parse_events(data):
    events = []
    for ev in data.get('events', []):
        comp = (ev.get('competitions') or [{}])[0]
        sides = {c.get('homeAway'): team(c) for c in comp.get('competitors', [])}
        st = ev.get('status', {}).get('type', {})
        events.append({
            'id': ev.get('id'), 'start': ev.get('date'),
            'state': st.get('state'),            # pre | in | post
            'detail': st.get('shortDetail'),     # e.g. 81', HT, FT, 8:00 PM
            'home': sides.get('home', {}), 'away': sides.get('away', {}),
        })
    return events


def scoreboards():
    leagues, errors = [], []
    for code, name in LEAGUES:
        try:
            data = json.loads(fetch(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/scoreboard'))
        except Exception as e:
            errors.append(f'{name}: {e}')
            continue
        leagues.append({'code': code, 'league': name, 'events': parse_events(data)})
    return leagues, errors


def load_results_cache():
    try:
        return json.load(open(RESULTS, encoding='utf-8')).get('cache', {})
    except Exception:
        return {}


def update_results(cache):
    """Fill cache[code][YYYYMMDD] with finished matches; returns how many days were fetched."""
    today = dt.date.today()
    days = [(today - dt.timedelta(days=n)).strftime('%Y%m%d') for n in range(0, RESULT_DAYS + 1)]
    fresh = set(days[:2])  # today and yesterday can still change
    todo = [(code, d) for d in days for code, _ in LEAGUES if d in fresh or d not in cache.get(code, {})]
    fetched = 0
    for code, d in todo:
        if fetched >= BACKFILL_PER_CYCLE + 2 * len(LEAGUES):
            break
        try:
            data = json.loads(fetch(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/scoreboard?dates={d}'))
        except Exception:
            continue
        cache.setdefault(code, {})[d] = [e for e in parse_events(data) if e['state'] == 'post']
        fetched += 1
        time.sleep(0.15)
    for code in cache:  # drop days that fell out of the window
        cache[code] = {d: v for d, v in cache[code].items() if d in days}
    names = dict(LEAGUES)
    leagues = []
    for code, by_day in cache.items():
        seen, events = set(), []
        for d in sorted(by_day, reverse=True):
            for e in by_day[d]:
                if e['id'] not in seen:
                    seen.add(e['id'])
                    events.append(e)
        if events:
            leagues.append({'code': code, 'league': names.get(code, code), 'events': events})
    write_json(RESULTS, {'updated': now(), 'source': 'ESPN public scoreboard', 'days': RESULT_DAYS,
                         'leagues': leagues, 'cache': cache})
    return fetched, sum(len(l['events']) for l in leagues)


def up(url):
    try:
        fetch(url, timeout=5)
        return True
    except Exception:
        return False


def audit():
    problems, matches = [], 0
    for path in glob.glob(os.path.join(ROOT, 'research', 'agent-*.json')):
        try:
            data = json.load(open(path, encoding='utf-8'))
        except Exception as e:
            problems.append(f'{os.path.basename(path)} unreadable: {e}')
            continue
        for m in data.get('matches', []):
            matches += 1
            if not m.get('found'):
                continue
            for side in ('home', 'away'):
                n = len((m.get('lineups') or {}).get(side) or [])
                if n != 11:
                    problems.append(f"{m['id']} {side} lineup has {n} players")
            goals = m.get('goals') or []
            tally = [sum(1 for g in goals if g.get('side') == s) for s in ('home', 'away')]
            if tally != list(m.get('score') or []):
                problems.append(f"{m['id']} goals {tally} != score {m.get('score')}")
    return matches, problems


def main():
    note('Agent Tom on duty: live feed every 30s, audits every 10 min')
    last_audit, audit_result = 0, (0, [])
    results_cache, last_results, result_count = load_results_cache(), 0, 0
    cycles = 0
    while True:
        cycles += 1
        leagues, errors = scoreboards()
        live_n = sum(1 for l in leagues for e in l['events'] if e['state'] == 'in')
        total_n = sum(len(l['events']) for l in leagues)
        if leagues:
            write_json(LIVE, {'updated': now(), 'source': 'ESPN public scoreboard', 'leagues': leagues, 'errors': errors})
        note(f'Live feed: {live_n} live, {total_n} fixtures across {len(leagues)}/{len(LEAGUES)} leagues' + (f'; {len(errors)} errors' if errors else ''))

        if time.time() - last_audit > AUDIT_EVERY:
            audit_result = audit()
            last_audit = time.time()
            note(f'Audit: {audit_result[0]} researched matches, {len(audit_result[1])} problems')
            for p in audit_result[1][:5]:
                note(f'Audit issue: {p}')

        backlog = any(len(results_cache.get(c, {})) <= RESULT_DAYS for c, _ in LEAGUES)
        if backlog or time.time() - last_results > AUDIT_EVERY:
            fetched, result_count = update_results(results_cache)
            last_results = time.time()
            note(f'Results: {result_count} finished matches over {RESULT_DAYS} days ({fetched} day files fetched)')

        # Keep the ?v= hashes in index.html current, so browsers never run stale scripts.
        subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'stamp-assets.py')], capture_output=True)

        app_ok, ws_ok = up('http://127.0.0.1:8000/'), up('http://127.0.0.1:8781/')
        if not app_ok:
            note('App server not responding on :8000')
        checks = [
            {'name': 'Live feed', 'ok': bool(leagues) and not errors, 'detail': f'{live_n} live · {total_n} fixtures'},
            {'name': 'App :8000', 'ok': app_ok, 'detail': 'responding' if app_ok else 'down'},
            {'name': 'Workstation :8781', 'ok': ws_ok, 'detail': 'responding' if ws_ok else 'down'},
            {'name': 'Results', 'ok': result_count > 0, 'detail': f'{result_count} finished · last {RESULT_DAYS} days'},
            {'name': 'Research audit', 'ok': not audit_result[1], 'detail': f'{audit_result[0]} matches · {len(audit_result[1])} problems'},
        ]
        healthy = all(c['ok'] for c in checks)
        write_json(STATUS, {
            'agent': 'tom', 'name': 'Agent Tom', 'role': 'Admin & supervisor',
            'state': 'supervising' if healthy else 'alert',
            'task': 'Supervising live feed and data' if healthy else 'Attention needed',
            'step': f'Cycle {cycles} · next check in {INTERVAL}s',
            'progress': 1 if healthy else 0.5,
            'matches': [c['name'] for c in checks], 'done': [c['name'] for c in checks if c['ok']],
            'checks': checks, 'live': {'live': live_n, 'fixtures': total_n},
            'log': log, 'updated': now(),
        })
        time.sleep(INTERVAL)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        note('Agent Tom signing off')
