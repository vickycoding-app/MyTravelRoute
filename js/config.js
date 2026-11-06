// =====================================================================
//  Home Route: settings you might want to change.
//  Edit this file on GitHub (pencil icon) and commit; the site redeploys.
//  All times are in MINUTES.
// =====================================================================

export const CONFIG = {
  // ---- Walking / interchange times (minutes) -------------------------
  walk: {
    stratfordToJubileePlatform: 2, // after you press the button
  },
  interchange: {
    canadaWater: 4,   // Jubilee -> Overground (Windrush line)
    westCroydon: 4,   // Overground -> National Rail platform
    londonBridge: 10, // Jubilee -> National Rail platforms (measured)
  },

  // Slack (spare minutes) below this is shown in red.
  tightSlackMinutes: 2,

  // Trains that terminate at Stratford wait about this long before
  // leaving westbound again.
  stratfordTurnaroundMinutes: 2,

  // Used when no live train match or timetable is available.
  fallbackRunMinutes: {
    stratfordToCanadaWater: 11,   // TfL timetable, Nov 2026
    stratfordToLondonBridge: 15,  // TfL timetable, Nov 2026
    canadaWaterToWestCroydon: 31, // matched live Windrush trains, Nov 2026
  },

  autoRefreshSeconds: 30,
  // After you press the big button, the walk is counted from that press
  // for this long. After that, it's counted from "now" again.
  pressValidMinutes: 15,

  // ---- IDs (checked against TfL StopPoint search, 6 Nov 2026) --------
  stops: {
    stratfordJubilee: '940GZZLUSTD',    // Stratford Underground Station
    canadaWaterJubilee: '940GZZLUCWR',  // Canada Water Underground Station
    canadaWaterOverground: '910GCNDAW', // Canada Water Rail Station (windrush)
    westCroydonRail: '910GWCROYDN',     // West Croydon Rail Station
    londonBridgeJubilee: '940GZZLULNB', // London Bridge Underground Station
    londonBridgeRail: '910GLNDNBDC',    // London Bridge Rail Station
    carshaltonBeechesRail: '910GCRSHLTB', // Carshalton Beeches Rail Station
  },
  // National Rail CRS codes (checked: CSB, LBG, WCY)
  crs: {
    londonBridge: 'LBG',
    westCroydon: 'WCY',
    carshaltonBeeches: 'CSB',
  },
  lines: {
    jubilee: 'jubilee',
    overground: 'windrush',
    southern: 'southern',
  },
  // Westbound Jubilee calling order from Stratford (to London Bridge).
  // Used to ignore any train that terminates before your interchange.
  jubileeWestboundOrder: [
    '940GZZLUSTD', '940GZZLUWHM', '940GZZLUCGT', '940GZZLUNGW',
    '940GZZLUCYF', '940GZZLUCWR', '940GZZLUBMY', '940GZZLULNB',
  ],

  // ---- APIs -----------------------------------------------------------
  tflBase: 'https://api.tfl.gov.uk',
  // Rail Data Marketplace "Live Departure Board" (needs your free key,
  // entered in the app's Settings panel, never stored in this repo).
  rdmBase: 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120',
};
