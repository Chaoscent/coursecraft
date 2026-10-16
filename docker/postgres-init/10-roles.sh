#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Runs once when the database volume is initialized. Creates one role per
# service with the least privileges it needs (see ARCHITECTURE.md §5.5).
set -eu
S=/run/lernwerk

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$(cat $S/migrator_password)" \
  -v app_pw="$(cat $S/app_password)" \
  -v converter_pw="$(cat $S/converter_password)" \
  -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE lernwerk_migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE lernwerk_app LOGIN PASSWORD :'app_pw';
CREATE ROLE lernwerk_converter LOGIN PASSWORD :'converter_pw';
ALTER DATABASE :"db" OWNER TO lernwerk_migrator;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO lernwerk_migrator, lernwerk_app, lernwerk_converter;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
-- Application schema: DDL only for the migrator, DML for the app.
ALTER SCHEMA public OWNER TO lernwerk_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lernwerk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lernwerk_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lernwerk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lernwerk_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lernwerk_app;

-- Job queue: app and converter may use it, never change it.
CREATE SCHEMA pgboss AUTHORIZATION lernwerk_migrator;
GRANT USAGE ON SCHEMA pgboss TO lernwerk_app, lernwerk_converter;
ALTER DEFAULT PRIVILEGES FOR ROLE lernwerk_migrator IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lernwerk_app, lernwerk_converter;
ALTER DEFAULT PRIVILEGES FOR ROLE lernwerk_migrator IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO lernwerk_app, lernwerk_converter;
ALTER DEFAULT PRIVILEGES FOR ROLE lernwerk_migrator IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO lernwerk_app, lernwerk_converter;
SQL
