#!/usr/bin/env python3
import argparse
import csv
import json
import os
from pathlib import Path

import psycopg
from psycopg.types.json import Json


def to_int_or_none(value):
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def load_json(json_path: Path):
    with json_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def ensure_schema(cur):
    schema_sql = (Path(__file__).with_name("schema_v2.sql")).read_text(encoding="utf-8")
    cur.execute(schema_sql)


def upsert_airports(cur, records):
    rows = []
    for airport_code, rec in records.items():
        rows.append((
            airport_code,
            rec.get("site_no"),
            rec.get("airport_name"),
            rec.get("city"),
            rec.get("state"),
            rec.get("country") or "US",
            rec.get("lat"),
            rec.get("lon"),
            rec.get("elevation"),
            rec.get("airspace"),
            rec.get("fuel"),
            rec.get("remarks"),
            Json(rec),
        ))

    cur.executemany(
        """
        INSERT INTO airports_v2 (
            airport_code, site_no, airport_name, city, state, country,
            lat, lon, elevation, airspace_class, fuel_raw, remarks, raw_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (airport_code) DO UPDATE SET
            site_no = EXCLUDED.site_no,
            airport_name = EXCLUDED.airport_name,
            city = EXCLUDED.city,
            state = EXCLUDED.state,
            country = EXCLUDED.country,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            elevation = EXCLUDED.elevation,
            airspace_class = EXCLUDED.airspace_class,
            fuel_raw = EXCLUDED.fuel_raw,
            remarks = EXCLUDED.remarks,
            raw_json = EXCLUDED.raw_json
        """,
        rows,
    )


def refresh_children(cur, records):
    airport_codes = list(records.keys())

    cur.execute(
        "DELETE FROM airport_runways_v2 WHERE airport_code = ANY(%s)",
        (airport_codes,),
    )
    cur.execute(
        "DELETE FROM airport_approaches_v2 WHERE airport_code = ANY(%s)",
        (airport_codes,),
    )

    runway_rows = []
    approach_rows = []

    for airport_code, rec in records.items():
        for rw in rec.get("runways", []) or []:
            runway_rows.append((
                airport_code,
                rw.get("rwy_id"),
                to_int_or_none(rw.get("length")),
                to_int_or_none(rw.get("width")),
                rw.get("surface"),
                rw.get("condition"),
            ))

        for ap in rec.get("approaches", []) or []:
            approach_rows.append((
                airport_code,
                ap.get("name"),
                ap.get("pdf_url"),
                ap.get("procuid"),
                ap.get("amdt_num"),
                ap.get("amdt_date"),
            ))

    if runway_rows:
        cur.executemany(
            """
            INSERT INTO airport_runways_v2 (
                airport_code, rwy_id, length_ft, width_ft, surface, condition
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            runway_rows,
        )

    if approach_rows:
        cur.executemany(
            """
            INSERT INTO airport_approaches_v2 (
                airport_code, approach_name, pdf_url, procuid, amdt_num, amdt_date
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            approach_rows,
        )


def backfill_scrape_status_from_legacy(cur):
    cur.execute("""
        INSERT INTO airport_scrape_status_v2 (
            airport_code,
            last_checked_at,
            next_check_at,
            check_priority,
            last_change_at,
            consecutive_no_change_count
        )
        SELECT
            v.airport_code,
            a.last_checked_at,
            a.next_check_at,
            COALESCE(a.check_priority, 2),
            a.last_change_at,
            COALESCE(a.consecutive_no_change_count, 0)
        FROM airports a
        JOIN airports_v2 v
          ON a.site_no = v.site_no
        ON CONFLICT (airport_code) DO UPDATE SET
            last_checked_at = EXCLUDED.last_checked_at,
            next_check_at = EXCLUDED.next_check_at,
            check_priority = EXCLUDED.check_priority,
            last_change_at = EXCLUDED.last_change_at,
            consecutive_no_change_count = EXCLUDED.consecutive_no_change_count
    """)


def main():
    parser = argparse.ArgumentParser(description="Import airport base JSON into Neon/Postgres _v2 tables.")
    parser.add_argument("--json", default=str(Path(__file__).with_name("airport_base_info_with_runways_airspace_approaches.json")))
    parser.add_argument("--database-url", default=os.getenv("NEON_DATABASE_URL"))
    parser.add_argument("--skip-status-backfill", action="store_true")
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL not provided. Pass --database-url or set DATABASE_URL.")

    json_path = Path(args.json)
    if not json_path.exists():
        raise SystemExit(f"JSON file not found: {json_path}")

    records = load_json(json_path)

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            ensure_schema(cur)
            upsert_airports(cur, records)
            refresh_children(cur, records)
            if not args.skip_status_backfill:
                backfill_scrape_status_from_legacy(cur)
        conn.commit()

    print(f"Imported {len(records):,} airports into airports_v2.")
    print("Refreshed airport_runways_v2 and airport_approaches_v2.")
    if not args.skip_status_backfill:
        print("Attempted airport_scrape_status_v2 backfill from legacy airports table.")


if __name__ == "__main__":
    main()
