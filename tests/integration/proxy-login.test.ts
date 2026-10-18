// SPDX-License-Identifier: Apache-2.0
// Sign-in through a reverse proxy that authenticates Windows accounts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { accountName, isTrustedPeer } from '../../apps/server/src/modules/sso/proxy.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

const PROXY = '10.20.30.40';
const SECRET = 'proxy-shared-secret-123456';
let t: TestApp;
let admin: Actor;
let id: string;

beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_LOGIN_RATE_LIMIT: '1000' });
  admin = await t.actor(['admin']);
});
afterAll(() => t.close());

const body = (extra: Record<string, unknown> = {}) => ({
  kind: 'proxy',
  name: 'Windows-Anmeldung',
  enabled: true,
  header: 'x-remote-user',
  trustedProxies: [`${PROXY}/32`, '192.168.0.0/16'],
  secretHeader: 'x-proxy-secret',
  sharedSecret: SECRET,
  stripRealm: false,
  directoryProviderId: null,
  allowedDomains: [],
  autoCreate: true,
  defaultRole: 'learner',
  emailTrusted: false,
  ...extra,
});

const signIn = (peer: string, headers: Record<string, string>, provider = id) =>
  t.app.inject({
    method: 'GET',
    url: `/api/auth/proxy/${provider}/login`,
    remoteAddress: peer,
    headers,
  });

describe('proxy address and account helpers', () => {
  it('matches single addresses, networks and mapped IPv4 addresses', () => {
    expect(isTrustedPeer('10.1.2.3', ['10.1.2.3'])).toBe(true);
    expect(isTrustedPeer('::ffff:10.1.2.3', ['10.1.2.3'])).toBe(true);
    expect(isTrustedPeer('192.168.7.9', ['192.168.0.0/16'])).toBe(true);
    expect(isTrustedPeer('192.169.0.1', ['192.168.0.0/16'])).toBe(false);
    expect(isTrustedPeer('fd00::5', ['fd00::/8'])).toBe(true);
    expect(isTrustedPeer(undefined, ['10.0.0.0/8'])).toBe(false);
    expect(isTrustedPeer('not-an-address', ['10.0.0.0/8'])).toBe(false);
  });

  it('reduces Windows account names', () => {
    expect(accountName('jdoe@EXAMPLE.COM', true)).toBe('jdoe');
    expect(accountName('EXAMPLE\\jdoe', true)).toBe('jdoe');
    expect(accountName('jdoe@EXAMPLE.COM', false)).toBe('jdoe@EXAMPLE.COM');
  });
});

describe('proxy sign-in', () => {
  it('stores the shared secret sealed and offers the provider on the login page', async () => {
    const res = await t.request(admin, 'POST', '/api/sso/providers', body());
    expect(res.statusCode, res.body).toBe(200);
    id = res.json<{ id: string }>().id;
    const row = await t.ctx.db
      .selectFrom('sso_providers')
      .select('secret')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row.secret)).not.toContain(SECRET);
    expect((await t.request(admin, 'GET', '/api/sso/providers')).body).not.toContain(SECRET);
    const pub = await t.request(null, 'GET', '/api/auth/sso/providers');
    expect(pub.json<{ items: { id: string; kind: string }[] }>().items).toContainEqual(
      expect.objectContaining({ id, kind: 'proxy' }),
    );
  });

  it('signs the account in from a trusted proxy and creates it once', async () => {
    const headers = { 'x-remote-user': 'Anna.Admin@Example.Com', 'x-proxy-secret': SECRET };
    const res = await signIn(PROXY, headers);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const session = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(me.json<{ session: { user: { email: string; roles: string[] } } }>().session.user).toMatchObject({
      email: 'anna.admin@example.com',
      roles: ['learner'],
    });
    expect((await signIn('192.168.1.1', headers)).headers.location).toBe('/');
    const users = await t.ctx.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'anna.admin@example.com')
      .execute();
    expect(users).toHaveLength(1);
  });

  it('refuses everything that is not a trusted proxy with the right secret and one clean header', async () => {
    const good = { 'x-remote-user': 'eve@example.com', 'x-proxy-secret': SECRET };
    const denied = (res: { cookies: { name: string }[]; headers: Record<string, unknown> }) => {
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
      expect(String(res.headers['location'])).toContain('/login?sso_error=');
    };
    // A client reaching the app directly cannot choose who it is.
    denied(await signIn('203.0.113.9', good));
    denied(await signIn(PROXY, { 'x-remote-user': 'eve@example.com' }));
    denied(await signIn(PROXY, { ...good, 'x-proxy-secret': `${SECRET}x` }));
    denied(await signIn(PROXY, { 'x-proxy-secret': SECRET }));
    denied(await signIn(PROXY, { ...good, 'x-remote-user': '   ' }));
    denied(await signIn(PROXY, { ...good, 'x-remote-user': 'a\u0007b' }));
    const eve = await t.ctx.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'eve@example.com')
      .execute();
    expect(eve).toHaveLength(0);
  });

  it('does not sign anyone in through a disabled provider and requires a secret for a secret header', async () => {
    const off = await t.request(admin, 'POST', '/api/sso/providers', body({ name: 'Aus', enabled: false }));
    expect(
      (
        await signIn(
          PROXY,
          { 'x-remote-user': 'a@example.com', 'x-proxy-secret': SECRET },
          off.json<{ id: string }>().id,
        )
      ).statusCode,
    ).toBe(404);
    const bad = await t.request(admin, 'POST', '/api/sso/providers', body({ sharedSecret: null }));
    expect(bad.statusCode).toBe(400);
    const open = await t.request(admin, 'POST', '/api/sso/providers', body({ trustedProxies: [] }));
    expect(open.statusCode).toBe(400);
  });
});
