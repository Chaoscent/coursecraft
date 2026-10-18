// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimRun } from '../../apps/server/src/jobs/lease.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('periodic job lease', () => {
  it('lets one replica run a job per round and hands it on after the lease', async () => {
    expect(await claimRun(t.ctx.db, 'demo', 60_000)).toBe(true);
    // The second replica ticks while the first holds the lease.
    expect(await claimRun(t.ctx.db, 'demo', 60_000)).toBe(false);
    // A different job is independent.
    expect(await claimRun(t.ctx.db, 'other', 60_000)).toBe(true);
    await t.ctx.db
      .updateTable('periodic_jobs')
      .set({ locked_until: new Date(Date.now() - 1000) })
      .where('name', '=', 'demo')
      .execute();
    expect(await claimRun(t.ctx.db, 'demo', 60_000)).toBe(true);
  });

  it('gives it to exactly one of many simultaneous claimants', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => claimRun(t.ctx.db, 'race', 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
