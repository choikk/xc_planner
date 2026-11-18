# XC Planner v2

XC Planner v2 is a React/Vite cross-country flight planning app for U.S. general aviation use. It centers on a home-base workflow: pick a departure airport, explore round-trip, triangle, or one-way (A to B) candidates on the map, filter by runway and airspace constraints, and generate printable trip summaries.

## What's New

- One-way (A to B) planning: choose the destination first, then build the route leg by leg with a min/max distance for every leg, any number of stops, Flip origin/destination, and the direct A-to-B distance next to the route distance
- Magnetic course (MC) for every leg (map labels colored by the FAA cruising altitude rule, popups, lists, and the Summary Report)
- Airport diagrams: FAA d-TPP first, AOPA image as a fallback, and both can be appended to the PDF report
- Summary Report on phones: the generated PDF is drawn page by page, with Open full PDF / Download links
- Min/max distance boxes always keep max >= min + 10 NM, show the unit, and use 10 NM steps
- Rebuilt the planner as a React/Vite app with a cleaner, faster v2 codebase
- Replaced the old bundled JSON-data workflow with a database-backed airport pipeline and an `/api/airport-data` endpoint
- Reworked the trip workflow so map candidates update immediately when filters or trip options change
- Added a more guided home-base-first planning flow for round trips, triangle trips, and one-way trips
- Added persistent home base selection in the same browser (changing the home base clears an A-to-B destination)
- Added better visual separation between selectable destinations, filtered-out airports, and airports just outside the max range (also in A to B)
- Improved mobile behavior and panel organization with dedicated Filters / Plan / Results sections
- Restored and upgraded the summary experience with PDF and text report views, route map snapshots, and linked instrument approaches
- Simplified the repository by removing old legacy frontend files that are no longer used in v2

## One-Way Trips (A to B)

Under Plan > Your Trip, the **A → B** mode plans a one-way route from the home base to a destination, with no return leg. The route is built in order:

1. **Choose the destination first.** The Origin card shows the home base. Set a minimum and maximum distance from it and click one of the airports that fit on the map (or in Results), then choose **Set as Destination**.
2. **Set the distance range of the next leg** (minimum and maximum NM), then click an airport on the map (or in Results). Every airport that passes the filters and lies inside the leg's range is drawn on the map and can be chosen. Results marks candidates from which B is reachable with the next leg and notes the ones that are farther from B than where you are now.
3. **Repeat for each leg.** Every leg has its own range (a new leg starts with the previous leg's limits), and you can add as many stops as you need.
4. **Finish adding stops** once B falls inside the current leg's range (button in the Plan tab, Results, or B's map popup); the last leg then goes straight to B.
- Changing a leg range, the filters, the home base, or the destination drops any stop that no longer fits. **Clear** removes a stop and everything after it.
- Each leg shows its **MC** (magnetic course) next to its distance, in the Plan/Results lists and in the Summary Report (preview, text, and PDF; also for round and triangle trips). The true course is taken at the middle of the leg and the variation comes from the World Magnetic Model (WMM2025, `magvar`) at that point.
- **Flip origin and destination** (shown once a destination is chosen) swaps the two **for this trip only**: the destination becomes the A-to-B origin and the old origin the destination, the route restarts from the new origin, and the home base (Home tab and the saved default) stays as it is. When the origin is not the home base, the Origin card shows the home base and **Use home base as origin** returns to it.
- Changing the home base in the Home tab clears the destination and the origin follows the new home base again.
- The direct A-to-B distance is shown on the Destination card and next to the route total, e.g. `Route 328.3 NM · Direct 327.6 NM (+0.2%)`.
- On the map each leg label shows the distance and the MC: green for 000-179 degrees, red for 180-359 degrees (odd or even thousands, +500 ft for VFR; IFR 14 CFR 91.179, VFR 14 CFR 91.159). The legend explains the colors.
- When the route is finished and every leg is within its range, **Summary Report** produces the same PDF/text report for the whole route. **Finish adding stops** is also offered next to Summary Report (bottom of the sidebar on desktop; top and bottom of the panel on phones) as soon as the destination is reachable.
- Results shows Sort by only while a candidate list is displayed; when nothing can be chosen, the map, Plan and Results explain why (for example, no airport in the leg's range passes the filters).

## Airport Diagrams

Airport diagrams come from the FAA d-TPP data (PDF). When an airport has none, the planner falls back to the AOPA diagram image
(`https://www.aopa.org/ustprocs/airportgraphics/gif/tn_<FAA id>_tif.gif`) if AOPA has one:

- The map popups, the summary preview, and the text report show an "Airport Diagram (AOPA)" link (existence is checked in the browser when needed).
- In the summary preview it can be ticked like the FAA diagram and plates; it is drawn at its original size. The GIF is fetched through the API (`/api/airport-data?plateUrl=...`,
  which only proxies that exact AOPA file pattern, plus FAA hosts), converted in the browser, and appended to the PDF report as its own page.
  Nothing is stored on the server.
- Only U.S. airports whose code maps unambiguously to an FAA identifier are looked up (`K` + 3 letters, or codes with a digit).

## Summary Report

- **How to:** open **Summary Report** (for one-way routes press **Finish adding stops** first; round and triangle trips need a chosen destination). In the PDF view tick the airport diagrams and approach plates to attach, press **Generate Report**, then use **Open full PDF**, **Download**, or the share button; **Edit plates** returns to the selection and **Regenerate Report** rebuilds the PDF. The Text view can be copied or shared the same way.
- **Contents:** route and total distance, a distance line per leg with the MC (`KGAI → KPTW: 98.3 NM; MC 060°`, with "MC = magnetic course" in the heading), the direct distance for one-way trips, a route map (the one-way report keeps the map's own aspect ratio), and an airport card per stop (runways, FBO, approaches, diagram).
- **Views:** PDF and text. Approach plates and airport diagrams can be ticked in the preview and are appended to the PDF.
- **Magnetic course:** the true course at the middle of each leg plus the World Magnetic Model (WMM2025, `magvar`) variation at that point: MC = TC - variation (east variation positive).
- **On phones:** browsers such as iOS Safari show only the first page of a PDF inside an iframe, so small/touch screens draw every page with PDF.js (loaded only when needed). **Open full PDF** and **Download** are always available above the preview. The button next to the PDF/Text tabs says what it does: `⤴ Send to` (system share sheet), `⬇ Download`, or `⧉ Copy`.

## Current Scope

- Home base airport selection with same-browser persistence
- Round trip, triangle trip, and one-way (A to B) planning
- First-leg and second-leg airport candidate mapping; per-leg candidates for one-way routes
- Airspace-colored selectable destinations
- Faint map markers for filtered-out airports and airports just outside the max range
- Filters: fuel, non-public exclusion, surface, airspace class, approaches, runway length, field elevation (when "Exclude non-public airports" is off, private airports still need to pass the fuel and approach filters; allow the `None` approach and untick fuel to include them)
- Summary report modal with PDF and text views, MC, airport diagrams (FAA / AOPA), and a mobile page-by-page PDF preview
- `/api/airport-data` endpoint backed by the `airports_v2` database tables, also proxying FAA plates and the AOPA diagram images

## Stack

- React 18
- Vite 5
- Leaflet / React Leaflet
- Node.js API handler (`functions/`) served by a small HTTP adapter
- PostgreSQL via `pg`
- `pdf-lib` (building the report PDF), `pdfjs-dist` (mobile PDF preview), `magvar` (WMM2025 magnetic variation)

## Repository Layout

- [index.html](/Users/kchoi/Workspace/xc_planner/index.html): Vite entry document
- [src/](/Users/kchoi/Workspace/xc_planner/src): v2 application source
- [functions/airport-data.js](/Users/kchoi/Workspace/xc_planner/functions/airport-data.js): airport-data API handler
- [backend_scripts/xc_airport_db.py](/Users/kchoi/Workspace/xc_planner/backend_scripts/xc_airport_db.py): FAA-to-database update script
- [backend_scripts/requirements.txt](/Users/kchoi/Workspace/xc_planner/backend_scripts/requirements.txt): Python dependencies for the update script
- [backend_scripts/neon/](/Users/kchoi/Workspace/xc_planner/backend_scripts/neon): Neon/Postgres support files and SQL helpers
- [.github/workflows/update_airport_db.yml](/Users/kchoi/Workspace/xc_planner/.github/workflows/update_airport_db.yml): weekly airport database update workflow on `main`

## Local Development

Install dependencies:

```bash
npm ci
```

Run the dev server:

```bash
npm run dev
```

Build production assets:

```bash
npm run build
```

Preview the build locally:

```bash
npm run preview
```

## Environment

The deployed app and the API handler expect one of these environment variables to be set:

- `NEON_DATABASE_URL`
- `DATABASE_URL`

Local secret shell files such as `backend_scripts/neon/neon_env.bash` are intentionally ignored by git. Use [backend_scripts/neon/neon_env.bash.example](/Users/kchoi/Workspace/xc_planner/backend_scripts/neon/neon_env.bash.example) as the template instead of committing real credentials.

## Data Flow

1. [backend_scripts/xc_airport_db.py](/Users/kchoi/Workspace/xc_planner/backend_scripts/xc_airport_db.py) downloads and normalizes FAA source data, then updates the database.
2. [functions/airport-data.js](/Users/kchoi/Workspace/xc_planner/functions/airport-data.js) reads from the database and returns airport payloads for the frontend.
3. The React app in [src/](/Users/kchoi/Workspace/xc_planner/src) renders the map, filters, candidate airports, and summary output.

## License

This repository is source-available. See [LICENSE](/Users/kchoi/Workspace/xc_planner/LICENSE).

The code is publicly visible for review and reference, but no permission is granted to use, copy, modify, distribute, sublicense, sell, or create derivative works without prior written permission from the copyright holder.

Permission requests: `pilot.drchoi@gmail.com`
