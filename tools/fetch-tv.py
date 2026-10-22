"""Build tv.json: every fixture from yesterday to six days ahead, with the TV channels showing it.

Usage: python3 tools/fetch-tv.py

Reads ESPN's public scoreboard for each competition in the app, one day per request, and
writes tv.json:

    { updated, region: "US", days: [YYYY-MM-DD, ...], matches: [match, ...] }   (by kickoff)
    match = { id, league, code, start, state, detail, venue, channels: [...],
              home: { name, logo, score }, away: { ... } }

The channels are ESPN's US broadcast listings (e.g. Peacock, USA Network, ESPN+,
Paramount+, Apple TV). Agent Tom runs this every 30 minutes; the "Refresh feeds" GitHub
Action refreshes the hosted copy.
"""
import concurrent.futures
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tv.json')
UA = {'User-Agent': 'Mozilla/5.0 (compatible; TDsportsTV/1.0; +https://github.com/expensivestrike50/tdsports)'}
LEAGUES = [('uefa.champions', 'Champions League'), ('eng.1', 'Premier League'), ('esp.1', 'LaLiga'), ('ger.1', 'Bundesliga'),
           ('ita.1', 'Serie A'), ('fra.1', 'Ligue 1'), ('uefa.europa', 'Europa League'), ('usa.1', 'MLS'), ('mex.1', 'Liga MX'),
           ('fifa.world', 'FIFA World Cup')]
# ESPN's short channel names -> the names viewers know.
CHANNEL_NAMES = {'USA Net': 'USA Network', 'Tele': 'Telemundo', 'beIn Sports': 'beIN Sports', 'Fandango': 'Fandango at Home',
                 'UNIVERSO': 'Universo', 'NBCSN': 'NBC Sports', 'CBSSN': 'CBS Sports Network'}


def scoreboard(code, day):
    url = f'https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/scoreboard?dates={day}'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            return json.loads(r.read()).get('events', [])
    except Exception as e:
        print('failed', code, day, e, file=sys.stderr)
        return []


def channels(comp):
    names = [n for b in comp.get('broadcasts') or [] for n in b.get('names') or []]
    names += [(g.get('media') or {}).get('shortName') for g in comp.get('geoBroadcasts') or []]
    out = []
    for n in names:
        n = CHANNEL_NAMES.get(n, n)
        if n and n not in out:
            out.append(n)
    return out


def main():
    today = datetime.now(timezone.utc).date()
    days = [(today + timedelta(days=d)) for d in range(-1, 7)]
    jobs = [(code, league, d.strftime('%Y%m%d')) for code, league in LEAGUES for d in days]
    with concurrent.futures.ThreadPoolExecutor(10) as pool:
        results = list(pool.map(lambda j: (j, scoreboard(j[0], j[2])), jobs))
    matches, seen = [], set()
    for (code, league, _), events in results:
        for e in events:
            if e['id'] in seen:
                continue
            seen.add(e['id'])
            comp = (e.get('competitions') or [{}])[0]
            side = {c.get('homeAway'): c for c in comp.get('competitors') or []}
            team = lambda h: {'name': ((side.get(h) or {}).get('team') or {}).get('shortDisplayName') or ((side.get(h) or {}).get('team') or {}).get('displayName'),
                              'logo': ((side.get(h) or {}).get('team') or {}).get('logo'), 'score': (side.get(h) or {}).get('score')}
            status = (e.get('status') or {}).get('type') or {}
            matches.append({'id': e['id'], 'league': league, 'code': code, 'start': e.get('date'), 'state': status.get('state'),
                            'detail': status.get('shortDetail'), 'venue': ((comp.get('venue') or {}).get('fullName')),
                            'channels': channels(comp), 'home': team('home'), 'away': team('away')})
    matches.sort(key=lambda m: (m['start'] or '', m['league']))
    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'region': 'US',
           'days': [d.isoformat() for d in days], 'matches': matches}
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    print(f"{len(matches)} fixtures, {sum(1 for m in matches if m['channels'])} with TV listings", flush=True)


if __name__ == '__main__':
    main()
