// Time helpers. Everything is shown in London time, whatever the device
// timezone is.
const TZ = 'Europe/London';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hmsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export const MIN = 60000;

export function londonParts(date) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function offsetMinutes(date) {
  const p = londonParts(date);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000) / MIN;
}

// Build a Date from a London wall-clock time.
export function fromLondon(y, mo, d, h, mi, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - offsetMinutes(new Date(guess)) * MIN;
  // Second pass handles the hour around a clock change.
  t = guess - offsetMinutes(new Date(t)) * MIN;
  return new Date(t);
}

// "2026-11-06T16:55:00" (TfL Journey Planner, London local, no zone).
export function parseLondonLocal(str) {
  if (!str) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(str)) return new Date(str);
  const m = str.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);
  if (!m) return null;
  return fromLondon(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
}

// "16:55" (Darwin) -> the Date nearest to `ref`.
export function parseHHMM(hhmm, ref) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const p = londonParts(ref);
  let d = fromLondon(p.y, p.mo, p.d, +m[1], +m[2]);
  const diff = d - ref;
  if (diff < -12 * 60 * MIN) d = new Date(d.getTime() + 24 * 60 * MIN);
  else if (diff > 12 * 60 * MIN) d = new Date(d.getTime() - 24 * 60 * MIN);
  return d;
}

export const fmt = (d) => (d ? hmFmt.format(d) : '--:--');
export const fmtSec = (d) => (d ? hmsFmt.format(d) : '--:--:--');

// For the TfL Journey Planner date/time parameters.
export function jpDateTime(d) {
  const p = londonParts(d);
  const z = (n) => String(n).padStart(2, '0');
  return { date: `${p.y}${z(p.mo)}${z(p.d)}`, time: `${z(p.h)}${z(p.mi)}` };
}

export const minutesBetween = (a, b) => (b - a) / MIN;
export const addMin = (d, m) => new Date(d.getTime() + m * MIN);
