# XC Planner v2

XC Planner v2 is a React/Vite cross-country flight planning app for U.S. general aviation use. It centers on a home-base workflow: pick a departure airport, explore round-trip or triangle-trip candidates on the map, filter by runway and airspace constraints, and generate printable trip summaries.

## What's New

- Rebuilt the planner as a React/Vite app with a cleaner, faster v2 codebase
- Replaced the old bundled JSON-data workflow with a database-backed airport pipeline and Netlify function endpoint
- Reworked the trip workflow so map candidates update immediately when filters or trip options change
- Added a more guided home-base-first planning flow for round trips and triangle trips
- Added persistent home base selection in the same browser
- Added better visual separation between selectable destinations, filtered-out airports, and airports just outside the first-leg max range
- Improved mobile behavior and panel organization with dedicated Plan / Filters / Results sections
- Restored and upgraded the summary experience with PDF and text report views, route map snapshots, and linked instrument approaches
- Simplified the repository by removing old legacy frontend files that are no longer used in v2

## Current Scope

- Home base airport selection with same-browser persistence
- Round trip and triangle trip planning
- First-leg and second-leg airport candidate mapping
- Airspace-colored selectable destinations
- Faint map markers for filtered-out airports and airports just outside the first-leg max range
- Summary report modal with PDF and text views
- Netlify function backed by the `airports_v2` database tables

## Stack

- React 18
- Vite 5
- Leaflet / React Leaflet
- Netlify Functions
- PostgreSQL via `pg`

## Repository Layout

- [index.html](/Users/kchoi/Workspace/xc_planner/index.html): Vite entry document
- [src/](/Users/kchoi/Workspace/xc_planner/src): v2 application source
- [netlify/functions/airport-data.js](/Users/kchoi/Workspace/xc_planner/netlify/functions/airport-data.js): serverless airport-data endpoint
- [backend_scripts/xc_airport_db.py](/Users/kchoi/Workspace/xc_planner/backend_scripts/xc_airport_db.py): FAA-to-database update script
- [backend_scripts/requirements.txt](/Users/kchoi/Workspace/xc_planner/backend_scripts/requirements.txt): Python dependencies for the update script
- [backend_scripts/neon/](/Users/kchoi/Workspace/xc_planner/backend_scripts/neon): Neon/Postgres support files and SQL helpers
- [netlify.toml](/Users/kchoi/Workspace/xc_planner/netlify.toml): Netlify build and functions config
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

The deployed app and the Netlify function expect one of these environment variables to be set:

- `NEON_DATABASE_URL`
- `NETLIFY_DATABASE_URL`
- `DATABASE_URL`

Local secret shell files such as `backend_scripts/neon/neon_env.bash` are intentionally ignored by git. Use [backend_scripts/neon/neon_env.bash.example](/Users/kchoi/Workspace/xc_planner/backend_scripts/neon/neon_env.bash.example) as the template instead of committing real credentials.

## Data Flow

1. [backend_scripts/xc_airport_db.py](/Users/kchoi/Workspace/xc_planner/backend_scripts/xc_airport_db.py) downloads and normalizes FAA source data, then updates the database.
2. [netlify/functions/airport-data.js](/Users/kchoi/Workspace/xc_planner/netlify/functions/airport-data.js) reads from the database and returns airport payloads for the frontend.
3. The React app in [src/](/Users/kchoi/Workspace/xc_planner/src) renders the map, filters, candidate airports, and summary output.

## License

This repository is source-available. See [LICENSE](/Users/kchoi/Workspace/xc_planner/LICENSE).

The code is publicly visible for review and reference, but no permission is granted to use, copy, modify, distribute, sublicense, sell, or create derivative works without prior written permission from the copyright holder.

Permission requests: `pilot.drchoi@gmail.com`
