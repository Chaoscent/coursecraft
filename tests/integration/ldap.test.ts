// SPDX-License-Identifier: Apache-2.0
// Directory sign-in against a real OpenLDAP server (Futurama test data) over LDAPS.
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { escapeFilterValue } from '../../apps/server/src/modules/sso/ldap.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

const IMAGE = 'ghcr.io/rroemhild/docker-test-openldap:master';
const BASE = 'ou=people,dc=planetexpress,dc=com';
let container: StartedTestContainer;
let t: TestApp;
let admin: Actor;
let providerId: string;
let ca = '';

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withExposedPorts(10636)
    .withWaitStrategy(Wait.forLogMessage(/slapd starting/))
    .start();
  ca = (await container.exec(['cat', '/etc/ldap/ssl/ldap.crt'])).output;
  t = await createTestApp({ COURSECRAFT_LOGIN_RATE_LIMIT: '1000' });
  admin = await t.actor(['admin']);
}, 120_000);
afterAll(async () => {
  await t?.close();
  await container?.stop();
});

const body = (extra: Record<string, unknown> = {}) => ({
  kind: 'ldap',
  name: 'Planet Express',
  enabled: true,
  url: `ldaps://127.0.0.1:${container.getMappedPort(10636)}`,
  startTls: false,
  caCert: ca,
  // The certificate of the test image is issued for this name, not for the address.
  tlsServerName: 'planetexpress.com',
  bindDn: 'cn=admin,dc=planetexpress,dc=com',
  bindPassword: 'GoodNewsEveryone',
  userBase: BASE,
  userFilter: '(&(objectClass=inetOrgPerson)(uid={username}))',
  subjectAttribute: 'entryUUID',
  emailAttribute: 'mail',
  nameAttribute: 'cn',
  groupAttribute: 'memberOf',
  requiredGroup: '',
  groupRoles: [],
  allowedDomains: [],
  autoCreate: true,
  defaultRole: 'learner',
  emailTrusted: true,
  ...extra,
});

async function configure(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await t.request(admin, 'POST', '/api/sso/providers', body(extra));
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ id: string }>().id;
}

const signIn = (id: string, username: string, password: string) =>
  t.request(null, 'POST', '/api/auth/ldap/login', { providerId: id, username, password });

describe('directory sign-in', () => {
  it('escapes filter metacharacters', () => {
    expect(escapeFilterValue('a*)(uid=*')).toBe('a\\2a\\29\\28uid=\\2a');
    expect(escapeFilterValue('back\\slash')).toBe('back\\5cslash');
  });

  it('refuses plain LDAP without StartTLS and seals the bind password', async () => {
    const plain = await t.request(
      admin,
      'POST',
      '/api/sso/providers',
      body({ url: 'ldap://127.0.0.1:389', startTls: false }),
    );
    expect(plain.statusCode).toBe(400);
    providerId = await configure();
    const row = await t.ctx.db
      .selectFrom('sso_providers')
      .select('secret')
      .where('id', '=', providerId)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row.secret)).not.toContain('GoodNewsEveryone');
    expect((await t.request(admin, 'GET', '/api/sso/providers')).body).not.toContain('GoodNewsEveryone');
  });

  it('signs a directory user in, creates the account and reuses it', async () => {
    const res = await signIn(providerId, 'fry', 'fry');
    expect(res.statusCode, res.body).toBe(200);
    const session = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(
      me.json<{ session: { user: { email: string; displayName: string; roles: string[] } } }>().session.user,
    ).toMatchObject({ email: 'fry@planetexpress.com', displayName: 'Philip J. Fry', roles: ['learner'] });
    expect((await signIn(providerId, 'fry', 'fry')).statusCode).toBe(200);
    const count = await t.ctx.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'fry@planetexpress.com')
      .execute();
    expect(count).toHaveLength(1);
  });

  it('rejects wrong passwords, unknown names, empty passwords and filter tricks alike', async () => {
    for (const [user, pass] of [
      ['fry', 'wrong'],
      ['nobody', 'x'],
      ['fry', ''],
      ['*', 'fry'],
      ['fry)(uid=*', 'fry'],
      ['fry)(|(uid=*', 'anything'],
    ] as const) {
      const res = await signIn(providerId, user, pass);
      expect(res.statusCode, `${user}:${pass}`).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, `${user}:${pass}`).toBeLessThan(500);
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    }
  });

  it('lets only members of the required group in', async () => {
    const id = await configure({
      name: 'Nur Admin-Staff',
      requiredGroup: `cn=admin_staff,${BASE}`,
    });
    expect((await signIn(id, 'professor', 'professor')).statusCode).toBe(200);
    expect((await signIn(id, 'fry', 'fry')).statusCode).toBe(401);
  });

  it('maps directory groups to roles at every sign-in and never to administrator', async () => {
    const id = await configure({
      name: 'Mit Rollen',
      groupRoles: [{ group: `cn=admin_staff,${BASE}`, role: 'trainer' }],
    });
    const first = await signIn(id, 'hermes', 'hermes');
    expect(first.statusCode, first.body).toBe(200);
    const roles = () =>
      t.ctx.db
        .selectFrom('user_roles')
        .innerJoin('users', 'users.id', 'user_roles.user_id')
        .select('user_roles.role')
        .where('users.email', '=', 'hermes@planetexpress.com')
        .execute()
        .then((rows) => rows.map((r) => r.role).sort());
    expect(await roles()).toEqual(['learner', 'trainer']);
    // The mapping changes: the role follows at the next sign-in.
    await t.request(
      admin,
      'PUT',
      `/api/sso/providers/${id}`,
      body({ name: 'Mit Rollen', groupRoles: [{ group: `cn=ship_crew,${BASE}`, role: 'author' }] }),
    );
    expect((await signIn(id, 'hermes', 'hermes')).statusCode).toBe(200);
    expect(await roles()).toEqual(['learner']);
    const refused = await t.request(
      admin,
      'POST',
      '/api/sso/providers',
      body({ groupRoles: [{ group: `cn=x,${BASE}`, role: 'admin' }] }),
    );
    expect(refused.statusCode).toBe(400);
  });

  it('does not sign in through a disabled provider or a wrong certificate authority', async () => {
    const off = await configure({ name: 'Aus', enabled: false });
    expect((await signIn(off, 'fry', 'fry')).statusCode).toBe(404);
    const other = await configure({ name: 'Falsche CA', caCert: '' });
    expect((await signIn(other, 'fry', 'fry')).statusCode).toBe(401);
  });
});
