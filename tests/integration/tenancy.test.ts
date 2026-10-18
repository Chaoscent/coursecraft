// SPDX-License-Identifier: Apache-2.0
// Several organisations in one installation: each is reached by its own
// address and sees only its own data, enforced by row-level security.
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { createTenant, deleteTenant, setTenantStatus } from '../../apps/server/src/cli/tenants.js';
import { createDatabase } from '../../apps/server/src/db/connection.js';
import { withTenant } from '../../apps/server/src/jobs/queue.js';
import { runAsTenant } from '../../apps/server/src/tenancy/context.js';
import { solidPng } from '../support/png.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Site {
  id: string;
  host: string;
  cookie: string;
  csrf: string;
}

let t: TestApp;
let migrator: ReturnType<typeof createDatabase>;
const sites: Record<'a' | 'b', Site> = {
  a: { id: '', host: 'a.example.test', cookie: '', csrf: '' },
  b: { id: '', host: 'b.example.test', cookie: '', csrf: '' },
};

function call(
  site: Pick<Site, 'host' | 'cookie' | 'csrf'>,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: unknown,
) {
  return t.app.inject({
    method,
    url,
    headers: {
      host: site.host,
      'x-forwarded-proto': 'https',
      origin: `https://${site.host}`,
      ...(site.csrf ? { 'x-csrf-token': site.csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(site.cookie ? { cookies: { [SESSION_COOKIE]: site.cookie } } : {}),
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const cookieOf = (res: LightMyRequestResponse) =>
  res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_TENANCY: 'multi', COURSECRAFT_TRUST_PROXY: 'true' });
  migrator = createDatabase(t.migratorUrl, { max: 1 });
  for (const key of ['a', 'b'] as const) {
    const site = sites[key];
    const created = await createTenant(migrator, t.ctx.db, {
      name: `Firma ${key.toUpperCase()}`,
      publicOrigin: `https://${site.host}`,
      contentOrigin: `https://content-${site.host}`,
    });
    site.id = created.id;
    t.ctx.tenants.invalidate();
    // Both organisations use the same administrator address: e-mails are unique per tenant only.
    const res = await call(site, 'POST', '/api/setup', {
      token: created.token,
      email: 'admin@example.org',
      displayName: `Admin ${key}`,
      password: 'a long enough password',
      locale: 'de',
    });
    expect(res.statusCode, res.body).toBe(200);
    site.cookie = cookieOf(res);
    site.csrf = res.json<{ session: { csrfToken: string } }>().session.csrfToken;
  }
});
afterAll(async () => {
  await migrator.destroy();
  await t.close();
});

describe('several organisations in one installation', () => {
  it('keeps courses, groups and users of one organisation invisible to the other', async () => {
    const course = await call(sites.a, 'POST', '/api/courses', { title: 'Nur für A', language: 'de' });
    expect(course.statusCode, course.body).toBe(200);
    const courseId = course.json<{ id: string }>().id;
    expect((await call(sites.a, 'POST', '/api/groups', { name: 'Vertrieb' })).statusCode).toBe(200);
    // The same group name is fine in the other organisation.
    expect((await call(sites.b, 'POST', '/api/groups', { name: 'Vertrieb' })).statusCode).toBe(200);

    const coursesB = await call(sites.b, 'GET', '/api/courses');
    expect(coursesB.body).not.toContain('Nur für A');
    expect((await call(sites.b, 'GET', `/api/courses/${courseId}`)).statusCode).toBe(404);
    const usersA = await call(sites.a, 'GET', '/api/users');
    expect(usersA.json<{ items: { displayName: string }[] }>().items.map((u) => u.displayName)).toEqual([
      'Admin a',
    ]);
    const groupsB = await call(sites.b, 'GET', '/api/groups');
    expect(groupsB.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('does not accept a session of one organisation at the address of the other', async () => {
    const res = await call({ ...sites.b, cookie: sites.a.cookie, csrf: sites.a.csrf }, 'GET', '/api/session');
    expect(res.json<{ session: unknown }>().session).toBeNull();
  });

  it('stores files below the organisation and hands it to background jobs', async () => {
    const created = await call(sites.a, 'POST', '/api/courses', { title: 'Mit Bild', language: 'de' });
    const id = created.json<{ id: string }>().id;
    await call(sites.a, 'POST', `/api/courses/${id}/lock`);
    const boundary = '----tenancy';
    const upload = await t.app.inject({
      method: 'POST',
      url: `/api/courses/${id}/assets`,
      headers: {
        host: sites.a.host,
        'x-forwarded-proto': 'https',
        origin: `https://${sites.a.host}`,
        'x-csrf-token': sites.a.csrf,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      cookies: { [SESSION_COOKIE]: sites.a.cookie },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bild.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        solidPng(8, 8, [1, 2, 3]),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(upload.statusCode, upload.body).toBe(200);
    const sha = upload.json<{ sha256: string }>().sha256;
    expect(await t.ctx.blobs.stat(`tenants/${sites.a.id}/assets/${sha.slice(0, 2)}/${sha}`)).not.toBeNull();
    expect(await t.ctx.blobs.stat(`assets/${sha.slice(0, 2)}/${sha}`)).toBeNull();

    // Jobs queued in an organisation's scope carry it; the default tenant's jobs stay as before.
    const scope = { id: sites.a.id, publicOrigin: null, contentOrigin: null };
    expect(runAsTenant(scope, () => withTenant({ jobId: 'x' }))).toEqual({
      jobId: 'x',
      tenantId: sites.a.id,
    });
    expect(withTenant({ jobId: 'x' })).toEqual({ jobId: 'x' });
  });

  it('fails closed: without an organisation, no query on organisation data runs', async () => {
    await expect(t.ctx.db.selectFrom('users').select('id').execute()).rejects.toThrow();
    const inA = await runAsTenant({ id: sites.a.id, publicOrigin: null, contentOrigin: null }, () =>
      t.ctx.db.selectFrom('users').select('email').execute(),
    );
    expect(inA).toHaveLength(1);
  });

  it('answers unknown addresses with 404 and a disabled organisation with 503', async () => {
    expect(
      (await call({ host: 'unknown.example.test', cookie: '', csrf: '' }, 'GET', '/api/session')).statusCode,
    ).toBe(404);
    await setTenantStatus(migrator, sites.b.id, 'disabled');
    t.ctx.tenants.invalidate();
    expect((await call(sites.b, 'GET', '/api/session')).statusCode).toBe(503);
    await setTenantStatus(migrator, sites.b.id, 'active');
    t.ctx.tenants.invalidate();
    expect((await call(sites.b, 'GET', '/api/session')).statusCode).toBe(200);
  });

  it('removes an organisation with all its rows and files', async () => {
    await deleteTenant(migrator, t.ctx.blobs, sites.a.id);
    t.ctx.tenants.invalidate();
    expect((await call(sites.a, 'GET', '/api/session')).statusCode).toBe(404);
    const left = await migrator.selectFrom('users').select('email').execute();
    expect(left.map((u) => u.email)).toEqual(['admin@example.org']);
    expect(await t.ctx.blobs.list(`tenants/${sites.a.id}/assets`)).toEqual([]);
  });
});
