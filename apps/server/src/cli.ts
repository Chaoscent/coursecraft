// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { backup, restore } from './cli/backup.js';
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

const USAGE = `Usage: coursecraft <command>

Commands:
  migrate               Apply database migrations and create job queues
  init-secrets <dir>    Create missing secrets for all services (first start)
  setup-token           Create a new one-time setup token (invalidates the previous one)
  backup                Write database and data volume to /data/backups (app container)
  restore <file>        Replace database and data with a backup (maintenance container,
                        app stopped), then apply newer migrations
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
        dataDir: process.env['COURSECRAFT_DATA_DIR'] ?? '/data',
      });
      console.log(`Backup written: ${file}`);
      return 0;
    }
    case 'restore': {
      const file = rest[0];
      if (!file) {
        console.error(USAGE);
        return 2;
      }
      const url = secretFromEnv('COURSECRAFT_MIGRATOR_DATABASE_URL');
      const manifest = await restore({
        file,
        databaseUrl: url,
        dataDir: process.env['COURSECRAFT_DATA_DIR'] ?? '/data',
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
