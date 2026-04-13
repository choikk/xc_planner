BEGIN;

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
);

CREATE INDEX IF NOT EXISTS idx_airports_v2_state
    ON airports_v2 (state);

CREATE INDEX IF NOT EXISTS idx_airports_v2_site_no
    ON airports_v2 (site_no);

CREATE INDEX IF NOT EXISTS idx_airports_v2_airspace
    ON airports_v2 (airspace_class);


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
        ON DELETE CASCADE,

    CONSTRAINT airport_runways_v2_length_check
        CHECK (length_ft IS NULL OR length_ft >= 0),

    CONSTRAINT airport_runways_v2_width_check
        CHECK (width_ft IS NULL OR width_ft >= 0)
);

CREATE INDEX IF NOT EXISTS idx_airport_runways_v2_airport
    ON airport_runways_v2 (airport_code);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_airport_runways_v2_airport_rwy
    ON airport_runways_v2 (airport_code, rwy_id);


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
);

CREATE INDEX IF NOT EXISTS idx_airport_approaches_v2_airport
    ON airport_approaches_v2 (airport_code);

CREATE INDEX IF NOT EXISTS idx_airport_approaches_v2_procuid
    ON airport_approaches_v2 (procuid);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_airport_approaches_v2_airport_name
    ON airport_approaches_v2 (airport_code, approach_name);


CREATE TABLE IF NOT EXISTS airport_scrape_status_v2 (
    airport_code text PRIMARY KEY,
    last_checked_at timestamptz,
    next_check_at timestamptz,
    check_priority integer NOT NULL DEFAULT 2,
    last_change_at timestamptz,
    consecutive_no_change_count integer NOT NULL DEFAULT 0,

    CONSTRAINT airport_scrape_status_v2_airport_code_fkey
        FOREIGN KEY (airport_code)
        REFERENCES airports_v2(airport_code)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT airport_scrape_status_v2_check_priority_check
        CHECK (check_priority >= 0),

    CONSTRAINT airport_scrape_status_v2_no_change_check
        CHECK (consecutive_no_change_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_airport_scrape_status_v2_next_check
    ON airport_scrape_status_v2 (next_check_at, check_priority, last_checked_at);

COMMIT;