# XC Planner v2

XC Planner v2 is a React/Vite cross-country flight planning tool for U.S. general aviation use. It helps a pilot choose a home base, explore round-trip or triangle-trip candidates on a map, filter airports by runway and airspace constraints, and generate printable trip summaries.

## Current App Scope

- Home base airport selection with same-browser persistence
- Round trip and triangle trip planning
- First-leg and second-leg candidate display on the map
- Airspace-colored airport markers plus faint outer-ring airports
- Summary report modal with PDF and text views
- Netlify function for loading airport data from a database-backed source

## Tech Stack

- React 18
- Vite 5
- Leaflet / React Leaflet
- Netlify Functions
- PostgreSQL via `pg`

## Repository Layout

- [`src/`](/Users/kchoi/Workspace/xc_planner/src): v2 frontend application
- [`netlify/functions/`](/Users/kchoi/Workspace/xc_planner/netlify/functions): serverless endpoint used by the deployed app
- [`backend_scripts/`](/Users/kchoi/Workspace/xc_planner/backend_scripts): data preparation and database support scripts that are still part of this project
- [`scripts/`](/Users/kchoi/Workspace/xc_planner/scripts): legacy planner scripts retained in the repository
- [`json_data/`](/Users/kchoi/Workspace/xc_planner/json_data): supporting dataset files retained from earlier versions

## Local Development

Install dependencies:

```bash
npm ci
```

Run the dev server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deployment

Netlify is configured through [`netlify.toml`](/Users/kchoi/Workspace/xc_planner/netlify.toml).

The deployed app expects a database connection string in one of these environment variables:

- `NEON_DATABASE_URL`
- `NETLIFY_DATABASE_URL`
- `DATABASE_URL`

The runtime endpoint is implemented in [`netlify/functions/airport-data.js`](/Users/kchoi/Workspace/xc_planner/netlify/functions/airport-data.js).

## Data Notes

The planner uses airport records that include coordinates, elevation, fuel availability, airspace class, runway data, and instrument approaches. The v2 app loads those records through the Netlify function layer rather than bundling the full dataset into the frontend.

## License

This repository is source-available. See [`LICENSE`](/Users/kchoi/Workspace/xc_planner/LICENSE).

The code is publicly visible for review and reference, but no permission is granted to use, copy, modify, distribute, sublicense, sell, or create derivative works without prior written permission from the copyright holder.

If you want to request permission for use, contact the copyright holder directly.
