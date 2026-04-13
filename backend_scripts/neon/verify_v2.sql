SELECT 'airports_v2' AS table_name, COUNT(*) AS row_count FROM airports_v2
UNION ALL
SELECT 'airport_runways_v2', COUNT(*) FROM airport_runways_v2
UNION ALL
SELECT 'airport_approaches_v2', COUNT(*) FROM airport_approaches_v2;

SELECT state, COUNT(*) AS airports
FROM airports_v2
GROUP BY state
ORDER BY airports DESC, state
LIMIT 20;

SELECT a.airport_code, a.airport_name, a.airspace_class, a.fuel_raw,
       COUNT(DISTINCT r.id) AS runway_count,
       COUNT(DISTINCT ap.id) AS approach_count
FROM airports_v2 a
LEFT JOIN airport_runways_v2 r ON r.airport_code = a.airport_code
LEFT JOIN airport_approaches_v2 ap ON ap.airport_code = a.airport_code
GROUP BY a.airport_code, a.airport_name, a.airspace_class, a.fuel_raw
ORDER BY a.airport_code
LIMIT 50;