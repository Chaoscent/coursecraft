// SPDX-License-Identifier: Apache-2.0
// The operator console API: organisations, limits, setup tokens, deletion.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../apps/server/src/db/connection.js';
import { buildOperatorApp } from '../../apps/server/src/operator/app.js';
import { DEFAULT_TENANT_ID } from '../../apps/server/src/tenancy/context.js';
import { uploadTo } from '../support/courses.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

const PASSWORD = 'operator password for tests';
const ORIGIN = 'http://localhost:3002';
let t: TestApp;
let admin: Actor;
let op: FastifyInstance;
let dbs: ReturnType<typeof createDatabase>[];
let cookie = '';
let csrf = '';

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.actor(['admin']);
  const migrator = createDatabase(t.migratorUrl, { max: 1 });
  const app = createDatabase(t.databaseUrl, { max: 1, tenancy: 'multi' });
  dbs = [migrator, app];
  op = await buildOperatorApp(
    {
      migratorDatabaseUrl: t.migratorUrl,
      databaseUrl: t.databaseUrl,
      password: PASSWORD,
      host: '127.0.0.1',
      port: 0,
      webDir: '/nonexistent',
      logLevel: 'fatal',
    },
    { migrator, app, blobs: t.ctx.blobs },
  );
});
afterAll(async () => {
  await op.close();
  for (const db of dbs) await db.destroy();
  await t.close();
});

function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return op.inject({
    method,
    url,
    headers: {
      host: 'localhost:3002',
      origin: ORIGIN,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(cookie ? { cookies: { '__Host-cc_operator': cookie } } : {}),
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const tenants = async () =>
  (await call('GET', '/api/operator/tenants')).json<{
    items: { id: string; name: string; users: number; maxUsers: number | null; status: string }[];
  }>().items;

describe('operator console', () => {
  it('needs the operator password', async () => {
    expect((await call('GET', '/api/operator/tenants')).statusCode).toBe(401);
    expect((await call('POST', '/api/operator/login', { password: 'wrong' })).statusCode).toBe(401);
    const res: LightMyRequestResponse = await call('POST', '/api/operator/login', { password: PASSWORD });
    expect(res.statusCode).toBe(200);
    cookie = res.cookies.find((c) => c.name === '__Host-cc_operator')?.value ?? '';
    csrf = res.json<{ csrfToken: string }>().csrfToken;
    expect(res.cookies.find((c) => c.name === '__Host-cc_operator')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    });
  });

  it('lists organisations with their usage and refuses changes without CSRF token or from elsewhere', async () => {
    const list = await tenants();
    const main = list.find((x) => x.id === DEFAULT_TENANT_ID);
    expect(main?.users).toBeGreaterThanOrEqual(1);
    const saved = csrf;
    csrf = '';
    expect(
      (await call('PATCH', `/api/operator/tenants/${DEFAULT_TENANT_ID}`, { name: 'X' })).statusCode,
    ).toBe(403);
    csrf = saved;
    expect(
      (
        await call(
          'PATCH',
          `/api/operator/tenants/${DEFAULT_TENANT_ID}`,
          { name: 'X' },
          { origin: 'https://evil.test' },
        )
      ).statusCode,
    ).toBe(403);
  });

  it('creates an organisation with limits and a setup token, and deletes it only with its name', async () => {
    const res = await call('POST', '/api/operator/tenants', {
      name: 'Firma C',
      publicOrigin: 'https://c.courses.test',
      contentOrigin: 'https://c.content.test',
      maxUsers: 25,
      maxStorageMb: 500,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { id, token } = res.json<{ id: string; token: string }>();
    expect(token.length).toBeGreaterThan(20);
    expect((await tenants()).find((x) => x.id === id)).toMatchObject({
      name: 'Firma C',
      users: 0,
      maxUsers: 25,
    });
    const dup = await call('POST', '/api/operator/tenants', {
      name: 'Doppelt',
      publicOrigin: 'https://c.courses.test',
      contentOrigin: 'https://other.content.test',
      maxUsers: null,
      maxStorageMb: null,
    });
    expect(dup.statusCode).toBe(409);
    expect((await call('POST', `/api/operator/tenants/${id}/setup-token`)).statusCode).toBe(200);
    expect((await call('PATCH', `/api/operator/tenants/${id}`, { status: 'disabled' })).statusCode).toBe(200);
    expect((await tenants()).find((x) => x.id === id)?.status).toBe('disabled');
    expect(
      (await call('POST', `/api/operator/tenants/${id}/delete`, { confirmName: 'Firma' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/api/operator/tenants/${id}/delete`, { confirmName: 'Firma C' })).statusCode,
    ).toBe(200);
    expect((await tenants()).find((x) => x.id === id)).toBeUndefined();
    expect(
      (await call('PATCH', `/api/operator/tenants/${DEFAULT_TENANT_ID}`, { status: 'disabled' })).statusCode,
    ).toBe(400);
  });

  it('enforces the limits it sets in the application', async () => {
    const users = (await tenants()).find((x) => x.id === DEFAULT_TENANT_ID)?.users ?? 0;
    await call('PATCH', `/api/operator/tenants/${DEFAULT_TENANT_ID}`, { maxUsers: users, maxStorageMb: 1 });
    t.ctx.tenants.invalidate();
    const created = await t.request(admin, 'POST', '/api/users', {
      email: 'one-too-many@example.org',
      displayName: 'Zu viel',
      locale: 'de',
      roles: ['learner'],
      groupIds: [],
      password: 'temporary password 1',
    });
    expect(created.statusCode, created.body).toBe(429);
    expect(created.json<{ error: { code: string } }>().error.code).toBe('quota_exceeded');
    const course = (await t.request(admin, 'POST', '/api/courses', { title: 'Groß', language: 'de' })).json<{
      id: string;
    }>().id;
    await t.request(admin, 'POST', `/api/courses/${course}/lock`);
    const upload = await uploadTo(
      t,
      admin,
      `/api/courses/${course}/assets`,
      'big.bin',
      Buffer.alloc(2 * 1024 * 1024, 1),
    );
    expect(upload.json<{ error: { code: string } }>().error.code).toBe('quota_exceeded');
    await call('PATCH', `/api/operator/tenants/${DEFAULT_TENANT_ID}`, { maxUsers: null, maxStorageMb: null });
    t.ctx.tenants.invalidate();
  });

  it('signs out', async () => {
    expect((await call('POST', '/api/operator/logout')).statusCode).toBe(200);
    expect((await call('GET', '/api/operator/tenants')).statusCode).toBe(401);
  });
});
