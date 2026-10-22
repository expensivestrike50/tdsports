"""Aggregate football news from the top sources into news.json.

Usage: python3 tools/fetch-news.py

Reads the public RSS feeds of BBC Sport, The Guardian, Sky Sports, The Athletic, ESPN,
FourFourTwo, talkSPORT, the Mirror, CBS Sports, Football Italia and football.london
(plus ESPN's per-league news API), and writes news.json:

    { updated, sources: [{ name, url }], articles: [article, ...] }   (newest first)
    article = { id, title, summary, url, source, image, published, clubs: [...], leagues: [...] }

Only headlines, the feed's own short summary (trimmed), a thumbnail and the link are kept:
the app links out to the publisher for the full story. Clubs and leagues are tagged from
the headline and summary so the news page can filter by them. Agent Tom runs this every
10 minutes; a GitHub Action refreshes the hosted copy (see .github/workflows/news.yml).
"""
import concurrent.futures
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'news.json')
UA = {'User-Agent': 'Mozilla/5.0 (compatible; TDsportsNews/1.0; +https://github.com/expensivestrike50/tdsports)'}
KEEP_DAYS = 4
MAX_ARTICLES = 600
PER_SOURCE = 60  # so the busiest feeds don't crowd out the rest

FEEDS = [
    ('BBC Sport', 'https://www.bbc.co.uk/sport/football', 'https://feeds.bbci.co.uk/sport/football/rss.xml'),
    ('The Guardian', 'https://www.theguardian.com/football', 'https://www.theguardian.com/football/rss'),
    ('Sky Sports', 'https://www.skysports.com/football', 'https://www.skysports.com/rss/11095'),
    ('The Athletic', 'https://www.nytimes.com/athletic/football/', 'https://www.nytimes.com/athletic/rss/football/'),
    ('FourFourTwo', 'https://www.fourfourtwo.com', 'https://www.fourfourtwo.com/feeds.xml'),
    ('talkSPORT', 'https://talksport.com/football/', 'https://talksport.com/football/feed/'),
    ('Mirror', 'https://www.mirror.co.uk/sport/football/', 'https://www.mirror.co.uk/sport/football/?service=rss'),
    ('CBS Sports', 'https://www.cbssports.com/soccer/', 'https://www.cbssports.com/rss/headlines/soccer/'),
    ('Football Italia', 'https://football-italia.net', 'https://football-italia.net/feed/'),
    ('football.london', 'https://www.football.london', 'https://www.football.london/?service=rss'),
]
ESPN_LEAGUES = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'usa.1', 'mex.1']

LEAGUE_WORDS = {
    'Premier League': r'Premier League|\bEPL\b',
    'LaLiga': r'La ?Liga',
    'Bundesliga': r'Bundesliga',
    'Serie A': r'Serie A\b',
    'Ligue 1': r'Ligue 1',
    'Champions League': r'Champions League|\bUCL\b',
    'Europa League': r'Europa League',
    'MLS': r'\bMLS\b|Major League Soccer',
    'Liga MX': r'Liga MX',
    'FIFA World Cup': r'World Cup',
}
# General sports feeds slip in other sports now and then.
OTHER_SPORTS = re.compile(r'\b(cricket|ODI|Test match|darts|rugby|Red Roses|Six Nations|tennis|Wimbledon|golf|Ryder Cup|F1|Formula 1|Grand Prix|'
                          r'snooker|boxing|UFC|NFL|NBA|MLB|NHL|cycling|Tour de France|netball|athletics)\b', re.I)
COMPETITION_LEAGUE = {'Premier League': 'Premier League', 'LaLiga': 'LaLiga', 'Bundesliga': 'Bundesliga', 'Serie A': 'Serie A',
                      'Ligue 1': 'Ligue 1', 'MLS': 'MLS', 'Liga MX': 'Liga MX'}
# How clubs are written in headlines, for the app's club names (ambiguous names like Nice,
# Lens, Inter or national teams are only matched through these longer forms).
CLUB_ALIASES = {
    'Man United': r'Manchester United|Man United|Man Utd', 'Man City': r'Manchester City|Man City',
    'Spurs': r'Tottenham|Spurs', 'Nottm Forest': r'Nottingham Forest|Forest\b', 'C Palace': r'Crystal Palace',
    'Newcastle': r'Newcastle', 'Brighton': r'Brighton', 'Leeds': r'Leeds', 'Ipswich': r'Ipswich', 'Hull': r'Hull City',
    'Inter': r'Inter Milan|Internazionale', 'Milan': r'AC Milan|\bMilan\b(?! Inter)', 'AS Roma': r'\bRoma\b',
    'PSG': r'Paris Saint-Germain|\bPSG\b', 'Bayern München': r'Bayern', 'Borussia Dortmund': r'Dortmund',
    'Atlético Madrid': r'Atl[eé]tico Madrid|Atletico', 'Athletic': r'Athletic Bilbao|Athletic Club', 'Racing': r'Racing Santander',
    'Nice': r'OGC Nice', 'Lens': r'RC Lens', 'Gladbach': r'Gladbach|M[öo]nchengladbach', 'Leverkusen': r'Leverkusen',
    'Inter Miami': r'Inter Miami', 'LA Galaxy': r'LA Galaxy|Galaxy', 'Club América': r'Club Am[eé]rica',
    'Santos': r'Santos Laguna', 'Atlas': r'Atlas FC', 'Monaco': r'AS Monaco|\bMonaco\b', 'Sporting CP': r'Sporting CP|Sporting Lisbon',
    'FC Porto': r'\bPorto\b', 'Celtic': r'\bCeltic\b', 'Rayo': r'Rayo Vallecano', 'Real Betis': r'\bBetis\b',
    'Tigres UANL': r'Tigres', 'UNAM': r'Pumas', 'Union SG': r'Union Saint-Gilloise|Union SG',
}
SKIP_CLUBS = {'Argentina', 'Belgium', 'England', 'France', 'Morocco', 'Norway', 'Spain', 'Switzerland', 'Austin', 'Dallas', 'Houston',
              'Portland', 'Atlanta', 'Kansas City', 'San Jose', 'Vancouver', 'Salt Lake', 'San Diego', 'Viking', 'Paris FC',
              'Deportivo', 'Racing', 'Le Mans', 'Cincinnati', 'Nashville', 'Columbus Crew', 'Toluca', 'Puebla', 'Necaxa', 'Atlante', 'Queretaro'}


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            return r.read()
    except Exception as e:
        print('failed', url, e, file=sys.stderr)
        return None


def clean(text, limit=240):
    # Some feeds escape their HTML twice, so unescape and strip tags in two passes.
    for _ in range(2):
        text = re.sub(r'<[^>]+>', ' ', html.unescape(text or ''))
    text = re.sub(r'\s+', ' ', text).strip()
    if text.lower() in ('null', 'none', 'undefined') or re.fullmatch(r'\{[^}]*\}', text):  # template placeholders
        return ''
    if len(text) > limit:
        text = text[:limit].rsplit(' ', 1)[0].rstrip(',.;:') + '…'
    return text


def local(tag):
    return tag.rsplit('}', 1)[-1]


def best_image(item):
    """Largest media:content / media:thumbnail / enclosure image, else the first <img> in the HTML."""
    found = []
    for el in item.iter():
        name = local(el.tag)
        url = el.get('url') or el.get('href')
        if name in ('content', 'thumbnail') and url and (el.get('medium') in (None, 'image') or 'image' in (el.get('type') or '')):
            found.append((int(el.get('width') or 0), url))
        elif name == 'enclosure' and url and 'image' in (el.get('type') or 'image'):
            found.append((int(el.get('length') or 0) and 1, url))
    if found:
        url = max(found)[1]
    else:
        body = ' '.join((el.text or '') for el in item if local(el.tag) in ('description', 'encoded', 'content', 'summary'))
        m = re.search(r'<img[^>]+src="([^"]+)"', body)
        url = m.group(1) if m else ''
    url = html.unescape(url)
    # BBC thumbnails are 240px; their image service serves any width.
    url = re.sub(r'(ichef\.bbci\.co\.uk/[^/]+/[^/]+/)240/', r'\g<1>800/', url)
    return url if url.startswith('http') else ''


# Time zone names some feeds use that email.utils doesn't know (it would read them as UTC).
TZ_NAMES = {'BST': '+0100', 'CEST': '+0200', 'CET': '+0100', 'EDT': '-0400', 'EST': '-0500', 'PDT': '-0700', 'PST': '-0800'}


def parse_date(text):
    if not text:
        return None
    text = re.sub(r'\b(' + '|'.join(TZ_NAMES) + r')$', lambda m: TZ_NAMES[m.group(1)], text.strip())
    try:
        return email.utils.parsedate_to_datetime(text).astimezone(timezone.utc)
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00')).astimezone(timezone.utc)
    except ValueError:
        return None


def parse_feed(name, data):
    out = []
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        print('bad feed', name, e, file=sys.stderr)
        return out
    for item in [el for el in root.iter() if local(el.tag) in ('item', 'entry')]:
        field = {local(el.tag): el for el in item}
        title = clean(field['title'].text if 'title' in field else '', 200)
        link = field.get('link')
        url = (link.text or link.get('href') or '').strip() if link is not None else ''
        date = next((field[k] for k in ('pubDate', 'published', 'updated', 'date') if k in field), None)
        published = parse_date(date.text if date is not None else None)
        summary_el = field.get('description') if field.get('description') is not None else field.get('summary')
        summary = clean(summary_el.text if summary_el is not None else '')
        if not title or not url or not published:
            continue
        out.append({'title': title, 'summary': summary if summary.lower() != title.lower() else '', 'url': url,
                    'source': name, 'image': best_image(item), 'published': published})
    return out


def espn_news(code):
    data = get(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/news?limit=50')
    out = []
    for a in (json.loads(data).get('articles', []) if data else []):
        url = ((a.get('links') or {}).get('web') or {}).get('href')
        published = parse_date(a.get('published'))
        if a.get('type') not in ('Story', 'HeadlineNews', 'Recap', 'Preview') or not url or not published:
            continue
        out.append({'title': clean(a.get('headline'), 200), 'summary': clean(a.get('description')), 'url': url, 'source': 'ESPN',
                    'image': ((a.get('images') or [{}])[0]).get('url', ''), 'published': published})
    return out


def club_index():
    clubs = [c['name'] for c in json.load(open(os.path.join(ROOT, 'api', 'v1', 'clubs.json'), encoding='utf-8'))['data']]
    matches = json.load(open(os.path.join(ROOT, 'api', 'v1', 'matches.json'), encoding='utf-8'))['data']
    league = {}
    for m in matches:
        lg = COMPETITION_LEAGUE.get(m['competition'])
        if lg:
            for side in ('home', 'away'):
                league.setdefault(m[side]['name'], lg)
    patterns = []
    for c in clubs:
        if c in SKIP_CLUBS and c not in CLUB_ALIASES:
            continue
        rx = CLUB_ALIASES.get(c) or r'\b' + re.escape(c) + r'\b'
        patterns.append((c, re.compile(rx), league.get(c)))
    return patterns


def tag(article, clubs):
    text = f"{article['title']} {article['summary']}"
    found = [(c, lg) for c, rx, lg in clubs if rx.search(text)]
    leagues = [lg for lg, rx in LEAGUE_WORDS.items() if re.search(rx, text)]
    for _, lg in found:
        if lg and lg not in leagues:
            leagues.append(lg)
    article['clubs'] = [c for c, _ in found][:6]
    article['leagues'] = leagues[:4]


def main():
    with concurrent.futures.ThreadPoolExecutor(10) as pool:
        feeds = list(pool.map(lambda f: (f, get(f[2])), FEEDS))
        espn = list(pool.map(espn_news, ESPN_LEAGUES))
    articles = []
    for (name, _, _), data in feeds:
        got = parse_feed(name, data) if data else []
        print(f'{name}: {len(got)}', flush=True)
        articles += got
    for items in espn:
        articles += items
    print(f'ESPN: {sum(len(x) for x in espn)}', flush=True)

    # Drop old stories and duplicates (same link, or the same headline from another feed).
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    seen, unique, per_source = set(), [], {}
    for a in sorted(articles, key=lambda a: a['published'], reverse=True):
        if OTHER_SPORTS.search(a['title']):
            continue
        key_url = a['url'].split('?')[0].rstrip('/')
        key_title = re.sub(r'[^a-z0-9]', '', a['title'].lower())[:80]
        if a['published'] < cutoff or key_url in seen or key_title in seen or per_source.get(a['source'], 0) >= PER_SOURCE:
            continue
        per_source[a['source']] = per_source.get(a['source'], 0) + 1
        seen.update({key_url, key_title})
        unique.append(a)
    unique = unique[:MAX_ARTICLES]

    # Feeds sometimes leave out the picture: use the article's own preview image (og:image).
    def og_image(a):
        page = get(a['url'])
        m = page and re.search(rb'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)', page) \
            or page and re.search(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)', page)
        a['image'] = html.unescape(m.group(1).decode('utf-8', 'ignore')) if m else ''
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        list(pool.map(og_image, [a for a in unique if not a['image']]))

    clubs = club_index()
    for a in unique:
        tag(a, clubs)
        a['id'] = hashlib.sha1(a['url'].encode()).hexdigest()[:12]
        a['published'] = a['published'].strftime('%Y-%m-%dT%H:%M:%SZ')

    out = {'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'sources': [{'name': n, 'url': u} for n, u, _ in FEEDS] + [{'name': 'ESPN', 'url': 'https://www.espn.com/soccer/'}],
           'articles': [{k: a[k] for k in ('id', 'title', 'summary', 'url', 'source', 'image', 'published', 'clubs', 'leagues')} for a in unique]}
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    print(f'{len(unique)} articles from {len({a["source"] for a in unique})} sources', flush=True)


if __name__ == '__main__':
    main()
