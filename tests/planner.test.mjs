// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { planAll, parseRailBoard, _resetRunTimeCache } from '../js/planner.js';
import { parseHHMM, fmt, fromLondon } from '../js/time.js';
import { CONFIG } from '../js/config.js';

const S = CONFIG.stops;
// 6 Nov 2026 is GMT, so London time == UTC.
const T = (hm) => `2026-11-06T${hm}:00Z`;
const D = (hm) => new Date(T(hm));

function jub(vehicleId, stop, hm, dest = '940GZZLUSTM', plat = 'Westbound - Platform 14') {
  return { id: `${vehicleId}-${stop}-${hm}`, vehicleId, naptanId: stop, platformName: plat, direction: 'inbound',
    destinationNaptanId: dest, destinationName: 'Stanmore Underground Station', expectedArrival: T(hm), currentLocation: '' };
}
function og(vehicleId, stop, hm, dest = S.westCroydonRail) {
  return { vehicleId, lineId: 'windrush', naptanId: stop, platformName: 'Platform 3', destinationNaptanId: dest,
    destinationName: 'West Croydon Rail Station', expectedArrival: T(hm) };
}
function svc(std, csbSt, { etd = 'On time', et = 'On time', platform = '2', cancelled = false, callsCSB = true } = {}) {
  return {
    std, etd, platform, isCancelled: cancelled, serviceID: std,
    destination: [{ locationName: 'Epsom', crs: 'EPS' }],
    subsequentCallingPoints: [{ callingPoint: [
      { locationName: 'Norwood Junction', crs: 'NWD', st: '00:00', et: 'On time' },
      ...(callsCSB ? [{ locationName: 'Carshalton Beeches', crs: 'CSB', st: csbSt, et }] : []),
    ] }],
  };
}

function mockApi({ stratford, cwr = [], lnb = [], cwOg = [], wcyOg = [], ad = [], boards = {}, rail = true, journeys = {}, status = [] }) {
  return {
    tfl: {
      lineArrivals: async (line, stop) => ({ [S.stratfordJubilee]: stratford, [S.canadaWaterJubilee]: cwr, [S.londonBridgeJubilee]: lnb }[stop]),
      stopArrivals: async (stop) => ({ [S.canadaWaterOverground]: cwOg, [S.westCroydonRail]: wcyOg }[stop]),
      arrivalDepartures: async () => ad,
      lineStatus: async () => status,
      timetable: async () => { throw new Error('no timetable'); },
      journey: async (from, to, p) => {
        const fn = journeys[`${from}>${to}`];
        if (!fn) throw new Error('no journey');
        return fn(p);
      },
    },
    railBoard: async (crs) => { if (!boards[crs]) throw Object.assign(new Error('board down'), { status: 500 }); return boards[crs]; },
    railLiveConfigured: () => rail,
  };
}

const base = () => ({
  stratford: [
    jub('101', S.stratfordJubilee, '16:00'),
    jub('102', S.stratfordJubilee, '16:04'),
    jub('103', S.stratfordJubilee, '16:08'),
  ],
  cwr: [jub('101', S.canadaWaterJubilee, '16:11', undefined, 'Westbound - Platform 1'), jub('102', S.canadaWaterJubilee, '16:15', undefined, 'Westbound - Platform 1')],
  lnb: [jub('101', S.londonBridgeJubilee, '16:15', undefined, 'Westbound - Platform 3')],
  cwOg: [og('A1', S.canadaWaterOverground, '16:14'), og('A2', S.canadaWaterOverground, '16:16'), og('A3', S.canadaWaterOverground, '16:31'),
    og('X1', S.canadaWaterOverground, '16:20', '910GCRYSTLP')],
  wcyOg: [og('A1', S.westCroydonRail, '16:45'), og('A2', S.westCroydonRail, '16:47')],
  boards: {
    LBG: { trainServices: [svc('16:20', '16:49'), svc('16:27', '16:56'), svc('16:57', '17:26')] },
    WCY: { trainServices: [svc('16:50', '16:59'), svc('16:53', '17:02', { callsCSB: false }), svc('17:04', '17:13')] },
  },
});

test('Route B chains Jubilee → London Bridge → Southern, skipping too-tight trains', async () => {
  _resetRunTimeCache();
  const r = await planAll(mockApi(base()), { pressTime: D('15:57'), now: D('15:57') });
  const B = r.plans.find((p) => p.route.id === 'B');
  assert.ok(B.best.complete);
  const [j, s] = B.best.steps;
  assert.equal(fmt(j.option.dep), '16:00');
  assert.equal(fmt(j.option.arr), '16:15');
  assert.equal(j.source, 'LIVE');
  // ready 16:25 → 16:20 impossible, 16:27 OK with 2 min slack
  assert.equal(fmt(s.option.dep), '16:27');
  assert.equal(Math.round(s.slackBefore), 2);
  assert.equal(fmt(B.best.arrival), '16:56');
  assert.equal(fmt(B.next.arrival), '17:26');
});

test('Route A rolls forward past an Overground train that is too tight', async () => {
  _resetRunTimeCache();
  const r = await planAll(mockApi(base()), { pressTime: D('15:57'), now: D('15:57') });
  const A = r.plans.find((p) => p.route.id === 'A');
  assert.ok(A.best.complete);
  const [j, o, s] = A.best.steps;
  assert.equal(fmt(j.option.arr), '16:11');      // live match at Canada Water
  assert.equal(fmt(o.option.dep), '16:16');      // 16:14 < 16:15 ready
  assert.equal(o.source, 'LIVE');
  assert.equal(fmt(o.option.arr), '16:47');
  // ready 16:51; 16:50 too early, 16:53 doesn't call at CSB → 17:04
  assert.equal(fmt(s.option.dep), '17:04');
  assert.equal(fmt(A.best.arrival), '17:13');
});

test('walk time from press: a train leaving 1 min after pressing is not offered', async () => {
  _resetRunTimeCache();
  const r = await planAll(mockApi(base()), { pressTime: D('15:59'), now: D('15:59') });
  const B = r.plans.find((p) => p.route.id === 'B');
  assert.equal(fmt(B.best.steps[0].option.dep), '16:04');
  assert.equal(B.best.steps[0].source, 'EST'); // no live match at LNB → run time
  assert.equal(fmt(B.best.steps[0].option.arr), '16:19');
});

test('terminating trains depart after the turnaround; short trains are excluded', async () => {
  _resetRunTimeCache();
  const d = base();
  d.stratford = [
    jub('201', S.stratfordJubilee, '16:00', S.stratfordJubilee, 'Westbound - Platform 13'),
    jub('201', S.stratfordJubilee, '16:00', S.stratfordJubilee, 'Westbound - Platform 14'),
    jub('202', S.stratfordJubilee, '15:59', '940GZZLUNGW'), // North Greenwich only
  ];
  const r = await planAll(mockApi(d), { pressTime: D('15:57'), now: D('15:57') });
  const B = r.plans.find((p) => p.route.id === 'B');
  assert.equal(fmt(B.best.steps[0].option.dep), '16:02');
  assert.equal(B.best.steps[0].option.platform, '13/14');
});

test('cancelled Southern trains are skipped and reported', async () => {
  _resetRunTimeCache();
  const d = base();
  d.boards.LBG.trainServices[1] = svc('16:27', '16:56', { etd: 'Cancelled', cancelled: true });
  const r = await planAll(mockApi(d), { pressTime: D('15:57'), now: D('15:57') });
  const B = r.plans.find((p) => p.route.id === 'B');
  assert.equal(fmt(B.best.steps[1].option.dep), '16:57');
  assert.ok(B.warnings.some((w) => /cancelled/.test(w)));
});

test('no rail key: Southern legs fall back to Journey Planner (SCHEDULED) and refetch later', async () => {
  _resetRunTimeCache();
  const d = base();
  d.rail = false;
  const calls = [];
  const jp = (deps) => (p) => {
    calls.push(p.time);
    return { journeys: deps.filter(([dep]) => dep.replace(':', '') >= p.time).slice(0, 3).map(([dep, arr]) => ({
      legs: [{ mode: { id: 'national-rail' }, routeOptions: [{ name: 'Southern', directions: ['Epsom Rail Station'] }],
        instruction: { summary: 'Southern to Carshalton Beeches' }, departureTime: `2026-11-06T${dep}:00`, arrivalTime: `2026-11-06T${arr}:00`,
        scheduledDepartureTime: `2026-11-06T${dep}:00`, departurePoint: { platformName: '' }, disruptions: [] }],
    })) };
  };
  d.journeys = {
    [`${S.londonBridgeRail}>${S.carshaltonBeechesRail}`]: jp([['15:58', '16:27'], ['16:05', '16:34'], ['16:12', '16:41'], ['16:28', '16:57']]),
    [`${S.westCroydonRail}>${S.carshaltonBeechesRail}`]: jp([['16:10', '16:19'], ['16:55', '17:04']]),
  };
  const r = await planAll(mockApi(d), { pressTime: D('15:57'), now: D('15:57') });
  const B = r.plans.find((p) => p.route.id === 'B');
  assert.equal(B.best.steps[1].source, 'SCHEDULED');
  assert.equal(fmt(B.best.steps[1].option.dep), '16:28');
  assert.ok(calls.includes('1625'));
});

test('Darwin board parsing: delays, missing estimates, other destinations', () => {
  const ref = D('16:00');
  const b = { trainServices: [
    svc('16:10', '16:39', { etd: '16:14', et: '16:43' }),
    svc('16:20', '16:49', { etd: 'Delayed', et: 'Delayed' }),
    svc('16:30', '16:59', { etd: '16:33', et: 'On time' }),
    svc('16:40', '17:09', { callsCSB: false }),
  ], nrccMessages: [{ value: '<p>Disruption at <b>Norwood</b></p>' }] };
  const r = parseRailBoard(b, 'CSB', ref);
  assert.equal(r.options.length, 3);
  assert.equal(fmt(r.options[0].dep), '16:14');
  assert.equal(fmt(r.options[0].arr), '16:43');
  assert.equal(r.options[0].status, '4 min late');
  assert.ok(r.options[1].notes.includes('Delayed, no estimate yet'));
  assert.equal(fmt(r.options[2].arr), '17:02'); // st + lateness when et says "On time"
  assert.equal(r.warnings[0], 'National Rail: Disruption at Norwood');
});

test('HH:MM parsing wraps around midnight and handles BST', () => {
  const late = new Date('2026-11-06T23:50:00Z');
  assert.equal(parseHHMM('00:10', late).toISOString(), '2026-11-07T00:10:00.000Z');
  const summer = new Date('2026-07-01T17:00:00Z'); // 18:00 BST
  assert.equal(parseHHMM('18:30', summer).toISOString(), '2026-07-01T17:30:00.000Z');
  assert.equal(fromLondon(2026, 7, 1, 18, 30).toISOString(), '2026-07-01T17:30:00.000Z');
});

test('both routes always returned, even when one has no data', async () => {
  _resetRunTimeCache();
  const d = base();
  d.cwOg = [];
  const r = await planAll(mockApi(d), { pressTime: D('15:57'), now: D('15:57') });
  assert.equal(r.plans.length, 2);
  const A = r.plans.find((p) => p.route.id === 'A');
  assert.equal(A.best.complete, false);
  assert.equal(A.best.failedLeg.lineName, 'Windrush line');
});
