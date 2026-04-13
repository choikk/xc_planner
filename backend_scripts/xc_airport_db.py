#!/usr/bin/env python3

import os
import sys
import ssl
import shutil
import zipfile
import json
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from datetime import datetime
from urllib.request import urlopen

import pandas as pd
import requests
from bs4 import BeautifulSoup
from psycopg import connect

DATABASE_URL = os.environ["NEON_DATABASE_URL"]

BASE_PATH = Path(__file__).resolve().parent
TMP_ROOT = BASE_PATH / "json_data" / "tmp"
TMP_ROOT.mkdir(parents=True, exist_ok=True)

NASR_SUB_URL = "https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/"
ZIP_BASE_URL = "https://nfdc.faa.gov/webContent/28DaySub/28DaySubscription_Effective_{}.zip"
DTPP_BASE_URL = "https://aeronav.faa.gov/d-tpp/{}/"
DTPP_XML_URL = "https://aeronav.faa.gov/d-tpp/{}/xml_data/d-TPP_Metafile.xml"


def get_current_nasr_effective_date():
    response = requests.get(NASR_SUB_URL, timeout=20)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    current_section = soup.find("h2", string="Current")
    if not current_section:
        raise RuntimeError("Could not find Current section on NASR subscription page")

    ul = current_section.find_next("ul")
    if not ul:
        raise RuntimeError("Could not find <ul> after Current section")

    li = ul.find("li")
    if not li:
        raise RuntimeError("Could not find <li> in Current section")

    a_tag = li.find("a", href=True)
    if not a_tag:
        raise RuntimeError("Could not find current ZIP link")

    href = a_tag["href"]
    return href.split("/")[-1]


def get_cycle_from_effective_date(effective_date: str) -> str:
    cycle_date = datetime.strptime(effective_date, "%Y-%m-%d")
    return f"{cycle_date.strftime('%y')}{cycle_date.month:02d}"


def ensure_metadata_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dataset_versions (
            dataset_name text PRIMARY KEY,
            effective_date text NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT NOW()
        )
    """)


def get_stored_effective_date(cur, dataset_name: str) -> str | None:
    cur.execute(
        """
        SELECT effective_date
        FROM dataset_versions
        WHERE dataset_name = %s
        """,
        (dataset_name,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def save_effective_date_with_stats(cur, dataset_name, effective_date, cycle, airport_count, approach_count):
    cur.execute(
        """
        INSERT INTO dataset_versions (
            dataset_name,
            effective_date,
            faa_cycle,
            airport_count,
            approach_airport_count,
            log,
            updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, NOW())
        ON CONFLICT (dataset_name) DO UPDATE
        SET effective_date = EXCLUDED.effective_date,
            faa_cycle = EXCLUDED.faa_cycle,
            airport_count = EXCLUDED.airport_count,
            approach_airport_count = EXCLUDED.approach_airport_count,
            log = EXCLUDED.log,
            updated_at = NOW()
        """,
        (
            dataset_name,
            effective_date,
            cycle,
            airport_count,
            approach_count,
            json.dumps({
                "message": "FAA dataset updated",
                "airport_count": airport_count,
                "approach_airports": approach_count
            }),
        ),
    )

import json
from datetime import datetime, timezone

def now_utc():
    return datetime.now(timezone.utc)

def insert_history_row(
    cur,
    dataset_name,
    effective_date,
    faa_cycle,
    airport_count,
    runway_count,
    approach_airport_count,
    approach_count,
    started_at,
    status,
    message,
    details=None,
):
    cur.execute(
        """
        INSERT INTO airport_dataset_history (
            dataset_name,
            effective_date,
            faa_cycle,
            airport_count,
            runway_count,
            approach_airport_count,
            approach_count,
            started_at,
            finished_at,
            status,
            message,
            details
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s::jsonb)
        """,
        (
            dataset_name,
            effective_date,
            faa_cycle,
            airport_count,
            runway_count,
            approach_airport_count,
            approach_count,
            started_at,
            status,
            message,
            json.dumps(details or {}, ensure_ascii=False),
        ),
    )


def upsert_dataset_version(
    cur,
    dataset_name,
    effective_date,
    faa_cycle,
    airport_count,
    runway_count,
    approach_airport_count,
    approach_count,
    details=None,
):
    cur.execute(
        """
        INSERT INTO dataset_versions (
            dataset_name,
            effective_date,
            faa_cycle,
            airport_count,
            runway_count,
            approach_airport_count,
            approach_count,
            details,
            updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
        ON CONFLICT (dataset_name) DO UPDATE
        SET effective_date = EXCLUDED.effective_date,
            faa_cycle = EXCLUDED.faa_cycle,
            airport_count = EXCLUDED.airport_count,
            runway_count = EXCLUDED.runway_count,
            approach_airport_count = EXCLUDED.approach_airport_count,
            approach_count = EXCLUDED.approach_count,
            details = EXCLUDED.details,
            updated_at = NOW()
        """,
        (
            dataset_name,
            effective_date,
            faa_cycle,
            airport_count,
            runway_count,
            approach_airport_count,
            approach_count,
            json.dumps(details or {}, ensure_ascii=False),
        ),
    )

def download_and_extract_csv_data(url: str, extract_root: Path):
    if extract_root.exists():
        shutil.rmtree(extract_root)
    extract_root.mkdir(parents=True, exist_ok=True)

    response = requests.get(url, timeout=60)
    response.raise_for_status()

    with zipfile.ZipFile(BytesIO(response.content)) as z:
        csv_data_files = [f for f in z.namelist() if f.startswith("CSV_Data/")]
        if not csv_data_files:
            raise RuntimeError("No CSV_Data directory found in main NASR ZIP")
        z.extractall(extract_root, members=csv_data_files)

    csv_data_path = extract_root / "CSV_Data"
    if not csv_data_path.is_dir():
        raise RuntimeError(f"CSV_Data folder missing after extraction: {csv_data_path}")

    secondary_zip = None
    for file in csv_data_path.iterdir():
        if file.suffix.lower() == ".zip":
            secondary_zip = file
            break

    if secondary_zip is None:
        raise RuntimeError("No secondary ZIP found inside CSV_Data")

    with zipfile.ZipFile(secondary_zip, "r") as z:
        z.extractall(csv_data_path)

    secondary_zip.unlink()


def load_airport_base(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path / "APT_BASE.csv", dtype=str)
    df = df[df["SITE_TYPE_CODE"].fillna("").str.upper() == "A"].copy()

    df["ICAO_ID"] = df["ICAO_ID"].fillna("").str.strip().str.upper()
    df["ARPT_ID"] = df["ARPT_ID"].fillna("").str.strip().str.upper()
    df["AirportCode"] = df["ICAO_ID"]
    df.loc[df["AirportCode"] == "", "AirportCode"] = df["ARPT_ID"]

    df["FUEL_TYPES"] = df["FUEL_TYPES"].fillna("").str.strip().str.upper()
    df["LAT_DECIMAL"] = pd.to_numeric(df["LAT_DECIMAL"], errors="coerce")
    df["LONG_DECIMAL"] = pd.to_numeric(df["LONG_DECIMAL"], errors="coerce")
    df["ELEV"] = pd.to_numeric(df["ELEV"], errors="coerce")

    df = df.dropna(subset=["AirportCode", "LAT_DECIMAL", "LONG_DECIMAL", "SITE_NO", "ELEV"])
    return df


def load_runways(path: Path) -> dict[str, list[dict]]:
    df = pd.read_csv(path / "APT_RWY.csv", dtype=str)
    df = df[["SITE_NO", "RWY_ID", "RWY_LEN", "RWY_WIDTH", "SURFACE_TYPE_CODE", "COND"]].copy()
    df["COND"] = df["COND"].fillna("").str.strip().str.upper()
    df["SURFACE_TYPE_CODE"] = df["SURFACE_TYPE_CODE"].fillna("").str.strip().str.upper()

    rwy_dict: dict[str, list[dict]] = {}

    for _, row in df.iterrows():
        rwy_id = str(row["RWY_ID"] or "").strip()
        rwy_len = str(row["RWY_LEN"] or "").strip()
        if "X" in rwy_id or "H" in rwy_id:
            continue
        if not rwy_len or rwy_len == "0":
            continue

        cond = str(row["COND"] or "").strip().upper() or "Unknown Condition"

        rwy_info = {
            "rwy_id": rwy_id,
            "length": rwy_len,
            "width": str(row["RWY_WIDTH"] or "").strip(),
            "surface": str(row["SURFACE_TYPE_CODE"] or "").strip().upper(),
            "condition": cond,
        }
        rwy_dict.setdefault(str(row["SITE_NO"]), []).append(rwy_info)

    return rwy_dict


def determine_airspace(row) -> str:
    if row["CLASS_B_AIRSPACE"] == "Y":
        return "B"
    if row["CLASS_C_AIRSPACE"] == "Y":
        return "C"
    if row["CLASS_D_AIRSPACE"] == "Y":
        return "D"
    if row["CLASS_E_AIRSPACE"] == "Y":
        return "E"
    return "G"


def load_airspace(path: Path) -> dict[str, dict]:
    df = pd.read_csv(path / "CLS_ARSP.csv", dtype=str)
    df["REMARK"] = df["REMARK"].fillna("").str.strip()

    airspace_info: dict[str, dict] = {}

    for site_no, group in df.groupby("SITE_NO"):
        highest = "G"
        remark = ""

        for _, row in group.iterrows():
            classification = determine_airspace(row)

            if classification == "B":
                highest = "B"
            elif classification == "C" and highest not in ["B"]:
                highest = "C"
            elif classification == "D" and highest not in ["B", "C"]:
                highest = "D"
            elif classification == "E" and highest not in ["B", "C", "D"]:
                highest = "E"

            remark = row.get("REMARK", remark)

        airspace_info[str(site_no)] = {"airspace": highest, "remarks": remark}

    return airspace_info


def parse_d_tpp_xml(xml_url: str, base_pdf_url: str, current_cycle: str):
    context = ssl._create_unverified_context()
    with urlopen(xml_url, context=context) as response:
        xml_content = response.read().decode("utf-8")
        tree = ET.ElementTree(ET.fromstring(xml_content))

    root = tree.getroot()
    cycle = root.get("cycle", current_cycle)

    approach_dict: dict[str, list[dict]] = {}

    for airport in root.findall(".//airport_name"):
        apt_ident = airport.get("apt_ident")
        icao_ident = airport.get("icao_ident", "")
        key = icao_ident if icao_ident else apt_ident
        if not key:
            continue

        approaches = []

        for record in airport.findall("record"):
            chart_code = record.findtext("chart_code")
            if chart_code != "IAP":
                continue

            pdf_name = record.findtext("pdf_name") or ""
            approaches.append(
                {
                    "name": record.findtext("chart_name") or "",
                    "pdf_url": f"{base_pdf_url}{pdf_name}",
                    "procuid": record.findtext("procuid") or "",
                    "amdt_num": record.findtext("amdtnum") or "",
                    "amdt_date": record.findtext("amdtdate") or "",
                }
            )

        if approaches:
            approach_dict[key] = approaches

    return approach_dict, cycle


def build_airport_data(df_base, rwy_dict, airspace_info, approach_dict):
    airport_data: dict[str, dict] = {}

    for _, row in df_base.iterrows():
        code = str(row["AirportCode"]).strip().upper()
        site_no = str(row["SITE_NO"]).strip()

        airspace = airspace_info.get(site_no, {"airspace": "G", "remarks": ""})
        approaches = approach_dict.get(code, [])

        country_code = str(row.get("COUNTRY_CODE", "")).strip()
        state_name = str(row.get("STATE_NAME", "")).strip()
        county_name = str(row.get("COUNTY_NAME", "")).strip()
        fuel_types = str(row.get("FUEL_TYPES", "")).strip()

        if state_name.lower() == "nan":
            state_name = ""
        if county_name.lower() == "nan":
            county_name = ""
        if fuel_types == "":
            fuel_types = "None"

        state = state_name if state_name else (county_name if county_name else "unknown")

        airport_data[code] = {
            "site_no": site_no,
            "lat": float(row["LAT_DECIMAL"]),
            "lon": float(row["LONG_DECIMAL"]),
            "elevation": float(row["ELEV"]),
            "city": str(row.get("CITY", "")).strip(),
            "state": state,
            "country": country_code,
            "airport_name": str(row.get("ARPT_NAME", "")).strip(),
            "runways": rwy_dict.get(site_no, []),
            "airspace": airspace["airspace"],
            "fuel": fuel_types,
            "remarks": airspace["remarks"],
            "approaches": approaches,
        }

    return airport_data


def ensure_v2_tables_exist(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS airports_v2 (
            airport_code text PRIMARY KEY,
            site_no text,
            airport_name text,
            city text,
            state text,
            country text NOT NULL DEFAULT 'US',
            lat double precision NOT NULL,
            lon double precision NOT NULL,
            elevation double precision,
            airspace_class text,
            fuel_raw text,
            remarks text,
            raw_json jsonb
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airports_v2_state ON airports_v2 (state)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airports_v2_site_no ON airports_v2 (site_no)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airports_v2_airspace ON airports_v2 (airspace_class)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS airport_runways_v2 (
            id bigserial PRIMARY KEY,
            airport_code text NOT NULL,
            rwy_id text NOT NULL,
            length_ft integer,
            width_ft integer,
            surface text,
            condition text,
            CONSTRAINT airport_runways_v2_airport_code_fkey
                FOREIGN KEY (airport_code)
                REFERENCES airports_v2(airport_code)
                ON UPDATE CASCADE
                ON DELETE CASCADE
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airport_runways_v2_airport ON airport_runways_v2 (airport_code)")
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_airport_runways_v2_airport_rwy
        ON airport_runways_v2 (airport_code, rwy_id)
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS airport_approaches_v2 (
            id bigserial PRIMARY KEY,
            airport_code text NOT NULL,
            approach_name text NOT NULL,
            pdf_url text,
            procuid text,
            amdt_num text,
            amdt_date text,
            CONSTRAINT airport_approaches_v2_airport_code_fkey
                FOREIGN KEY (airport_code)
                REFERENCES airports_v2(airport_code)
                ON UPDATE CASCADE
                ON DELETE CASCADE
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airport_approaches_v2_airport ON airport_approaches_v2 (airport_code)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airport_approaches_v2_procuid ON airport_approaches_v2 (procuid)")
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_airport_approaches_v2_airport_name
        ON airport_approaches_v2 (airport_code, approach_name)
    """)


def sync_airports_v2(cur, airport_data: dict[str, dict]):
    """
    Preserve schedule-state FK integrity when airport_code changes but site_no stays same:
    - if an existing airports_v2 row has same site_no and different airport_code,
      update PK airport_code first (ON UPDATE CASCADE propagates to child FKs)
    - then perform normal UPSERT by airport_code
    """
    existing_by_site: dict[str, str] = {}
    cur.execute("SELECT airport_code, site_no FROM airports_v2 WHERE site_no IS NOT NULL")
    for airport_code, site_no in cur.fetchall():
        existing_by_site[str(site_no)] = str(airport_code)

    seen_codes = set(airport_data.keys())
    seen_site_nos = {rec["site_no"] for rec in airport_data.values() if rec.get("site_no")}

    # Step 1: migrate code changes by site_no
    for new_code, rec in airport_data.items():
        site_no = rec.get("site_no")
        if not site_no:
            continue

        old_code = existing_by_site.get(site_no)
        if old_code and old_code != new_code:
            cur.execute(
                """
                UPDATE airports_v2
                SET airport_code = %s
                WHERE airport_code = %s
                """,
                (new_code, old_code),
            )

    # Step 2: upsert fresh airport metadata
    for airport_code, rec in airport_data.items():
        cur.execute(
            """
            INSERT INTO airports_v2 (
                airport_code,
                site_no,
                airport_name,
                city,
                state,
                country,
                lat,
                lon,
                elevation,
                airspace_class,
                fuel_raw,
                remarks,
                raw_json
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
            )
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
            (
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
                json.dumps(rec, ensure_ascii=False),
            ),
        )

    # Optional cleanup: remove airports no longer present in current import
    # This will cascade to runways/approaches only.
    # It will also fail safely if airport_scrape_status_v2 or any other FK blocks it.
    cur.execute("SELECT airport_code, site_no FROM airports_v2")
    existing_rows = cur.fetchall()

    codes_to_delete = []
    for airport_code, site_no in existing_rows:
        airport_code = str(airport_code)
        site_no = str(site_no) if site_no is not None else None

        if airport_code in seen_codes:
            continue
        if site_no and site_no in seen_site_nos:
            continue

        codes_to_delete.append(airport_code)

    for airport_code in codes_to_delete:
        cur.execute("DELETE FROM airports_v2 WHERE airport_code = %s", (airport_code,))


def refresh_runways_and_approaches(cur, airport_data: dict[str, dict]):
    cur.execute("TRUNCATE TABLE airport_approaches_v2 RESTART IDENTITY CASCADE")
    cur.execute("TRUNCATE TABLE airport_runways_v2 RESTART IDENTITY CASCADE")

    for airport_code, rec in airport_data.items():
        for rwy in rec.get("runways", []):
            length_ft = int(rwy["length"]) if str(rwy.get("length", "")).strip().isdigit() else None
            width_ft = int(rwy["width"]) if str(rwy.get("width", "")).strip().isdigit() else None

            cur.execute(
                """
                INSERT INTO airport_runways_v2 (
                    airport_code,
                    rwy_id,
                    length_ft,
                    width_ft,
                    surface,
                    condition
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    airport_code,
                    rwy.get("rwy_id"),
                    length_ft,
                    width_ft,
                    rwy.get("surface"),
                    rwy.get("condition"),
                ),
            )

        for ap in rec.get("approaches", []):
            cur.execute(
                """
                INSERT INTO airport_approaches_v2 (
                    airport_code,
                    approach_name,
                    pdf_url,
                    procuid,
                    amdt_num,
                    amdt_date
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    airport_code,
                    ap.get("name"),
                    ap.get("pdf_url"),
                    ap.get("procuid"),
                    ap.get("amdt_num"),
                    ap.get("amdt_date"),
                ),
            )


def main():
    started_at = now_utc()

    effective_date = get_current_nasr_effective_date()
    print(f"Current NASR effective date: {effective_date}")

    cycle = get_cycle_from_effective_date(effective_date)
    print(f"Current FAA cycle: {cycle}")

    zip_url = ZIP_BASE_URL.format(effective_date)
    dtpp_base_pdf_url = DTPP_BASE_URL.format(cycle)
    dtpp_xml_url = DTPP_XML_URL.format(cycle)

    dataset_name = "airports_v2_source"

    # Make sure metadata tables exist and check current applied version
    with connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            ensure_metadata_table(cur)
            ensure_v2_tables_exist(cur)
            stored_version = get_stored_effective_date(cur, dataset_name)

        if stored_version == effective_date:
            with conn.cursor() as cur:
                insert_history_row(
                    cur,
                    dataset_name=dataset_name,
                    effective_date=effective_date,
                    faa_cycle=cycle,
                    airport_count=None,
                    runway_count=None,
                    approach_airport_count=None,
                    approach_count=None,
                    started_at=started_at,
                    status="skipped",
                    message="Database already up to date",
                    details={"stored_version": stored_version},
                )
            conn.commit()
            print(f"Database already up to date: {effective_date}")
            return

    airport_count = None
    runway_count = None
    approach_airport_count = None
    approach_count = None

    try:
        extract_root = TMP_ROOT / f"28DaySubscription_Effective_{effective_date}"
        download_and_extract_csv_data(zip_url, extract_root)
        csv_path = extract_root / "CSV_Data"

        df_base = load_airport_base(csv_path)
        rwy_dict = load_runways(csv_path)
        airspace_info = load_airspace(csv_path)
        approach_dict, xml_cycle = parse_d_tpp_xml(
            dtpp_xml_url,
            dtpp_base_pdf_url,
            cycle,
        )

        airport_data = build_airport_data(df_base, rwy_dict, airspace_info, approach_dict)

        airport_count = len(airport_data)
        runway_count = sum(len(v.get("runways", [])) for v in airport_data.values())
        approach_airport_count = len(approach_dict)
        approach_count = sum(len(v) for v in approach_dict.values())

        print(f"Loaded {approach_airport_count} airports with approach plates from d-TPP XML (cycle {xml_cycle})")
        print(f"Built airport dataset: {airport_count} airports")

        details = {
            "effective_date": effective_date,
            "faa_cycle": cycle,
            "xml_cycle": xml_cycle,
            "airport_count": airport_count,
            "runway_count": runway_count,
            "approach_airport_count": approach_airport_count,
            "approach_count": approach_count,
        }

        with connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                sync_airports_v2(cur, airport_data)
                refresh_runways_and_approaches(cur, airport_data)

                upsert_dataset_version(
                    cur,
                    dataset_name=dataset_name,
                    effective_date=effective_date,
                    faa_cycle=cycle,
                    airport_count=airport_count,
                    runway_count=runway_count,
                    approach_airport_count=approach_airport_count,
                    approach_count=approach_count,
                    details=details,
                )

                insert_history_row(
                    cur,
                    dataset_name=dataset_name,
                    effective_date=effective_date,
                    faa_cycle=cycle,
                    airport_count=airport_count,
                    runway_count=runway_count,
                    approach_airport_count=approach_airport_count,
                    approach_count=approach_count,
                    started_at=started_at,
                    status="success",
                    message="Database updated successfully",
                    details=details,
                )

            conn.commit()

        print(f"Database updated successfully to {effective_date}")
        sys.exit(1)

    except Exception as e:
        with connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                insert_history_row(
                    cur,
                    dataset_name=dataset_name,
                    effective_date=effective_date,
                    faa_cycle=cycle,
                    airport_count=airport_count,
                    runway_count=runway_count,
                    approach_airport_count=approach_airport_count,
                    approach_count=approach_count,
                    started_at=started_at,
                    status="failed",
                    message=str(e),
                    details={"error": str(e)},
                )
            conn.commit()
        raise


if __name__ == "__main__":
    main()
