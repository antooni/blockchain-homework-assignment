-- Minimal PostgreSQL initialization
-- Creates the raw schema for blockchain data

CREATE SCHEMA IF NOT EXISTS raw;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'indexer') THEN
    CREATE ROLE indexer WITH LOGIN PASSWORD 'indexer_password';
  END IF;
END $$;
-- Grant permissions to indexer user
GRANT USAGE ON SCHEMA raw TO indexer;
GRANT CREATE ON SCHEMA raw TO indexer;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA raw TO indexer;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA raw TO indexer;