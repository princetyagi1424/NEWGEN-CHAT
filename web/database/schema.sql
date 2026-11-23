-- NEWGEN CHAT account schema for Neon PostgreSQL (Vercel Functions).
-- The API also creates this table lazily; this file is provided for explicit setup/review.
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY,
  username VARCHAR(24) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_version INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT app_users_username_format CHECK (username ~ '^[a-z0-9_]{3,24}$')
);
