"""Fetch Wikimedia Commons headshots for researched players and coaches.

Usage: python3 tools/fetch-player-photos.py [--skip-search]

For every person in match-data.js without a photo it looks up their English Wikipedia
article (exact title first, in batches; then a search for "<name> footballer"), keeps
only articles whose short description mentions football, takes the article's lead image
when it is hosted on Wikimedia Commons, crops it to a square headshot and records the
author and licence in assets/photo-sources.json. Safe to re-run: people who already have
a photo are skipped. Rebuild afterwards with tools/build-match-data.py.
--skip-search uses exact article titles only; the search fallback is slow because
Wikipedia rate-limits it.
"""
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'photos', 'people')
SOURCES = os.path.join(ROOT, 'assets', 'photo-sources.json')
UA = {'User-Agent': 'TDsportsPrototype/1.0 (football app prototype; player headshots)'}
FOOTBALL = re.compile(r'football|soccer|goalkeeper|striker|midfielder|defender|manager|coach', re.I)


def get(url, binary=False):
    for attempt in range(6):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
            time.sleep(0.6)
            return data if binary else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(8 * (attempt + 1))
    raise RuntimeError('rate limited: ' + url)


def api(params, host='en.wikipedia.org'):
    return get(f'https://{host}/w/api.php?' + urllib.parse.urlencode({**params, 'format': 'json', 'formatversion': 2}))


def slug(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def load_people():
    text = open(os.path.join(ROOT, 'match-data.js'), encoding='utf-8').read()
    m = re.search(r'Object\.assign\(PEOPLE, (\{.*?\})\);\n', text, re.S)
    return json.loads(m.group(1))


def lead_images(titles):
    """{requested title: (page title, image file, description)} for up to 50 titles."""
    out = {}
    r = api({'action': 'query', 'titles': '|'.join(titles), 'prop': 'pageimages|description', 'piprop': 'name|thumbnail',
             'pithumbsize': 400, 'redirects': 1})
    q = r.get('query', {})
    alias = {}
    for n in q.get('normalized', []) + q.get('redirects', []):
        alias[n['to']] = alias.get(n['from'], n['from'])
    for p in q.get('pages', []):
        if p.get('missing'):
            continue
        req = p['title']
        while req in alias:
            req = alias[req]
        out[req] = (p['title'], p.get('pageimage'), p.get('description', ''), (p.get('thumbnail') or {}).get('source', ''))
    return out


def commons_meta(files):
    r = api({'action': 'query', 'titles': '|'.join('File:' + f for f in files), 'prop': 'imageinfo',
             'iiprop': 'url|extmetadata', 'iiurlwidth': 420}, host='commons.wikimedia.org')
    strip = lambda s: re.sub('<[^>]+>', '', s or '').strip()
    out = {}
    for p in r.get('query', {}).get('pages', []):
        if 'imageinfo' not in p:
            continue
        ii = p['imageinfo'][0]
        m = ii.get('extmetadata', {})
        out[p['title'][5:].replace(' ', '_')] = {
            'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'),
            'author': strip(m.get('Artist', {}).get('value')), 'license': m.get('LicenseShortName', {}).get('value', ''),
        }
    return out


def headshot(data):
    im = Image.open(io.BytesIO(data)).convert('RGB')
    w, h = im.size
    side = min(w, h)
    if h > w:  # portrait: faces sit near the top
        top = int(h * 0.04)
        box = (0, top, w, top + side)
    else:      # landscape: centre horizontally, keep the top
        left = (w - side) // 2
        box = (left, 0, left + side, side)
    return im.crop(box).resize((240, 240), Image.LANCZOS)


def main():
    people = load_people()
    sources = json.load(open(SOURCES, encoding='utf-8'))
    have = {s['local'] for s in sources}
    skip_path = os.path.join(ROOT, 'assets', 'photo-skip.json')
    skip = set(json.load(open(skip_path))['skip']) if os.path.exists(skip_path) else set()
    todo = {pid: p for pid, p in people.items()
            if slug(p['name']) not in skip and not os.path.exists(os.path.join(OUT_DIR, slug(p['name']) + '.jpg'))}
    print(f'{len(todo)} people without photos', flush=True)

    # 1) exact titles in batches of 50
    found = {}
    names = list({p['name'] for p in todo.values()})
    for i in range(0, len(names), 50):
        for req, info in lead_images(names[i:i + 50]).items():
            if info[1] and FOOTBALL.search(info[2] or '') and '/commons/' in info[3]:
                found[req] = info
        print(f'titles {min(i + 50, len(names))}/{len(names)} · matched {len(found)}', flush=True)

    # 2) search fallback for the rest
    for n, name in enumerate([] if '--skip-search' in sys.argv else [n for n in names if n not in found]):
        try:
            hits = api({'action': 'query', 'list': 'search', 'srsearch': f'{name} footballer', 'srlimit': 1})['query']['search']
            if hits:
                info = lead_images([hits[0]['title']]).get(hits[0]['title'])
                if info and info[1] and FOOTBALL.search(info[2] or '') and '/commons/' in info[3]:
                    found[name] = info
        except Exception as e:  # keep going on odd failures
            print('search failed', name, e, flush=True)
        if n % 25 == 0:
            print(f'search {n} · matched {len(found)}', flush=True)

    # 3) licence metadata in batches, then download and crop
    files = list({info[1] for info in found.values()})
    meta = {}
    for i in range(0, len(files), 50):
        meta.update(commons_meta(files[i:i + 50]))
    saved = 0
    for name, (title, file, desc, _) in found.items():
        m = meta.get(file.replace(' ', '_'))
        if not m or not m['thumb']:
            continue
        local = f'assets/photos/people/{slug(name)}.jpg'
        if local in have:
            continue
        try:
            headshot(get(m['thumb'], binary=True)).save(os.path.join(ROOT, local), quality=84, optimize=True)
        except Exception as e:
            print('download failed', name, e, flush=True)
            continue
        sources.append({'subject': name, 'local': local, 'source': m['page'], 'author': m['author'] or 'Unknown',
                        'license': m['license'] or 'See source', 'wikipedia': f'https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(" ", "_"))}'})
        have.add(local)
        saved += 1
        if saved % 20 == 0:
            json.dump(sorted(sources, key=lambda s: s['local']), open(SOURCES, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            print(f'saved {saved}', flush=True)
    json.dump(sorted(sources, key=lambda s: s['local']), open(SOURCES, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'done: {saved} new photos', flush=True)


if __name__ == '__main__':
    sys.exit(main())
