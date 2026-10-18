// SPDX-License-Identifier: Apache-2.0
import { createReadStream, createWriteStream, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { S3BlobStore } from '@coursecraft/storage';
import { backup, restore } from './cli/backup.js';
import { bootstrapDatabase } from './cli/db-bootstrap.js';
import { initSecrets } from './cli/init-secrets.js';
import { migrate } from './cli/migrate.js';
import { createDatabase } from './db/connection.js';
import { issueSetupToken } from './modules/setup/service.js';

function secretFromEnv(name: string): string {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE must be set`);
  return value;
}

/** Object storage from the environment, or null when files live on the data volume. */
function objectStore(): S3BlobStore | null {
  if (process.env['COURSECRAFT_STORAGE'] !== 's3') return null;
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must be set when COURSECRAFT_STORAGE=s3`);
    return value;
  };
  return new S3BlobStore({
    endpoint: required('COURSECRAFT_S3_ENDPOINT'),
    region: process.env['COURSECRAFT_S3_REGION'] ?? 'us-east-1',
    bucket: required('COURSECRAFT_S3_BUCKET'),
    accessKeyId: secretFromEnv('COURSECRAFT_S3_ACCESS_KEY_ID'),
    secretAccessKey: secretFromEnv('COURSECRAFT_S3_SECRET_ACCESS_KEY'),
    keyPrefix: process.env['COURSECRAFT_S3_KEY_PREFIX'] ?? '',
    virtualHostedStyle: process.env['COURSECRAFT_S3_VIRTUAL_HOSTED_STYLE'] === 'true',
  });
}

const dataDir = (): string | null =>
  objectStore() ? null : (process.env['COURSECRAFT_DATA_DIR'] ?? '/data');

const USAGE = `Usage: coursecraft <command>

Commands:
  migrate               Apply database migrations and create job queues
  init-secrets <dir>    Create missing secrets for all services (first start)
  db-bootstrap          Create the service roles in an existing database (managed PostgreSQL);
                        needs COURSECRAFT_ADMIN_DATABASE_URL and the three role passwords
  setup-token           Create a new one-time setup token (invalidates the previous one)
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
        const setup = await issueSetupToken(db);
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
    case 'backup': {
      const file = await backup({
        databaseUrl: secretFromEnv('COURSECRAFT_DATABASE_URL'),
        dataDir: dataDir(),
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
