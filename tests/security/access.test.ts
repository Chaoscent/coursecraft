// SPDX-License-Identifier: Apache-2.0
/**
 * Generated from the route registry: every route that is not public must
 * reject anonymous callers, and every route must reject roles that lack its
 * permission. New routes are covered automatically.
 */
import { ROLES, rolesGrant, type Permission, type Role } from '@lernwerk/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
const actors = new Map<Role, Actor>();

beforeAll(async () => {
  t = await createTestApp({ LERNWERK_WEB_DIR: '' });
  for (const role of ROLES) actors.set(role, await t.actor([role]));
});
afterAll(async () => t.close());

const fill = (url: string) => url.replace(/:[a-zA-Z]+/g, () => randomUUID()).replace('*', 'x');
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

describe('route permissions', () => {
  it('has routes to check', () => {
    expect(t.routes.length).toBeGreaterThan(15);
  });

  it('rejects anonymous callers on every non-public route', async () => {
    const failures: string[] = [];
    for (const route of t.routes.filter((r) => r.permission !== 'public')) {
      const res = await t.request(
        null,
        route.method as Method,
        fill(route.url),
        route.method === 'GET' ? undefined : {},
      );
      if (res.statusCode !== 401) failures.push(`${route.method} ${route.url}: ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('rejects every role that lacks the declared permission', async () => {
    const failures: string[] = [];
    for (const route of t.routes.filter((r) => r.permission !== 'public')) {
      for (const role of ROLES) {
        if (rolesGrant([role], route.permission as Permission)) continue;
        const actor = actors.get(role);
        const res = await t.request(
          actor ?? null,
          route.method as Method,
          fill(route.url),
          route.method === 'GET' ? undefined : {},
        );
        if (res.statusCode !== 403) failures.push(`${role} ${route.method} ${route.url}: ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('object-level access (IDOR)', () => {
  it("cannot end another user's session", async () => {
    const a = await t.actor(['learner']);
    const b = await t.actor(['learner']);
    const sessions = await t.ctx.db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', b.userId)
      .execute();
    const res = await t.request(a, 'DELETE', `/api/account/sessions/${sessions[0]?.id ?? randomUUID()}`);
    expect(res.statusCode).toBe(404);
    const after = await t.ctx.db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', b.userId)
      .execute();
    expect(after).toHaveLength(sessions.length);
  });

  it("lists only the caller's own sessions", async () => {
    const a = await t.actor(['learner']);
    await t.actor(['learner']);
    const res = await t.request(a, 'GET', '/api/account/sessions');
    const ids = res.json<{ items: { id: string }[] }>().items.map((s) => s.id);
    const own = await t.ctx.db.selectFrom('sessions').select('id').where('user_id', '=', a.userId).execute();
    expect(ids.sort()).toEqual(own.map((s) => s.id).sort());
  });

  it("exports only the caller's own data", async () => {
    const a = await t.actor(['learner']);
    const res = await t.request(a, 'GET', '/api/account/export');
    expect(res.json()).toMatchObject({ profile: { id: a.userId } });
  });

  it('the last administrator cannot be demoted, disabled or deleted', async () => {
    const solo = await createTestApp();
    try {
      const admin = await solo.actor(['admin']);
      expect(
        (await solo.request(admin, 'PATCH', `/api/users/${admin.userId}`, { roles: ['learner'] })).statusCode,
      ).toBe(409);
      expect(
        (await solo.request(admin, 'PATCH', `/api/users/${admin.userId}`, { status: 'disabled' })).statusCode,
      ).toBe(409);
      expect((await solo.request(admin, 'DELETE', `/api/users/${admin.userId}`)).statusCode).toBe(409);
    } finally {
      await solo.close();
    }
  });
});
