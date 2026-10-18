// SPDX-License-Identifier: Apache-2.0
// Request counters in the database, shared by all replicas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseRateLimitStore, purgeRateLimits } from '../../apps/server/src/http/rate-limit-store.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_RATE_LIMIT_STORE: 'database', COURSECRAFT_LOGIN_RATE_LIMIT: '5' });
});
afterAll(() => t.close());

const attempt = (address: string) =>
  t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress: address,
    headers: { origin: 'https://coursecraft.test', 'content-type': 'application/json' },
    payload: JSON.stringify({ email: 'nobody@example.org', password: 'wrong password' }),
  });

describe('database rate limit store', () => {
  it('limits per client address across requests', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i += 1) codes.push((await attempt('10.9.9.1')).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429]);
    // Another client is not affected.
    expect((await attempt('10.9.9.2')).statusCode).toBe(401);
  });

  it('is shared with every other process using the same database', async () => {
    const other = new (databaseRateLimitStore(t.ctx.db))({
      routeInfo: { method: 'POST', url: '/api/auth/login' },
    });
    const seen = await new Promise<{ current: number; ttl: number } | undefined>((resolve) => {
      other.incr('10.9.9.1', (_error, result) => resolve(result), 60_000, 5);
    });
    expect(seen?.current).toBe(8);
    expect(seen?.ttl).toBeGreaterThan(0);
    expect(seen?.ttl).toBeLessThanOrEqual(60_000);
  });

  it('starts a new window after the old one ended and purges finished windows', async () => {
    await t.ctx.db
      .updateTable('rate_limits')
      .set({ reset_at: new Date(Date.now() - 2 * 3_600_000) })
      .execute();
    expect((await attempt('10.9.9.1')).statusCode).toBe(401);
    const rows = await t.ctx.db.selectFrom('rate_limits').select(['key', 'count']).execute();
    expect(rows.find((r) => r.key.endsWith('10.9.9.1'))?.count).toBe(1);
    await t.ctx.db
      .updateTable('rate_limits')
      .set({ reset_at: new Date(Date.now() - 2 * 3_600_000) })
      .where('key', 'like', '%10.9.9.2')
      .execute();
    expect(await purgeRateLimits(t.ctx.db)).toBe(1);
  });
});
