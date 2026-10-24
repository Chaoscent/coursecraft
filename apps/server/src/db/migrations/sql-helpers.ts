// SPDX-License-Identifier: Apache-2.0
/**
 * The single reviewed file allowed to use Kysely's `sql`. Anything added here
 * needs a security review. Identifiers are accepted only as TrustedIdentifier,
 * which can be created from string literals in code but never from runtime
 * strings.
 */
import { CompiledQuery, sql, type Kysely, type RawBuilder } from 'kysely';

declare const trusted: unique symbol;
export type TrustedIdentifier = string & { readonly [trusted]: true };

/** Resolves to `never` for the wide `string` type, so only literals type-check. */
type Literal<T extends string> = string extends T ? never : T;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function ident<const T extends string>(name: Literal<T>): TrustedIdentifier {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return name as string as TrustedIdentifier;
}

export const now = (): RawBuilder<Date> => sql<Date>`now()`;

export const randomUuid = (): RawBuilder<string> => sql<string>`gen_random_uuid()`;

/** Default for a JSON column holding an empty object. */
export const emptyJsonObject = (): RawBuilder<unknown> => sql`'{}'::jsonb`;

/** Lower-case unique index expression, e.g. for e-mail addresses. */
export const lower = (column: TrustedIdentifier): RawBuilder<string> =>
  sql<string>`lower(${sql.ref(column)})`;

/** CHECK expression `column IN (...)` for values defined as code constants. */
export const oneOf = (column: TrustedIdentifier, values: readonly string[]): RawBuilder<boolean> =>
  sql<boolean>`${sql.ref(column)} in (${sql.join(values.map((v) => sql.lit(v)))})`;

/** CHECK expression: exactly one of two columns is set. */
export const exactlyOne = (a: TrustedIdentifier, b: TrustedIdentifier): RawBuilder<boolean> =>
  sql<boolean>`num_nonnulls(${sql.ref(a)}, ${sql.ref(b)}) = 1`;

/** CHECK expression `column = value` for a numeric constant (singleton tables). */
export const equals = (column: TrustedIdentifier, value: number): RawBuilder<boolean> =>
  sql<boolean>`${sql.ref(column)} = ${sql.lit(value)}`;

/**
 * Makes a table append-only for a role (audit log). Skipped when the role does
 * not exist, e.g. in development databases without the role setup.
 */
export async function revokeWrites<DB>(
  db: Kysely<DB>,
  table: TrustedIdentifier,
  role: TrustedIdentifier,
): Promise<void> {
  const result = await sql<{
    n: number;
  }>`select count(*)::int as n from pg_roles where rolname = ${role}`.execute(db);
  if (result.rows[0]?.n) {
    await sql`revoke update, delete, truncate on ${sql.table(table)} from ${sql.id(role)}`.execute(db);
  }
}

/* ---------- Tenancy (row-level security) ---------- */

/** The tenant every installation has; single-tenant installations use only this one. */
export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

/** The tenant of the current connection, set by the database driver (see db/connection.ts). */
export const currentTenant = (): RawBuilder<string> => sql<string>`current_setting('app.tenant_id')::uuid`;

/**
 * Restricts every row of a table to the connection's tenant, for reading and
 * writing. An unset or empty tenant makes queries fail instead of returning
 * rows of any tenant. The table owner (the migrator) is not affected.
 */
export async function isolateTenants<DB>(db: Kysely<DB>, table: TrustedIdentifier): Promise<void> {
  await sql`alter table ${sql.table(table)} enable row level security`.execute(db);
  await sql`create policy tenant_isolation on ${sql.table(table)}
    using (tenant_id = current_setting('app.tenant_id')::uuid)
    with check (tenant_id = current_setting('app.tenant_id')::uuid)`.execute(db);
}

export async function dropTenantIsolation<DB>(db: Kysely<DB>, table: TrustedIdentifier): Promise<void> {
  await sql`drop policy if exists tenant_isolation on ${sql.table(table)}`.execute(db);
  await sql`alter table ${sql.table(table)} disable row level security`.execute(db);
}

/** Statement the driver sends when a pooled connection switches tenants. */
export function setTenantQuery(tenantId: string): CompiledQuery {
  return CompiledQuery.raw("select set_config('app.tenant_id', $1, false)", [tenantId]);
}

/** Read access only for a role (platform tables the app must not change). Skipped when the role is missing. */
export async function readOnlyFor<DB>(
  db: Kysely<DB>,
  table: TrustedIdentifier,
  role: TrustedIdentifier,
): Promise<void> {
  const result = await sql<{
    n: number;
  }>`select count(*)::int as n from pg_roles where rolname = ${role}`.execute(db);
  if (result.rows[0]?.n) {
    // Granted explicitly: reading is wanted (backups with the app role, tenant lookup).
    await sql`grant select on ${sql.table(table)} to ${sql.id(role)}`.execute(db);
    await sql`revoke insert, update, delete, truncate on ${sql.table(table)} from ${sql.id(role)}`.execute(
      db,
    );
  }
}

/** Lets a role change only these columns of a table (on top of read access). Skipped when the role is missing. */
export async function grantColumnUpdate<DB>(
  db: Kysely<DB>,
  table: TrustedIdentifier,
  columns: readonly TrustedIdentifier[],
  role: TrustedIdentifier,
): Promise<void> {
  const result = await sql<{
    n: number;
  }>`select count(*)::int as n from pg_roles where rolname = ${role}`.execute(db);
  if (result.rows[0]?.n)
    await sql`grant update (${sql.join(columns.map((c) => sql.id(c)))}) on ${sql.table(table)} to ${sql.id(role)}`.execute(
      db,
    );
}

/* ---------- Job queue (pg-boss) privileges, SECURITY_AUDIT.md F-01 ---------- */

/**
 * pg-boss's own deferred commands are single index statements on its job
 * tables. bam.ts runs a command with the simple query protocol, so a `;`
 * would allow more statements.
 */
const PG_BOSS_COMMAND = String.raw`^\s*(CREATE (UNIQUE )?INDEX|DROP INDEX)[^;]*;?\s*$`;

const queueReady = async <DB>(db: Kysely<DB>): Promise<boolean> => {
  const result = await sql<{ ok: boolean }>`select to_regclass('pgboss.bam') is not null
    and exists (select 1 from pg_roles where rolname = 'coursecraft_converter')
    and exists (select 1 from pg_roles where rolname = 'coursecraft_app') as ok`.execute(db);
  return result.rows[0]?.ok === true;
};

/**
 * Least privilege on the job queue. The converter only works its job rows and
 * registers itself; neither it nor the app may write pg-boss's maintenance
 * tables (`bam` commands run as the table owner during migrate). Idempotent;
 * runs after every migration and after pg-boss created or upgraded its
 * tables. Skipped while the schema or the roles do not exist.
 */
export async function lockDownJobQueue<DB>(db: Kysely<DB>): Promise<void> {
  if (!(await queueReady(db))) return;
  await sql`alter default privileges for role coursecraft_migrator in schema pgboss revoke all on tables from coursecraft_converter`.execute(
    db,
  );
  await sql`revoke all on all tables in schema pgboss from coursecraft_converter`.execute(db);
  await sql`grant select, insert, update on pgboss.job, pgboss.job_common to coursecraft_converter`.execute(
    db,
  );
  await sql`grant select on pgboss.queue, pgboss.version to coursecraft_converter`.execute(db);
  await sql`grant select, insert, update, delete on pgboss.instance to coursecraft_converter`.execute(db);
  await sql`revoke insert, update, delete, truncate on pgboss.bam from coursecraft_app`.execute(db);
}

/** Deletes queued maintenance commands that pg-boss did not write (queued through the old grants). */
export async function purgeForeignQueueCommands<DB>(db: Kysely<DB>): Promise<number> {
  if (!(await queueReady(db))) return 0;
  const result = await sql`delete from pgboss.bam
    where status <> 'completed' and command !~* ${PG_BOSS_COMMAND}`.execute(db);
  return Number(result.numAffectedRows ?? 0);
}
