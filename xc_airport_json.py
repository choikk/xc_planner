import os
import pandas as pd
import json
import xml.etree.ElementTree as ET
from urllib.request import urlopen
import ssl
from datetime import datetime
import requests
from bs4 import BeautifulSoup
import zipfile
from io import BytesIO
import shutil

# Current date (system-provided: April 07, 2025, 8:21 PM PDT)
CURRENT_DATE = datetime(2025, 4, 7, 20, 21)

# Base path for 28-day subscription folders
BASE_PATH = "/Users/kchoi/Workspace/airport_data"

# NASR subscription page URL and ZIP base URL
NASR_SUB_URL = "https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/"
ZIP_BASE_URL = "https://nfdc.faa.gov/webContent/28DaySub/28DaySubscription_Effective_{}.zip"
DTPP_BASE_URL = "https://aeronav.faa.gov/d-tpp/{}/"
DTPP_XML_URL = "https://aeronav.faa.gov/d-tpp/{}/xml_data/d-TPP_Metafile.xml"

# === FETCH CURRENT NASR EFFECTIVE DATE FROM "CURRENT" SECTION ===
def get_current_nasr_effective_date():
    try:
        response = requests.get(NASR_SUB_URL, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        current_section = soup.find("h2", string="Current")
        if not current_section:
            raise ValueError("Could not find '<h2>Current</h2>' section on page")

        ul = current_section.find_next("ul")
        if not ul:
            raise ValueError("No <ul> found after 'Current' section")
        
        li = ul.find("li")
        if not li:
            raise ValueError("No <li> found under 'Current' section")
        
        a_tag = li.find("a", href=True)
        if not a_tag:
            raise ValueError("No <a> tag found under 'Current' section")

        href = a_tag["href"]
        effective_date = href.split("/")[-1]  # Get "2025-03-20"
        return effective_date
    except Exception as e:
        print(f"⚠️ Failed to fetch current NASR effective date: {e}")
        return "2025-03-20"

effective_date = get_current_nasr_effective_date()
print(f"✅ Current NASR effective date: {effective_date}")

# Construct ZIP URL
zip_url = ZIP_BASE_URL.format(effective_date)
print(f"✅ Current NASR ZIP URL: {zip_url}")

# Derive cycle from effective date (YYMM)
cycle_date = datetime.strptime(effective_date, "%Y-%m-%d")
current_cycle = f"{cycle_date.strftime('%y')}{cycle_date.month:02d}"  # e.g., "2503" for March
print(f"✅ Current FAA cycle: {current_cycle}")

# Construct d-TPP URLs
BASE_PDF_URL = DTPP_BASE_URL.format(current_cycle)  # e.g., "https://aeronav.faa.gov/d-tpp/2503/"
d_tpp_xml_url = DTPP_XML_URL.format(current_cycle)  # e.g., "https://aeronav.faa.gov/d-tpp/2503/xml_data/d-TPP_Metafile.xml"
print(f"✅ d-TPP XML URL: {d_tpp_xml_url}")

# === DOWNLOAD AND EXTRACT ONLY CSV_Data ===
def download_and_extract_csv_data(url, extract_path):
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        with zipfile.ZipFile(BytesIO(response.content)) as z:
            csv_data_files = [f for f in z.namelist() if f.startswith("CSV_Data/")]
            if not csv_data_files:
                raise ValueError("No CSV_Data directory found in main ZIP")
            z.extractall(extract_path, members=csv_data_files)
        print(f"✅ Extracted CSV_Data from main ZIP to: {extract_path}")

        csv_data_path = os.path.join(extract_path, "CSV_Data")
        if not os.path.isdir(csv_data_path):
            raise FileNotFoundError(f"CSV_Data folder not found in {extract_path}")
        
        secondary_zip = None
        for file in os.listdir(csv_data_path):
            if file.endswith(".zip"):
                secondary_zip = os.path.join(csv_data_path, file)
                break
        
        if not secondary_zip:
            raise FileNotFoundError(f"No secondary ZIP file found in {csv_data_path}")
        
        with zipfile.ZipFile(secondary_zip, "r") as z:
            z.extractall(csv_data_path)
        print(f"✅ Extracted secondary ZIP: {secondary_zip}")

        os.remove(secondary_zip)
        print(f"✅ Deleted secondary ZIP: {secondary_zip}")
    except Exception as e:
        print(f"⚠️ Failed to extract CSV_Data selectively: {e}")
        raise

# Set the folder name and path
#selected_folder = f"28DaySubscription_Effective_{effective_date}"
selected_folder = f"28DaySubscription_Effective_"
extract_path = os.path.join(BASE_PATH, selected_folder)

# Download and extract if folder doesn’t exist
if os.path.isdir(extract_path):
    print(f"✅ Folder {selected_folder} already exists; Deleting for re-downloading")
    try:
        if os.path.isdir(extract_path):
            print(f"🗑️ Folder {selected_folder} exists; deleting it")
            shutil.rmtree(extract_path)
    except Exception as e:
        print(f"⚠️ Failed to delete folder {selected_folder}: {e}")
        raise
os.makedirs(extract_path, exist_ok=True)
download_and_extract_csv_data(zip_url, extract_path)

# Set path to CSV_Data subfolder
path = os.path.join(extract_path, "CSV_Data")

if not os.path.isdir(path):
    print(f"⚠️ CSV_Data subfolder not found at {path}; check ZIP contents")
    raise FileNotFoundError("CSV_Data subfolder missing")

# Write effective_date to db_versions.txt
with open("db_versions.txt", "w") as f:
    f.write(effective_date + "\n")
print("✅ Version written to db_versions.txt:", effective_date)

# === LOAD AIRPORT BASE CSV ===
apt_base_csv = os.path.join(path, "APT_BASE.csv")
df_base = pd.read_csv(apt_base_csv, dtype=str)
df_base = df_base[df_base["SITE_TYPE_CODE"].str.upper() == "A"]

df_base["ICAO_ID"] = df_base["ICAO_ID"].fillna("").str.strip().str.upper()
df_base["ARPT_ID"] = df_base["ARPT_ID"].fillna("").str.strip().str.upper()
df_base["AirportCode"] = df_base["ICAO_ID"]
df_base.loc[df_base["AirportCode"] == "", "AirportCode"] = df_base["ARPT_ID"]

df_base["LAT_DECIMAL"] = pd.to_numeric(df_base["LAT_DECIMAL"], errors="coerce")
df_base["LONG_DECIMAL"] = pd.to_numeric(df_base["LONG_DECIMAL"], errors="coerce")
df_base = df_base.dropna(subset=["AirportCode", "LAT_DECIMAL", "LONG_DECIMAL", "SITE_NO"])

# === LOAD RUNWAY DATA ===
apt_rwy_csv = os.path.join(path, "APT_RWY.csv")
df_rwy = pd.read_csv(apt_rwy_csv, dtype=str)
df_rwy = df_rwy[["SITE_NO", "RWY_ID", "RWY_LEN", "RWY_WIDTH", "SURFACE_TYPE_CODE", "COND"]]
df_rwy["COND"] = df_rwy["COND"].fillna("").str.strip().str.upper()
df_rwy["SURFACE_TYPE_CODE"] = df_rwy["SURFACE_TYPE_CODE"].fillna("").str.strip().str.upper()

rwy_dict = {}
for _, row in df_rwy.iterrows():
    cond = ""
    if "X" in row["RWY_ID"] or "H" in row["RWY_ID"]:
        continue
    if not row["RWY_LEN"] or row["RWY_LEN"].strip() == "0":
        continue
    if row["COND"] == "":
        cond = "Unknown Condition"
    else:
        cond = row["COND"]

    rwy_info = {
        "rwy_id": row["RWY_ID"],
        "length": row["RWY_LEN"],
        "width": row["RWY_WIDTH"],
        "surface": row["SURFACE_TYPE_CODE"],
        "condition": cond
    }
    rwy_dict.setdefault(row["SITE_NO"], []).append(rwy_info)

# === LOAD AIRSPACE DATA ===
cls_arsp_csv = os.path.join(path, "CLS_ARSP.csv")
df_cls = pd.read_csv(cls_arsp_csv, dtype=str)
df_cls["REMARK"] = df_cls["REMARK"].fillna("").str.strip()

def determine_airspace(row):
    if row["CLASS_B_AIRSPACE"] == "Y":
        return "B"
    elif row["CLASS_C_AIRSPACE"] == "Y":
        return "C"
    elif row["CLASS_D_AIRSPACE"] == "Y":
        return "D"
    elif row["CLASS_E_AIRSPACE"] == "Y":
        return "E"
    else:
        return "G"

airspace_info = {}
for site_no, group in df_cls.groupby("SITE_NO"):
    highest = "G"
    remark = ""
    for _, row in group.iterrows():
        classification = determine_airspace(row)
        if "B" == classification:
            highest = "B"
        elif "C" == classification and highest not in ["B"]:
            highest = "C"
        elif "D" == classification and highest not in ["B", "C"]:
            highest = "D"
        elif "E" == classification and highest not in ["B", "C", "D"]:
            highest = "E"
        remark = row.get("REMARK", remark)
    airspace_info[site_no] = {"airspace": highest, "remarks": remark}

# === LOAD APPROACH PLATE DATA FROM d-TPP XML ===
def parse_d_tpp_xml(xml_url):
    try:
        context = ssl._create_unverified_context()
        with urlopen(xml_url, context=context) as response:
            xml_content = response.read().decode("utf-8")
            print(f"DEBUG: XML content length: {len(xml_content)} characters")
            tree = ET.ElementTree(ET.fromstring(xml_content))
        
        root = tree.getroot()
        cycle = root.get("cycle", current_cycle)
        print(f"DEBUG: XML cycle: {cycle}")
        
        approach_dict = {}
        airports = root.findall(".//airport_name")
        print(f"DEBUG: Found {len(airports)} airports in XML")
        
        for airport in airports:
            site_no = airport.get("alnum")
            apt_ident = airport.get("apt_ident")
            icao_ident = airport.get("icao_ident", "")
            key = icao_ident if icao_ident else apt_ident  # Prioritize icao_ident over apt_ident
            print(f"DEBUG: Processing airport key: {key} (site_no: {site_no}, icao: {icao_ident}, apt: {apt_ident})")
            
            approaches = []
            records = airport.findall("record")
            print(f"DEBUG: Found {len(records)} records for {key}")
            
            for record in records:
                chart_code = record.find("chart_code").text if record.find("chart_code") is not None else None
                if chart_code == "IAP":
                    pdf_name = record.find("pdf_name").text if record.find("pdf_name") is not None else ""
                    approach = {
                        "name": record.find("chart_name").text if record.find("chart_name") is not None else "",
                        "pdf_url": f"{BASE_PDF_URL}{pdf_name}",
                        "procuid": record.find("procuid").text if record.find("procuid") is not None else "",
                        "amdt_num": record.find("amdtnum").text or "",
                        "amdt_date": record.find("amdtdate").text or ""
                    }
                    approaches.append(approach)
                    print(f"DEBUG: Added approach for {key}: {approach['name']}")
            
            if approaches:
                approach_dict[key] = approaches
        
        print(f"DEBUG: Total approaches in dict: {sum(len(v) for v in approach_dict.values())}")
        return approach_dict, cycle
    except Exception as e:
        print(f"⚠️ Failed to parse d-TPP XML from {xml_url}: {e}")
        return {}, current_cycle

approach_dict, xml_cycle = parse_d_tpp_xml(d_tpp_xml_url)
print(f"✅ Loaded {len(approach_dict)} airports with approach plates from d-TPP XML (Cycle: {xml_cycle})")

# === COMBINE ALL DATA ===
airport_data = {}
na = 0
aa = 0
for _, row in df_base.iterrows():
    code = row["AirportCode"]
    site_no = row["SITE_NO"]
    airspace = airspace_info.get(site_no, {"airspace": "G", "remarks": ""})
    # Try matching with AirportCode (ICAO_ID or ARPT_ID) instead of site_no
    approaches = approach_dict.get(code, [])
    if approaches:
        aa = aa + 1
    else:
        na = na + 1
#        print(f"DEBUG: No approaches found for code: {code}, site_no: {site_no}")

    airport_data[code] = {
        "site_no": site_no,
        "lat": float(row["LAT_DECIMAL"]),
        "lon": float(row["LONG_DECIMAL"]),
        "city": str(row.get("CITY", "")).strip(),
        "state": str(row.get("STATE_NAME", "")).strip(),
        "country": str(row.get("COUNTRY_CODE", "")).strip(),
        "airport_name": str(row.get("ARPT_NAME", "")).strip(),
        "runways": rwy_dict.get(site_no, []),
        "airspace": airspace["airspace"],
        "remarks": airspace["remarks"],
        "approaches": approaches
    }

# === SAVE JSON ===
output_dir = "json_data"
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, "airport_base_info_with_runways_airspace_approaches.json")
output_mini_path = os.path.join(output_dir, "airport_base_info_with_runways_airspace_approaches_mini.json")

with open(output_path, "w") as f:
    json.dump(airport_data, f, indent=2)
# with open(output_mini_path, "w") as f:
#     json.dump(airport_data, f, separators=(",", ":"))  # Minified version

print(f"✅ JSON with runways, airspace, and approaches saved: {output_path} ({len(airport_data)} airports)")

with open(os.path.join(output_dir, "db_versions.txt"), "w") as f:
    f.write(effective_date + "\n")
print("✅ Version written to db_versions.txt:", effective_date)
