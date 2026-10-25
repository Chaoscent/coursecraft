// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { lockDownJobQueue, purgeForeignQueueCommands } from './sql-helpers.js';

/**
 * SECURITY_AUDIT.md F-01: the converter (and the app) could queue SQL that the
 * migrate step runs as table owner. Runs before pg-boss starts in `migrate`,
 * so commands queued under the old grants are gone before the runner polls.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await purgeForeignQueueCommands(db);
  await lockDownJobQueue(db);
}

export function down(): Promise<never> {
  // One-way hardening: rolling back would re-widen the converter's and app's
  // rights on the job queue. The grants are also re-applied by enforcePrivileges
  // and migrate on every run, so a down migration here would not stick anyway.
  return Promise.reject(new Error('0023-job-queue-privileges is irreversible (security hardening)'));
}
