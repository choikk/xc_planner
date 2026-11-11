"""Refresh only airport_diagrams_v2 from the FAA d-TPP metafile.

The full update (xc_airport_db.py) does this every 28 days. This script lets you
fill the table right away, e.g. after adding it, without reloading everything else.

    NEON_DATABASE_URL=... python3 backend_scripts/update_airport_diagrams.py [--dry-run]
"""
import argparse

from psycopg import connect

from xc_airport_db import (
    DATABASE_URL,
    DTPP_BASE_URL,
    DTPP_XML_URL,
    ensure_v2_tables_exist,
    get_current_nasr_effective_date,
    get_cycle_from_effective_date,
    parse_d_tpp_xml,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    effective_date = get_current_nasr_effective_date()
    cycle = get_cycle_from_effective_date(effective_date)
    print(f"NASR effective {effective_date}, d-TPP cycle {cycle}")

    _, _, diagrams, xml_cycle = parse_d_tpp_xml(
        DTPP_XML_URL.format(cycle), DTPP_BASE_URL.format(cycle), cycle
    )
    print(f"d-TPP XML cycle {xml_cycle}: {len(diagrams)} airport diagrams")

    if args.dry_run:
        for code in list(diagrams)[:5]:
            print(code, diagrams[code])
        return
    if not DATABASE_URL:
        raise RuntimeError("Missing NEON_DATABASE_URL")

    with connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            ensure_v2_tables_exist(cur)
            cur.execute("SELECT airport_code FROM airports_v2")
            known = {row[0] for row in cur.fetchall()}
            rows = [
                (code, d["name"], d["pdf_url"], d["procuid"], d["amdt_num"], d["amdt_date"])
                for code, d in diagrams.items()
                if code in known
            ]
            cur.execute("TRUNCATE TABLE airport_diagrams_v2")
            cur.executemany(
                """
                INSERT INTO airport_diagrams_v2
                    (airport_code, diagram_name, pdf_url, procuid, amdt_num, amdt_date)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
        conn.commit()
    print(f"Saved {len(rows)} diagrams ({len(diagrams) - len(rows)} skipped: airport not in airports_v2)")


if __name__ == "__main__":
    main()
