BEGIN;

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
);


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
);

CREATE INDEX IF NOT EXISTS idx_airport_dataset_history_dataset_name
    ON airport_dataset_history (dataset_name);

CREATE INDEX IF NOT EXISTS idx_airport_dataset_history_finished_at
    ON airport_dataset_history (finished_at);


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
);

CREATE INDEX IF NOT EXISTS idx_fixes_v2_state
    ON fixes_v2 (state_code);

CREATE INDEX IF NOT EXISTS idx_fixes_v2_artcc
    ON fixes_v2 (artcc);


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
);

CREATE INDEX IF NOT EXISTS idx_navaids_v2_type
    ON navaids_v2 (nav_type);

CREATE INDEX IF NOT EXISTS idx_navaids_v2_state
    ON navaids_v2 (state_code);


CREATE TABLE IF NOT EXISTS airway_routes_v2 (
    designation text PRIMARY KEY,
    route_type text,
    airway_designation text,
    airway_location text,
    regulatory text,
    remark text,
    airway_string text,
    raw_json jsonb
);

CREATE INDEX IF NOT EXISTS idx_airway_routes_v2_route_type
    ON airway_routes_v2 (route_type);


CREATE TABLE IF NOT EXISTS airway_segments_v2 (
    designation text NOT NULL,
    route_type text,
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
    PRIMARY KEY (designation, point_seq)
);

CREATE INDEX IF NOT EXISTS idx_airway_segments_v2_route_type
    ON airway_segments_v2 (route_type);

CREATE INDEX IF NOT EXISTS idx_airway_segments_v2_from_point
    ON airway_segments_v2 (from_point);

CREATE INDEX IF NOT EXISTS idx_airway_segments_v2_to_point
    ON airway_segments_v2 (to_point);


CREATE TABLE IF NOT EXISTS airway_segment_altitudes_v2 (
    id bigserial PRIMARY KEY,
    designation text NOT NULL,
    route_type text,
    point_seq integer NOT NULL,
    point_name text,
    point_ident text,
    point_type text,
    minimum_altitude text,
    maximum_altitude text,
    direction_of_flight text,
    raw_json jsonb
);

CREATE INDEX IF NOT EXISTS idx_airway_segment_altitudes_v2_designation
    ON airway_segment_altitudes_v2 (designation, point_seq);


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
