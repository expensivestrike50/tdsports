"""Find FotMob headshots for every player and coach without a photo.

Usage: python3 tools/fetch-fotmob-photos.py

For each person in match-data.js without a local photo it searches FotMob by name, picks
the suggestion whose club matches the person's club in the match (players vs coaches kept
apart), checks the headshot exists and records its FotMob id in assets/fotmob-photos.json
({photo key: FotMob id}). tools/build-match-data.py then points those people at
https://images.fotmob.com/image_resources/playerimages/<id>.png. The images are linked,
not copied into the repository: FotMob headshots are copyrighted. Safe to re-run.
"""
import concurrent.futures
import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'fotmob-photos.json')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'}
IMG = 'https://images.fotmob.com/image_resources/playerimages/{}.png'


def slug(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


# Short club names used in the app -> words in FotMob's full club names.
ALIASES = {'spurs': 'tottenham', 'man': 'manchester', 'nottm': 'nottingham', 'wolves': 'wolverhampton', 'psg': 'paris',
           'inter': 'internazionale', 'gladbach': 'monchengladbach', 'leverkusen': 'bayer', 'atl': 'atletico'}


def words(name):
    ws = {w for w in slug(name or '').split('-') if len(w) > 2 and w not in {'fc', 'afc', 'cf', 'club', 'sc', 'de', 'city', 'united'}}
    return ws | {ALIASES[w] for w in slug(name or '').split('-') if w in ALIASES}


def request(url, method='GET'):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method=method), timeout=20) as r:
                return r.status, (r.read() if method == 'GET' else b'')
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return e.code, b''
        except Exception:
            pass
        time.sleep(2 * (attempt + 1))
    return 0, b''


def load():
    text = open(os.path.join(ROOT, 'match-data.js'), encoding='utf-8').read()
    grab = lambda pattern: json.loads(re.search(pattern, text, re.S).group(1))
    people = grab(r'Object\.assign\(PEOPLE, (\{.*?\})\);\n')
    lineups = grab(r'Object\.assign\(LINEUPS, (\{.*?\})\);\n')
    updates = grab(r'const MATCH_UPDATES = (\{.*?\});\n')
    data = open(os.path.join(ROOT, 'data.js'), encoding='utf-8').read()
    # Each person's club, from the side they're listed on.
    club = {}
    for mid, L in lineups.items():
        u = updates.get(mid, {})
        home, away = u.get('home'), u.get('away')
        if not home:  # fixtures defined in data.js keep their teams there
            m = re.search(r"id: '" + re.escape(mid) + r"', home: '([^']+)', away: '([^']+)'", data)
            home, away = (m.group(1), m.group(2)) if m else (None, None)
        for side, team in (('home', home), ('away', away)):
            if not team:
                continue
            ids = [p[0] for p in L.get(side, [])] + [p[0] for p in L.get(side + 'Subs', [])]
            ids += [L['coaches'][0 if side == 'home' else 1]] if L.get('coaches') else []
            for pid in ids:
                club.setdefault(pid, team)
    return people, club


def find(person, team):
    # Full name first; then the surname alone (catches spelling variants), which must match the club.
    return search(person, team, person['name'], False) or search(person, team, person.get('short') or person['name'].split()[-1], True)


def search(person, team, term, club_only):
    status, body = request('https://www.fotmob.com/api/data/search/suggest?' + urllib.parse.urlencode({'term': term, 'lang': 'en'}))
    if status != 200:
        return None
    try:
        # The same player is listed in several groups ("All", "Players"): keep each id once.
        suggestions = list({s['id']: s for g in json.loads(body) for s in g.get('suggestions', []) if s.get('type') == 'player'}.values())
    except ValueError:
        return None
    coach = person.get('pos') == 'Coach'
    suggestions = [s for s in suggestions if bool(s.get('isCoach')) == coach]
    target = slug(person['name'])
    club = words(team)
    same_name = [s for s in suggestions if slug(s.get('name', '')) == target]
    by_club = [s for s in suggestions if club & words(s.get('teamName', ''))]
    # Best: same club (and the same name if possible); otherwise an exact, unambiguous name.
    pick = next((s for s in by_club if s in same_name), None) or (by_club[0] if by_club and words(by_club[0]['name']) & words(person['name']) else None) \
        or (same_name[0] if len(same_name) == 1 and not club_only else None)
    if not pick:
        return None
    ok, _ = request(IMG.format(pick['id']), 'HEAD')
    return pick['id'] if ok == 200 else None


def main():
    people, club = load()
    found = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    todo = {pid: p for pid, p in people.items() if not p.get('photo') and slug(p['name']) not in found}
    print(f'{len(todo)} people without photos', flush=True)
    done = 0
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        futures = {pool.submit(find, p, club.get(pid, '')): (pid, p) for pid, p in todo.items()}
        for f in concurrent.futures.as_completed(futures):
            pid, p = futures[f]
            done += 1
            try:
                fid = f.result()
            except Exception:
                fid = None
            if fid:
                found[slug(p['name'])] = fid
            if done % 100 == 0:
                json.dump(found, open(OUT, 'w', encoding='utf-8'), indent=0, sort_keys=True)
                print(f'{done}/{len(todo)} · found {len(found)}', flush=True)
    json.dump(found, open(OUT, 'w', encoding='utf-8'), indent=0, sort_keys=True)
    print(f'done: {len(found)} FotMob photos', flush=True)


if __name__ == '__main__':
    main()
