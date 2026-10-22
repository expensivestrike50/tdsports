"""Build match-data.js from the research agents' JSON files.

Usage: python3 tools/build-match-data.py

Reads research/agent-*.json (schema described in the research prompt) and writes
match-data.js, which the app loads after data.js. For each researched match it:
  - updates the fixture in MATCHES (score, kick-off, competition, round), or marks it
    as a sample fixture when the research could not verify it;
  - adds every player and coach to PEOPLE;
  - adds a LINEUPS entry: pitch positions from the formation, substitutes, events,
    goal locations and descriptions, stats, attendance, referee and sources.
Player ratings are not published by the sources, so they are generated sample values
(deterministic per player, nudged by goals, assists and cards).
"""
import glob
import hashlib
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSITIONS = {'GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'}


def slug(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def seeded(key):
    """Deterministic 0..1 value for a string."""
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def line_ys(k):
    return {1: [50], 2: [30, 70], 3: [23, 50, 78], 4: [12, 38, 64, 88], 5: [8, 29, 50, 71, 92]}.get(k) or [
        round(8 + i * 84 / (k - 1)) for i in range(k)]


def positions(formation, n_outfield):
    """[(x, y)] for GK + outfield players, home side attacking left to right."""
    try:
        lines = [int(p) for p in formation.split('-')]
    except (AttributeError, ValueError):
        lines = []
    if sum(lines) != n_outfield:
        lines = [4, 3, 3] if n_outfield == 10 else [n_outfield]
    xs = [18] if len(lines) == 1 else [round(18 + i * (46 - 18) / (len(lines) - 1)) for i in range(len(lines))]
    out = [(5, 50)]
    for x, k in zip(xs, lines):
        out += [(x, y) for y in line_ys(k)]
    return out


def main():
    research = []
    for path in sorted(glob.glob(os.path.join(ROOT, 'research', 'agent-*.json'))):
        with open(path, encoding='utf-8') as f:
            research += json.load(f).get('matches', [])

    people, lineups, updates = {}, {}, {}
    clubs = {}  # team -> {logo, country, venue} from the research, for clubs data.js doesn't know
    used_ids = set()

    for m in research:
        mid = m['id']
        if not m.get('found') or not m.get('lineups'):
            updates[mid] = {'sample': True, 'note': m.get('notes', '')}
            continue

        upd = {'score': m.get('score'), 'kickoff': m.get('kickoff_local'), 'date': m.get('date'),
               'competition': m.get('competition'), 'round': m.get('round'),
               # Used to add the fixture when it isn't in data.js (other leagues).
               'home': m.get('home'), 'away': m.get('away'), 'league': m.get('league')}
        updates[mid] = {k: v for k, v in upd.items() if v}
        for side in ('home', 'away'):
            team = m.get(side)
            if team and m.get(f'{side}_logo'):
                clubs.setdefault(team, {})['logo'] = m[f'{side}_logo']
            if team and m.get(f'{side}_country'):
                clubs.setdefault(team, {})['country'] = m[f'{side}_country']
        if m.get('home') and (m.get('venue') or {}).get('name'):
            clubs.setdefault(m['home'], {}).setdefault('venue', {'name': m['venue']['name'], 'city': m['venue'].get('city') or '',
                                                                 'capacity': m['venue'].get('capacity')})

        # Person ids: unique across the whole app; lookup by full and short name per side.
        lookup = {'home': {}, 'away': {}}

        def person(name, side, pos=None, short=None):
            if not name:
                return None
            key = name.strip().lower()
            if key in lookup[side]:
                return lookup[side][key]
            base = slug(name) or 'player'
            pid = base if base not in used_ids else f'{base}-{mid}'
            used_ids.add(pid)
            people[pid] = {'name': name.strip(), 'short': (short or name.split()[-1]).strip(),
                           'pos': pos if pos in POSITIONS or pos == 'Coach' else 'CM'}
            # Coaches stay out of the name lookup so a player who shares a surname isn't matched to them.
            if pos != 'Coach':
                lookup[side][key] = pid
                lookup[side][people[pid]['short'].lower()] = pid
            return pid

        def find(name, side=None):
            if not name:
                return None
            key = name.strip().lower()
            for s in ([side] if side else []) + ['home', 'away']:
                if key in lookup[s]:
                    return lookup[s][key]
                # Fall back to surname match.
                sur = key.split()[-1]
                if sur in lookup[s]:
                    return lookup[s][sur]
            return None

        xi = {}
        for side in ('home', 'away'):
            players = (m['lineups'].get(side) or [])[:11]
            form = (m.get('formations') or {}).get(side) or ''
            coords = positions(form, max(len(players) - 1, 0))
            row = []
            for i, p in enumerate(players):
                pid = person(p.get('name'), side, p.get('pos'), p.get('short'))
                x, y = coords[i] if i < len(coords) else (30, 50)
                if side == 'away':  # away attacks right to left; their left side is the bottom
                    x, y = 100 - x, 100 - y
                row.append([pid, x, y])
            xi[side] = row

        coaches = [person((m.get('coaches') or {}).get(s) or f'{s.title()} coach', s, 'Coach') for s in ('home', 'away')]

        # Substitutes: players coming on inherit the position of the player they replace.
        subs_events, bench = [], {'home': [], 'away': []}
        for s in sorted(m.get('subs') or [], key=lambda s: s.get('minute') or 0):
            side = s.get('side')
            if side not in ('home', 'away'):
                continue
            out_id = find(s.get('out'), side)
            pos = people[out_id]['pos'] if out_id else 'CM'
            in_id = find(s.get('in'), side) or person(s.get('in'), side, pos)
            if in_id and out_id:
                subs_events.append([s.get('minute') or 0, 'sub', side, in_id, out_id])
                if in_id not in bench[side]:
                    bench[side].append(in_id)
        unused = {'home': [], 'away': []}
        for side in ('home', 'away'):
            for name in (m.get('unused_subs') or {}).get(side) or []:
                pid = find(name, side) or person(name, side, 'CM')
                if pid and pid not in bench[side] and pid not in unused[side]:
                    unused[side].append(pid)

        # Goals in time order with the running score.
        goals, goal_shots, goal_info = [], {}, {}
        h = a = 0
        for g in sorted(m.get('goals') or [], key=lambda g: g.get('minute') or 0):
            side = g.get('side')
            if side not in ('home', 'away'):
                continue
            h, a = (h + 1, a) if side == 'home' else (h, a + 1)
            other = 'away' if side == 'home' else 'home'
            who = find(g.get('scorer'), other if g.get('own_goal') else side) or person(g.get('scorer'), other if g.get('own_goal') else side)
            ev = [g.get('minute') or 0, 'owngoal' if g.get('own_goal') else 'goal', side, who, f'{h} - {a}']
            if g.get('penalty'):
                ev.append('pen')
            goals.append(ev)
            minute = g.get('minute') or 0
            shot = g.get('shot') or {}
            if not g.get('own_goal') and shot.get('x') is not None and shot.get('y') is not None:
                goal_shots[minute] = [shot['x'], shot['y'], bool(shot.get('header') or g.get('foot') == 'header')]
            goal_info[minute] = {'assist': find(g.get('assist'), side), 'type': g.get('type') or 'build',
                                 'foot': g.get('foot'), 'description': g.get('description') or '',
                                 'penalty': bool(g.get('penalty')), 'ownGoal': bool(g.get('own_goal'))}

        cards = []
        for c in m.get('cards') or []:
            side = c.get('side')
            who = find(c.get('player'), side)
            if not who or side not in ('home', 'away'):
                continue
            kind = 'yellow' if c.get('card') == 'yellow' else 'red'
            cards.append([c.get('minute') or 0, kind, side, who, c.get('reason') or ('Foul' if kind == 'yellow' else 'Sent off')])
        var = [[v.get('minute') or 0, 'var', v.get('side'), find(v.get('player'), v.get('side')), v.get('detail') or 'VAR check']
               for v in m.get('var') or [] if v.get('side') in ('home', 'away')]
        events = sorted(goals + subs_events + cards + var, key=lambda e: e[0])

        # Anyone named in an event played: move them off the unused list (sources sometimes
        # miss a substitution on, e.g. a player recorded only as coming off).
        involved = {e[3] for e in events} | {e[4] for e in subs_events}
        for side in ('home', 'away'):
            for pid in list(unused[side]):
                if pid in involved:
                    unused[side].remove(pid)
                    bench[side].append(pid)

        # Sample ratings: deterministic per player, adjusted for goals, assists and cards.
        def rating(pid, side):
            r = 6.1 + seeded(pid + mid) * 1.4
            r += 0.9 * sum(1 for e in goals if e[3] == pid and e[1] == 'goal')
            r += 0.5 * sum(1 for g in goal_info.values() if g['assist'] == pid)
            r -= 0.8 * sum(1 for e in goals if e[3] == pid and e[1] == 'owngoal')
            r -= 1.0 * sum(1 for e in cards if e[3] == pid and e[1] == 'red')
            won = (m['score'][0] > m['score'][1]) if side == 'home' else (m['score'][1] > m['score'][0])
            r += 0.2 if won else 0
            return round(max(4.5, min(9.6, r)), 1)

        stats_in = m.get('stats') or {}
        stats = {}
        for k in ('shots', 'onTarget', 'corners', 'fouls', 'xg'):
            v = stats_in.get(k)
            if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
                stats[k] = v
        pos_ = stats_in.get('possession')
        if isinstance(pos_, list) and len(pos_) == 2 and isinstance(pos_[0], (int, float)):
            stats['possession'] = round(pos_[0])

        venue = m.get('venue') or {}
        ref = m.get('referee') or {}
        lineups[mid] = {
            'formations': [(m.get('formations') or {}).get('home') or '', (m.get('formations') or {}).get('away') or ''],
            'coaches': coaches,
            'home': [[p, x, y, rating(p, 'home')] for p, x, y in xi['home']],
            'away': [[p, x, y, rating(p, 'away')] for p, x, y in xi['away']],
            'homeSubs': [[p, rating(p, 'home')] for p in bench['home']] + [[p] for p in unused['home']],
            'awaySubs': [[p, rating(p, 'away')] for p in bench['away']] + [[p] for p in unused['away']],
            'events': events,
            'goalShots': goal_shots,
            'goalInfo': goal_info,
            'stats': stats,
            'attendance': venue.get('attendance'),
            'venue': {k: v for k, v in {'name': venue.get('name'), 'city': venue.get('city'),
                                         'capacity': venue.get('capacity')}.items() if v},
            'referee': [ref['name'], ref.get('country') or ''] if ref.get('name') else None,
            'sources': m.get('sources') or [],
            'notes': m.get('notes') or '',
            'researched': True,
        }

    # Attach Wikimedia headshots fetched by tools/fetch-player-photos.py, with their credits.
    credits = []
    sources_path = os.path.join(ROOT, 'assets', 'photo-sources.json')
    by_local = {s['local']: s for s in json.load(open(sources_path, encoding='utf-8'))} if os.path.exists(sources_path) else {}
    for pid, p in people.items():
        local = f"assets/photos/people/{slug(p['name'])}.jpg"
        if os.path.exists(os.path.join(ROOT, local)) and local in by_local:
            p['photo'] = slug(p['name'])
            s = by_local[local]
            credits.append([local, s['subject'], s['author'], s['license'], s['source']])
    # Everyone else: FotMob headshots found by tools/fetch-fotmob-photos.py (linked, not copied).
    fotmob_path = os.path.join(ROOT, 'assets', 'fotmob-photos.json')
    fotmob = json.load(open(fotmob_path, encoding='utf-8')) if os.path.exists(fotmob_path) else {}
    for p in people.values():
        fid = fotmob.get(slug(p['name']))
        if fid and not p.get('photo'):
            p['photo'] = f'https://images.fotmob.com/image_resources/playerimages/{fid}.png'
    # Stadium photos fetched by tools/fetch-venue-photos.py, keyed by the venue named in each match.
    for L in lineups.values():
        name = (L.get('venue') or {}).get('name')
        local = f"assets/photos/venues/{slug(name)}.jpg" if name else None
        if local and os.path.exists(os.path.join(ROOT, local)) and local in by_local:
            L['venue']['photo'] = local
            s = by_local[local]
            credits.append([local, s['subject'], s['author'], s['license'], s['source']])
    credits = [list(c) for c in {tuple(c) for c in credits}]

    out = [
        '// Generated by tools/build-match-data.py from research/agent-*.json. Do not edit by hand.',
        '// Real match facts (lineups, events, scores, stats where found) gathered by the research',
        '// agents, with sources per match. Player ratings are sample values.',
        f'const RESEARCHED_MATCHES = {json.dumps(sorted(lineups))};',
        f'Object.assign(PEOPLE, {json.dumps(people, ensure_ascii=False)});',
        f'Object.assign(LINEUPS, {json.dumps(lineups, ensure_ascii=False)});',
        f'const MATCH_UPDATES = {json.dumps(updates, ensure_ascii=False)};',
        f'const RESEARCH_CLUBS = {json.dumps(clubs, ensure_ascii=False)};',
        '// Crests, countries and home grounds for clubs data.js does not know yet.',
        'for (const [team, c] of Object.entries(RESEARCH_CLUBS)) {',
        '  if (c.logo && !CLUB_LOGOS[team]) CLUB_LOGOS[team] = c.logo;',
        '  if (c.country && !CLUB_COUNTRY[team]) CLUB_COUNTRY[team] = c.country;',
        '  if (c.venue && !VENUES[team]) VENUES[team] = c.venue;',
        '}',
        '// Researched fixtures from other leagues and rounds are added as new matches.',
        'for (const [id, u] of Object.entries(MATCH_UPDATES)) {',
        '  if (u.sample || !u.home || MATCHES.some(m => m.id === id)) continue;',
        '  MATCHES.push({ id, home: u.home, away: u.away, score: u.score, kickoff: u.kickoff, date: u.date, competition: u.competition, round: u.round, league: u.league });',
        '}',
        f'PHOTO_CREDITS.push(...{json.dumps(sorted(credits), ensure_ascii=False)}.filter(c => !PHOTO_CREDITS.some(x => x[0] === c[0])));',
        'for (const m of MATCHES) {',
        '  const u = MATCH_UPDATES[m.id];',
        '  if (!u) continue;',
        '  // Existing fixtures keep their own team names (they match the crests in data.js).',
        '  if (u.sample) m.sample = true; else { const { home, away, league, ...rest } = u; Object.assign(m, rest); }',
        '}',
        '',
    ]
    with open(os.path.join(ROOT, 'match-data.js'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    print(f'{len(lineups)} researched matches, {len(people)} people, {sum(1 for u in updates.values() if u.get("sample"))} unverified')


if __name__ == '__main__':
    main()
