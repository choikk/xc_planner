# XC Planner v2

XC Planner v2 is a React/Vite cross-country flight planning app for U.S. general aviation use. It centers on a home-base workflow: pick a departure airport, explore round-trip or triangle-trip candidates on the map, filter by runway and airspace constraints, and generate printable trip summaries.

## What's New

- Rebuilt the planner as a React/Vite app with a cleaner, faster v2 codebase
- Replaced the old bundled JSON-data workflow with a database-backed airport pipeline and an `/api/airport-data` endpoint
- Reworked the trip workflow so map candidates update immediately when filters or trip options change
- Added a more guided home-base-first planning flow for round trips and triangle trips
- Added persistent home base selection in the same browser
- Added better visual separation between selectable destinations, filtered-out airports, and airports just outside the first-leg max range
- Improved mobile behavior and panel organization with dedicated Plan / Filters / Results sections
- Restored and upgraded the summary experience with PDF and text report views, route map snapshots, and linked instrument approaches
- Simplified the repository by removing old legacy frontend files that are no longer used in v2

## One-Way Trips (A to B)

Under Plan > Your Trip, the **A → B** mode plans a one-way route from the home base to a destination, with no return leg. The route is built in order:

1. **Choose the destination first.** The Origin card shows the home base. Set a minimum and maximum distance from it and click one of the airports that fit on the map (or in Results), then choose **Set as Destination**.
2. **Set the distance range of the next leg** (minimum and maximum NM), then click an airport on the map (or in Results). The dots shown pass the filters, lie inside the leg's range, and are closer to B than where you are now. Results marks candidates from which B is reachable with the next leg.
3. **Repeat for each leg.** Every leg has its own range (a new leg starts with the previous leg's limits), and you can add as many stops as you need.
4. **Finish adding stops** once B falls inside the current leg's range (button in the Plan tab, Results, or B's map popup); the last leg then goes straight to B.
- Changing a leg range, the filters, the home base, or the destination drops any stop that no longer fits. **Clear** removes a stop and everything after it.
- When the route is finished and every leg is within its range, **Summary Report** produces the same PDF/text report for the whole route.

## Airport Diagrams

Airport diagrams come from the FAA d-TPP data (PDF). When an airport has none, the planner falls back to the AOPA diagram image
(`https://www.aopa.org/ustprocs/airportgraphics/gif/tn_<FAA id>_tif.gif`) if AOPA has one:

- The map popups, the summary preview, and the text report show an "Airport Diagram (AOPA)" link (existence is checked in the browser when needed).
- In the summary preview it can be ticked like the FAA diagram and plates. The GIF is fetched through the API (`/api/airport-data?plateUrl=...`,
  which only proxies that exact AOPA file pattern, plus FAA hosts), converted in the browser, and appended to the PDF report as its own page.
  Nothing is stored on the server.
- Only U.S. airports whose code maps unambiguously to an FAA identifier are looked up (`K` + 3 letters, or codes with a digit).

## Current Scope

- Home base airport selection with same-browser persistence
- Round trip and triangle trip planning
- First-leg and second-leg airport candidate mapping
- Airspace-colored selectable destinations
- Faint map markers for filtered-out airports and airports just outside the first-leg max range
- Summary report modal with PDF and text views
- `/api/airport-data` endpoint backed by the `airports_v2` database tables

## Stack

- React 18
- Vite 5
- Leaflet / React Leaflet
- Node.js API handler (`functions/`) served by a small HTTP adapter
- PostgreSQL via `pg`

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
