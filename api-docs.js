'use strict';

// API documentation (#/api, #/api/<page>): a menu on the left, the endpoint or guide in
// the middle, and on the right a code sample in the chosen language with a "Try It!"
// button that calls the API live. #/api opens the Introduction. The API itself is
// static JSON built by tools/build-api.js (served by tools/serve.py locally and by GitHub
// Pages online).

// Site root, so the docs work on localhost and on GitHub Pages (which serves under /<repo>/).
const apiRoot = () => (location.protocol.startsWith('http') ? new URL('.', location.href).href : 'http://localhost:8000/');

// Response fields for each object, shared by the endpoint pages and the object pages.
const API_FIELDS = {
  Match: [
    ['id', 'string', 'Stable slug, e.g. lille-galatasaray. Use it in /matches/{id}.'],
    ['date · kickoff', 'string', 'ISO date (YYYY-MM-DD) and local kickoff time (HH:MM).'],
    ['competition · round', 'string', 'e.g. UEFA Champions League · League phase, matchday 3.'],
    ['status', 'string', 'FT for finished matches.'],
    ['home · away', 'Club', '{ name, id, crest, country }.'],
    ['score', 'object', '{ home, away } goals.'],
    ['lineups', 'object', 'Single match only. Per side: formation, coach, starting (with x, y pitch position 0–100) and bench.'],
    ['events', 'Event[]', 'Single match only. Goals, cards, substitutions and VAR decisions in order.'],
    ['stats', 'object', 'Single match only. Team totals as [home, away] pairs (shots, onTarget, corners…); possession is the home share.'],
    ['provenance', 'object', 'Single match only. Which parts are real and which are sample values.'],
  ],
  Event: [
    ['minute', 'number', 'Match minute. Stoppage time is folded in (45+2 → 45).'],
    ['type', 'string', 'goal, own_goal, yellow_card, red_card, substitution or var.'],
    ['team', 'string', 'home or away.'],
    ['player', 'Person', 'Who it happened to; for a substitution, the player coming on.'],
    ['replaced', 'Person', 'Substitutions only: the player going off.'],
    ['scoreAfter · penalty', 'string · boolean', 'Goals only: the score after the goal, and whether it was a penalty.'],
    ['assist · goalType · description', 'Person · string', 'Goals in researched matches: assister, build-up type and a short write-up.'],
  ],
  Person: [
    ['id', 'string', 'Stable slug. Use it in /people/{id}.'],
    ['name · short', 'string', 'Full name and the short name used on the pitch.'],
    ['position', 'string', 'GK, CB, LB, RB, DM, CM, AM, LW, RW, ST or Coach.'],
    ['photo', 'string | null', 'A site path or a full URL to a square headshot, or null.'],
    ['rating', 'number | null', 'In lineups only. A sample value, not an official rating.'],
  ],
  Club: [
    ['name · id', 'string', 'Display name and stable slug.'],
    ['crest', 'string', 'Path or URL of the club crest.'],
    ['country', 'string', 'ISO country code.'],
  ],
  Competition: [
    ['name', 'string', 'e.g. Premier League.'],
    ['country', 'string', 'Country or region.'],
    ['logo', 'string', 'Path of the competition logo.'],
  ],
  'Live event': [
    ['id', 'string', 'ESPN event id.'],
    ['start', 'string', 'Kickoff time, ISO 8601 (UTC).'],
    ['state', 'string', 'pre (not started), in (live) or post (finished).'],
    ['detail', 'string', "Status text: the minute (67'), HT, FT or a kickoff time."],
    ['home · away', 'object', '{ name, logo, score }.'],
  ],
  Fixture: [
    ['id · code', 'string', 'ESPN event id and competition code (e.g. eng.1). The match page is #/match/espn-<code with _>-<id>.'],
    ['league', 'string', 'Competition name, e.g. Premier League.'],
    ['start', 'string', 'Kickoff time, ISO 8601 (UTC).'],
    ['state · detail', 'string', 'pre, in or post, and the status text (kickoff time, minute or FT).'],
    ['venue', 'string | null', 'Stadium name.'],
    ['channels', 'string[]', 'US TV channels showing it (from ESPN), e.g. Peacock, Paramount+.'],
    ['home · away', 'object', '{ name, logo, score }; score is set once the match starts.'],
  ],
  Article: [
    ['id', 'string', 'Stable id for the story.'],
    ['title · summary', 'string', "The headline and the publisher's short summary."],
    ['url', 'string', "Link to the full story on the publisher's site."],
    ['source', 'string', 'Publisher, e.g. BBC Sport.'],
    ['image', 'string', 'Thumbnail URL (may be empty).'],
    ['published', 'string', 'ISO 8601 time (UTC).'],
    ['clubs · leagues', 'string[]', 'Clubs and competitions the story mentions.'],
  ],
};

const API_PAGES = [
  { group: 'Getting started', id: 'introduction', title: 'Introduction', guide: true },
  { group: 'Getting started', id: 'responses', title: 'Responses and errors', guide: true },
  { group: 'Getting started', id: 'data', title: 'Real and sample data', guide: true },
  { group: 'Matches', id: 'list-matches', title: 'List matches', path: 'api/v1/matches.json', object: 'Match', list: true,
    text: 'Every match in TDsports: date, kickoff, competition, round, both teams with crests, the score and status. Lineups, events and stats are left out; get a single match for those.' },
  { group: 'Matches', id: 'get-match', title: 'Get a match', path: 'api/v1/matches/{id}.json', object: 'Match', also: ['Event', 'Person'],
    params: [['id', 'lille-galatasaray', 'The match id, from List matches.']],
    text: 'One match in full: lineups with pitch positions, coaches and benches, every event, team stats, venue, referee, attendance and the sources the data came from.' },
  { group: 'Matches', id: 'upcoming-fixtures', title: 'Upcoming fixtures', path: 'tv.json', object: 'Fixture', list: true,
    text: "Every fixture from yesterday to six days ahead in all ten competitions, with kickoff time, venue and the US TV channels showing it. The shape is { updated, region, days, matches }. Refreshed every 30 minutes; the freshest copy is also at raw.githubusercontent.com/expensivestrike50/tdsports/news-data/tv.json." },
  { group: 'Live', id: 'live-scores', title: 'Live scores', path: 'live.json', object: 'Live event', list: true,
    text: "Today's scoreboard across 10 competitions, from ESPN. Refreshed every 30 seconds while Agent Tom runs locally; on the hosted site it's the last published snapshot. The shape is { updated, source, leagues: [{ code, league, events }] }." },
  { group: 'Live', id: 'news', title: 'News feed', path: 'news.json', object: 'Article', list: true,
    text: 'Football news from BBC Sport, The Guardian, Sky Sports, The Athletic, ESPN and more, newest first and tagged by club and competition. The shape is { updated, sources, articles }.' },
  { group: 'Competitions and clubs', id: 'list-competitions', title: 'List competitions', path: 'api/v1/competitions.json', object: 'Competition', list: true,
    text: 'The leagues and cups in TDsports, with country and logo.' },
  { group: 'Competitions and clubs', id: 'list-clubs', title: 'List clubs', path: 'api/v1/clubs.json', object: 'Club', list: true,
    text: 'Every club and national team, with id, crest and country.' },
  { group: 'People', id: 'list-people', title: 'List people', path: 'api/v1/people.json', object: 'Person', list: true,
    text: 'Every player and coach: id, name, short name, position and photo.' },
  { group: 'People', id: 'get-person', title: 'Get a person', path: 'api/v1/people/{id}.json', object: 'Person', also: ['Match'],
    params: [['id', 'osimhen', 'The person id, from List people or a match lineup.']],
    text: 'One player or coach, plus every match they appear in (as a starter, on the bench or as coach).' },
  { group: 'Index', id: 'index', title: 'API index', path: 'api/v1/index.json',
    text: 'Every endpoint and how many records each holds. A good first call.' },
  ...Object.keys(API_FIELDS).map(name => ({ group: 'Objects', id: 'object-' + name.toLowerCase().replace(/ /g, '-'), title: name, objectPage: name })),
];

const API_LANGS = [
  ['Shell', 'bash', 'https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/bash/bash-original.svg'],
  ['Node', 'node', 'https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/nodejs/nodejs-original.svg'],
  ['Python', 'python', 'https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/python/python-original.svg'],
  ['Ruby', 'ruby', 'https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/ruby/ruby-original.svg'],
  ['PHP', 'php', 'https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/php/php-original.svg'],
];

const apiSample = (lang, url) => ({
  Shell: `curl --request GET \\\n     --url ${url} \\\n     --header 'accept: application/json'`,
  Node: `const res = await fetch('${url}');\nconst body = await res.json();\n\nconsole.log(body.data ?? body);`,
  Python: `import json, urllib.request\n\nurl = '${url}'\nbody = json.load(urllib.request.urlopen(url))\n\nprint(body.get('data', body))`,
  Ruby: `require 'net/http'\nrequire 'json'\n\nbody = JSON.parse(Net::HTTP.get(URI('${url}')))\nputs body.fetch('data', body)`,
  PHP: `<?php\n$body = json_decode(file_get_contents('${url}'), true);\n\nprint_r($body['data'] ?? $body);`,
}[lang]);

const apiHistory = {};   // page id -> [{ time, status, ms, url }]
const apiParams = {};    // page id -> { param: value }
let apiResponse = null;  // { page, status, ms, size, text }

const apiPage = id => API_PAGES.find(p => p.id === id);
const apiUrl = p => apiRoot() + (p.params || []).reduce((path, [name, example]) => path.replace(`{${name}}`, encodeURIComponent((apiParams[p.id] || {})[name] || example)), p.path);
const apiPathHtml = p => esc(p.path).replace(/\{(\w+)\}/g, '<b>{$1}</b>');

function renderApi(pageId) {
  const page = apiPage(pageId || 'introduction');
  if (!page) { location.hash = '#/api'; return; }
  document.title = `${page.title} | TDsports API`;
  const q = (state.apiFilter || '').toLowerCase();
  const groups = [...new Set(API_PAGES.map(p => p.group))];
  app.innerHTML = `
    <div class="ad ${page.path ? '' : 'no-side'}">
      <nav class="ad-nav" aria-label="API reference">
        <label class="ad-filter"><span aria-hidden="true">⌕</span><input id="api-filter" type="search" placeholder="Filter" value="${esc(state.apiFilter || '')}" aria-label="Filter the reference"></label>
        <p class="ad-label">TDsports API v1 reference</p>
        ${groups.map(g => {
          const items = API_PAGES.filter(p => p.group === g && (!q || `${p.title} ${p.path || ''}`.toLowerCase().includes(q)));
          if (!items.length) return '';
          return `<div class="ad-group"><p class="ad-group-title">${esc(g)}</p>${items.map(p => `
            <a class="ad-link ${p.id === page.id ? 'on' : ''}" href="#/api/${p.id}" ${p.id === page.id ? 'aria-current="page"' : ''}>
              <span>${esc(p.title)}</span>${p.path ? '<span class="ad-get">GET</span>' : ''}
            </a>`).join('')}</div>`;
        }).join('')}
      </nav>
      <article class="ad-main">${page.path ? apiEndpoint(page) : page.objectPage ? apiObject(page.objectPage) : apiGuide(page)}</article>
      ${page.path ? apiConsole(page) : ''}
    </div>`;
}

function apiFieldsTable(name) {
  return `<div class="ad-box"><div class="ad-box-head"><b>${esc(name)}</b><span class="muted">object</span></div>${API_FIELDS[name].map(([f, t, d]) => `
    <div class="ad-row"><div><code class="ad-field">${esc(f)}</code> <span class="ad-type">${esc(t)}</span></div><p>${esc(d)}</p></div>`).join('')}</div>`;
}

function apiEndpoint(p) {
  const hist = apiHistory[p.id] || [];
  return `
    <div class="ad-top"><button class="ad-btn" data-action="api-copy-url" data-url="${esc(apiUrl(p))}">⧉ Copy URL</button></div>
    <h1 class="ad-title">${esc(p.title)}</h1>
    <p class="ad-url"><span class="ad-get big">GET</span><code>${esc(apiRoot())}${apiPathHtml(p)}</code></p>
    <p class="ad-text">${esc(p.text)}</p>
    <p class="ad-text">No key or sign-up is needed, and CORS is open, so you can call it from any page or script.</p>
    <hr class="ad-hr">
    <h2 class="ad-h2">Recent requests</h2>
    <div class="ad-box"><table class="ad-table"><thead><tr><th>Time</th><th>Status</th><th>Duration</th></tr></thead><tbody>
      ${hist.length ? hist.map(h => `<tr><td>${h.time}</td><td><span class="ad-status ${h.status === 200 ? 'ok' : 'bad'}">${h.status || 'failed'}</span></td><td>${h.ms} ms</td></tr>`).join('') : '<tr><td colspan="3" class="ad-empty">Make a request to see history.</td></tr>'}
    </tbody></table></div>
    ${p.params ? `
    <h2 class="ad-h2">Path params</h2>
    <div class="ad-box">${p.params.map(([name, example, desc]) => `
      <div class="ad-row ad-param"><div><div><code class="ad-field">${name}</code> <span class="ad-type">string</span> <span class="ad-req">required</span></div><p>${esc(desc)}</p></div>
      <input class="ad-input" data-param="${name}" data-page="${p.id}" value="${esc((apiParams[p.id] || {})[name] || example)}" aria-label="${name}"></div>`).join('')}</div>` : ''}
    <h2 class="ad-h2">Response</h2>
    <div class="ad-box"><div class="ad-row"><div><span class="ad-status ok">200</span> <span class="muted">application/json</span></div>
      <p>${p.object ? (p.list ? `A list of <a href="#/api/object-${p.object.toLowerCase().replace(/ /g, '-')}">${p.object}</a> objects.` : `One <a href="#/api/object-${p.object.toLowerCase().replace(/ /g, '-')}">${p.object}</a> object.`) : 'An object describing every endpoint.'} See <a href="#/api/responses">Responses and errors</a> for the envelope.</p></div>
      ${p.params ? `<div class="ad-row"><div><span class="ad-status bad">404</span> <span class="muted">application/json</span></div><p>No ${p.object.toLowerCase()} has that id.</p></div>` : ''}</div>
    ${p.object ? `<h2 class="ad-h2">Fields</h2>${apiFieldsTable(p.object)}` : ''}
    ${(p.also || []).map(o => `<h2 class="ad-h2">${o} object</h2>${apiFieldsTable(o)}`).join('')}
    ${apiPager(p)}`;
}

function apiConsole(p) {
  const lang = API_LANGS.some(([l]) => l === state.apiLang) ? state.apiLang : 'Shell';
  const code = apiSample(lang, apiUrl(p)).split('\n');
  const r = apiResponse && apiResponse.page === p.id ? apiResponse : null;
  return `
    <aside class="ad-side">
      <p class="ad-label">Language</p>
      <div class="ad-langs" role="tablist">${API_LANGS.map(([l, , icon]) => `
        <button role="tab" class="${l === lang ? 'on' : ''}" aria-selected="${l === lang}" data-action="api-lang" data-value="${l}"><img src="${icon}" alt="" loading="lazy">${l}</button>`).join('')}</div>
      <div class="ad-code">
        <div class="ad-code-head"><span>${lang === 'Shell' ? 'cURL' : lang} request</span><span class="ad-code-url">GET</span></div>
        <pre id="api-sample">${code.map((line, i) => `<span class="ln">${i + 1}</span>${apiHighlight(line)}`).join('\n')}</pre>
        <div class="ad-code-foot"><button class="ad-icon-btn" data-action="api-copy" data-target="api-sample" aria-label="Copy code">⧉</button><button class="ad-try" data-action="api-try" data-page="${p.id}">Try It!</button></div>
      </div>
      <div class="ad-response" aria-live="polite">
        <div class="ad-response-head"><span class="ad-label">Response</span>${r ? `<span class="muted"><span class="ad-status ${r.status === 200 ? 'ok' : 'bad'}">${r.status || 'failed'}</span> ${r.ms} ms · ${r.size}</span>` : ''}</div>
        ${r ? `<pre class="ad-json">${esc(r.text)}</pre>` : `<p class="ad-text small">Click <span class="ad-kbd">Try It!</span> to start a request and see the response here.</p><p class="muted small">application/json</p><span class="ad-status ok dot">200</span>`}
      </div>
    </aside>`;
}

// Light syntax colouring for the code samples: strings, keywords and flags.
function apiHighlight(line) {
  return esc(line)
    .replace(/(&#39;[^&]*?&#39;)/g, '<span class="s">$1</span>')
    .replace(/(--\w+)/g, '<span class="f">$1</span>')
    .replace(/\b(curl|const|await|import|require|print|puts|print_r|console)\b/g, '<span class="k">$1</span>');
}

function apiObject(name) {
  const used = API_PAGES.filter(p => p.object === name || (p.also || []).includes(name));
  return `
    <h1 class="ad-title">${esc(name)} object</h1>
    <p class="ad-text">Returned by ${used.map(p => `<a href="#/api/${p.id}">${esc(p.title)}</a>`).join(', ') || 'the API'}.</p>
    ${apiFieldsTable(name)}
    ${apiPager(apiPage('object-' + name.toLowerCase().replace(/ /g, '-')))}`;
}

function apiGuide(p) {
  const body = {
    introduction: `
      <p class="ad-text">The TDsports API gives you read-only JSON for every match, lineup, event, club, player and coach in TDsports, plus live scores and aggregated news. There's no key or sign-up: send a GET request and read the response.</p>
      <h2 class="ad-h2">Base URL</h2>
      <div class="ad-box"><div class="ad-row"><code class="ad-field">${esc(apiRoot())}</code><p>All paths in this reference are relative to it. When the local services run, <code>http://localhost:8000/</code> serves the same API (and also answers without the <code>.json</code> ending).</p></div></div>
      <h2 class="ad-h2" id="api-first">Your first request</h2>
      <div class="ad-code"><pre>${apiSample('Shell', apiRoot() + 'api/v1/matches.json').split('\n').map((l, i) => `<span class="ln">${i + 1}</span>${apiHighlight(l)}`).join('\n')}</pre></div>
      <p class="ad-text">Then pick an endpoint on the left: each page has code in five languages and a <b>Try It!</b> button that runs the request in your browser.</p>
      <h2 class="ad-h2">At a glance</h2>
      <div class="ad-stats"><div><b>${API_PAGES.filter(x => x.path).length}</b><span>endpoints, all GET</span></div><div><b>${MATCHES.length}</b><span>matches with lineups</span></div><div><b>${Object.keys(PEOPLE).length.toLocaleString()}</b><span>players and coaches</span></div></div>
      <div class="ad-links">
        <div><h2>Get started with the API</h2><a href="#/api/get-match">Try the API</a><a href="#/api/introduction" data-action="api-first">Your first request</a><a href="${apiRoot()}api/v1/matches.json" target="_blank" rel="noopener">Download all matches</a></div>
        <div><h2>Data and sources</h2><a href="#/api/responses">Responses and errors</a><a href="#/api/data">Real and sample data</a><a href="#/api/object-match">The Match object</a></div>
        <div><h2>Get support</h2><a href="https://github.com/expensivestrike50/tdsports" target="_blank" rel="noopener">Source on GitHub</a><a href="https://github.com/expensivestrike50/tdsports/issues" target="_blank" rel="noopener">Report an issue</a></div>
      </div>`,
    responses: `
      <p class="ad-text">Every <code>api/v1</code> response has the same envelope: <code>{ "generated": "&lt;ISO time&gt;", "data": … }</code>. Lists are arrays; single resources are objects.</p>
      <p class="ad-text"><code>live.json</code> and <code>news.json</code> are feeds with their own shape, described on their pages.</p>
      <h2 class="ad-h2">Errors</h2>
      <div class="ad-box">
        <div class="ad-row"><div><span class="ad-status bad">404</span></div><p>Unknown path or id. The local server returns <code>{ "error": { "status", "message", "path" } }</code>; GitHub Pages returns its own 404 page.</p></div>
        <div class="ad-row"><div><span class="ad-status bad">405</span></div><p>Only GET (and HEAD) are supported.</p></div>
      </div>
      <h2 class="ad-h2">Images</h2>
      <p class="ad-text"><code>crest</code>, <code>logo</code> and <code>photo</code> are either paths relative to the base URL (e.g. <code>assets/clubs/364.png</code>) or full URLs.</p>
      <h2 class="ad-h2">Versioning</h2>
      <p class="ad-text">Fields may be added to v1. Nothing will be renamed or removed without a v2.</p>`,
    data: `
      <p class="ad-text">Scores, lineups, formations, events, coaches, referees and attendance are real, gathered from ESPN, UEFA and club sources; each match lists its <code>sources</code>.</p>
      <p class="ad-text">Player ratings and the detailed per-player stats are sample values. Each match's <code>provenance</code> field says which parts are real.</p>
      <h2 class="ad-h2">Freshness</h2>
      <div class="ad-box">
        <div class="ad-row"><code class="ad-field">live.json</code><p>Every 30 seconds locally (Agent Tom); a snapshot on the hosted site.</p></div>
        <div class="ad-row"><code class="ad-field">news.json</code><p>Every 10 minutes locally; every 30 minutes on the hosted site.</p></div>
        <div class="ad-row"><code class="ad-field">api/v1/*</code><p>When the data is rebuilt with <code>node tools/build-api.js</code>.</p></div>
      </div>`,
  }[p.id];
  return `<h1 class="ad-title">${esc(p.title)}</h1>${body}${apiPager(p)}`;
}

function apiPager(p) {
  const i = API_PAGES.indexOf(p), prev = API_PAGES[i - 1], next = API_PAGES[i + 1];
  return `<div class="ad-pager">${prev ? `<a href="#/api/${prev.id}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="#/api/${next.id}"><small>Next</small>${esc(next.title)}</a>` : ''}</div>`;
}

async function apiTry(el) {
  const p = apiPage(el.dataset.page);
  const url = apiUrl(p);
  el.textContent = 'Sending…';
  const t0 = performance.now();
  let status = 0, text = '';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    status = res.status;
    text = await res.text();
  } catch {
    text = 'Could not reach the API. Open TDsports from a web server (GitHub Pages or http://localhost:8000), not as a file.';
  }
  const ms = Math.round(performance.now() - t0);
  let pretty = text;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
  const lines = pretty.split('\n');
  apiResponse = { page: p.id, status, ms, size: `${(text.length / 1024).toFixed(1)} KB`, text: lines.slice(0, 200).join('\n') + (lines.length > 200 ? `\n… ${lines.length - 200} more lines` : '') };
  (apiHistory[p.id] ||= []).unshift({ time: new Date().toLocaleTimeString('en-GB'), status, ms });
  apiHistory[p.id].length = Math.min(apiHistory[p.id].length, 5);
  render();
  const box = $('.ad-response');
  if (box && box.getBoundingClientRect().top > innerHeight) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function apiCopy(el) {
  const text = el.dataset.url || $('#' + el.dataset.target).textContent.replace(/^\d+/gm, '');
  const label = el.textContent;
  navigator.clipboard?.writeText(text).then(() => {
    el.textContent = 'Copied';
    setTimeout(() => { el.textContent = label; }, 1500);
  }, () => { el.textContent = 'Select and copy'; });
}
