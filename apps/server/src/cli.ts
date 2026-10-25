// SPDX-License-Identifier: Apache-2.0
import { createReadStream, createWriteStream, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { BlobStore, S3BlobStore } from '@coursecraft/storage';
import { blobStoreFromEnv, objectStoreFromEnv } from './storage.js';
import { backup, restore } from './cli/backup.js';
import { bootstrapDatabase } from './cli/db-bootstrap.js';
import { DEFAULT_TENANT_ID } from './tenancy/context.js';
import { createTenant, deleteTenant, listTenants, newSetupToken, setTenantStatus } from './cli/tenants.js';
import { initSecrets } from './cli/init-secrets.js';
import { migrate } from './cli/migrate.js';
import { resealTenantSecrets } from './cli/rotate-master-key.js';
import { loadConfig } from './config/env.js';
import { createContext } from './context-factory.js';
import { createDatabase } from './db/connection.js';
import { issueSetupToken } from './modules/setup/service.js';
import { forEachTenant } from './tenancy/directory.js';

function optionalSecret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  return (file ? readFileSync(file, 'utf8').trim() : process.env[name]) || undefined;
}

function secretFromEnv(name: string): string {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE must be set`);
  return value;
}

/** Object storage from the environment, or null when files live on the data volume. */
const objectStore = (): S3BlobStore | null => objectStoreFromEnv();

const dataDir = (): string | null =>
  objectStore() ? null : (process.env['COURSECRAFT_DATA_DIR'] ?? '/data');

const blobStore = (): BlobStore => blobStoreFromEnv();

async function tenantCommand(args: string[]): Promise<number> {
  const [action, ...params] = args;
  const migrator = createDatabase(secretFromEnv('COURSECRAFT_MIGRATOR_DATABASE_URL'), { max: 1 });
  const app =
    action === 'create' ? createDatabase(secretFromEnv('COURSECRAFT_DATABASE_URL'), { max: 1 }) : null;
  try {
    switch (action) {
      case 'list':
        for (const t of await listTenants(migrator))
          console.log([t.id, t.status, t.name, t.publicOrigin ?? '-', t.contentOrigin ?? '-'].join('\t'));
        return 0;
      case 'create': {
        const [name, publicOrigin, contentOrigin] = params;
        if (!name || !publicOrigin || !contentOrigin || !app) break;
        const created = await createTenant(migrator, app, { name, publicOrigin, contentOrigin });
        console.log(`Tenant: ${created.id}`);
        console.log(`Setup token: ${created.token}\nValid until: ${created.expiresAt.toISOString()}`);
        console.log(`Open ${publicOrigin}/setup to create the first administrator.`);
        return 0;
      }
      case 'disable':
      case 'enable':
        if (!params[0]) break;
        await setTenantStatus(migrator, params[0], action === 'disable' ? 'disabled' : 'active');
        console.log(`Tenant ${params[0]} ${action}d (takes effect within 30 seconds).`);
        return 0;
      case 'delete':
        if (!params[0]) break;
        await deleteTenant(migrator, blobStore(), params[0]);
        console.log(`Tenant ${params[0]} deleted with all its data.`);
        return 0;
    }
    console.error(USAGE);
    return 2;
  } finally {
    await migrator.destroy();
    await app?.destroy();
  }
}

const USAGE = `Usage: coursecraft <command>

Commands:
  migrate               Apply database migrations and create job queues
  init-secrets <dir>    Create missing secrets for all services (first start)
  db-bootstrap          Create the service roles in an existing database (managed PostgreSQL);
                        needs COURSECRAFT_ADMIN_DATABASE_URL and the three role passwords
  setup-token [tenant]  Create a new one-time setup token (invalidates the previous one)
  tenant list           Organisations of this installation (COURSECRAFT_TENANCY=multi)
  tenant create <name> <public-origin> <content-origin>
                        Add an organisation; prints its setup token
  tenant disable|enable <id>
  tenant delete <id>    Remove an organisation with all its data and files
  backup                Write database and data volume to /data/backups (app container);
                        with object storage: database only, uploaded to backups/ in the bucket
  restore <file>        Replace database and data with a backup (maintenance container,
                        app stopped), then apply newer migrations; <file> may be
                        s3:backups/<name>.tar with object storage
`;

async function run(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case 'migrate': {
      const { applied } = await migrate(secretFromEnv('COURSECRAFT_MIGRATOR_DATABASE_URL'));
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
      return 0;
    }
    case 'init-secrets': {
      const dir = rest[0];
      if (!dir) {
        console.error(USAGE);
        return 2;
      }
      const created = initSecrets({
        dir,
        dbHost: process.env['COURSECRAFT_DB_HOST'] ?? 'db',
        dbName: process.env['COURSECRAFT_DB_NAME'] ?? 'coursecraft',
        chown: process.getuid?.() === 0,
      });
      console.log(created.length ? `Created: ${created.join(', ')}` : 'All secrets present.');
      return 0;
    }
    case 'db-bootstrap': {
      await bootstrapDatabase(secretFromEnv('COURSECRAFT_ADMIN_DATABASE_URL'), {
        migrator: secretFromEnv('COURSECRAFT_MIGRATOR_PASSWORD'),
        app: secretFromEnv('COURSECRAFT_APP_PASSWORD'),
        converter: secretFromEnv('COURSECRAFT_CONVERTER_PASSWORD'),
      });
      console.log('Database roles are in place.');
      return 0;
    }
    case 'setup-token': {
      const db = createDatabase(secretFromEnv('COURSECRAFT_DATABASE_URL'), { max: 1 });
      try {
        const setup = rest[0] ? await newSetupToken(db, rest[0]) : await issueSetupToken(db);
        console.log(
          setup
            ? `Setup token: ${setup.token}\nValid until: ${setup.expiresAt.toISOString()}`
            : 'Setup is already complete.',
        );
      } finally {
        await db.destroy();
      }
      return 0;
    }
    case 'rotate-master-key': {
      const config = loadConfig();
      if (!config.masterKeys)
        throw new Error(
          'Set COURSECRAFT_MASTER_KEYS (the key ring, current key last) before rotating; a single COURSECRAFT_MASTER_KEY has nothing to rotate to.',
        );
      const ctx = createContext(config);
      try {
        let total = 0;
        await forEachTenant(
          config,
          ctx.tenants,
          async () => {
            total += await resealTenantSecrets(ctx.db, ctx.box);
          },
          (scope, error) => {
            throw error instanceof Error ? error : new Error(`re-seal failed for organisation ${scope.id}`);
          },
        );
        console.log(
          `Re-sealed ${total} secret(s) with the current master key. Retired keys can now be removed.`,
        );
      } finally {
        await ctx.db.destroy();
      }
      return 0;
    }
    case 'tenant':
      return tenantCommand(rest);
    case 'backup': {
      // The migrator (owner) dumps every tenant; the app role only the default tenant.
      const migratorUrl = optionalSecret('COURSECRAFT_MIGRATOR_DATABASE_URL');
      if (!migratorUrl && process.env['COURSECRAFT_TENANCY'] === 'multi')
        throw new Error('With several tenants the backup needs COURSECRAFT_MIGRATOR_DATABASE_URL');
      const file = await backup({
        databaseUrl: migratorUrl ?? secretFromEnv('COURSECRAFT_DATABASE_URL'),
        dataDir: dataDir(),
        ...(migratorUrl ? {} : { tenantId: DEFAULT_TENANT_ID }),
      });
      const store = objectStore();
      if (store) {
        const key = `backups/${basename(file)}`;
        await store.put(key, { stream: createReadStream(file), size: statSync(file).size });
        rmSync(file, { force: true });
        console.log(`Backup uploaded: ${key} (database only; the bucket itself is not part of it)`);
      } else console.log(`Backup written: ${file}`);
      return 0;
    }
    case 'restore': {
      const file = rest[0];
      if (!file) {
        console.error(USAGE);
        return 2;
      }
      const url = secretFromEnv('COURSECRAFT_MIGRATOR_DATABASE_URL');
      const store = objectStore();
      let local = file;
      if (file.startsWith('s3:')) {
        if (!store) throw new Error('s3: backups need COURSECRAFT_STORAGE=s3');
        local = join(tmpdir(), `restore-${basename(file)}`);
        await pipeline(await store.read(file.slice(3)), createWriteStream(local, { mode: 0o600 }));
      }
      const manifest = await restore({ file: local, databaseUrl: url, dataDir: dataDir() }).finally(() => {
        if (local !== file) rmSync(local, { force: true });
      });
      const { applied } = await migrate(url);
      console.log(`Restored backup from ${manifest.createdAt} (${manifest.migration}).`);
      if (applied.length) console.log(`Applied: ${applied.join(', ')}`);
      return 0;
    }
    default:
      console.error(USAGE);
      return command ? 2 : 0;
  }
}

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
