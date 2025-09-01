#!/bin/bash

# Database initialization script
# This runs when the database container starts for the first time

set -e

echo "Initializing database for Homelab Dashboard..."

# Create the database if it doesn't exist
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Database is already created by POSTGRES_DB env var
    -- Just ensure it's ready for connections
    SELECT 1;
EOSQL

echo "Database initialization complete."