// Route planning: chains the legs of the two fixed routes using live data
// where possible, falling back to TfL timetable / Journey Planner times.
import { CONFIG } from './config.js';
import { MIN, addMin, parseHHMM, parseLondonLocal, jpDateTime, fmt } from './time.js';

const S = CONFIG.stops;

// ------------------------------------------------------------------ //
//  Data source with per-refresh caching. `api` is injectable for tests.
// ------------------------------------------------------------------ //
export class Sources {
  constructor(api, now = new Date()) {
    this.api = api;
    this.now = now;
    this.cache = new Map();
    this.errors = [];
  }
  memo(key, fn) {
    if (!this.cache.has(key)) {
      const p = fn().catch((e) => {
        this.errors.push(e);
        throw e;
      });
      this.cache.set(key, p);
    }
    return this.cache.get(key);
  }
  lineArrivals(line, stop) { return this.memo(`la:${line}:${stop}`, () => this.api.tfl.lineArrivals(line, stop)); }
  stopArrivals(stop) { return this.memo(`sa:${stop}`, () => this.api.tfl.stopArrivals(stop)); }
  arrivalDepartures(stop, lines) { return this.memo(`ad:${stop}`, () => this.api.tfl.arrivalDepartures(stop, lines)); }
  lineStatus() {
    const L = CONFIG.lines;
    return this.memo('status', () => this.api.tfl.lineStatus([L.jubilee, L.overground, L.southern]));
  }
  railBoard(crs, toCrs) { return this.memo(`rb:${crs}:${toCrs}`, () => this.api.railBoard(crs, toCrs)); }
  journey(from, to, mode, when) {
    const { date, time } = jpDateTime(when);
    return this.memo(`jp:${from}:${to}:${mode}:${date}${time}`,
      () => this.api.tfl.journey(from, to, { mode, date, time, timeIs: 'Departing' }));
  }
}

// Jubilee run times from the TfL timetable (cached for the session).
let runTimeCache = null;
export async function jubileeRunTimes(api) {
  if (runTimeCache) return runTimeCache;
  const fb = CONFIG.fallbackRunMinutes;
  const out = { [S.canadaWaterJubilee]: fb.stratfordToCanadaWater, [S.londonBridgeJubilee]: fb.stratfordToLondonBridge, source: 'config' };
  try {
    const tt = await api.tfl.timetable(CONFIG.lines.jubilee, S.stratfordJubilee, 'inbound');
    const intervals = tt?.timetable?.routes?.[0]?.stationIntervals?.[0]?.intervals || [];
    for (const i of intervals) {
      if (i.stopId in out && typeof i.timeToArrival === 'number') out[i.stopId] = i.timeToArrival;
    }
    out.source = 'timetable';
    runTimeCache = out;
  } catch {
    /* keep config fallbacks; retry next refresh */
  }
  return out;
}
export function _resetRunTimeCache() { runTimeCache = null; }

// ------------------------------------------------------------------ //
//  Leg option providers. Each returns { options:[...], warnings:[...] }
//  Option: { dep, arr, depLive, arrLive, platform, destination,
//            status, cancelled, notes:[] }
// ------------------------------------------------------------------ //
const isWestbound = (a) => /west/i.test(a.platformName || '') || a.direction === 'inbound';
const cleanName = (n) => String(n || '').replace(/ (Underground|Rail|DLR) Station$/i, '').replace(/ Station$/i, '');

function callsAt(destId, targetId) {
  const order = CONFIG.jubileeWestboundOrder;
  const di = order.indexOf(destId);
  const ti = order.indexOf(targetId);
  // Destination before (or at) the interchange -> doesn't get there.
  if (di >= 0 && ti >= 0 && di <= ti && destId !== S.stratfordJubilee) return false;
  return true;
}

export async function jubileeOptions(src, targetStop, runTimes) {
  const warnings = [];
  let atStratford;
  try {
    atStratford = await src.lineArrivals(CONFIG.lines.jubilee, S.stratfordJubilee);
  } catch (e) {
    warnings.push(`Live Jubilee times unavailable (${e.message}); using Journey Planner.`);
    return { ...(await jpOptions(src, S.stratfordJubilee, targetStop, 'tube', /jubilee/i)), warnings, fallback: true };
  }
  let atTarget = [];
  try {
    atTarget = await src.lineArrivals(CONFIG.lines.jubilee, targetStop);
  } catch { /* use run time */ }

  const byVehicle = new Map();
  for (const a of atStratford || []) {
    const terminating = a.destinationNaptanId === S.stratfordJubilee;
    if (!terminating && !isWestbound(a)) continue;
    if (!callsAt(a.destinationNaptanId, targetStop)) continue;
    const t = new Date(a.expectedArrival);
    const key = a.vehicleId && a.vehicleId !== '000' ? a.vehicleId : a.id;
    const prev = byVehicle.get(key);
    if (prev && prev.t <= t) {
      prev.platforms.add(a.platformName);
      continue;
    }
    byVehicle.set(key, { a, t, terminating, platforms: new Set([a.platformName]) });
  }

  const run = runTimes[targetStop];
  const options = [];
  for (const [vehicleId, { a, t, terminating, platforms }] of byVehicle) {
    const dep = terminating ? addMin(t, CONFIG.stratfordTurnaroundMinutes) : t;
    // Same train's prediction further down the line?
    let arr = null;
    for (const b of atTarget) {
      if (b.vehicleId !== vehicleId || !isWestbound(b)) continue;
      const bt = new Date(b.expectedArrival);
      const mins = (bt - dep) / MIN;
      if (mins < run * 0.5 || mins > run * 2.5) continue;
      if (!arr || bt < arr) arr = bt;
    }
    const plats = [...platforms].map((p) => (p.match(/platform\s*(\w+)/i) || [])[1]).filter(Boolean)
      .sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
    options.push({
      dep,
      arr: arr || addMin(dep, run),
      depLive: true,
      arrLive: Boolean(arr),
      platform: plats.length === 1 ? plats[0] : plats.length ? plats.join('/') : '',
      destination: terminating ? '' : cleanName(a.destinationName || a.towards),
      status: '',
      vehicleId,
      notes: [
        ...(terminating ? [`Arrives ${fmt(t)}, turns round, leaves westbound ~${fmt(dep)} (platform may change)`] : []),
        ...(a.currentLocation ? [`Now: ${a.currentLocation}`] : []),
      ],
    });
  }
  options.sort((x, y) => x.dep - y.dep);
  return { options, warnings };
}

export async function overgroundOptions(src) {
  const warnings = [];
  const L = CONFIG.lines.overground;
  let atCW;
  try {
    atCW = await src.stopArrivals(S.canadaWaterOverground);
  } catch (e) {
    warnings.push(`Live Overground times unavailable (${e.message}); using Journey Planner.`);
    return { ...(await jpOptions(src, S.canadaWaterOverground, S.westCroydonRail, 'overground', /./)), warnings, fallback: true };
  }
  let atWCY = [];
  let statusRows = [];
  try { atWCY = await src.stopArrivals(S.westCroydonRail); } catch { /* run time */ }
  try { statusRows = await src.arrivalDepartures(S.canadaWaterOverground, L); } catch { /* optional */ }

  const run = CONFIG.fallbackRunMinutes.canadaWaterToWestCroydon;
  const toWCY = statusRows.filter((r) => r.destinationNaptanId === S.westCroydonRail);
  for (const r of toWCY) {
    if (/cancel/i.test(r.departureStatus || '')) {
      warnings.push(`Overground ${fmt(new Date(r.scheduledTimeOfDeparture))} Canada Water → West Croydon is cancelled.`);
    }
  }

  const options = [];
  for (const a of atCW || []) {
    if (a.lineId !== L || a.destinationNaptanId !== S.westCroydonRail) continue;
    const dep = new Date(a.expectedArrival);
    const match = (atWCY || []).find((b) => b.vehicleId === a.vehicleId && b.lineId === L && new Date(b.expectedArrival) > dep);
    const row = toWCY.find((r) => Math.abs(new Date(r.estimatedTimeOfDeparture) - dep) < 1.5 * MIN);
    const cancelled = row ? /cancel/i.test(row.departureStatus || '') : false;
    const notes = [];
    let status = row?.departureStatus || '';
    if (row && row.scheduledTimeOfDeparture !== row.estimatedTimeOfDeparture) {
      const late = Math.round((new Date(row.estimatedTimeOfDeparture) - new Date(row.scheduledTimeOfDeparture)) / MIN);
      if (late > 0) { status = `${late} min late`; notes.push(`Scheduled ${fmt(new Date(row.scheduledTimeOfDeparture))}`); }
    }
    options.push({
      dep,
      arr: match ? new Date(match.expectedArrival) : addMin(dep, run),
      depLive: true,
      arrLive: Boolean(match),
      platform: (String(a.platformName || '').match(/(\w+)\s*$/) || [])[1] || '',
      destination: cleanName(a.destinationName),
      status,
      cancelled,
      notes,
    });
  }
  options.sort((x, y) => x.dep - y.dep);
  return { options, warnings };
}

// Darwin JSON is camelCase on RDM/Huxley2; accept PascalCase too.
const g = (o, k) => (o ? (o[k] ?? o[k[0].toUpperCase() + k.slice(1)]) : undefined);

export function parseRailBoard(board, toCrs, ref) {
  const options = [];
  const warnings = [];
  for (const m of g(board, 'nrccMessages') || []) {
    const text = String(g(m, 'value') ?? g(m, 'xhtmlMessage') ?? m ?? '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) warnings.push(`National Rail: ${text}`);
  }
  for (const svc of g(board, 'trainServices') || []) {
    const std = parseHHMM(g(svc, 'std'), ref);
    if (!std) continue;
    const etdRaw = String(g(svc, 'etd') || '');
    const etd = parseHHMM(etdRaw, ref);
    const cps = (g(svc, 'subsequentCallingPoints') || []).flatMap((l) => g(l, 'callingPoint') || []);
    const cp = cps.find((c) => g(c, 'crs') === toCrs);
    if (!cp) continue; // must call at the target
    const st = parseHHMM(g(cp, 'st'), ref);
    const etRaw = String(g(cp, 'et') || g(cp, 'at') || '');
    const et = parseHHMM(etRaw, ref);
    const cancelled = Boolean(g(svc, 'isCancelled')) || /cancel/i.test(etdRaw) || Boolean(g(cp, 'isCancelled')) || /cancel/i.test(etRaw);
    const dep = etd || std;
    let arr = et || st;
    const notes = [];
    let status = etdRaw;
    if (etd) {
      const late = Math.round((etd - std) / MIN);
      status = late > 0 ? `${late} min late` : 'On time';
      if (late > 0) notes.push(`Scheduled ${fmt(std)}`);
      if (!et && st && late > 0) arr = addMin(st, late);
    } else if (/delayed/i.test(etdRaw)) {
      notes.push('Delayed, no estimate yet');
    }
    const reason = g(svc, 'cancelReason') || g(svc, 'delayReason');
    if (reason) notes.push(String(reason));
    const dest = (g(svc, 'destination') || []).map((d) => g(d, 'locationName')).join(' & ');
    options.push({
      dep, arr, depLive: true, arrLive: true,
      platform: g(svc, 'platform') || '',
      destination: dest,
      status, cancelled, notes,
      std,
    });
    if (cancelled) warnings.push(`Southern ${fmt(std)} to ${dest} is cancelled${reason ? ': ' + reason : ''}.`);
  }
  options.sort((x, y) => x.dep - y.dep);
  return { options, warnings };
}

export async function railOptions(src, fromCrs, fromStop, live) {
  const toCrs = CONFIG.crs.carshaltonBeeches;
  const warnings = [];
  if (live) {
    try {
      const board = await src.railBoard(fromCrs, toCrs);
      const r = parseRailBoard(board, toCrs, src.now);
      return { options: r.options, warnings: r.warnings, live: true };
    } catch (e) {
      warnings.push(`Live National Rail unavailable (${e.message}); showing scheduled Southern times.`);
    }
  }
  const r = await jpOptions(src, fromStop, S.carshaltonBeechesRail, 'national-rail', /southern/i);
  return { ...r, warnings: [...warnings, ...r.warnings], fallback: true };
}

// TfL Journey Planner (scheduled). Re-queried with the needed start time.
export async function jpOptions(src, from, to, mode, lineRe, when) {
  const options = [];
  const warnings = [];
  const t = when || src.now;
  let data;
  try {
    data = await src.journey(from, to, mode, t);
  } catch (e) {
    warnings.push(`Journey Planner unavailable (${e.message}).`);
    return { options, warnings, scheduled: true };
  }
  for (const j of data?.journeys || []) {
    const legs = (j.legs || []).filter((l) => l.mode?.id !== 'walking');
    if (legs.length !== 1) continue; // direct trains only
    const l = legs[0];
    const names = (l.routeOptions || []).map((r) => r.name).join(' ');
    if (!lineRe.test(names) && !lineRe.test(l.instruction?.summary || '')) continue;
    const dep = parseLondonLocal(l.departureTime);
    const arr = parseLondonLocal(l.arrivalTime);
    const sched = parseLondonLocal(l.scheduledDepartureTime);
    const notes = [];
    if (sched && dep && Math.abs(dep - sched) >= MIN) notes.push(`Timetabled ${fmt(sched)}`);
    for (const d of l.disruptions || []) {
      const txt = (d.description || '').trim();
      if (txt) warnings.push(txt);
    }
    options.push({
      dep, arr, depLive: false, arrLive: false,
      platform: l.departurePoint?.platformName || '',
      destination: cleanName((l.routeOptions?.[0]?.directions || [])[0] || ''),
      status: l.isDisrupted ? 'Disrupted' : '',
      cancelled: false,
      notes,
    });
  }
  options.sort((x, y) => x.dep - y.dep);
  return { options, warnings: [...new Set(warnings)], scheduled: true, refetch: (w) => jpOptions(src, from, to, mode, lineRe, w) };
}

// ------------------------------------------------------------------ //
//  Routes
// ------------------------------------------------------------------ //
export function routeDefs(railLive) {
  const IC = CONFIG.interchange;
  return [
    {
      id: 'A',
      name: 'Route A',
      via: 'via Canada Water & West Croydon',
      lines: ['jubilee', 'windrush', 'southern'],
      legs: [
        { line: 'jubilee', lineName: 'Jubilee', from: 'Stratford', to: 'Canada Water', walkAfter: IC.canadaWater, walkLabel: 'Change at Canada Water',
          get: (src, rt) => jubileeOptions(src, S.canadaWaterJubilee, rt) },
        { line: 'overground', lineName: 'Windrush line', from: 'Canada Water', to: 'West Croydon', walkAfter: IC.westCroydon, walkLabel: 'Change at West Croydon',
          get: (src) => overgroundOptions(src) },
        { line: 'rail', lineName: 'Southern', from: 'West Croydon', to: 'Carshalton Beeches',
          get: (src) => railOptions(src, CONFIG.crs.westCroydon, S.westCroydonRail, railLive) },
      ],
    },
    {
      id: 'B',
      name: 'Route B',
      via: 'via London Bridge',
      lines: ['jubilee', 'southern'],
      legs: [
        { line: 'jubilee', lineName: 'Jubilee', from: 'Stratford', to: 'London Bridge', walkAfter: IC.londonBridge, walkLabel: 'Change at London Bridge',
          get: (src, rt) => jubileeOptions(src, S.londonBridgeJubilee, rt) },
        { line: 'rail', lineName: 'Southern', from: 'London Bridge', to: 'Carshalton Beeches',
          get: (src) => railOptions(src, CONFIG.crs.londonBridge, S.londonBridgeRail, railLive) },
      ],
    },
  ];
}

function sourceLabel(o, scheduled) {
  if (scheduled) return 'SCHEDULED';
  if (o.depLive && o.arrLive) return 'LIVE';
  return 'EST';
}

// Pick the first usable option leaving at/after `ready`.
async function pick(result, ready) {
  let opt = result.options.find((o) => !o.cancelled && o.dep && o.arr && o.dep >= ready);
  // Journey Planner only returns ~3 journeys: ask again from `ready`.
  if (!opt && result.refetch) {
    const again = await result.refetch(ready);
    opt = again.options.find((o) => !o.cancelled && o.dep && o.arr && o.dep >= ready);
  }
  return opt || null;
}

// Chain one journey starting no earlier than `start`.
export async function chain(route, legResults, start, walkStart) {
  const steps = [];
  let ready = start;
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    const res = legResults[i];
    const opt = await pick(res, ready);
    if (!opt) {
      return { complete: false, steps, failedLeg: leg, ready };
    }
    const slack = (opt.dep - ready) / MIN;
    steps.push({
      leg,
      option: opt,
      source: sourceLabel(opt, res.scheduled),
      slackBefore: i === 0 ? (opt.dep - walkStart) / MIN : slack,
    });
    ready = leg.walkAfter ? addMin(opt.arr, leg.walkAfter) : opt.arr;
  }
  return { complete: true, steps, arrival: steps[steps.length - 1].option.arr };
}

// Plan a route: best journey + "next option if you miss it".
export async function planRoute(route, src, { pressTime, now, runTimes }) {
  const walk = CONFIG.walk.stratfordToJubileePlatform;
  const start = new Date(Math.max(addMin(pressTime, walk).getTime(), now.getTime()));
  const legResults = await Promise.all(route.legs.map((l) => l.get(src, runTimes)));
  const warnings = legResults.flatMap((r) => r.warnings || []);
  const best = await chain(route, legResults, start, start);

  let next = null;
  if (best.complete) {
    // Miss any train -> try later first trains until home time changes.
    let s = new Date(best.steps[0].option.dep.getTime() + 1000);
    for (let tries = 0; tries < 5; tries++) {
      const c = await chain(route, legResults, s, s);
      if (!c.complete) break;
      if (c.arrival > best.arrival) { next = c; break; }
      s = new Date(c.steps[0].option.dep.getTime() + 1000);
    }
  }
  return {
    route,
    best,
    next,
    start,
    warnings: [...new Set(warnings)],
    anyScheduled: legResults.some((r) => r.scheduled),
  };
}

export function statusWarnings(statusData, route) {
  const want = route.lines;
  const out = [];
  for (const line of statusData || []) {
    if (!want.includes(line.id)) continue;
    for (const s of line.lineStatuses || []) {
      if (s.statusSeverity === 10) continue; // Good Service
      const reason = (s.reason || '').trim();
      out.push({ line: line.id, text: `${line.name}: ${s.statusSeverityDescription}${reason ? ' – ' + reason.replace(/^[^:]*:\s*/, '') : ''}` });
    }
  }
  return out;
}

export async function planAll(api, { pressTime, now = new Date() }) {
  const src = new Sources(api, now);
  const railLive = api.railLiveConfigured();
  const [runTimes, status] = await Promise.all([
    jubileeRunTimes(api),
    src.lineStatus().catch(() => null),
  ]);
  const routes = routeDefs(railLive);
  const plans = await Promise.all(routes.map((r) => planRoute(r, src, { pressTime, now, runTimes }).catch((e) => ({
    route: r, best: { complete: false, steps: [] }, next: null, warnings: [`Planning failed: ${e.message}`], error: e,
  }))));
  for (const p of plans) p.status = statusWarnings(status, p.route);
  return { plans, now, pressTime, runTimes, railLive, statusOk: Boolean(status), errors: src.errors };
}
