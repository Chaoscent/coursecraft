// SPDX-License-Identifier: Apache-2.0
import type { ColumnType, Generated, JSONColumnType } from 'kysely';

export interface SettingsTable {
  key: string;
  value: JSONColumnType<Record<string, unknown>>;
  updated_at: ColumnType<Date, never, Date>;
}

/** Maintained by Kysely's migrator; read for readiness checks. */
export interface KyselyMigrationTable {
  name: string;
  timestamp: Generated<string>;
}

export interface Database {
  settings: SettingsTable;
  kysely_migration: KyselyMigrationTable;
}
