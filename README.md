# TDsports

A matchday scores app prototype: results, match facts, momentum, events, lineups, standings and player ratings.

Live site: **https://expensivestrike50.github.io/tdsports/** (GitHub Pages, from the `main` branch).

## Hosting on GitHub Pages

The app is fully static, so GitHub Pages serves it as is. To publish changes:

    python3 tools/stamp-assets.py   # refresh the ?v= hashes so browsers load the new files
    git add -A && git commit -m "Update" && git push

On the hosted site there is no Agent Tom: `live.json` and `results.json` are the last committed snapshots, so the app fetches live scores and the last week of results straight from ESPN. The JSON API works as static files (`api/v1/*.json`). Three FotMob headshots are kept out of the repository (see `.gitignore`) because they are copyrighted; those players show initials online.

## Research data

`research/agent-*.json` holds real match facts, one file per research agent, in the same schema: lineups, formations, coaches, goals with descriptions, cards, subs, VAR, stats, venue, referee and sources. Besides the Champions League matchday, it covers the latest round of the Premier League, LaLiga, Bundesliga, Serie A, Ligue 1, MLS, Liga MX and the Europa League, plus the 2026 World Cup from the quarter-finals on. Rebuild after any change:

    python3 tools/build-match-data.py && node tools/build-api.js

## Run on your PC

Double click `index.html` to open it in your browser. No installation, API key, npm packages or build step is needed. Keep the `assets` folder beside `index.html`.

Optional local server, if Python 3 is installed (run it inside this folder, then open http://localhost:8000):

- Windows: `py -m http.server 8000 --bind 127.0.0.1`
- macOS / Linux: `python3 -m http.server 8000 --bind 127.0.0.1`

## Always-on services (macOS)

The app, the agent workstation and Agent Tom (live scores every 30 seconds, health checks and data audits) can run permanently as login services:

    tools/services.sh install     # start now and at every login; restarts automatically if stopped
    tools/services.sh status      # running / not running for each service
    tools/services.sh restart
    tools/services.sh logs        # logs live in ~/Library/Logs/popouts
    tools/services.sh uninstall   # stop and remove

- App: http://localhost:8000
- Agent workstation: http://localhost:8781
- Agent Tom writes `live.json` for the app's "Live now" card, and `results.json` (finished matches from the last 21 days in every league) for the "Earlier results" list under today's matches. Finished days are fetched once and cached; today and yesterday are refreshed every 10 minutes.
- If `live.json` is missing or more than two minutes old, the app fetches ESPN's scoreboard directly. Without `results.json`, it fetches the last week of results from ESPN the same way.

## API

TDsports has a read-only JSON API at http://localhost:8000/api/v1, served by the app service. The **API** link in the header opens the full documentation, with code samples and a **Try** button on each endpoint.

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1` | Every endpoint, plus record counts |
| `GET /api/v1/matches` | All matches: date, kickoff, competition, teams, score |
| `GET /api/v1/matches/{id}` | One match: lineups, events, stats, venue, referee, sources |
| `GET /api/v1/live` | Live scores across 10 leagues (refreshed every 30 s by Agent Tom) |
| `GET /api/v1/competitions` | Competitions with logos |
| `GET /api/v1/clubs` | Clubs with crests and countries |
| `GET /api/v1/people` | Every player and coach |
| `GET /api/v1/people/{id}` | One person and the matches they appear in |

    curl http://localhost:8000/api/v1/matches
    curl http://localhost:8000/api/v1/matches/lille-galatasaray

Every response is `{ "generated": ..., "data": ... }`; errors are `{ "error": { "status", "message", "path" } }`. CORS is open, and URLs work with or without `.json`. Ratings are sample values; each match's `provenance` field says which parts are real.

The API files are static JSON in `api/v1/`, built from the app's data. Rebuild them after changing the data:

    python3 tools/build-match-data.py   # if the research changed
    node tools/build-api.js

`tools/serve.py` is the web server behind `com.popouts.app`. It adds the extensionless URLs, CORS headers, JSON errors and the `/live` alias to the static file server. Run it by hand with `python3 tools/serve.py 8000`.

## Browser caching

`index.html` loads every script and stylesheet with a content hash (`data.js?v=0122dca7`), so a normal refresh always picks up edited files. Agent Tom re-stamps the hashes every 30 seconds; without him, run `python3 tools/stamp-assets.py` after editing a `.js` or `.css` file.

## Project layout

| File | What it holds |
| --- | --- |
| `index.html` | Page shell: header, search, nav, footer |
| `styles.css` | Theme tokens (light and dark), layout, components, responsive rules |
| `data.js` | All sample data: leagues, matches, venues, people, the detailed lineup, news, photo credits |
| `analytics.js` | Generates the detailed analytics: shot-by-shot data, per-player stats and team metrics |
| `replays.js` | Animated goal replays: keyframe scripts for each goal (from match reports) and the animation engine |
| `style.js` | Style of play: style classifier, next-match style and lineup prediction, coach and key-player views |
| `match-data.js` | Generated real match data for the other 12 fixtures (built by `tools/build-match-data.py` from `research/agent-*.json`) |
| `app.js` | Rendering, routing, search, modals and interactions |
| `api-docs.js` | The API documentation page (`#/api`) with the live "Try it" console |
| `api/v1/` | Generated API files (built by `tools/build-api.js`) |
| `assets/brand/` | TDsports logo (light and dark versions) and the favicon |
| `assets/clubs/` | 40 club crests (sources: `assets/club-logo-sources.json`) |
| `assets/leagues/` | 10 competition logos (sources: `assets/league-logo-sources.json`) |
| `assets/photos/` | Player, coach, stadium and news photos (sources and licenses: `assets/photo-sources.json`) |

## Features

- **Routing:** each match and tab has its own URL (`#/match/lille-galatasaray/lineup`), so the browser's Back button and bookmarks work.
- **Full-width match dashboard:** sections sit in a 3-column grid (2 columns on laptops, 1 on phones). Tabs: Facts, Stats, Players, Lineup, Events, Table.
- **Team analytics:** a key-stats strip under the score, plus sections for momentum, xG race, a shot map (each shot sized by xG), attacking, passing and build-up, defending, physical, discipline and set pieces, and style of play (field tilt, PPDA, directness, defensive line height).
- **Player data (scouting view):** a sortable table with Summary, Attacking, Passing, Defending, Physical and Goalkeeping views. Filter by team or position, switch to per-90 values, and export to CSV. There are also Top performers, Goalkeeping (goals prevented) and Bench impact sections. Each player profile has percentile ranks and grouped stats.
- **Goal replays:** under Top performers, each goal is animated on a pitch with both teams moving, the ball (including crosses in the air), captions and a GOAL frame. It plays all goals in a loop and has pause, scrub, speed and per-goal tabs. The build-up follows ESPN, beIN SPORTS and VAVEL reports; player positions are approximations, not tracking data.
- **Style of play tabs:** This match, Style review (style classifier, style DNA, attacking lanes, last six matches, insights), Next match (predicted style and predicted XI with start probabilities), Coach (verified notes only, plus a tactical fingerprint and substitution timeline) and Key players (role tags).
- **Real match data:** Lille 2-4 Galatasaray (21 Oct 2026) uses the real goals, substitutions and cards from ESPN's commentary. Ratings and the detailed stats are still sample values.
- **Consistent numbers:** player totals add up to team totals (shots, xG, accurate passes, fouls, tackles), and the shots add up to each team's goals and xG.
- **Match pages:** every match gets its own stats, momentum, events, venue, referee, weather, team form and a full league table. Lille v Galatasaray also has named scorers, a lineup on the pitch, substitutes and coaches.
- **Player cards:** each card shows a photo, rating, minutes played, goals worked out from the match events, a heatmap and stats. Use the arrows to move through the lineup.
- **Search:** find players, coaches and clubs. Accents are ignored, so "ozer" finds Özer. Press `/` to focus the box and use the arrow keys to move through results.
- **Filters:** Live, On TV, Favorites, sort by time or team, and filter by team name. Favorites, theme and poll votes are saved in this browser.
- **Dark theme:** follows your system setting and can be toggled from the header.
- **Accessibility:** works with the keyboard throughout, dialogs keep focus inside them, and there's a skip link and ARIA labels.

## Adding data

Add matches to `MATCHES` in `data.js`. Matches without a `LINEUPS` entry get generated stats and events that stay the same on every load. To give a match a full lineup, add an entry to `LINEUPS` keyed by the match id, and add the people to `PEOPLE`.

## Researched match data

All 13 matchday-3 fixtures are real. Two research agents gathered lineups, formations, goals (with assists, type and location), substitutions, cards, VAR, referees, coaches, attendance and team stats from ESPN and UEFA match data; each match lists its sources in `research/agent-*.json`. Rebuild the app data after editing the research files:

    python3 tools/build-match-data.py

Gaps: xG isn't published by those sources, so xG and other missing stats are modelled; player ratings are sample values; goal locations and some goal descriptions are estimated from commentary wording. The agent workstation in `workstation/` shows research progress live (serve that folder on its own port).

## Current scope and credits

This is a frontend prototype. Scores, ratings, events, standings and schedules are sample content, not real results, and the app is not connected to a live data service.

Photos come from Wikimedia Commons under the licenses listed in `assets/photo-sources.json`. They're also listed in the app under **Image credits** in the footer, and the venue and news photos are credited where they appear. People without a freely licensed photo are shown with their initials. Club and competition logos were downloaded from ESPN's public logo CDN and belong to their respective owners.

The poll's vote map uses a dot grid built from Natural Earth 1:110m land (public domain, via the world-atlas package). The vote locations and splits are sample data; your own vote is placed from your device's time zone, with no location permission or network request.

`assets/players.png` and `assets/news.png` (the earlier AI-generated images) are no longer used and can be deleted.

