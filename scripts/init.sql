-- PostgreSQL init script for DiCandilo ERP
-- Runs automatically on first container start

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for fuzzy/full-text search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- for GIN index on numeric columns

-- Set timezone
SET timezone = 'UTC';
