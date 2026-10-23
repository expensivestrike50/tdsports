"""Build lineups.json: team news for every upcoming fixture in tv.json.

Usage: python3 tools/fetch-lineups.py

For each fixture that hasn't kicked off it finds the same match on FotMob (by kickoff time
and team names) and keeps FotMob's lineup: the predicted XI (or the confirmed one about an
hour before kickoff), the formation, the coach and the players who are out, each with the
reason (injury or suspension) and expected return. It also picks out news.json articles
about either side's injuries, suspensions or team news. The app's predicted lineup starts
from this and only falls back to each side's last XI when a match is missing here.

    { updated, source, matches: { "<ESPN event id>": {
        fotmob, type: "predicted" | "confirmed",
        home: { name, formation, coach, starters: [player], unavailable: [absence] }, away: { ... },
        news: [{ title, url, source, published }] } } }
    player = { id, name, short, shirt, position, x, y }     (x 0 own goal .. 1 opponent's goal; y 0 left .. 1 right)
    absence = { id, name, type: "injury" | "suspension" | ..., return }

Agent Tom runs this with the news and TV refresh; the "Refresh feeds" GitHub Action
refreshes the hosted copy.
"""
import concurrent.futures
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'lineups.json')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'}
API = 'https://www.fotmob.com/api/data'
TEAM_NEWS = re.compile(r'injur|suspen|\bban(ned)?\b|ruled out|\bmiss(es|ing)?\b|sidelined|\bdoubt|fitness|knock|red card|sent off|team news|line-?up|setback|surgery|\bacl\b', re.I)


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == 2:
                print('failed', url, e, file=sys.stderr)
            time.sleep(1 + attempt)
    return None


def slug(name):
    s = unicodedata.normalize('NFKD', (name or '').replace('ø', 'o').replace('Ø', 'O')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# ESPN's short club names -> words in FotMob's names.
ALIASES = {'spurs': 'tottenham', 'man': 'manchester', 'nottm': 'nottingham', 'wolves': 'wolverhampton', 'psg': 'paris',
           'gladbach': 'monchengladbach', 'atl': 'atletico', 'utd': 'united', 'cologne': 'koln', 'nycfc': 'new york city',
           'lafc': 'los angeles', 'unam': 'pumas', 'guadalajara': 'chivas'}
DROP = {'fc', 'afc', 'cf', 'sc', 'club', 'de', 'cd', 'ac', 'as', 'ss', 'ud', 'rc', 'sv', 'vfb', 'vfl', 'tsg', '1', 'fk', 'the'}


def words(name):
    ws = ' '.join(ALIASES.get(w, w) for w in slug(name).split()).split()
    return {w for w in ws if w not in DROP and len(w) > 1}


def same_word(a, b):
    return a == b or (min(len(a), len(b)) >= 5 and (a.startswith(b) or b.startswith(a)))  # Hamburg / Hamburger SV


def same_team(a, b):
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return False
    common = {w for w in wa if any(same_word(w, v) for v in wb)}
    return bool(common) and (len(common) >= min(len(wa), len(wb)) or len(common) >= 2)


def fotmob_day(day):
    data = get(f'{API}/matches?date={day.replace("-", "")}&timezone=UTC') or {}
    out = []
    for lg in data.get('leagues', []):
        for m in lg.get('matches', []):
            out.append({'id': m['id'], 'home': m['home']['name'], 'away': m['away']['name'],
                        'start': (m.get('status') or {}).get('utcTime') or m.get('time')})
    return out


def find(fixture, days):
    start = datetime.fromisoformat(fixture['start'].replace('Z', '+00:00'))
    for m in days.get(start.strftime('%Y-%m-%d'), []) + days.get((start - timedelta(days=1)).strftime('%Y-%m-%d'), []):
        if not m['start'] or re.search(r'\(W\)| II$| U\d\d', m['home'] + m['away']):
            continue
        near = abs(datetime.fromisoformat(m['start'].replace('Z', '+00:00')) - start) <= timedelta(hours=3)
        if near and same_team(fixture['home']['name'], m['home']) and same_team(fixture['away']['name'], m['away']):
            return m
    return None


def player(p):
    lay = p.get('horizontalLayout') or {}
    return {'id': p['id'], 'name': p['name'], 'short': p.get('lastName') or p['name'].split(' ')[-1],
            'shirt': p.get('shirtNumber'), 'position': p.get('positionId'),
            'x': lay.get('x'), 'y': lay.get('y')}


def team(t):
    out = []
    for u in t.get('unavailable') or []:
        info = u.get('unavailability') or {}
        out.append({'id': u['id'], 'name': u['name'], 'type': info.get('type') or 'unavailable', 'return': info.get('expectedReturn')})
    return {'name': t.get('name'), 'formation': t.get('formation'), 'coach': (t.get('coach') or {}).get('name'),
            'starters': [player(p) for p in t.get('starters') or []], 'subs': [player(p) for p in t.get('subs') or []],
            'unavailable': out}


def details(fm):
    d = get(f'{API}/matchDetails?matchId={fm["id"]}')
    lu = ((d or {}).get('content') or {}).get('lineup') or {}
    if not lu.get('homeTeam') or not lu.get('awayTeam'):
        return None
    return {'fotmob': fm['id'], 'type': lu.get('lineupType') or 'predicted', 'home': team(lu['homeTeam']), 'away': team(lu['awayTeam'])}


def team_news(fixture, entry, articles):
    """Articles from the last 10 days about either side's injuries, suspensions or team news."""
    names = [fixture['home']['name'], fixture['away']['name']]
    out_names = {slug(u['name']) for h in ('home', 'away') for u in entry[h]['unavailable']}
    since = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    picked = []
    for a in articles:
        if (a.get('published') or '') < since:
            continue
        # A headline naming a missing player, or naming a side and about injuries, bans or team news.
        title = slug(a.get('title'))
        side = any(f' {w} ' in f' {title} ' for n in names for w in words(n) if len(w) > 3)
        if any(n and n in title for n in out_names) or (side and TEAM_NEWS.search(a.get('title', ''))):
            picked.append({'title': a['title'], 'url': a['url'], 'source': a.get('source'), 'published': a.get('published')})
    return sorted(picked, key=lambda x: x['published'] or '', reverse=True)[:6]


def main():
    tv = json.load(open(os.path.join(ROOT, 'tv.json')))
    try:
        articles = json.load(open(os.path.join(ROOT, 'news.json'))).get('articles', [])
    except Exception:
        articles = []
    fixtures = [m for m in tv['matches'] if m.get('state') == 'pre']
    dates = set()
    for f in fixtures:
        start = datetime.fromisoformat(f['start'].replace('Z', '+00:00'))
        dates |= {start.strftime('%Y-%m-%d'), (start - timedelta(days=1)).strftime('%Y-%m-%d')}
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        days = dict(zip(sorted(dates), ex.map(fotmob_day, sorted(dates))))
    pairs = [(f, find(f, days)) for f in fixtures]
    found = [(f, fm) for f, fm in pairs if fm]
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        entries = list(ex.map(lambda p: details(p[1]), found))
    matches = {}
    for (f, _), entry in zip(found, entries):
        if entry:
            entry['news'] = team_news(f, entry, articles)
            matches[f['id']] = entry
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'source': 'FotMob', 'matches': matches}
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    absent = sum(len(e[h]['unavailable']) for e in matches.values() for h in ('home', 'away'))
    print(f'{len(matches)} of {len(fixtures)} upcoming fixtures with team news ({absent} players out)')


if __name__ == '__main__':
    main()
