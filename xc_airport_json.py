import os
import pandas as pd
import json

# ✅ Set your path correctly
path = "/Users/kchoi/Workspace/airport_json/28DaySubscription_Effective_2025-03-20/CSV_Data/20_Mar_2025_CSV"
folder_name = os.path.basename(path)

with open("db_versions.txt", "w") as f:
    f.write(folder_name + "\n")

print("✅ Version written to db_versions.txt:", folder_name)

# === CONFIGURATION ===
apt_base_csv = os.path.join(path,"APT_BASE.csv")
apt_rwy_csv  = os.path.join(path,"APT_RWY.csv")
cls_arsp_csv = os.path.join(path,"CLS_ARSP.csv")
output_dir   = "json_data"
output_file  = "airport_base_info_with_runways_airspace.json"
output_mini_file  = "airport_base_info_with_runways_airspace_mini.json"

# === LOAD AIRPORT BASE CSV ===
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
df_rwy = pd.read_csv(apt_rwy_csv, dtype=str)
df_rwy = df_rwy[["SITE_NO", "RWY_ID", "RWY_LEN", "RWY_WIDTH", "SURFACE_TYPE_CODE", "COND"]]
df_rwy["COND"] = df_rwy["COND"].fillna("").str.strip().str.upper()
df_rwy["SURFACE_TYPE_CODE"] = df_rwy["SURFACE_TYPE_CODE"].fillna("").str.strip().str.upper()

rwy_dict = {}
for _, row in df_rwy.iterrows():
    cond = ""
    if "X" in row["RWY_ID"] or "H" in row["RWY_ID"]:
        continue  # Skip runways with X or H in the ID

    if not row["RWY_LEN"] or row["RWY_LEN"].strip() == "0":
        continue  # Skip if length is missing or zero
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
df_cls = pd.read_csv(cls_arsp_csv, dtype=str)
df_cls["REMARK"] = df_cls["REMARK"].fillna("").str.strip()

# Determine highest airspace class
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

# Group by SITE_NO and get highest airspace + remark
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

# === COMBINE ALL DATA ===
airport_data = {}
for _, row in df_base.iterrows():
    code = row["AirportCode"]
    site_no = row["SITE_NO"]
    airspace = airspace_info.get(site_no, {"airspace": "G", "remarks": ""})

    airport_data[code] = {
        "site_no": site_no,
        "lat": float(row["LAT_DECIMAL"]),
        "lon": float(row["LONG_DECIMAL"]),
        "city": str(row.get("CITY", "")).strip(),
        "state":  str(row.get("STATE_NAME",  "")).strip(),
        "country":str(row.get("COUNTRY_CODE","")).strip(),
        "airport_name": str(row.get("ARPT_NAME", "")).strip(),
        "runways": rwy_dict.get(site_no, []),
        "airspace": airspace["airspace"],
        "remarks": airspace["remarks"]
    }

# === SAVE JSON ===
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, output_file)
output_mini_path = os.path.join(output_dir, output_mini_file)

with open(output_path, "w") as f:
    json.dump(airport_data, f, indent=2)
#with open(output_mini_path, "w") as f:
#    json.dump(airport_data, f, separators=(",", ":"))  # Minified version

print(f"✅ JSON with runways and airspace saved: {output_path} ({len(airport_data)} airports)")

with open(os.path.join(output_dir, "db_versions.txt"), "w") as f:
    f.write(folder_name + "\n")
    
print("✅ Version written to db_versions.txt:", folder_name)
        

