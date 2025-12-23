-- Minimal PostgreSQL initialization
-- Creates the raw schema for blockchain data

CREATE SCHEMA IF NOT EXISTS raw;
ALTER SCHEMA raw OWNER TO CURRENT_USER;