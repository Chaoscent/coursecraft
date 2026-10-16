// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueSetupToken } from '../../apps/server/src/modules/setup/service.js';
import { createTestApp, sessionCookie, type TestApp } from '../support/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const admin = {
  email: 'Admin@Example.org',
  displayName: 'Admin',
  password: 'a long admin password',
  locale: 'de',
};

describe('first-run setup', () => {
  it('reports that setup is required', async () => {
    const res = await t.request(null, 'GET', '/api/session');
    expect(res.json()).toMatchObject({ session: null, setupRequired: true });
  });

  it('rejects a wrong token', async () => {
    await issueSetupToken(t.ctx.db);
    const res = await t.request(null, 'POST', '/api/setup', { ...admin, token: 'x'.repeat(43) });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an expired token', async () => {
    const setup = await issueSetupToken(t.ctx.db);
    await t.ctx.db
      .updateTable('setup_state')
      .set({ token_expires_at: new Date(Date.now() - 1000) })
      .execute();
    const res = await t.request(null, 'POST', '/api/setup', { ...admin, token: setup?.token });
    expect(res.statusCode).toBe(403);
  });

  it('only the newest token is valid', async () => {
    const first = await issueSetupToken(t.ctx.db);
    await issueSetupToken(t.ctx.db);
    const res = await t.request(null, 'POST', '/api/setup', { ...admin, token: first?.token });
    expect(res.statusCode).toBe(403);
  });

  it('creates the first admin with a valid token and signs them in', async () => {
    const setup = await issueSetupToken(t.ctx.db);
    const res = await t.request(null, 'POST', '/api/setup', { ...admin, token: setup?.token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      session: { user: { email: 'admin@example.org', roles: ['admin'] } },
    });
    expect(sessionCookie(res)).toBeDefined();
  });

  it('cannot run a second time, even with a fresh token', async () => {
    expect(await issueSetupToken(t.ctx.db)).toBeNull();
    const res = await t.request(null, 'POST', '/api/setup', {
      ...admin,
      email: 'evil@example.org',
      token: 'y'.repeat(43),
    });
    expect(res.statusCode).toBe(403);
    const count = await t.ctx.db
      .selectFrom('user_roles')
      .where('role', '=', 'admin')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });

  it('enforces the password length', async () => {
    const res = await t.request(null, 'POST', '/api/setup', {
      ...admin,
      password: 'short',
      token: 'z'.repeat(43),
    });
    expect(res.statusCode).toBe(400);
  });
});
