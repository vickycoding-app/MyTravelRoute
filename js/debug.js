// Raw API test page: one button per data source.
import { CONFIG } from './config.js';
import * as api from './api.js';
import { jpDateTime } from './time.js';

const S = CONFIG.stops;
const L = CONFIG.lines;
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const now = () => jpDateTime(new Date());

const tests = {
  'Jubilee @ Stratford': () => api.tfl.lineArrivals(L.jubilee, S.stratfordJubilee),
  'Jubilee @ Canada Water': () => api.tfl.lineArrivals(L.jubilee, S.canadaWaterJubilee),
  'Jubilee @ London Bridge': () => api.tfl.lineArrivals(L.jubilee, S.londonBridgeJubilee),
  'Overground @ Canada Water': () => api.tfl.stopArrivals(S.canadaWaterOverground),
  'Overground arr/dep @ Canada Water': () => api.tfl.arrivalDepartures(S.canadaWaterOverground, L.overground),
  'Overground @ West Croydon': () => api.tfl.stopArrivals(S.westCroydonRail),
  'Line status': () => api.tfl.lineStatus([L.jubilee, L.overground, L.southern]),
  'Jubilee timetable': () => api.tfl.timetable(L.jubilee, S.stratfordJubilee, 'inbound'),
  'Rail board LBG→CSB': () => api.railBoard(CONFIG.crs.londonBridge, CONFIG.crs.carshaltonBeeches),
  'Rail board WCY→CSB': () => api.railBoard(CONFIG.crs.westCroydon, CONFIG.crs.carshaltonBeeches),
  'Planner: Southern LBG→CSB': () => api.tfl.journey(S.londonBridgeRail, S.carshaltonBeechesRail, { mode: 'national-rail', ...now(), timeIs: 'Departing' }),
  'Planner: Southern WCY→CSB': () => api.tfl.journey(S.westCroydonRail, S.carshaltonBeechesRail, { mode: 'national-rail', ...now(), timeIs: 'Departing' }),
  'Planner: whole Route A (via)': () => api.tfl.journey(S.stratfordJubilee, S.carshaltonBeechesRail, { via: S.westCroydonRail, ...now(), timeIs: 'Departing' }),
  'Planner: whole Route B (via)': () => api.tfl.journey(S.stratfordJubilee, S.carshaltonBeechesRail, { via: S.londonBridgeRail, ...now(), timeIs: 'Departing' }),
  'Search: Carshalton Beeches': () => api.tfl.stopSearch('Carshalton Beeches', 'national-rail'),
};

const out = document.getElementById('out');
const btns = document.getElementById('buttons');
for (const [name, fn] of Object.entries(tests)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', async () => {
    api.rawLog.length = 0;
    out.innerHTML = `<p class="small">Calling ${esc(name)}…</p>`;
    try { await fn(); } catch { /* shown below */ }
    const e = api.rawLog[api.rawLog.length - 1];
    let body = e?.body || '';
    try { body = JSON.stringify(JSON.parse(body), null, 1); } catch { /* raw */ }
    out.innerHTML = e ? `<details open><summary class="${e.error ? 'err' : ''}">${esc(e.label)} · HTTP ${e.status || 'ERR'} · ${e.ms} ms</summary>
      <p class="small">${esc(e.url)}</p>${e.error ? `<p class="err">${esc(e.error)}</p>` : ''}<pre>${esc(body)}</pre></details>`
      : '<p class="err">No request was made (is a rail key set in Settings?).</p>';
  });
  btns.appendChild(b);
}
