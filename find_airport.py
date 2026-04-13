import json
import sys

def find_airports(json_file, max_length, allowed_surfaces):
    # JSON 파일 읽기
    with open(json_file, 'r', encoding='utf-8') as f:
        airports = json.load(f)

    matches = []

    for airport_id, airport_info in airports.items():
        for runway in airport_info.get('runways', []):
            try:
                length = int(runway['length'])
            except (ValueError, KeyError):
                continue

            surface = runway.get('surface', '').upper()

            if length < max_length and surface in allowed_surfaces:
                matches.append({
                    "airport_id": airport_id,
                    "airport_name": airport_info.get('airport_name', ''),
                    "city": airport_info.get('city', ''),
                    "state": airport_info.get('state', ''),
                    "runway_id": runway.get('rwy_id', ''),
                    "length": length,
                    "surface": surface
                })

    return matches

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python find_airports.py <path_to_json_file> <max_length> <surface1> [<surface2> ...]")
        sys.exit(1)

    json_file = sys.argv[1]
    max_length = int(sys.argv[2])
    allowed_surfaces = [s.upper() for s in sys.argv[3:]]

    results = find_airports(json_file, max_length, allowed_surfaces)

    # 출력
    for r in results:
        print(
            r['airport_id'],
            r['airport_name'],
            r['city'],
            r['state'],
            r['runway_id'],
            r['length'],
            r['surface']
        )

