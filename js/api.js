// Network layer: fetch wrappers, settings (localStorage) and a raw
// response log used by the debug panel.
import { CONFIG } from './config.js';

// ---------------- Settings (stored only in this browser) --------------
const SETTINGS_KEY = 'homeRoute.settings.v1';
const DEFAULT_SETTINGS = {
  rdmKey: '',      // Rail Data Marketplace consumer key (free)
  tflAppKey: '',   // optional TfL app_key (free, raises rate limit)
  huxleyBase: '',  // optional self-hosted Huxley2 URL (alternative to RDM)
  huxleyToken: '', // optional Darwin token for that Huxley2 server
  debug: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// ---------------- Raw response log -----------------------------------
export const rawLog = [];
const MAX_BODY = 40000;

function redact(url) {
  return url.replace(/(app_key|accessToken)=[^&]+/gi, '$1=***');
}

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false, url = '' } = {}) {
    super(message);
    this.status = status;
    this.offline = offline;
    this.url = url;
  }
}

async function fetchJson(label, url, { headers = {}, timeoutMs = 12000 } = {}) {
  const started = performance.now();
  const entry = { label, url: redact(url), time: new Date(), status: 0, ms: 0, body: '' };
  rawLog.push(entry);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    entry.status = res.status;
    entry.ms = Math.round(performance.now() - started);
    entry.body = text.length > MAX_BODY ? text.slice(0, MAX_BODY) + '\n…(truncated)' : text;
    if (!res.ok) {
      throw new ApiError(`${label}: HTTP ${res.status}`, { status: res.status, url });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError(`${label}: response was not JSON`, { status: res.status, url });
    }
  } catch (e) {
    entry.ms = Math.round(performance.now() - started);
    if (e instanceof ApiError) {
      entry.error = e.message;
      throw e;
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const msg = e.name === 'AbortError' ? `${label}: timed out` : `${label}: network error (${e.message})`;
    entry.error = msg;
    throw new ApiError(msg, { offline, url });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- TfL -------------------------------------------------
function tflUrl(path, params = {}) {
  const s = loadSettings();
  const u = new URL(CONFIG.tflBase + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  if (s.tflAppKey) u.searchParams.set('app_key', s.tflAppKey);
  return u.toString();
}

export const tfl = {
  lineArrivals: (line, stopId) =>
    fetchJson(`TfL ${line} arrivals @ ${stopId}`, tflUrl(`/Line/${line}/Arrivals/${stopId}`)),
  stopArrivals: (stopId) =>
    fetchJson(`TfL arrivals @ ${stopId}`, tflUrl(`/StopPoint/${stopId}/Arrivals`)),
  arrivalDepartures: (stopId, lineIds) =>
    fetchJson(`TfL arr/dep @ ${stopId}`, tflUrl(`/StopPoint/${stopId}/ArrivalDepartures`, { lineIds })),
  lineStatus: (lines) =>
    fetchJson('TfL line status', tflUrl(`/Line/${lines.join(',')}/Status`)),
  timetable: (line, stopId, direction) =>
    fetchJson(`TfL ${line} timetable @ ${stopId}`, tflUrl(`/Line/${line}/Timetable/${stopId}`, { direction })),
  journey: (from, to, params) =>
    fetchJson(`TfL journey ${from}→${to}${params.via ? ' via ' + params.via : ''}`,
      tflUrl(`/Journey/JourneyResults/${from}/to/${to}`, params)),
  stopSearch: (q, modes) =>
    fetchJson(`TfL search "${q}"`, tflUrl(`/StopPoint/Search/${encodeURIComponent(q)}`, { modes })),
};

// ---------------- National Rail (Darwin via RDM or Huxley2) ----------
export function railLiveConfigured() {
  const s = loadSettings();
  return Boolean(s.rdmKey || s.huxleyBase);
}

// Returns a Darwin departure board (with calling points) of trains from
// `crs` that call at `toCrs`.
export function railBoard(crs, toCrs) {
  const s = loadSettings();
  if (s.huxleyBase) {
    const base = s.huxleyBase.replace(/\/+$/, '');
    const u = new URL(`${base}/departures/${crs}/to/${toCrs}/10`);
    u.searchParams.set('expand', 'true');
    u.searchParams.set('timeWindow', '120');
    if (s.huxleyToken) u.searchParams.set('accessToken', s.huxleyToken);
    return fetchJson(`Rail board ${crs}→${toCrs} (Huxley2)`, u.toString());
  }
  if (!s.rdmKey) {
    return Promise.reject(new ApiError('No National Rail key set'));
  }
  const u = new URL(`${CONFIG.rdmBase}/GetDepBoardWithDetails/${crs}`);
  u.searchParams.set('numRows', '10');
  u.searchParams.set('filterCrs', toCrs);
  u.searchParams.set('filterType', 'to');
  u.searchParams.set('timeOffset', '0');
  u.searchParams.set('timeWindow', '120');
  return fetchJson(`Rail board ${crs}→${toCrs} (RDM)`, u.toString(), {
    headers: { 'x-apikey': s.rdmKey },
  });
}
