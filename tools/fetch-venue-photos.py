"""Fetch Wikimedia Commons photos for the stadiums in the research data.

Usage: python3 tools/fetch-venue-photos.py

For every venue named in research/agent-*.json without a photo it looks up the English
Wikipedia article (exact title first; then a search for "<name> stadium"), keeps only
articles whose short description sounds like a venue, takes the article's lead image when
it is hosted on Wikimedia Commons, crops it to 4:3 (720x540) and records the author and
licence in assets/photo-sources.json. Safe to re-run: venues that already have a photo are
skipped. Rebuild afterwards with tools/build-match-data.py.
"""
import glob
import importlib.util
import io
import json
import os
import re
import sys
import urllib.parse

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'photos', 'venues')
SOURCES = os.path.join(ROOT, 'assets', 'photo-sources.json')
# Venues whose Wikipedia lead image isn't the stadium (a portrait, a logo).
SKIP = {'Santiago Bernabéu', 'Citi Field'}
VENUE = re.compile(r'stadium|stadio|estadio|est[aá]dio|stade|arena|ground|park|field|venue|football|soccer|sports', re.I)

# Reuse the Wikipedia/Commons helpers from the player photo fetcher.
_spec = importlib.util.spec_from_file_location('players', os.path.join(ROOT, 'tools', 'fetch-player-photos.py'))
players = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(players)
api, get, slug, lead_images, commons_meta = players.api, players.get, players.slug, players.lead_images, players.commons_meta


def landscape(data):
    im = Image.open(io.BytesIO(data)).convert('RGB')
    w, h = im.size
    if w / h > 4 / 3:
        nw = int(h * 4 / 3)
        box = ((w - nw) // 2, 0, (w - nw) // 2 + nw, h)
    else:
        nh = int(w * 3 / 4)
        box = (0, (h - nh) // 2, w, (h - nh) // 2 + nh)
    return im.crop(box).resize((720, 540), Image.LANCZOS)


def main():
    names = set()
    for path in glob.glob(os.path.join(ROOT, 'research', 'agent-*.json')):
        for m in json.load(open(path, encoding='utf-8')).get('matches', []):
            name = (m.get('venue') or {}).get('name')
            if name:
                names.add(name.strip())
    sources = json.load(open(SOURCES, encoding='utf-8'))
    have = {s['local'] for s in sources}
    todo = sorted(n for n in names if n not in SKIP and not os.path.exists(os.path.join(OUT_DIR, slug(n) + '.jpg')))
    print(f'{len(todo)} venues without photos', flush=True)

    ok = lambda info: info and info[1] and VENUE.search(info[2] or '') and '/commons/' in info[3]
    found = {}
    for i in range(0, len(todo), 50):
        for req, info in lead_images(todo[i:i + 50]).items():
            if ok(info):
                found[req] = info
    for name in [n for n in todo if n not in found]:
        try:
            hits = api({'action': 'query', 'list': 'search', 'srsearch': f'{name} stadium', 'srlimit': 1})['query']['search']
            if hits:
                info = lead_images([hits[0]['title']]).get(hits[0]['title'])
                if ok(info):
                    found[name] = info
        except Exception as e:
            print('search failed', name, e, flush=True)
    print(f'matched {len(found)}', flush=True)

    files = list({info[1] for info in found.values()})
    meta = {}
    for i in range(0, len(files), 50):
        meta.update(commons_meta(files[i:i + 50]))
    saved = 0
    for name, (title, file, _, _) in found.items():
        m = meta.get(file.replace(' ', '_'))
        local = f'assets/photos/venues/{slug(name)}.jpg'
        if not m or not m['thumb'] or local in have:
            continue
        try:
            # commons_meta asks for 420px thumbnails; venues need a wider one.
            thumb = re.sub(r'/(\d+)px-', '/960px-', m['thumb'])
            try:
                data = get(thumb, binary=True)
            except Exception:
                data = get(m['thumb'], binary=True)
            landscape(data).save(os.path.join(ROOT, local), quality=82, optimize=True)
        except Exception as e:
            print('download failed', name, e, flush=True)
            continue
        sources.append({'subject': name, 'local': local, 'source': m['page'], 'author': m['author'] or 'Unknown',
                        'license': m['license'] or 'See source', 'wikipedia': f'https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(" ", "_"))}'})
        have.add(local)
        saved += 1
    json.dump(sorted(sources, key=lambda s: s['local']), open(SOURCES, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'done: {saved} new venue photos', flush=True)


if __name__ == '__main__':
    sys.exit(main())
