// SPDX-License-Identifier: Apache-2.0
// Rule: local password sign-in only for administrators.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, PASSWORD, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let admin: Actor;

beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_LOGIN_RATE_LIMIT: '1000' });
  admin = await t.actor(['admin']);
});
afterAll(() => t.close());

describe('local sign-in policy', () => {
  it('is off by default and settable only by administrators', async () => {
    expect((await t.request(admin, 'GET', '/api/sso/policy')).json()).toEqual({ localLoginAdminOnly: false });
    const learner = await t.actor(['learner']);
    expect(
      (await t.request(learner, 'PUT', '/api/sso/policy', { localLoginAdminOnly: true })).statusCode,
    ).toBe(403);
    expect((await t.request(null, 'GET', '/api/sso/policy')).statusCode).toBe(401);
  });

  it('blocks local passwords of everyone but administrators once on, and lifts again', async () => {
    const learner = await t.createUser(['learner']);
    const author = await t.createUser(['author', 'trainer']);
    expect((await t.request(admin, 'PUT', '/api/sso/policy', { localLoginAdminOnly: true })).statusCode).toBe(
      200,
    );
    for (const u of [learner, author]) {
      const res = await t.request(null, 'POST', '/api/auth/login', {
        email: u.email,
        password: PASSWORD,
      });
      expect(res.statusCode, u.email).toBe(401);
    }
    // The break-glass administrator still gets in.
    const again = await t.actor(['admin']);
    expect((await t.request(again, 'GET', '/api/session')).statusCode).toBe(200);
    await t.request(admin, 'PUT', '/api/sso/policy', { localLoginAdminOnly: false });
    expect((await t.login(learner.email)).userId).toBe(learner.id);
  });
});
