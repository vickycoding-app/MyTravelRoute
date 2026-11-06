# Home Route

A small mobile web app. Press one big button at Stratford Underground station and it shows live, side-by-side times for the only two routes home to **Carshalton Beeches**, with the fastest one highlighted.

| | Route |
|---|---|
| **A** | Stratford → Canada Water (Jubilee) → West Croydon (Overground, Windrush line) → Carshalton Beeches (Southern) |
| **B** | Stratford → London Bridge (Jubilee) → Carshalton Beeches (Southern, from the National Rail platforms) |

No other routes are ever shown, even if an API suggests a faster one.

Live site: **https://vickycoding-app.github.io/MyTravelRoute/**

## Using it

1. Open the site on your phone. In Safari tap **Share → Add to Home Screen** (in Chrome: **⋮ → Add to Home screen / Install app**). It then opens like an app.
2. At Stratford, tap **Get me home**.
3. The top card says which route gets you home first and by how much. Each route card shows:
   - home time and total journey time
   - every leg, with times, platform, the train's destination and a **LIVE / EST / SCHEDULED** badge
   - each change, with the walk time and the spare minutes before the next train. Under 2 minutes spare is shown in **red**.
   - delays, cancellations and line-status warnings
   - "Miss it?": the next option if you miss this one
4. The page refreshes itself every 30 seconds while it's open. You can also tap **Refresh**.

### What the badges mean

| Badge | Meaning |
|---|---|
| **LIVE** | Departure and arrival both come from live predictions (TfL, or National Rail Darwin). |
| **EST** | Live departure, plus the TfL timetable's run time, because the same train couldn't be matched further down the line yet. |
| **SCHEDULED** | Timetable only (TfL Journey Planner). It doesn't know about delays, so trust it less. |

## How the routing works

For each route the legs are chained in order (`js/planner.js`):

1. **Jubilee at Stratford.** The app reads live westbound predictions (`/Line/jubilee/Arrivals/940GZZLUSTD`) and takes the first train you can catch at *button press + 2 min walk*. Stratford is the terminus, so a train shown as "arriving, destination Stratford" is counted as leaving westbound 2 minutes after it arrives (`stratfordTurnaroundMinutes`). Trains that terminate before your interchange are ignored.
2. **Arrival at the interchange.** It looks for *the same train* (TfL `vehicleId`) in the live predictions at Canada Water or London Bridge. If the train is found, the leg is LIVE. If not, the run time comes from the TfL Jubilee timetable (Stratford→Canada Water 11 min, →London Bridge 15 min), and the leg is EST.
3. **Change.** It adds the walk time, then picks the first connecting train that leaves **at or after** that moment *and* calls at the next stop:
   - Canada Water Overground: only trains whose destination is West Croydon (Crystal Palace, Clapham Junction and New Cross trains are skipped). The arrival at West Croydon comes from matching the same train in West Croydon's live predictions.
   - Southern from West Croydon or London Bridge: only services whose calling points include Carshalton Beeches (CSB). Cancelled trains are skipped.
4. It repeats until arrival at Carshalton Beeches. A connection is never shown if the walk makes it impossible; the next valid train is used instead.
5. **Miss it?** The app re-runs the chain from the next Jubilee train until the home time changes.

If both routes get you home at the same minute, Route B (fewer changes) is marked fastest.

## Changing interchange times

Everything you might want to tweak is in **`js/config.js`**:

```js
walk: { stratfordToJubileePlatform: 2 },
interchange: {
  canadaWater: 4,   // Jubilee -> Overground
  westCroydon: 4,   // Overground -> National Rail platform
  londonBridge: 10, // Jubilee -> National Rail platforms (measured)
},
tightSlackMinutes: 2,
```

To change these from your phone:

1. Open the repo on github.com and tap **js** → **config.js**.
2. Tap the **pencil icon** (Edit). In the mobile app you may need **⋯ → Edit file**, or switch to the desktop site.
3. Change the number, then tap **Commit changes…** → **Commit changes** (on the `main` branch).
4. In about 1 minute the site redeploys (see the **Actions** tab). Reload the app.

## Data sources (researched 6 Nov 2026)

| Data | Source | Key? |
|---|---|---|
| Jubilee and Overground live times | TfL Unified API: `Line/{line}/Arrivals`, `StopPoint/{id}/Arrivals`, `StopPoint/{id}/ArrivalDepartures` | No (optional free TfL key) |
| Jubilee run times | TfL `Line/jubilee/Timetable/940GZZLUSTD?direction=inbound` | No |
| Line status | TfL `Line/jubilee,windrush,southern/Status` | No |
| **Southern live times** | **Rail Data Marketplace, "Live Departure Board" (National Rail Darwin)** | **Yes, free** |
| Fallback timetable times | TfL Journey Planner `Journey/JourneyResults` (direct trains only) | No |

### Why Rail Data Marketplace for Southern

TfL's arrivals endpoints don't cover Southern: they return `[]` for Carshalton Beeches and reject `lineIds=southern`. Options tested from a browser:

- **Huxley2 public demo (`huxley2.azurewebsites.net`).** The repo was archived in March 2026, and every departures call now returns HTTP 500. Not usable. You can still point the app at your own Huxley2 server under *Settings → Advanced*.
- **Realtime Trains API.** Needs a username and password, and isn't designed for calls straight from a browser (no CORS), so it would expose credentials. Not used.
- **Rail Data Marketplace (RDM).** This is National Rail's official free portal for Darwin. Its Live Departure Board REST/JSON API **sends CORS headers that allow GitHub Pages** (checked: `access-control-allow-origin` echoes the site and allows the `x-apikey` header). The key is free, personal and read-only. **Chosen.**

The key is pasted into the app's **Settings** (⚙) and stored only in your browser's `localStorage`. It is never committed to this repo. Anyone using your phone's browser could read it, but it only gives free, read-only train times.

Without a key the app still works: Southern legs show **SCHEDULED** times from the TfL Journey Planner.

### Getting the free Rail Data Marketplace key

1. Go to **https://raildata.org.uk** and tap **Register**. Create a free account and confirm your email.
2. Sign in, open the **Data products** catalogue and search for **"Live Departure Board"** (National Rail / Darwin, the "with details" version used by `GetDepBoardWithDetails`).
3. Tap **Subscribe**. It's free; accept the licence.
4. Go to **My subscriptions**, open the product and find the **Consumer key** (sometimes labelled API key). Copy it.
5. In Home Route tap **⚙ Settings**, paste it into **Rail Data Marketplace key**, then tap **Test rail key**. It should say "Works. London Bridge: N train(s)…". Tap **Save**.

If the test says 401, the key is wrong or isn't subscribed to that product. If the product's URL ever changes, update `rdmBase` in `js/config.js`.

### Verified IDs (TfL StopPoint search, 6 Nov 2026)

| Place | ID |
|---|---|
| Stratford Underground | `940GZZLUSTD` |
| Canada Water Underground / Rail (Windrush) | `940GZZLUCWR` / `910GCNDAW` |
| West Croydon Rail | `910GWCROYDN` |
| London Bridge Underground / Rail | `940GZZLULNB` / `910GLNDNBDC` |
| Carshalton Beeches Rail | `910GCRSHLTB` |
| CRS codes | CSB, LBG, WCY (all confirmed) |
| TfL line IDs | `jubilee`, `windrush`, `southern` |

## Debugging from your phone

- **⚙ Settings → Show raw API responses** adds a list under the results with every API call made in the last refresh: status, timing and the raw JSON (keys hidden).
- **`debug.html`** (link at the bottom of that list, or `/MyTravelRoute/debug.html`) has one button per data source, including a whole-route Journey Planner check using `via`.

## Project layout

```
index.html            app page
debug.html            raw API test page
css/style.css         styles (light/dark, TfL colours)
js/config.js          ← times and IDs you may want to edit
js/planner.js         routing logic
js/api.js             API calls, settings, raw log
js/time.js            London-time helpers
js/app.js             UI
sw.js, manifest.webmanifest, icons/   PWA bits
tests/                planner tests (run in CI before every deploy)
.github/workflows/pages.yml           deploys to GitHub Pages on push to main
```

There's no build step. Plain HTML, CSS and ES modules.

## Known limitations

- **Stratford platform/turnaround.** Trains that start at Stratford appear in TfL data as *arriving* trains, often listed on several platforms at once. The departure time is arrival + 2 min, which is an estimate. Watch the departure boards.
- **EST arrivals.** If the same Jubilee train can't be found in the downstream predictions yet (common for trains still turning round), the timetable run time is used.
- **Overground cancellations.** These are taken from TfL's `ArrivalDepartures` status. A cancelled train usually disappears from predictions, and a warning is shown when TfL reports it.
- **Without a Rail Data Marketplace key,** Southern times are timetable only and won't reflect delays.
- **Darwin boards cover the next 2 hours.** Late at night, or with a very long wait, the app falls back to scheduled times or shows "no trains".
- **Journey Planner returns only about 3 options per request.** The app re-asks from the time it needs, so it can make a few extra calls.
- **Clock.** Times use your phone's clock and are shown in London time.
- **Rate limits.** TfL allows about 50 anonymous calls a minute. One refresh uses about 10. An optional free TfL key (Settings) raises the limit.
