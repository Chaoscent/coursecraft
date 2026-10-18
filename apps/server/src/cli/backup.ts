// SPDX-License-Identifier: Apache-2.0
/**
 * `coursecraft backup` and `coursecraft restore`: one tar file with the
 * database (pg_dump custom format), the data volume and a manifest.
 *
 * Backup runs in the app container (read access to the database, the data
 * volume). Restore runs in the maintenance container with the migrator
 * role, which owns the schema; the app must be stopped meanwhile.
 */
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { LATEST_MIGRATION } from '../db/migrations/index.js';

const FORMAT = 1;

/**
 * Removes the application objects before the dump is replayed (pg_restore
 * --clean cannot drop the partitioned job tables). Runs as the migrator,
 * which owns them; schema `public` itself and its privileges stay.
 */
const CLEAR_SQL = `DROP SCHEMA IF EXISTS pgboss CASCADE;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S' LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
END $$;
`;
/** Kept out of the archive: earlier backups and scratch space. */
const SKIPPED = new Set(['backups', 'tmp']);

const manifestSchema = z
  .object({
    format: z.literal(FORMAT),
    product: z.literal('coursecraft'),
    createdAt: z.string(),
    migration: z.string(),
  })
  .strict();
export type BackupManifest = z.infer<typeof manifestSchema>;

/** libpq environment from a connection URL, so the password never appears in a process list. */
export function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ''),
    ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') ?? '' } : {}),
  };
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = { PATH: process.env['PATH'] },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(Buffer.concat(out).toString('utf8'))
        : reject(
            new Error(`${command} failed (${code}): ${Buffer.concat(err).toString('utf8').slice(0, 2000)}`),
          ),
    );
  });
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * `dataDir` is null when files live in object storage: the archive then holds
 * the database only, and the bucket is protected by its own means
 * (versioning, replication, provider backups).
 */
export async function backup(options: {
  databaseUrl: string;
  dataDir: string | null;
  outDir?: string;
}): Promise<string> {
  const outDir = options.outDir ?? join(options.dataDir ?? tmpdir(), 'backups');
  mkdirSync(outDir, { recursive: true, mode: 0o750 });
  const work = join(outDir, `.work-${stamp()}`);
  mkdirSync(work, { mode: 0o700 });
  try {
    await run(
      'pg_dump',
      ['--format=custom', '--no-owner', `--file=${join(work, 'database.dump')}`],
      pgEnv(options.databaseUrl),
    );
    const manifest: BackupManifest = {
      format: FORMAT,
      product: 'coursecraft',
      createdAt: new Date().toISOString(),
      migration: LATEST_MIGRATION ?? '',
    };
    writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const file = join(outDir, `coursecraft-${stamp()}.tar`);
    const dataEntries =
      options.dataDir && existsSync(options.dataDir)
        ? readdirSync(options.dataDir).filter((n) => !SKIPPED.has(n) && !n.startsWith('.'))
        : [];
    await run('tar', [
      '--create',
      `--file=${file}.part`,
      `--directory=${work}`,
      'manifest.json',
      'database.dump',
    ]);
    if (options.dataDir && dataEntries.length) {
      await run('tar', [
        '--append',
        `--file=${file}.part`,
        `--directory=${options.dataDir}`,
        '--transform=s,^,data/,',
        '--',
        ...dataEntries,
      ]);
    }
    renameSync(`${file}.part`, file);
    return file;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Entry check before anything is extracted: only the manifest, the dump and
 * regular files or directories below `data/`; no links, devices, absolute
 * paths or `..`.
 */
export function checkListing(verbose: string): void {
  for (const line of verbose.split('\n').filter(Boolean)) {
    const type = line[0];
    const name = line.split(/\s+/).slice(5).join(' ');
    if (type !== '-' && type !== 'd') throw new Error(`Refusing archive entry of type "${type}": ${name}`);
    const parts = name.replace(/\/$/, '').split('/');
    const safe =
      !name.startsWith('/') &&
      !parts.includes('..') &&
      (name === 'manifest.json' || name === 'database.dump' || parts[0] === 'data');
    if (!safe) throw new Error(`Refusing archive entry: ${name}`);
  }
}

export async function restore(options: {
  file: string;
  databaseUrl: string;
  dataDir: string | null;
}): Promise<BackupManifest> {
  const file = resolve(options.file);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`No such backup file: ${file}`);
  checkListing(await run('tar', ['--list', '--verbose', '--numeric-owner', `--file=${file}`]));
  const work = join(options.dataDir ?? tmpdir(), `.restore-${stamp()}`);
  mkdirSync(work, { mode: 0o700 });
  try {
    await run('tar', [
      '--extract',
      `--file=${file}`,
      `--directory=${work}`,
      '--no-same-owner',
      '--no-same-permissions',
    ]);
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8')));
    if (manifest.migration > (LATEST_MIGRATION ?? '')) {
      throw new Error(`Backup is from a newer version (${manifest.migration}); update Coursecraft first.`);
    }
    // The dump as SQL, then one transaction: remove the current objects, recreate from the dump.
    const env = pgEnv(options.databaseUrl);
    await run(
      'pg_restore',
      ['--no-owner', `--file=${join(work, 'restore.sql')}`, join(work, 'database.dump')],
      env,
    );
    writeFileSync(join(work, 'clear.sql'), CLEAR_SQL);
    await run(
      'psql',
      [
        '--no-psqlrc',
        '--quiet',
        '--set=ON_ERROR_STOP=1',
        '--single-transaction',
        `--file=${join(work, 'clear.sql')}`,
        `--file=${join(work, 'restore.sql')}`,
      ],
      env,
    );
    // Replace the data volume contents (except backups) with the archived ones.
    if (options.dataDir) {
      for (const name of readdirSync(options.dataDir)) {
        if (SKIPPED.has(name) || name.startsWith('.')) continue;
        rmSync(join(options.dataDir, name), { recursive: true, force: true });
      }
      const restored = join(work, 'data');
      if (existsSync(restored)) {
        for (const name of readdirSync(restored))
          renameSync(join(restored, name), join(options.dataDir, name));
      }
    }
    return manifest;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
