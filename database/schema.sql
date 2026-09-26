CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    team TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    item JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_records (
    id TEXT PRIMARY KEY,
    record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_checks (
    id TEXT PRIMARY KEY,
    record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_config (
    config_key TEXT PRIMARY KEY,
    config_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_state (
    state_key TEXT PRIMARY KEY,
    state_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Petrosains Programme Catalogue (see database/data/programme_catalogue.json).
-- One row per verified offering (Offering_ID), stored as a JSONB blob like the
-- other tables above so new catalogue fields never need a migration. This is
-- the groundwork for future programme-booking / inventory-reservation work -
-- today it is read-only reference data served to the guest programme planner.
CREATE TABLE IF NOT EXISTS programme_catalogue (
    id TEXT PRIMARY KEY,
    offering JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_updated ON inventory_items(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_created ON scan_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_created ON stock_checks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_programme_catalogue_updated ON programme_catalogue(updated_at DESC);
