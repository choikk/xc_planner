#!/usr/bin/env python3

import argparse
import os
import sys
import ssl
import re
import shutil
import zipfile
import json
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from datetime import datetime
from urllib.request import urlopen
from collections import defaultdict

import pandas as pd
import requests
from bs4 import BeautifulSoup
from psycopg import connect

DATABASE_URL = os.environ.get("NEON_DATABASE_URL")

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
            faa_cycle text,
            airport_count integer,
            runway_count integer,
            approach_airport_count integer,
            approach_count integer,
            log jsonb,
            details jsonb,
            updated_at timestamptz NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS faa_cycle text")
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS airport_count integer")
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS runway_count integer")
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS approach_airport_count integer")
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS approach_count integer")
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS log jsonb")
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS details jsonb")
    cur.execute("ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS airport_dataset_history (
            id bigserial PRIMARY KEY,
            dataset_name text NOT NULL,
            effective_date text NOT NULL,
            faa_cycle text,
            airport_count integer,
            runway_count integer,
            approach_airport_count integer,
            approach_count integer,
            started_at timestamptz,
            finished_at timestamptz NOT NULL DEFAULT NOW(),
            status text NOT NULL,
            message text,
            details jsonb
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airport_dataset_history_dataset_name ON airport_dataset_history (dataset_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airport_dataset_history_finished_at ON airport_dataset_history (finished_at)")


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


def get_navigation_table_counts(cur) -> dict[str, int]:
    counts = {}
    for table_name in (
        "fixes_v2",
        "navaids_v2",
        "airway_segments_v2",
        "airway_segment_altitudes_v2",
    ):
        cur.execute(f"SELECT COUNT(*) FROM {table_name}")
        counts[table_name] = int(cur.fetchone()[0])
    return counts


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


def normalize_column_name(name: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", str(name).strip().upper()).strip("_")


def load_csv_group(path: Path, filename: str) -> pd.DataFrame:
    file_path = path / filename
    if not file_path.exists():
        return pd.DataFrame()

    df = pd.read_csv(file_path, dtype=str).fillna("")
    df.columns = [normalize_column_name(column) for column in df.columns]
    return df


def clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return ""
    return text


def first_nonempty(record: dict, *candidates: str) -> str:
    for candidate in candidates:
        value = clean_text(record.get(candidate))
        if value:
            return value
    return ""


def to_float_or_none(value):
    text = clean_text(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def to_int_or_none(value):
    text = clean_text(value)
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def parse_dms_coordinate(value):
    text = clean_text(value).replace(" ", "")
    if not text:
        return None

    match = re.fullmatch(r"(\d+)-(\d+)-([\d.]+)([NSEW])", text)
    if not match:
        return None

    degrees = int(match.group(1))
    minutes = int(match.group(2))
    seconds = float(match.group(3))
    hemisphere = match.group(4)
    decimal = degrees + (minutes / 60) + (seconds / 3600)
    if hemisphere in ("S", "W"):
        decimal *= -1
    return decimal


def extract_coordinate(record: dict, decimal_candidates: list[str], dms_candidates: list[str]):
    for candidate in decimal_candidates:
        value = to_float_or_none(record.get(candidate))
        if value is not None:
            return value

    for candidate in dms_candidates:
        value = parse_dms_coordinate(record.get(candidate))
        if value is not None:
            return value

    return None


def dataframe_records(df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []
    return [{column: clean_text(value) for column, value in row.items()} for row in df.to_dict(orient="records")]


def group_records(records: list[dict], *key_candidates: str) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        key = first_nonempty(record, *key_candidates).upper()
        if key:
            grouped[key].append(record)
    return dict(grouped)


def collect_matching_values(record: dict, patterns: list[str]) -> list[str]:
    values = []
    for key, value in record.items():
        normalized_key = normalize_column_name(key)
        if any(pattern in normalized_key for pattern in patterns):
            cleaned = clean_text(value)
            if cleaned:
                values.append(cleaned)
    return values


def unique_join(values: list[str]) -> str:
    seen = set()
    ordered = []
    for value in values:
        cleaned = clean_text(value)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        ordered.append(cleaned)
    return ", ".join(ordered)


def load_airport_base(path: Path) -> pd.DataFrame:
    df = load_csv_group(path, "APT_BASE.csv")
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
    df = load_csv_group(path, "APT_RWY.csv")
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
    df = load_csv_group(path, "CLS_ARSP.csv")
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


def load_fixes(path: Path) -> dict[str, dict]:
    base_records = dataframe_records(load_csv_group(path, "FIX_BASE.csv"))
    chart_records = group_records(dataframe_records(load_csv_group(path, "FIX_CHRT.csv")), "FIX_ID")
    nav_records = group_records(dataframe_records(load_csv_group(path, "FIX_NAV.csv")), "FIX_ID")

    fixes = {}

    for record in base_records:
        fix_id = first_nonempty(record, "FIX_ID").upper()
        if not fix_id:
            continue

        lat = extract_coordinate(
            record,
            ["LAT_DECIMAL", "FIX_LAT_DECIMAL", "FIX_ID_LAT_DECIMAL"],
            ["FIX_LAT", "LATITUDE", "LAT"],
        )
        lon = extract_coordinate(
            record,
            ["LONG_DECIMAL", "LON_DECIMAL", "FIX_LONG_DECIMAL", "FIX_ID_LONG_DECIMAL"],
            ["FIX_LONG", "LONGITUDE", "LON", "LONG"],
        )
        if lat is None or lon is None:
            continue

        related_chart_records = chart_records.get(fix_id, [])
        related_nav_records = nav_records.get(fix_id, [])
        charts = unique_join(
            [first_nonempty(record, "CHARTS")]
            + [first_nonempty(chart_record, "CHARTING_TYPE_DESC", "CHARTS") for chart_record in related_chart_records]
        )
        chart_info = unique_join([
            *[first_nonempty(nav_record, "CHART_INFO", "CHART_INFO_DESC") for nav_record in related_nav_records],
            *[value for nav_record in related_nav_records for value in collect_matching_values(nav_record, ["CHART_INFO"])],
        ])
        nav_makeup = unique_join([
            *[value for nav_record in related_nav_records for value in collect_matching_values(nav_record, ["MAKEUP"])],
            *[value for nav_record in related_nav_records for value in collect_matching_values(nav_record, ["NAV"])],
        ])

        fixes[fix_id] = {
            "fix_id": fix_id,
            "fix_use_code": first_nonempty(record, "FIX_USE_CODE", "FIX_USE"),
            "state_code": first_nonempty(record, "STATE_CODE"),
            "artcc": first_nonempty(record, "ARTCC"),
            "lat": lat,
            "lon": lon,
            "charts": charts,
            "chart_info": chart_info,
            "nav_makeup": nav_makeup,
            "description": first_nonempty(record, "DESCRIPTION", "FIX_DESCRIPTION"),
            "raw_json": {
                "base": record,
                "chart_rows": related_chart_records,
                "nav_rows": related_nav_records,
            },
        }

    return fixes


def load_navaids(path: Path) -> dict[str, dict]:
    records = dataframe_records(load_csv_group(path, "NAV_BASE.csv"))
    navaids = {}

    for record in records:
        nav_id = first_nonempty(record, "NAV_ID", "IDENT", "ID").upper()
        if not nav_id:
            continue

        lat = extract_coordinate(
            record,
            ["LAT_DECIMAL", "NAV_LAT_DECIMAL"],
            ["LATITUDE", "LAT", "NAV_LAT"],
        )
        lon = extract_coordinate(
            record,
            ["LONG_DECIMAL", "LON_DECIMAL", "NAV_LONG_DECIMAL"],
            ["LONGITUDE", "LONG", "LON", "NAV_LONG"],
        )
        if lat is None or lon is None:
            continue

        navaids[nav_id] = {
            "nav_id": nav_id,
            "facility_name": first_nonempty(record, "NAV_NAME", "FACILITY_NAME", "NAME"),
            "nav_type": first_nonempty(record, "NAV_TYPE", "NAV_TYPE_CODE", "FACILITY_TYPE", "TYPE"),
            "state_code": first_nonempty(record, "STATE_CODE"),
            "city": first_nonempty(record, "CITY"),
            "lat": lat,
            "lon": lon,
            "frequency": first_nonempty(record, "FREQUENCY", "FREQ", "FREQUENCY_MHZ"),
            "channel": first_nonempty(record, "CHANNEL", "TACAN_CHANNEL"),
            "magnetic_variation": first_nonempty(record, "MAGNETIC_VARIATION", "MAG_VAR", "MAGNETIC_VAR"),
            "service_volume": unique_join([
                first_nonempty(record, "SERVICE_VOLUME", "SERVICE_VOLUME_CODE"),
                first_nonempty(record, "CLASS", "CLASS_CODE"),
            ]),
            "voice": first_nonempty(record, "VOICE_FEATURE", "VOICE", "VOICE_CODE"),
            "raw_json": record,
        }

    return navaids


def load_airway_routes(path: Path) -> dict[str, dict]:
    records = dataframe_records(load_csv_group(path, "AWY_BASE.csv"))
    routes = {}

    for record in records:
        designation = first_nonempty(record, "AWY_ID", "DESIGNATION", "AIRWAY_ID").upper()
        if not designation:
            continue

        routes[designation] = {
            "designation": designation,
            "route_type": designation[:1],
            "airway_designation": first_nonempty(record, "AWY_DESIGNATION"),
            "airway_location": first_nonempty(record, "AWY_LOCATION"),
            "regulatory": first_nonempty(record, "REGULATORY"),
            "remark": first_nonempty(record, "REMARK"),
            "airway_string": first_nonempty(record, "AIRWAY_STRING"),
            "raw_json": record,
        }

    return routes


def build_airway_coordinate_lookup(
    fixes: dict[str, dict],
    navaids: dict[str, dict],
) -> dict[str, tuple[float, float]]:
    coordinates = {}

    for record in fixes.values():
        fix_id = clean_text(record.get("fix_id")).upper()
        lat = record.get("lat")
        lon = record.get("lon")
        if fix_id and lat is not None and lon is not None:
            coordinates[fix_id] = (lat, lon)

    for record in navaids.values():
        nav_id = clean_text(record.get("nav_id")).upper()
        lat = record.get("lat")
        lon = record.get("lon")
        if nav_id and lat is not None and lon is not None and nav_id not in coordinates:
            coordinates[nav_id] = (lat, lon)

    return coordinates


def load_airway_segments(path: Path, coordinate_lookup: dict[str, tuple[float, float]]) -> list[dict]:
    records = dataframe_records(load_csv_group(path, "AWY_SEG_ALT.csv"))
    segments = []

    for record in records:
        designation = first_nonempty(record, "AWY_ID", "DESIGNATION", "AIRWAY_ID").upper()
        point_seq = to_int_or_none(first_nonempty(record, "POINT_SEQ", "PT_SEQ", "SEQUENCE_NUMBER"))
        if not designation or point_seq is None:
            continue

        from_point = first_nonempty(record, "FROM_POINT", "POINT_NAME", "FIX_ID").upper()
        lat = None
        lon = None
        if from_point and from_point in coordinate_lookup:
            lat, lon = coordinate_lookup[from_point]

        segments.append({
            "designation": designation,
            "route_type": designation[:1],
            "awy_location": first_nonempty(record, "AWY_LOCATION", "LOCATION", "REGION_CODE"),
            "point_seq": point_seq,
            "from_point": from_point,
            "from_point_type": first_nonempty(record, "FROM_PT_TYPE", "POINT_TYPE", "FIX_TYPE").strip(),
            "to_point": first_nonempty(record, "TO_POINT").upper(),
            "state_code": first_nonempty(record, "STATE_CODE"),
            "lat": lat,
            "lon": lon,
            "segment_course": first_nonempty(record, "MAG_COURSE", "SEG_MAG_COURSE", "SEGMENT_MAG_COURSE"),
            "segment_course_opposite": first_nonempty(record, "OPP_MAG_COURSE", "SEG_MAG_COURSE_OPPOSITE", "SEGMENT_MAG_COURSE_OPPOSITE"),
            "next_point_distance_nm": to_float_or_none(first_nonempty(record, "MAG_COURSE_DIST", "NEXT_POINT_DIST_SEG", "NEXT_POINT_DISTANCE_SEG")),
            "dog_leg": first_nonempty(record, "DOGLEG", "DOG_LEG"),
            "raw_json": record,
        })

    return segments


def load_airway_segment_altitudes(path: Path) -> list[dict]:
    records = dataframe_records(load_csv_group(path, "AWY_SEG_ALT.csv"))
    altitudes = []

    for record in records:
        designation = first_nonempty(record, "AWY_ID", "DESIGNATION", "AIRWAY_ID").upper()
        point_seq = to_int_or_none(first_nonempty(record, "POINT_SEQ", "PT_SEQ", "SEQUENCE_NUMBER"))
        if not designation or point_seq is None:
            continue

        altitudes.append({
            "designation": designation,
            "route_type": designation[:1],
            "awy_location": first_nonempty(record, "AWY_LOCATION", "LOCATION", "REGION_CODE"),
            "point_seq": point_seq,
            "point_name": first_nonempty(record, "FROM_POINT", "POINT_NAME", "FIX_ID").upper(),
            "point_ident": first_nonempty(record, "FROM_POINT", "NAV_ID", "FIX_ID", "POINT_IDENT").upper(),
            "point_type": first_nonempty(record, "FROM_PT_TYPE", "POINT_TYPE", "FIX_TYPE").strip(),
            "minimum_altitude": first_nonempty(
                record,
                "MIN_ENROUTE_ALT",
                "GPS_MIN_ENROUTE_ALT",
                "MIN_ALTITUDE",
                "MEA",
                "MINIMUM_ENROUTE_ALTITUDE",
                "ALTITUDE_LOW",
            ),
            "maximum_altitude": first_nonempty(
                record,
                "MAX_AUTH_ALT",
                "MAX_ALTITUDE",
                "MAA",
                "MAXIMUM_ALTITUDE",
                "ALTITUDE_HIGH",
            ),
            "direction_of_flight": first_nonempty(
                record,
                "MIN_ENROUTE_ALT_DIR",
                "GPS_MIN_ENROUTE_ALT_DIR",
                "DIRECTION_OF_FLIGHT",
                "DIRECTION",
            ),
            "raw_json": record,
        })

    return altitudes


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

    cur.execute("""
        CREATE TABLE IF NOT EXISTS fixes_v2 (
            fix_id text PRIMARY KEY,
            fix_use_code text,
            state_code text,
            artcc text,
            lat double precision NOT NULL,
            lon double precision NOT NULL,
            charts text,
            chart_info text,
            nav_makeup text,
            description text,
            raw_json jsonb
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fixes_v2_state ON fixes_v2 (state_code)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fixes_v2_artcc ON fixes_v2 (artcc)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS navaids_v2 (
            nav_id text PRIMARY KEY,
            facility_name text,
            nav_type text,
            state_code text,
            city text,
            lat double precision NOT NULL,
            lon double precision NOT NULL,
            frequency text,
            channel text,
            magnetic_variation text,
            service_volume text,
            voice text,
            raw_json jsonb
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_navaids_v2_type ON navaids_v2 (nav_type)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_navaids_v2_state ON navaids_v2 (state_code)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS airway_routes_v2 (
            designation text PRIMARY KEY,
            route_type text,
            airway_designation text,
            airway_location text,
            regulatory text,
            remark text,
            airway_string text,
            raw_json jsonb
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airway_routes_v2_route_type ON airway_routes_v2 (route_type)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS airway_segments_v2 (
            designation text NOT NULL,
            route_type text,
            awy_location text NOT NULL DEFAULT '',
            point_seq integer NOT NULL,
            from_point text,
            from_point_type text,
            to_point text,
            state_code text,
            lat double precision,
            lon double precision,
            segment_course text,
            segment_course_opposite text,
            next_point_distance_nm double precision,
            dog_leg text,
            raw_json jsonb,
            PRIMARY KEY (designation, awy_location, point_seq)
        )
    """)
    # designation alone is not unique: the same airway id (e.g. V1) exists in
    # separate FAA regions (C=CONUS, A=Alaska, H=Hawaii), so awy_location is part
    # of the key. Migrate any pre-existing table off the old (designation, point_seq) PK.
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS awy_location text NOT NULL DEFAULT ''")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS route_type text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS from_point text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS from_point_type text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS to_point text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS state_code text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS lat double precision")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS lon double precision")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS segment_course text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS segment_course_opposite text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS next_point_distance_nm double precision")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS dog_leg text")
    cur.execute("ALTER TABLE airway_segments_v2 ADD COLUMN IF NOT EXISTS raw_json jsonb")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airway_segments_v2_route_type ON airway_segments_v2 (route_type)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airway_segments_v2_from_point ON airway_segments_v2 (from_point)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airway_segments_v2_to_point ON airway_segments_v2 (to_point)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS airway_segment_altitudes_v2 (
            id bigserial PRIMARY KEY,
            designation text NOT NULL,
            route_type text,
            awy_location text NOT NULL DEFAULT '',
            point_seq integer NOT NULL,
            point_name text,
            point_ident text,
            point_type text,
            minimum_altitude text,
            maximum_altitude text,
            direction_of_flight text,
            raw_json jsonb
        )
    """)
    cur.execute("ALTER TABLE airway_segment_altitudes_v2 ADD COLUMN IF NOT EXISTS awy_location text NOT NULL DEFAULT ''")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_airway_segment_altitudes_v2_designation ON airway_segment_altitudes_v2 (designation, awy_location, point_seq)")


def refresh_fixes_v2(cur, fixes: dict[str, dict]):
    cur.execute("TRUNCATE TABLE fixes_v2")
    rows = [
        (
            record.get("fix_id"),
            record.get("fix_use_code"),
            record.get("state_code"),
            record.get("artcc"),
            record.get("lat"),
            record.get("lon"),
            record.get("charts"),
            record.get("chart_info"),
            record.get("nav_makeup"),
            record.get("description"),
            json.dumps(record.get("raw_json") or {}, ensure_ascii=False),
        )
        for record in fixes.values()
    ]
    cur.executemany(
        """
        INSERT INTO fixes_v2 (
            fix_id,
            fix_use_code,
            state_code,
            artcc,
            lat,
            lon,
            charts,
            chart_info,
            nav_makeup,
            description,
            raw_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """,
        rows,
    )


def refresh_navaids_v2(cur, navaids: dict[str, dict]):
    cur.execute("TRUNCATE TABLE navaids_v2")
    rows = [
        (
            record.get("nav_id"),
            record.get("facility_name"),
            record.get("nav_type"),
            record.get("state_code"),
            record.get("city"),
            record.get("lat"),
            record.get("lon"),
            record.get("frequency"),
            record.get("channel"),
            record.get("magnetic_variation"),
            record.get("service_volume"),
            record.get("voice"),
            json.dumps(record.get("raw_json") or {}, ensure_ascii=False),
        )
        for record in navaids.values()
    ]
    cur.executemany(
        """
        INSERT INTO navaids_v2 (
            nav_id,
            facility_name,
            nav_type,
            state_code,
            city,
            lat,
            lon,
            frequency,
            channel,
            magnetic_variation,
            service_volume,
            voice,
            raw_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """,
        rows,
    )


def refresh_airway_routes_v2(cur, airway_routes: dict[str, dict]):
    cur.execute("TRUNCATE TABLE airway_routes_v2")
    rows = [
        (
            record.get("designation"),
            record.get("route_type"),
            record.get("airway_designation"),
            record.get("airway_location"),
            record.get("regulatory"),
            record.get("remark"),
            record.get("airway_string"),
            json.dumps(record.get("raw_json") or {}, ensure_ascii=False),
        )
        for record in airway_routes.values()
    ]
    cur.executemany(
        """
        INSERT INTO airway_routes_v2 (
            designation,
            route_type,
            airway_designation,
            airway_location,
            regulatory,
            remark,
            airway_string,
            raw_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """,
        rows,
    )


def refresh_airway_segments_v2(cur, airway_segments: list[dict]):
    cur.execute("TRUNCATE TABLE airway_segments_v2")
    # Reload without the composite PK, then rebuild it (see ensure-schema note:
    # awy_location distinguishes same-id airways across FAA regions).
    cur.execute("ALTER TABLE airway_segments_v2 DROP CONSTRAINT IF EXISTS airway_segments_v2_pkey")
    rows = [
        (
            record.get("designation"),
            record.get("route_type"),
            record.get("awy_location") or "",
            record.get("point_seq"),
            record.get("from_point"),
            record.get("from_point_type"),
            record.get("to_point"),
            record.get("state_code"),
            record.get("lat"),
            record.get("lon"),
            record.get("segment_course"),
            record.get("segment_course_opposite"),
            record.get("next_point_distance_nm"),
            record.get("dog_leg"),
            json.dumps(record.get("raw_json") or {}, ensure_ascii=False),
        )
        for record in airway_segments
    ]
    cur.executemany(
        """
        INSERT INTO airway_segments_v2 (
            designation,
            route_type,
            awy_location,
            point_seq,
            from_point,
            from_point_type,
            to_point,
            state_code,
            lat,
            lon,
            segment_course,
            segment_course_opposite,
            next_point_distance_nm,
            dog_leg,
            raw_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """,
        rows,
    )
    cur.execute(
        "ALTER TABLE airway_segments_v2 "
        "ADD CONSTRAINT airway_segments_v2_pkey "
        "PRIMARY KEY (designation, awy_location, point_seq)"
    )


def refresh_airway_segment_altitudes_v2(cur, airway_altitudes: list[dict]):
    cur.execute("TRUNCATE TABLE airway_segment_altitudes_v2 RESTART IDENTITY")
    rows = [
        (
            record.get("designation"),
            record.get("route_type"),
            record.get("awy_location") or "",
            record.get("point_seq"),
            record.get("point_name"),
            record.get("point_ident"),
            record.get("point_type"),
            record.get("minimum_altitude"),
            record.get("maximum_altitude"),
            record.get("direction_of_flight"),
            json.dumps(record.get("raw_json") or {}, ensure_ascii=False),
        )
        for record in airway_altitudes
    ]
    cur.executemany(
        """
        INSERT INTO airway_segment_altitudes_v2 (
            designation,
            route_type,
            awy_location,
            point_seq,
            point_name,
            point_ident,
            point_type,
            minimum_altitude,
            maximum_altitude,
            direction_of_flight,
            raw_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """,
        rows,
    )


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
    upsert_rows = [
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
        )
        for airport_code, rec in airport_data.items()
    ]
    cur.executemany(
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
        upsert_rows,
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

    runway_rows = []
    approach_rows = []
    for airport_code, rec in airport_data.items():
        for rwy in rec.get("runways", []):
            length_ft = int(rwy["length"]) if str(rwy.get("length", "")).strip().isdigit() else None
            width_ft = int(rwy["width"]) if str(rwy.get("width", "")).strip().isdigit() else None
            runway_rows.append(
                (
                    airport_code,
                    rwy.get("rwy_id"),
                    length_ft,
                    width_ft,
                    rwy.get("surface"),
                    rwy.get("condition"),
                )
            )

        for ap in rec.get("approaches", []):
            approach_rows.append(
                (
                    airport_code,
                    ap.get("name"),
                    ap.get("pdf_url"),
                    ap.get("procuid"),
                    ap.get("amdt_num"),
                    ap.get("amdt_date"),
                )
            )

    cur.executemany(
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
        runway_rows,
    )
    cur.executemany(
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
        approach_rows,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Import FAA airport/navigation data into Neon.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and parse FAA data without writing anything to the database.",
    )
    args = parser.parse_args(argv)

    started_at = now_utc()

    effective_date = get_current_nasr_effective_date()
    print(f"Current NASR effective date: {effective_date}")

    cycle = get_cycle_from_effective_date(effective_date)
    print(f"Current FAA cycle: {cycle}")

    zip_url = ZIP_BASE_URL.format(effective_date)
    dtpp_base_pdf_url = DTPP_BASE_URL.format(cycle)
    dtpp_xml_url = DTPP_XML_URL.format(cycle)

    dataset_name = "airports_v2_source"

    if not args.dry_run:
        if not DATABASE_URL:
            raise RuntimeError("Missing NEON_DATABASE_URL")

        # Make sure metadata tables exist and check current applied version
        with connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                ensure_metadata_table(cur)
                ensure_v2_tables_exist(cur)
                stored_version = get_stored_effective_date(cur, dataset_name)
                navigation_counts = get_navigation_table_counts(cur)

            navigation_backfill_ready = all(count > 0 for count in navigation_counts.values())

            if stored_version == effective_date and navigation_backfill_ready:
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
                        details={
                            "stored_version": stored_version,
                            "navigation_counts": navigation_counts,
                        },
                    )
                conn.commit()
                print(f"Database already up to date: {effective_date}")
                return

            if stored_version == effective_date and not navigation_backfill_ready:
                print(f"Current cycle already applied, but navigation tables need backfill: {navigation_counts}")

    airport_count = None
    runway_count = None
    approach_airport_count = None
    approach_count = None
    fix_count = None
    navaid_count = None
    airway_route_count = None
    airway_segment_count = None
    airway_altitude_count = None

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
        fixes = load_fixes(csv_path)
        navaids = load_navaids(csv_path)
        airway_routes = load_airway_routes(csv_path)
        airway_coordinate_lookup = build_airway_coordinate_lookup(fixes, navaids)
        airway_segments = load_airway_segments(csv_path, airway_coordinate_lookup)
        airway_altitudes = load_airway_segment_altitudes(csv_path)

        airport_data = build_airport_data(df_base, rwy_dict, airspace_info, approach_dict)

        airport_count = len(airport_data)
        runway_count = sum(len(v.get("runways", [])) for v in airport_data.values())
        approach_airport_count = len(approach_dict)
        approach_count = sum(len(v) for v in approach_dict.values())
        fix_count = len(fixes)
        navaid_count = len(navaids)
        airway_route_count = len(airway_routes)
        airway_segment_count = len(airway_segments)
        airway_altitude_count = len(airway_altitudes)

        print(f"Loaded {approach_airport_count} airports with approach plates from d-TPP XML (cycle {xml_cycle})")
        print(f"Built airport dataset: {airport_count} airports")
        print(f"Loaded {fix_count} fixes")
        print(f"Loaded {navaid_count} navaids")
        print(f"Loaded {airway_route_count} airway routes")
        print(f"Loaded {airway_segment_count} airway segments")
        print(f"Loaded {airway_altitude_count} airway altitude rows")

        details = {
            "effective_date": effective_date,
            "faa_cycle": cycle,
            "xml_cycle": xml_cycle,
            "airport_count": airport_count,
            "runway_count": runway_count,
            "approach_airport_count": approach_airport_count,
            "approach_count": approach_count,
            "fix_count": fix_count,
            "navaid_count": navaid_count,
            "airway_route_count": airway_route_count,
            "airway_segment_count": airway_segment_count,
            "airway_altitude_count": airway_altitude_count,
        }

        if args.dry_run:
            print("Dry run complete. No database writes were performed.")
            print(json.dumps(details, indent=2, ensure_ascii=False))
            return

        with connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                sync_airports_v2(cur, airport_data)
                refresh_runways_and_approaches(cur, airport_data)
                refresh_fixes_v2(cur, fixes)
                refresh_navaids_v2(cur, navaids)
                refresh_airway_routes_v2(cur, airway_routes)
                refresh_airway_segments_v2(cur, airway_segments)
                refresh_airway_segment_altitudes_v2(cur, airway_altitudes)

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
        return

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
                    details={
                        "error": str(e),
                        "fix_count": fix_count,
                        "navaid_count": navaid_count,
                        "airway_route_count": airway_route_count,
                        "airway_segment_count": airway_segment_count,
                        "airway_altitude_count": airway_altitude_count,
                    },
                )
            conn.commit()
        raise


if __name__ == "__main__":
    main()
