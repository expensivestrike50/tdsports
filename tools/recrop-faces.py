"""Re-crop player photos around the face.

Usage: python3 tools/recrop-faces.py <faces-binary> <photo.jpg> [<photo.jpg> ...]

<faces-binary> is tools/faces.swift compiled with `swiftc -O tools/faces.swift -o faces`.
For each photo it re-downloads the original from Wikimedia Commons at 1000 px (using the
source page recorded in assets/photo-sources.json), finds the largest face with Apple's
Vision framework and saves a 240 px square headshot centred on it. Photos whose original
has no detectable face are left unchanged.
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'TDsportsPrototype/1.0 (football app prototype; player headshots)'}


def get(url, binary=False):
    for attempt in range(6):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
            time.sleep(0.8)
            return data if binary else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(10 * (attempt + 1))
    raise RuntimeError('rate limited')


def main():
    faces_bin, files = sys.argv[1], sys.argv[2:]
    sources = {s['local']: s for s in json.load(open(os.path.join(ROOT, 'assets', 'photo-sources.json'), encoding='utf-8'))}
    # Commons file titles for the requested photos.
    titles = {}
    for f in files:
        local = os.path.relpath(os.path.abspath(f), ROOT)
        src = sources.get(local)
        if src and '/wiki/File:' in src['source']:
            titles[local] = urllib.parse.unquote(src['source'].split('/wiki/')[1])
    urls = {}
    items = list(titles.items())
    for i in range(0, len(items), 50):
        batch = items[i:i + 50]
        r = get('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'titles': '|'.join(t for _, t in batch), 'prop': 'imageinfo',
            'iiprop': 'url', 'iiurlwidth': 1000, 'format': 'json', 'formatversion': 2}))
        by_title = {p['title'].replace(' ', '_'): p['imageinfo'][0]['thumburl'] for p in r['query']['pages'] if 'imageinfo' in p}
        for local, t in batch:
            u = by_title.get(t.replace(' ', '_'))
            if u:
                urls[local] = u
    fixed = 0
    with tempfile.TemporaryDirectory() as tmp:
        for local, url in urls.items():
            try:
                im = Image.open(io.BytesIO(get(url, binary=True))).convert('RGB')
            except Exception as e:
                print('download failed', local, e, flush=True)
                continue
            path = os.path.join(tmp, 'orig.jpg')
            im.save(path, quality=92)
            out = subprocess.run([faces_bin, path], capture_output=True, text=True).stdout.strip()
            face = json.loads(out)['face'] if out else None
            if not face:
                print('no face', local, flush=True)
                continue
            W, H = im.size
            fx, fy, fw, fh = face[0] * W, face[1] * H, face[2] * W, face[3] * H
            side = min(max(fh * 3.0, fw * 3.0), W, H)
            cx, cy = fx + fw / 2, fy + fh / 2 + fh * 0.35  # leave room for shoulders
            left = max(0, min(W - side, cx - side / 2))
            top = max(0, min(H - side, cy - side / 2))
            im.crop((int(left), int(top), int(left + side), int(top + side))).resize((240, 240), Image.LANCZOS).save(
                os.path.join(ROOT, local), quality=86, optimize=True)
            fixed += 1
            print('recropped', local, flush=True)
    print(f'done: {fixed}/{len(files)} recropped', flush=True)


if __name__ == '__main__':
    main()
