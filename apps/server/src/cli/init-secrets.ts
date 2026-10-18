// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Numeric ids of the service users in the images (see docker/). */
export const UIDS = { postgres: 999, app: 10001, converter: 10002 } as const;
export const WORK_GID = 10000;

export interface SecretLayout {
  dir: string;
  dbHost: string;
  dbName: string;
  /** Skip chown, for tests that do not run as root. */
  chown: boolean;
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');

/**
 * Creates one subdirectory per consumer so that each container mounts only
 * the secrets it needs. Existing files are kept, which makes this idempotent.
 */
export function initSecrets(layout: SecretLayout): string[] {
  const created: string[] = [];
  const dirs = new Set<string>();
  const write = (sub: string, name: string, value: () => string, uid: number) => {
    const dir = join(layout.dir, sub);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    dirs.add(dir);
    const file = join(dir, name);
    if (!existsSync(file)) {
      writeFileSync(file, `${value()}\n`, { mode: 0o400 });
      created.push(`${sub}/${name}`);
    }
    if (layout.chown) {
      chownSync(dir, uid, uid);
      chownSync(file, uid, uid);
    }
    return file;
  };
  const read = (sub: string, name: string) => readFileSync(join(layout.dir, sub, name), 'utf8').trim();
  const url = (role: string, password: string) =>
    `postgres://${role}:${password}@${layout.dbHost}:5432/${layout.dbName}`;

  for (const name of ['postgres_password', 'migrator_password', 'app_password', 'converter_password']) {
    write('db', name, () => hex(24), UIDS.postgres);
  }
  write(
    'migrate',
    'database_url',
    () => url('coursecraft_migrator', read('db', 'migrator_password')),
    UIDS.app,
  );
  // The migrate step also creates the service roles (coursecraft db-bootstrap) with the superuser.
  write('migrate', 'admin_database_url', () => url('postgres', read('db', 'postgres_password')), UIDS.app);
  for (const role of ['migrator', 'app', 'converter'])
    write('migrate', `${role}_password`, () => read('db', `${role}_password`), UIDS.app);
  write('app', 'database_url', () => url('coursecraft_app', read('db', 'app_password')), UIDS.app);
  write('app', 'master_key', () => randomBytes(32).toString('base64'), UIDS.app);
  write('app', 'ip_pepper', () => randomBytes(32).toString('base64'), UIDS.app);
  write(
    'converter',
    'database_url',
    () => url('coursecraft_converter', read('db', 'converter_password')),
    UIDS.converter,
  );
  for (const dir of dirs) chmodSync(dir, 0o500);
  return created;
}
