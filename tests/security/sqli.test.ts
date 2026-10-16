// SPDX-License-Identifier: Apache-2.0
/**
 * Sends SQL injection payloads into every path parameter, the search and
 * sort parameters and every string field of request bodies, for every route.
 * Requests must fail cleanly (never 500) and the database must stay intact.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

const PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  '" OR ""="',
  '1; SELECT pg_sleep(5) --',
  "admin'--",
  "' UNION SELECT password_hash, email FROM users --",
  '%',
  '_',
  '\\',
  "1' AND 1=CAST((SELECT version()) AS int) --",
  'name; DELETE FROM sessions',
];

let t: TestApp;
let admin: Actor;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.actor(['admin']);
});
afterAll(async () => t.close());

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function tableCount(): Promise<number> {
  const rows = await t.ctx.db.selectFrom('users').select('id').execute();
  return rows.length;
}

describe('SQL injection', () => {
  it('no route fails or leaks with injection payloads', async () => {
    const before = await tableCount();
    const failures: string[] = [];
    const routes = t.routes.filter((r) => !r.url.startsWith('/*'));
    for (const route of routes) {
      for (const payload of PAYLOADS) {
        const encoded = encodeURIComponent(payload);
        const url =
          route.url.replace(/:[a-zA-Z]+/g, encoded) +
          `?q=${encoded}&sort=${encoded}&dir=${encoded}&action=${encoded}&page=1`;
        const body =
          route.method === 'GET'
            ? undefined
            : {
                email: payload,
                password: payload,
                name: payload,
                displayName: payload,
                token: payload,
                code: payload,
                challenge: payload,
              };
        const res = await t.request(admin, route.method as Method, url, body);
        // Some routes legitimately end the caller's session (logout).
        if ((await t.request(admin, 'GET', '/api/session')).json<{ session: unknown }>().session === null) {
          admin = await t.login(admin.email);
        }
        if (res.statusCode >= 500)
          failures.push(`${route.method} ${route.url} [${payload}]: ${res.statusCode}`);
        if (res.body.includes('$argon2') || res.body.toLowerCase().includes('postgresql')) {
          failures.push(`${route.method} ${route.url} [${payload}]: leaked data`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(await tableCount()).toBe(before);
    const session = await t.request(admin, 'GET', '/api/session');
    expect(session.json().session).not.toBeNull();
  });

  it('treats LIKE wildcards in search literally', async () => {
    await t.createUser(['learner'], { email: 'percent@example.org' });
    const all = await t.request(admin, 'GET', '/api/users?pageSize=200');
    const wildcard = await t.request(admin, 'GET', `/api/users?q=${encodeURIComponent('%')}`);
    expect(wildcard.json().total).toBeLessThan(all.json().total);
  });

  it('rejects sort keys outside the whitelist', async () => {
    const res = await t.request(admin, 'GET', '/api/users?sort=password_hash');
    expect(res.statusCode).toBe(400);
  });
});
