"""Fill airports_v2.facility_use / ownership from the FAA NASR APT_BASE.csv.

facility_use:  PU = open to the public, PR = private use
ownership:     PU, PR, MA (Air Force), MN (Navy), MR (Army), CG (Coast Guard)

The full update (xc_airport_db.py) does this every 28 days. Use this script to fill the two
columns right away without reloading everything else.

    NEON_DATABASE_URL=... python3 backend_scripts/update_airport_access.py [--dry-run]
"""
import argparse
from collections import Counter

from psycopg import connect

from xc_airport_db import (
    DATABASE_URL,
    TMP_ROOT,
    ZIP_BASE_URL,
    download_and_extract_csv_data,
    ensure_v2_tables_exist,
    get_current_nasr_effective_date,
    load_airport_base,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    effective_date = get_current_nasr_effective_date()
    root = TMP_ROOT / f"28DaySubscription_Effective_{effective_date}"
    download_and_extract_csv_data(ZIP_BASE_URL.format(effective_date), root)
    df = load_airport_base(root / "CSV_Data")

    rows = []
    for _, r in df.iterrows():
        rows.append(
            (
                str(r["FACILITY_USE_CODE"]).strip().upper() if r["FACILITY_USE_CODE"] == r["FACILITY_USE_CODE"] else "",
                str(r["OWNERSHIP_TYPE_CODE"]).strip().upper() if r["OWNERSHIP_TYPE_CODE"] == r["OWNERSHIP_TYPE_CODE"] else "",
                r["AirportCode"],
            )
        )
    print(f"NASR {effective_date}: {len(rows)} airports")
    print("facility_use:", dict(Counter(x[0] for x in rows)))
    print("ownership:   ", dict(Counter(x[1] for x in rows)))
    if args.dry_run:
        return
    if not DATABASE_URL:
        raise RuntimeError("Missing NEON_DATABASE_URL")

    with connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            ensure_v2_tables_exist(cur)
            cur.executemany(
                "UPDATE airports_v2 SET facility_use = %s, ownership = %s WHERE airport_code = %s",
                rows,
            )
            cur.execute("SELECT count(*) FILTER (WHERE facility_use IS NOT NULL), count(*) FROM airports_v2")
            filled, total = cur.fetchone()
        conn.commit()
    print(f"airports_v2: {filled} of {total} rows now have a facility_use")


if __name__ == "__main__":
    main()
