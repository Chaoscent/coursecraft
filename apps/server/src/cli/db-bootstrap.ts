// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { pgEnv } from './backup.js';

/** Passwords go to psql on standard input; keep them to characters that need no quoting. */
const PASSWORD = /^[A-Za-z0-9_\-+=./]{16,200}$/;

export interface BootstrapPasswords {
  migrator: string;
  app: string;
  converter: string;
}

const SQL = String.raw`
SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY['coursecraft_migrator','coursecraft_app','coursecraft_converter']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
ALTER ROLE coursecraft_migrator PASSWORD :'migrator_pw';
ALTER ROLE coursecraft_app PASSWORD :'app_pw';
ALTER ROLE coursecraft_converter PASSWORD :'converter_pw';
-- Bound the converter's database footprint (SECURITY_AUDIT.md F-17): few connections and
-- a short statement timeout, so a compromised converter cannot tie up the database for every tenant.
ALTER ROLE coursecraft_converter CONNECTION LIMIT 4;
ALTER ROLE coursecraft_converter SET statement_timeout = '30s';
-- Managed services: the administrator is no superuser and must be allowed to hand out ownership.
SELECT 'GRANT coursecraft_migrator TO ' || quote_ident(current_user)
  WHERE NOT pg_has_role(current_user, 'coursecraft_migrator', 'MEMBER') \gexec
ALTER DATABASE :"db" OWNER TO coursecraft_migrator;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO coursecraft_migrator, coursecraft_app, coursecraft_converter;
ALTER SCHEMA public OWNER TO coursecraft_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO coursecraft_app;
ALTER DEFAULT PRIVILEGES FOR ROLE coursecraft_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO coursecraft_app;
ALTER DEFAULT PRIVILEGES FOR ROLE coursecraft_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO coursecraft_app;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION coursecraft_migrator;
GRANT USAGE ON SCHEMA pgboss TO coursecraft_app, coursecraft_converter;
ALTER DEFAULT PRIVILEGES FOR ROLE coursecraft_migrator IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO coursecraft_app;
-- The converter gets its few table rights from migrate (lockDownJobQueue), never by default.
ALTER DEFAULT PRIVILEGES FOR ROLE coursecraft_migrator IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO coursecraft_app;
ALTER DEFAULT PRIVILEGES FOR ROLE coursecraft_migrator IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO coursecraft_app, coursecraft_converter;
`;

/** The bootstrap as one psql script (also used by the test database setup). */
export function bootstrapScript(passwords: BootstrapPasswords, database: string): string {
  for (const [name, value] of [
    ['migrator', passwords.migrator],
    ['app', passwords.app],
    ['converter', passwords.converter],
  ] as const)
    if (!PASSWORD.test(value))
      throw new Error(`The ${name} password must be 16-200 characters from A-Z a-z 0-9 _ - + = . /`);
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(database)) throw new Error('Unexpected database name');
  return [
    `\\set migrator_pw '${passwords.migrator}'`,
    `\\set app_pw '${passwords.app}'`,
    `\\set converter_pw '${passwords.converter}'`,
    `\\set db '${database}'`,
    SQL,
  ].join('\n');
}

/**
 * Creates the three service roles and their privileges in an existing
 * database (a managed PostgreSQL, or the bundled one on first start). Safe to
 * run again: roles are kept and passwords are set to the given values, which
 * also rotates them.
 */
export async function bootstrapDatabase(adminUrl: string, passwords: BootstrapPasswords): Promise<void> {
  const env = pgEnv(adminUrl);
  const db = env['PGDATABASE'];
  if (!db) throw new Error('The administrator URL must name the database');
  const script = bootstrapScript(passwords, db);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('psql', ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--file=-'], {
      env,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const errors: Buffer[] = [];
    child.stderr.on('data', (c: Buffer) => errors.push(c));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`psql failed (${code}): ${Buffer.concat(errors).toString('utf8').slice(0, 1500)}`),
          ),
    );
    child.stdin.end(script);
  });
}
