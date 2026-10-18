// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

/**
 * Lets exactly one replica run a periodic job per interval: the first to
 * claim the row wins, the others skip this round. The lease is shorter than
 * the interval, so the job also moves on when a replica goes away.
 */
export async function claimRun(db: Kysely<Database>, name: string, leaseMs: number): Promise<boolean> {
  const now = new Date();
  const row = await db
    .insertInto('periodic_jobs')
    .values({ name, locked_until: new Date(now.getTime() + leaseMs) })
    .onConflict((oc) =>
      oc
        .column('name')
        .doUpdateSet({ locked_until: new Date(now.getTime() + leaseMs) })
        .where('periodic_jobs.locked_until', '<=', now),
    )
    .returning('name')
    .executeTakeFirst();
  return row !== undefined;
}
