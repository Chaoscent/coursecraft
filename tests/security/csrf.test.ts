// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { createTestApp, ORIGIN, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let admin: Actor;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.actor(['admin']);
});
afterAll(async () => t.close());

const post = (headers: Record<string, string>, payload = JSON.stringify({ name: `g-${Math.random()}` })) =>
  t.app.inject({
    method: 'POST',
    url: '/api/groups',
    cookies: { [SESSION_COOKIE]: admin.cookie },
    headers,
    payload,
  });

describe('CSRF protection', () => {
  it('accepts a same-origin request with the token', async () => {
    const res = await post({
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-csrf-token': admin.csrf,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a missing token', async () => {
    expect((await post({ origin: ORIGIN, 'content-type': 'application/json' })).statusCode).toBe(403);
  });

  it('rejects a wrong token', async () => {
    expect(
      (await post({ origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': 'forged' }))
        .statusCode,
    ).toBe(403);
  });

  it("rejects another session's token", async () => {
    const other = await t.actor(['admin']);
    expect(
      (await post({ origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': other.csrf }))
        .statusCode,
    ).toBe(403);
  });

  it('rejects foreign origins even with a valid token', async () => {
    const res = await post({
      origin: 'https://evil.example',
      'content-type': 'application/json',
      'x-csrf-token': admin.csrf,
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects requests without Origin and without Sec-Fetch-Site', async () => {
    expect((await post({ 'content-type': 'application/json', 'x-csrf-token': admin.csrf })).statusCode).toBe(
      403,
    );
  });

  it('accepts Sec-Fetch-Site: same-origin when Origin is absent', async () => {
    const res = await post({
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-csrf-token': admin.csrf,
    });
    expect(res.statusCode).toBe(200);
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])(
    'rejects %s bodies that simple cross-site forms can send',
    async (type) => {
      const res = await post({ origin: ORIGIN, 'content-type': type, 'x-csrf-token': admin.csrf }, 'name=x');
      expect(res.statusCode).toBe(415);
    },
  );

  it('protects the login form against cross-site posts', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify({ email: admin.email, password: 'x' }),
    });
    expect(res.statusCode).toBe(403);
  });
});
