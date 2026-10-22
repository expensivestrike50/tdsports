'use strict';

// API documentation page (#/api). The API itself is static JSON built by
// tools/build-api.js and served by tools/serve.py at /api/v1; the "Try it" buttons
// fetch it live and show the response in the console beside the docs.

// Site root, so the docs work on localhost and on GitHub Pages (which serves under /<repo>/).
const apiRoot = () => (location.protocol.startsWith('http') ? new URL('.', location.href).href : 'http://localhost:8000/');

const API_ENDPOINTS = [
  { path: 'api/v1/index.json', title: 'Index', text: 'Every endpoint and how many records each holds. A good first call.' },
  { path: 'api/v1/matches.json', title: 'Matches', text: 'All matches: date, kickoff, competition, round, teams with crests, score and status.' },
  { path: 'api/v1/matches/{id}.json', example: 'lille-galatasaray', title: 'Match', text: 'One match in full: lineups with pitch positions, coaches, bench, events, team stats, venue, referee, attendance and sources.' },
  { path: 'live.json', title: 'Live scores', text: 'Scoreboard across 10 leagues from ESPN, refreshed every 30 seconds by Agent Tom when running locally (a snapshot on the hosted site).' },
  { path: 'api/v1/competitions.json', title: 'Competitions', text: 'Leagues and cups in the app, with country and logo.' },
  { path: 'api/v1/clubs.json', title: 'Clubs', text: 'Club name, id, crest and country.' },
  { path: 'api/v1/people.json', title: 'People', text: 'Every player and coach: id, name, short name, position and photo.' },
  { path: 'api/v1/people/{id}.json', example: 'osimhen', title: 'Person', text: 'One player or coach, plus the matches they appear in (starter, bench or coach).' },
];

const API_FIELDS = {
  Match: [
    ['id', 'string', 'Stable slug, e.g. lille-galatasaray. Use it in /matches/{id}.'],
    ['date · kickoff', 'string', 'ISO date (YYYY-MM-DD) and local kickoff time (HH:MM).'],
    ['competition · round', 'string', 'e.g. UEFA Champions League · League phase, matchday 3.'],
    ['status', 'string', 'FT for finished matches.'],
    ['home · away', 'Club', '{ name, id, crest, country }.'],
    ['score', 'object', '{ home, away } goals.'],
    ['lineups', 'object', 'Match only. Per side: formation, coach, starting (with x, y pitch position 0–100) and bench.'],
    ['events', 'Event[]', 'Match only. Goals, cards, substitutions and VAR decisions in order.'],
    ['stats', 'object', 'Match only. Team totals as [home, away] pairs, e.g. shots, onTarget, corners; possession is the home share.'],
    ['provenance', 'object', 'Match only. Which parts are real and which are sample values.'],
  ],
  Event: [
    ['minute', 'number', 'Match minute. Stoppage time is folded in (45+2 → 45).'],
    ['type', 'string', 'goal, own_goal, yellow_card, red_card, substitution or var.'],
    ['team', 'string', 'home or away.'],
    ['player', 'Person', 'Who it happened to; for a substitution, the player coming on.'],
    ['replaced', 'Person', 'Substitutions only: the player going off.'],
    ['scoreAfter · penalty', 'string · boolean', 'Goals only: the score after the goal, and whether it was a penalty.'],
    ['assist · goalType · description', 'Person · string · string', 'Goals in researched matches: assister, build-up type (counter, set, build…) and a short write-up.'],
  ],
  Person: [
    ['id', 'string', 'Stable slug. Use it in /people/{id}.'],
    ['name · short', 'string', 'Full name and the short name used on the pitch.'],
    ['position', 'string', 'GK, CB, LB, RB, DM, CM, AM, LW, RW, ST or Coach.'],
    ['photo', 'string | null', 'Path to a 240 px square headshot, or null. Credits: /assets/photo-sources.json.'],
    ['rating', 'number | null', 'In lineups only. A sample value, not an official rating.'],
  ],
};

const API_SAMPLES = {
  curl: () => `curl ${apiRoot()}api/v1/matches.json`,
  JavaScript: () => `const res = await fetch('${apiRoot()}api/v1/matches.json');
const { data } = await res.json();

for (const m of data) {
  console.log(\`\${m.home.name} \${m.score.home}-\${m.score.away} \${m.away.name}\`);
}`,
  Python: () => `import json, urllib.request

url = '${apiRoot()}api/v1/matches.json'
data = json.load(urllib.request.urlopen(url))['data']

for m in data:
    print(f"{m['home']['name']} {m['score']['home']}-{m['score']['away']} {m['away']['name']}")`,
};

function apiCode(id, text) {
  return `<div class="api-code"><button class="api-copy" data-action="api-copy" data-target="${id}">Copy</button><pre id="${id}"><code>${esc(text)}</code></pre></div>`;
}

function renderApi() {
  document.title = 'API | TDsports';
  const lang = state.apiLang || 'curl';
  const urlOf = e => (e.example ? e.path.replace(/\{id\}/, e.example) : e.path);
  app.innerHTML = `
    <div class="api-page">
      <article class="card api-card">
        <div class="rv">
          <header class="rv-head">
            <div>
              <span class="rv-kicker">Developers · API v1</span>
              <h1 class="rv-title">TDsports API</h1>
              <p class="rv-dek">Read-only JSON for every match, lineup, event, club and player in TDsports, plus live scores. No key or sign-up: send a GET request and read the <code>data</code> field.</p>
            </div>
            <dl class="rv-numbers">
              <div><dt>Endpoints</dt><dd>${API_ENDPOINTS.length}<small>all GET, JSON</small></dd></div>
              <div><dt>Matches</dt><dd>${MATCHES.length}<small>with full lineups</small></dd></div>
              <div><dt>People</dt><dd>${Object.keys(PEOPLE).length}<small>players and coaches</small></dd></div>
            </dl>
          </header>

          <div class="api-body">
            <div class="api-main">
              <section>
                <h2 class="rv-kicker">Quick start <span class="rv-cap">Base URL <code>${esc(apiRoot())}</code></span></h2>
                <div class="seg api-langs" role="tablist">${Object.keys(API_SAMPLES).map(l => `<button role="tab" class="${l === lang ? 'on' : ''}" aria-selected="${l === lang}" data-action="api-lang" data-value="${l}">${l}</button>`).join('')}</div>
                ${apiCode('api-sample', API_SAMPLES[lang]())}
              </section>

              <section>
                <h2 class="rv-kicker rv-gap">Endpoints <span class="rv-cap">Press Try to see a live response</span></h2>
                <div class="api-endpoints">${API_ENDPOINTS.map(e => `
                  <div class="api-ep">
                    <span class="api-method">GET</span>
                    <span class="api-ep-main"><code>${e.path}</code><b>${e.title}</b><small>${e.text}</small></span>
                    <button class="api-try" data-action="api-try" data-url="${urlOf(e)}">Try</button>
                  </div>`).join('')}
                </div>
              </section>

              <section>
                <h2 class="rv-kicker rv-gap">Responses <span class="rv-cap">Same envelope everywhere</span></h2>
                <p class="api-p">Every response is <code>{ "generated": "&lt;ISO time&gt;", "data": … }</code>. Lists are arrays; single resources are objects. Every URL ends in <code>.json</code> (the local server also answers without it). Errors return the HTTP status with <code>{ "error": { "status", "message", "path" } }</code>; an unknown id gives a 404.</p>
                <p class="api-p"><code>/live</code> uses ESPN's shape instead: <code>{ updated, source, leagues: [{ code, league, events: [{ id, start, state, detail, home, away }] }] }</code>, where <code>state</code> is <code>pre</code>, <code>in</code> or <code>post</code>.</p>
              </section>

              ${Object.entries(API_FIELDS).map(([name, rows]) => `
                <section>
                  <h2 class="rv-kicker rv-gap">${name} object</h2>
                  <table class="rv-table api-fields"><tbody>${rows.map(([f, t, d]) => `<tr><td><code>${f}</code><small>${t}</small></td><td>${d}</td></tr>`).join('')}</tbody></table>
                </section>`).join('')}

              <section>
                <h2 class="rv-kicker rv-gap">Good to know</h2>
                <ol class="rv-notes">
                  <li><b>Real vs sample data.</b> Scores, lineups, events, coaches, referees and attendance are real (ESPN and UEFA). Player ratings, and the detailed stats for Lille v Galatasaray, are sample values. Each match's <code>provenance</code> says which is which.</li>
                  <li><b>Where it runs.</b> The API is plain static files, served from this site (<code>${esc(apiRoot())}</code>) and from <code>localhost:8000</code> when the local services run. CORS is open, so any page or script can call it.</li>
                  <li><b>Freshness.</b> <code>/live</code> updates every 30 seconds. Everything else changes only when the data is rebuilt with <code>node tools/build-api.js</code>.</li>
                  <li><b>Images.</b> <code>crest</code>, <code>logo</code> and <code>photo</code> are paths relative to the site root, e.g. <code>${esc(apiRoot())}assets/clubs/364.png</code>.</li>
                  <li><b>Versioning.</b> Fields may be added to v1; nothing will be renamed or removed without a v2.</li>
                </ol>
              </section>
            </div>

            <aside class="api-console" aria-live="polite">
              <div class="api-console-head"><span class="rv-kicker">Response</span><span id="api-status" class="rv-cap">Press Try on an endpoint</span></div>
              <pre id="api-output" class="api-output"><code>// The response will appear here.</code></pre>
              <a id="api-open" class="api-open" href="api/v1/index.json" target="_blank" rel="noopener" hidden>Open full response ↗</a>
            </aside>
          </div>
          <p class="nx-note">ⓘ Built from the same data as the app by <code>tools/build-api.js</code>. See README.md for setup.</p>
        </div>
      </article>
    </div>`;
}

async function apiTry(el) {
  const out = $('#api-output'), status = $('#api-status'), open = $('#api-open');
  document.querySelectorAll('.api-try.on').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  const url = el.dataset.url;
  status.textContent = `GET ${url} …`;
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
    const lines = pretty.split('\n');
    const shown = lines.slice(0, 160).join('\n') + (lines.length > 160 ? `\n… ${lines.length - 160} more lines` : '');
    out.innerHTML = `<code>${esc(shown)}</code>`;
    status.innerHTML = `<b class="${res.ok ? 'api-ok' : 'api-bad'}">${res.status}</b> · ${ms} ms · ${(text.length / 1024).toFixed(1)} KB`;
    open.href = url;
    open.hidden = false;
  } catch {
    out.innerHTML = `<code>${esc('Could not reach the API. Open TDsports from a web server (GitHub Pages or\nhttp://localhost:8000), not as a file.')}</code>`;
    status.innerHTML = '<b class="api-bad">Offline</b>';
    open.hidden = true;
  }
  if (getComputedStyle($('.api-body')).gridTemplateColumns.split(' ').length < 2) $('.api-console').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function apiCopy(el) {
  const text = $('#' + el.dataset.target).textContent;
  navigator.clipboard?.writeText(text).then(() => {
    el.textContent = 'Copied';
    setTimeout(() => { el.textContent = 'Copy'; }, 1500);
  }, () => { el.textContent = 'Select and copy'; });
}
