import { CONFIG } from './config.js';
import * as api from './api.js';
import { planAll } from './planner.js';
import { fmt, fmtSec, MIN, londonParts } from './time.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let pressTime = null;
let timer = null;
let busy = false;
let lastResult = null;

const LINE_CLASS = { jubilee: 'jubilee', overground: 'overground', rail: 'rail' };
const LINE_COLOR = { jubilee: 'var(--jubilee)', windrush: 'var(--overground)', southern: 'var(--rail)' };

function effectivePress() {
  const now = new Date();
  if (!pressTime || now - pressTime > CONFIG.pressValidMinutes * MIN) return now;
  return pressTime;
}

// ------------------------------------------------------------------ //
async function refresh() {
  if (busy) return;
  busy = true;
  $('goBtn').setAttribute('aria-busy', 'true');
  $('refreshBtn').textContent = 'Updating…';
  api.rawLog.length = 0;
  try {
    const now = new Date();
    const result = await planAll(api, { pressTime: effectivePress(), now });
    lastResult = result;
    render(result);
  } catch (e) {
    showBanner(`Something went wrong: ${e.message}`, true);
  } finally {
    busy = false;
    $('goBtn').removeAttribute('aria-busy');
    $('refreshBtn').textContent = 'Refresh';
    renderDebug();
  }
}

function startAuto() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, CONFIG.autoRefreshSeconds * 1000);
}

// ------------------------------------------------------------------ //
function showBanner(text, error = false) {
  const b = $('banner');
  if (!text) { b.hidden = true; return; }
  b.textContent = text;
  b.className = 'banner' + (error ? ' error' : '');
  b.hidden = false;
}

function lateNight(d) {
  const { h, mi } = londonParts(d);
  const m = h * 60 + mi;
  return m >= 0 * 60 + 30 && m < 5 * 60 + 30;
}

function render(result) {
  const { plans, now } = result;
  const complete = plans.filter((p) => p.best.complete);
  const errs = result.errors || [];
  const offline = navigator.onLine === false || (errs.length && errs.every((e) => e.offline));

  // ---- banners
  if (offline && !complete.length) {
    showBanner("You're offline. Showing the last result if there is one. Connect and tap Refresh.", true);
  } else if (!complete.length && lateNight(now)) {
    showBanner('No trains found. Services may have finished for the night. Check night buses or a taxi.', true);
  } else if (errs.some((e) => e.status >= 500 || e.status === 429)) {
    showBanner('Some TfL or National Rail data is unavailable right now. Showing what we have.');
  } else if (!result.railLive) {
    showBanner('Southern times are SCHEDULED. Add a free Rail Data Marketplace key in Settings (⚙) for live trains.');
  } else {
    showBanner('');
  }
  if (offline && !complete.length && lastGood) {
    renderPlans(lastGood, true);
    return;
  }
  if (complete.length) lastGood = result;
  renderPlans(result, false);
}
let lastGood = null;

function renderPlans(result, stale) {
  const { plans, now } = result;
  // Earliest home time wins; on a tie, fewer changes (Route B), then the later start.
  const complete = plans.filter((p) => p.best.complete).sort((a, b) =>
    (a.best.arrival - b.best.arrival) || (a.route.legs.length - b.route.legs.length)
    || (b.best.steps[0].option.dep - a.best.steps[0].option.dep));
  const fastest = complete[0];

  // ---- summary
  const sum = $('summary');
  sum.hidden = false;
  if (fastest) {
    const other = complete[1];
    let diff;
    if (other) {
      const d = Math.round((other.best.arrival - fastest.best.arrival) / MIN);
      diff = d === 0 ? `Same home time as ${other.route.name}. ${fastest.route.legs.length < other.route.legs.length ? `${fastest.route.name} has fewer changes.` : ''}`
        : `${d} min sooner than ${other.route.name} (home ${fmt(other.best.arrival)})`;
    } else {
      diff = 'The other route has no valid connection right now.';
    }
    sum.className = 'summary';
    sum.innerHTML = `<p class="big">Fastest: ${esc(fastest.route.name)}, home at ${fmt(fastest.best.arrival)}</p>
      <p class="diff">${esc(diff)}</p>`;
  } else {
    sum.className = 'summary none';
    sum.innerHTML = `<p class="big">No complete journey found</p><p class="diff">See the route cards for what is available.</p>`;
  }

  // ---- route cards (A then B, always both)
  $('routes').innerHTML = plans.map((p) => renderCard(p, p === fastest, result)).join('');

  $('meta').hidden = false;
  $('legend').hidden = false;
  $('updated').textContent = `${stale ? 'Stale, last good data' : 'Last updated'} ${fmtSec(now)}`;
}

function badge(source) {
  const cls = source === 'LIVE' ? 'live' : source === 'EST' ? 'est' : 'sched';
  return `<span class="badge ${cls}">${source}</span>`;
}

function renderCard(plan, isFastest, result) {
  const { route, best, next } = plan;
  const dots = route.lines.map((l) => `<span style="background:${LINE_COLOR[l]}"></span>`).join('');
  let body = '';

  if (best.complete) {
    const total = Math.round((best.arrival - plan.start) / MIN) + CONFIG.walk.stratfordToJubileePlatform;
    body += `<div class="headline"><div class="home"><small>Home at</small>${fmt(best.arrival)}</div>
      <div class="dur">${total} min total</div></div>`;
  }

  body += '<ol class="legs">';
  best.steps.forEach((s, i) => {
    const o = s.option;
    if (i === 0) {
      const tight = s.slackBefore < CONFIG.tightSlackMinutes;
      body += `<li class="change${tight ? ' tight' : ''}"><span>Walk to Jubilee platform · ${CONFIG.walk.stratfordToJubileePlatform} min</span>
        <span class="slack">${Math.max(0, Math.round(s.slackBefore))} min spare</span></li>`;
    } else {
      const prev = best.steps[i - 1];
      const tight = s.slackBefore < CONFIG.tightSlackMinutes;
      body += `<li class="change${tight ? ' tight' : ''}"><span>${esc(prev.leg.walkLabel)} · ${prev.leg.walkAfter} min walk</span>
        <span class="slack">${formatSlack(s.slackBefore)}</span></li>`;
    }
    const lateCls = /late|delay|cancel/i.test(o.status) ? 'late' : /on ?time/i.test(o.status) ? 'ok' : '';
    const details = [
      o.platform ? `Platform ${esc(o.platform)}` : '',
      o.destination ? `to ${esc(o.destination)}` : '',
    ].filter(Boolean).join(' · ');
    body += `<li class="leg ${LINE_CLASS[s.leg.line]}">
      <div class="leg-top"><span class="leg-line">${esc(s.leg.lineName)}</span>${badge(s.source)}</div>
      <div class="leg-times">${fmt(o.dep)} → ${fmt(o.arr)}</div>
      <div class="leg-stations">${esc(s.leg.from)} → ${esc(s.leg.to)}</div>
      ${details ? `<div class="leg-detail">${details}</div>` : ''}
      ${o.status && !/^(on ?time)$/i.test(o.status) ? `<div class="leg-status ${lateCls}">${esc(o.status)}</div>` : o.status ? `<div class="leg-status ok">On time</div>` : ''}
      ${(o.notes || []).map((n) => `<div class="leg-detail">${esc(n)}</div>`).join('')}
    </li>`;
  });
  body += '</ol>';

  if (!best.complete) {
    const where = best.failedLeg ? `${best.failedLeg.lineName} ${best.failedLeg.from} → ${best.failedLeg.to}` : 'this route';
    const after = best.ready ? ` after ${fmt(best.ready)}` : '';
    body += `<div class="problem">No usable train found for ${esc(where)}${esc(after)}.${lateNight(result.now) ? ' Services may have finished for the night.' : ''}</div>`;
  }

  const warn = [
    ...(plan.status || []).map((w) => ({ text: w.text, bad: true })),
    ...(plan.warnings || []).map((w) => ({ text: w, bad: /cancel/i.test(w) })),
  ];
  if (warn.length) {
    body += `<ul class="warnings">${warn.map((w) => `<li class="${w.bad ? 'bad' : ''}">${esc(w.text)}</li>`).join('')}</ul>`;
  }

  if (best.complete) {
    if (next) {
      const first = next.steps[0].option;
      body += `<p class="next">Miss it? <strong>Next: Jubilee ${fmt(first.dep)} → home ${fmt(next.arrival)}</strong> (+${Math.round((next.arrival - best.arrival) / MIN)} min)</p>`;
    } else {
      body += '<p class="next">Miss it? No later option found in the data available.</p>';
    }
  }

  return `<article class="card${isFastest ? ' fastest' : ''}" aria-label="${esc(route.name)}">
    <div class="card-head">
      <div><h2 class="card-title">${esc(route.name)}</h2><p class="card-via">${esc(route.via)}</p></div>
      ${isFastest ? '<span class="tag-fastest">FASTEST</span>' : ''}
    </div>
    <div class="line-dots">${dots}</div>
    ${body}
  </article>`;
}

function formatSlack(m) {
  const r = Math.floor(m);
  return `${r} min spare`;
}

// ------------------------------------------------------------------ //
function renderDebug() {
  const s = api.loadSettings();
  $('debug').hidden = !s.debug;
  if (!s.debug) return;
  const items = [...api.rawLog].reverse();
  $('debugList').innerHTML = items.length ? items.map((e) => `<details>
      <summary class="${e.error ? 'err' : ''}">${esc(e.label)} · ${e.status || 'ERR'} · ${e.ms} ms</summary>
      <p class="small">${esc(e.url)}</p>
      ${e.error ? `<p class="err small">${esc(e.error)}</p>` : ''}
      <pre>${esc(pretty(e.body))}</pre>
    </details>`).join('') : '<p class="small">No requests yet. Press the button.</p>';
}

function pretty(body) {
  try { return JSON.stringify(JSON.parse(body), null, 1); } catch { return body || ''; }
}

// ------------------------------------------------------------------ //
function openSettings() {
  const s = api.loadSettings();
  $('rdmKey').value = s.rdmKey;
  $('tflAppKey').value = s.tflAppKey;
  $('huxleyBase').value = s.huxleyBase;
  $('huxleyToken').value = s.huxleyToken;
  $('debugToggle').checked = s.debug;
  $('testResult').textContent = '';
  $('settings').showModal();
}

function readForm() {
  return {
    rdmKey: $('rdmKey').value.trim(),
    tflAppKey: $('tflAppKey').value.trim(),
    huxleyBase: $('huxleyBase').value.trim(),
    huxleyToken: $('huxleyToken').value.trim(),
    debug: $('debugToggle').checked,
  };
}

async function testRail() {
  const prev = api.loadSettings();
  api.saveSettings({ ...prev, ...readForm() });
  $('testResult').textContent = 'Testing…';
  try {
    const b = await api.railBoard(CONFIG.crs.londonBridge, CONFIG.crs.carshaltonBeeches);
    const n = (b.trainServices || b.TrainServices || []).length;
    $('testResult').textContent = `Works. ${b.locationName || 'London Bridge'}: ${n} train(s) to Carshalton Beeches in the next 2 hours.`;
  } catch (e) {
    $('testResult').textContent = `Failed: ${e.message}. ${e.status === 401 ? 'Check the key and that you subscribed to the Live Departure Board product.' : ''}`;
  }
  renderDebug();
}

// ------------------------------------------------------------------ //
$('goBtn').addEventListener('click', () => {
  pressTime = new Date();
  refresh();
  startAuto();
});
$('refreshBtn').addEventListener('click', refresh);
$('settingsBtn').addEventListener('click', openSettings);
$('testRail').addEventListener('click', testRail);
$('settingsForm').addEventListener('submit', () => {
  if (!api.saveSettings(readForm())) alert('Could not save settings (storage blocked).');
  renderDebug();
  if (lastResult) refresh();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer) refresh();
});
window.addEventListener('online', () => { if (timer) refresh(); });
window.addEventListener('offline', () => showBanner("You're offline. Times shown may be out of date.", true));

renderDebug();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
