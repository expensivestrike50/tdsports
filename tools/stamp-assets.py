"""Add a content hash to every script and stylesheet link in index.html.

Usage: python3 tools/stamp-assets.py

Turns <script src="data.js"> into <script src="data.js?v=1a2b3c4d">. When a file changes,
its hash changes, so browsers fetch the new copy instead of reusing an old cached one.
Run it after editing any .js or .css file; files that haven't changed keep their hash.
"""
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')


def stamp(match):
    attr, path = match.group(1), match.group(2)
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return match.group(0)
    digest = hashlib.sha1(open(full, 'rb').read()).hexdigest()[:8]
    return f'{attr}="{path}?v={digest}"'


html = open(INDEX, encoding='utf-8').read()
new = re.sub(r'\b(src|href)="([\w./-]+\.(?:js|css))(?:\?v=\w+)?"', stamp, html)
if new != html:
    open(INDEX, 'w', encoding='utf-8').write(new)
print('\n'.join(re.findall(r'(?:src|href)="[\w./-]+\.(?:js|css)\?v=\w+"', new)))
