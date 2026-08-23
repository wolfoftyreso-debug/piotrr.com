-- bootstrap.sql — the one thing a brand-new PostgreSQL needs BEFORE migrations.
--
-- WHAT THIS IS FOR
--   `npm run db:migrate` creates every table and even the extensions it
--   needs (pg_trgm in drizzle/0001; gen_random_uuid() is core in
--   PostgreSQL 13+, no pgcrypto required). What it CANNOT do is create the
--   database it connects to, or the role that owns it — you cannot create
--   a database from inside itself. That is this file's whole job, and
--   nothing more.
--
-- HOW TO RUN IT
--   Connect as a superuser to the maintenance database `postgres`, not to
--   the app database (which does not exist yet):
--
--     psql "postgres://<admin>@<host>:5432/postgres" -v ON_ERROR_STOP=1 -f bootstrap.sql
--
--   Then set the app password and run migrations:
--
--     psql "postgres://<admin>@<host>:5432/postgres" \
--       -c "ALTER ROLE baltic WITH PASSWORD 'a-real-password';"
--     DATABASE_URL="postgres://baltic:a-real-password@<host>:5432/baltic_bridge" \
--       npm run db:migrate
--
--   In the Kubernetes path this is unnecessary: the Postgres container's
--   entrypoint creates POSTGRES_DB owned by POSTGRES_USER on first start,
--   and the migrate Job runs afterwards. bootstrap.sql is the answer for a
--   managed cluster (RDS) or any pre-existing Postgres where you own only
--   an admin login.
--
-- IDEMPOTENT
--   Safe to run twice. It creates the role and database only if absent and
--   never touches an existing password — set that separately (above), so a
--   real secret never lives in this committed file.

-- 1) The application role. Login role, no superuser, no createdb/createrole.
--    Password is deliberately NOT set here — do it out of band so no
--    credential is committed. Until then the role cannot log in over TCP.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baltic') THEN
    CREATE ROLE baltic WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 2) The database, owned by that role. `CREATE DATABASE` cannot run inside
--    a transaction or a DO block, so it is guarded with \gexec: the SELECT
--    emits the CREATE statement only when the database is missing, and
--    \gexec runs whatever the query returned (nothing, if it already
--    exists).
SELECT format('CREATE DATABASE %I OWNER %I', 'baltic_bridge', 'baltic')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'baltic_bridge')
\gexec

-- Extensions are intentionally NOT created here. They live in the target
-- database, and the migrations own them (CREATE EXTENSION IF NOT EXISTS
-- pg_trgm in drizzle/0001_company_search_fts.sql). Creating them requires
-- privileges on baltic_bridge, which the migrate step runs with. Keeping
-- them in migrations means the from-empty install is reproducible from the
-- repo alone — the property docs/RUNBOOK.md verifies.
