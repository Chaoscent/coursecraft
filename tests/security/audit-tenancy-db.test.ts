// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md): checks of the database tenancy model
// against a throwaway PostgreSQL (testcontainers). Never point this at a
// real installation.
//
// - "tenant on pooled connections" and "catalog" verify claims of the audit
//   and are expected to pass.
// - "F-01" / "F-01b" demonstrate SECURITY_AUDIT.md F-01. They are marked
//   `it.fails` (expected failure), so the suite is green while the finding is
//   open. Once the fix lands they start to pass, `it.fails` then reports them
//   as failing, and the marker must be removed (turning them into regression
//   tests).
import { mailJobSchema, PGBOSS_SCHEMA, QUEUES } from '@coursecraft/shared';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../apps/server/src/cli/migrate.js';
import { createTenant } from '../../apps/server/src/cli/tenants.js';
import { createDatabase } from '../../apps/server/src/db/connection.js';
import { createBoss } from '../../apps/server/src/jobs/queue.js';
import type { Database } from '../../apps/server/src/db/schema.js';
import { runAsTenant, type TenantScope } from '../../apps/server/src/tenancy/context.js';
import { createTestDatabase } from '../support/database.js';
import { pgUrl } from '../support/postgres.js';

const pg = inject('pg');
let drop: () => Promise<void>;
let appUrl: string;
let migratorUrl: string;
let converterUrl: string;
let migrator: Kysely<Database>;
const scope = (id: string): TenantScope => ({ id, publicOrigin: null, contentOrigin: null });
const tenants = { a: '', b: '' };

beforeAll(async () => {
  const created = await createTestDatabase(pg);
  drop = created.drop;
  appUrl = created.url;
  migratorUrl = created.migratorUrl;
  converterUrl = pgUrl(pg, 'coursecraft_converter', new URL(appUrl).pathname.slice(1));
  migrator = createDatabase(migratorUrl, { tenancy: 'off' });
  const app = createDatabase(appUrl, { tenancy: 'multi' });
  try {
    for (const key of ['a', 'b'] as const) {
      const t = await createTenant(migrator, app, {
        name: `Audit ${key}`,
        publicOrigin: `https://${key}.audit.test`,
        contentOrigin: `https://content-${key}.audit.test`,
      });
      tenants[key] = t.id;
      await runAsTenant(scope(t.id), () =>
        app
          .insertInto('settings')
          .values({ key: 'audit_probe', value: JSON.stringify({ tenant: key }) })
          .execute(),
      );
    }
  } finally {
    await app.destroy();
  }
});

afterAll(async () => {
  await migrator?.destroy();
  await drop?.();
});

describe('audit: tenant on pooled connections (session-level set_config)', () => {
  const probe = (db: Kysely<Database>, id: string) =>
    runAsTenant(scope(id), async () => {
      const rows = await db.selectFrom('settings').select('value').where('key', '=', 'audit_probe').execute();
      return rows.map((r) => (r.value as { tenant: string }).tenant);
    });

  it('one pooled connection never carries a tenant into the next use', async () => {
    const db = createDatabase(appUrl, { tenancy: 'multi', max: 1 });
    try {
      for (let i = 0; i < 20; i++) {
        const key = i % 2 ? 'a' : 'b';
        expect(await probe(db, tenants[key])).toEqual([key]);
      }
      // Interleaved, all queued on the single connection.
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => probe(db, tenants[i % 3 ? 'a' : 'b'])),
      );
      results.forEach((r, i) => expect(r).toEqual([i % 3 ? 'a' : 'b']));
    } finally {
      await db.destroy();
    }
  });

  it('keeps the right tenant after a failed query and a rolled-back transaction', async () => {
    const db = createDatabase(appUrl, { tenancy: 'multi', max: 1 });
    try {
      // Duplicate primary key inside tenant A.
      await expect(
        runAsTenant(scope(tenants.a), () =>
          db.insertInto('settings').values({ key: 'audit_probe', value: '{}' }).execute(),
        ),
      ).rejects.toThrow();
      expect(await probe(db, tenants.b)).toEqual(['b']);
      await expect(
        runAsTenant(scope(tenants.a), () =>
          db.transaction().execute(async (trx) => {
            await trx.selectFrom('settings').select('key').execute();
            throw new Error('rollback');
          }),
        ),
      ).rejects.toThrow('rollback');
      expect(await probe(db, tenants.b)).toEqual(['b']);
      expect(await probe(db, tenants.a)).toEqual(['a']);
    } finally {
      await db.destroy();
    }
  });

  it('a connection used without any scope fails instead of using the last tenant', async () => {
    const db = createDatabase(appUrl, { tenancy: 'multi', max: 1 });
    try {
      expect(await probe(db, tenants.a)).toEqual(['a']);
      await expect(db.selectFrom('settings').select('key').execute()).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });
});

describe('audit: row-level security catalog', () => {
  const catalog = () => migrator.withSchema('pg_catalog');

  it('every table with tenant_id has RLS and a policy with USING and WITH CHECK for all commands', async () => {
    const withTenant = await migrator
      .withSchema('information_schema')
      .withTables<{ columns: { table_schema: string; table_name: string; column_name: string } }>()
      .selectFrom('columns')
      .select('table_name')
      .where('table_schema', '=', 'public')
      .where('column_name', '=', 'tenant_id')
      .execute();
    const names = withTenant
      .map((r) => r.table_name)
      // Platform tables that name a tenant but belong to the operator (no RLS by design).
      .filter((n) => n !== 'billing_events' && n !== 'operator_log');
    expect(names.length).toBeGreaterThanOrEqual(43);

    const classes = await catalog()
      .withTables<{
        pg_class: { relname: string; relnamespace: number; relrowsecurity: boolean; relkind: string };
        pg_namespace: { oid: number; nspname: string };
      }>()
      .selectFrom('pg_class')
      .innerJoin('pg_namespace', 'pg_namespace.oid', 'pg_class.relnamespace')
      .select(['relname', 'relrowsecurity'])
      .where('nspname', '=', 'public')
      .where('relname', 'in', names)
      .where('relkind', 'in', ['r', 'p'])
      .execute();
    expect(classes.filter((c) => !c.relrowsecurity).map((c) => c.relname)).toEqual([]);

    const policies = await catalog()
      .withTables<{
        pg_policies: {
          schemaname: string;
          tablename: string;
          policyname: string;
          cmd: string;
          permissive: string;
          qual: string | null;
          with_check: string | null;
        };
      }>()
      .selectFrom('pg_policies')
      .selectAll()
      .where('schemaname', '=', 'public')
      .execute();
    for (const name of names) {
      const own = policies.filter((p) => p.tablename === name);
      expect(own, name).toHaveLength(1);
      expect(own[0]).toMatchObject({ policyname: 'tenant_isolation', cmd: 'ALL', permissive: 'PERMISSIVE' });
      expect(own[0]?.qual, name).toContain("current_setting('app.tenant_id'");
      expect(own[0]?.with_check, name).toContain("current_setting('app.tenant_id'");
    }
  });

  it('the app and converter roles own nothing and cannot bypass RLS', async () => {
    const roles = await catalog()
      .withTables<{ pg_roles: { oid: number; rolname: string; rolbypassrls: boolean; rolsuper: boolean } }>()
      .selectFrom('pg_roles')
      .select(['rolname', 'rolbypassrls', 'rolsuper'])
      .where('rolname', 'in', ['coursecraft_app', 'coursecraft_converter'])
      .execute();
    expect(roles).toHaveLength(2);
    for (const r of roles) expect(r).toMatchObject({ rolbypassrls: false, rolsuper: false });

    const owned = await catalog()
      .withTables<{
        pg_class: { relname: string; relnamespace: number; relowner: number };
        pg_namespace: { oid: number; nspname: string };
        pg_roles: { oid: number; rolname: string };
      }>()
      .selectFrom('pg_class')
      .innerJoin('pg_namespace', 'pg_namespace.oid', 'pg_class.relnamespace')
      .innerJoin('pg_roles', 'pg_roles.oid', 'pg_class.relowner')
      .select(['relname', 'rolname'])
      .where('nspname', 'in', ['public', PGBOSS_SCHEMA])
      .where('rolname', 'in', ['coursecraft_app', 'coursecraft_converter'])
      .execute();
    expect(owned).toEqual([]);
  });

  it('no SECURITY DEFINER functions, views or materialized views can bypass the policies', async () => {
    const definers = await catalog()
      .withTables<{
        pg_proc: { proname: string; pronamespace: number; prosecdef: boolean };
        pg_namespace: { oid: number; nspname: string };
      }>()
      .selectFrom('pg_proc')
      .innerJoin('pg_namespace', 'pg_namespace.oid', 'pg_proc.pronamespace')
      .select(['nspname', 'proname'])
      .where('prosecdef', '=', true)
      .where('nspname', 'not in', ['pg_catalog', 'information_schema'])
      .execute();
    expect(definers).toEqual([]);

    const views = await catalog()
      .withTables<{
        pg_class: { relname: string; relnamespace: number; relkind: string };
        pg_namespace: { oid: number; nspname: string };
      }>()
      .selectFrom('pg_class')
      .innerJoin('pg_namespace', 'pg_namespace.oid', 'pg_class.relnamespace')
      .select(['nspname', 'relname', 'relkind'])
      .where('relkind', 'in', ['v', 'm'])
      .where('nspname', 'not in', ['pg_catalog', 'information_schema'])
      .execute();
    expect(views).toEqual([]);
  });
});

describe('F-01: converter role and app-internal jobs (expected failure until F-01 is fixed)', () => {
  const victimUser = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    // What the app does when it notifies a learner of tenant B.
    const app = createBoss(appUrl);
    app.on('error', () => undefined);
    await app.start();
    try {
      await app.send(QUEUES.mail, {
        tenantId: tenants.b,
        kind: 'assigned',
        userId: victimUser,
        params: { title: 'Fire safety', link: 'https://b.audit.test/learn/x' },
      });
    } finally {
      await app.stop({ graceful: false });
    }
  });

  // F-01 (SECURITY_AUDIT.md): fails today; remove `.fails` once the fix is in.
  it.fails(
    'the converter cannot read payloads of app-internal queues (user and tenant ids of every organisation)',
    async () => {
      const converter = createDatabase(converterUrl, { tenancy: 'off', max: 1 });
      try {
        const read = converter
          .withSchema(PGBOSS_SCHEMA)
          .withTables<{ job: { name: string; data: unknown } }>()
          .selectFrom('job')
          .select(['name', 'data'])
          .where('name', 'in', [QUEUES.mail, QUEUES.exportBuild])
          .execute();
        await expect(read).rejects.toThrow(/permission denied/);
      } finally {
        await converter.destroy();
      }
    },
  );

  // F-01 (SECURITY_AUDIT.md): fails today; remove `.fails` once the fix is in.
  it.fails('the converter cannot queue a mail.send job that the app worker would accept', async () => {
    const forged = {
      tenantId: tenants.b,
      kind: 'assigned' as const,
      userId: victimUser,
      params: { title: 'Mandatory security training', link: 'https://evil.example/login' },
    };
    // The payload passes the worker's validation as is (main.ts: mailJobSchema.safeParse).
    expect(mailJobSchema.safeParse(forged).success).toBe(true);

    // The same client the converter uses (apps/converter/src/main.ts), with the converter's role.
    const converter = createBoss(converterUrl);
    converter.on('error', () => undefined);
    await converter.start();
    try {
      await expect(converter.send(QUEUES.mail, forged)).rejects.toThrow(/permission denied/);
    } finally {
      await converter.stop({ graceful: false });
    }
  });
});

describe('F-01b: converter role and pg-boss maintenance commands (expected failure until F-01 is fixed)', () => {
  // F-01 (SECURITY_AUDIT.md): fails today; remove `.fails` once the fix is in.
  it.fails(
    'a command queued by the converter is not executed by the migrate step as the table owner',
    async () => {
      const converter = createDatabase(converterUrl, { tenancy: 'off', max: 1 });
      try {
        const boss = converter.withSchema(PGBOSS_SCHEMA).withTables<{
          bam: { name: string; version: number; status: string; table_name: string; command: string };
          version: { bam_on: Date | null };
        }>();
        // Copies every organisation's settings (RLS does not apply to the owner) into a table the
        // converter can read (default privileges on the pgboss schema).
        await boss
          .insertInto('bam')
          .values({
            name: 'audit_probe',
            version: 0,
            status: 'pending',
            table_name: 'job',
            command: 'CREATE TABLE pgboss.audit_probe AS SELECT tenant_id, key, value FROM public.settings',
          })
          .execute();
        // Lifts the interval gate so the next pg-boss start with migrate enabled polls at once.
        await boss.updateTable('version').set({ bam_on: null }).execute();
      } finally {
        await converter.destroy();
      }

      // What every deployment runs on start (Compose `migrate` service, Helm init container).
      await migrate(migratorUrl);

      const reader = createDatabase(converterUrl, { tenancy: 'off', max: 1 });
      try {
        const leaked = reader
          .withSchema(PGBOSS_SCHEMA)
          .withTables<{ audit_probe: { tenant_id: string; key: string } }>()
          .selectFrom('audit_probe')
          .select(['tenant_id', 'key'])
          .execute();
        await expect(leaked).rejects.toThrow(/does not exist|permission denied/);
      } finally {
        await reader.destroy();
      }
    },
  );
});
