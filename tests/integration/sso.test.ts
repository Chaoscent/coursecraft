// SPDX-License-Identifier: Apache-2.0
// OpenID Connect sign-in against a fake provider on loopback.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeIdp, type IdpUser } from '../support/oidc-idp.js';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

const BINDER = '__Host-cc_sso';
const idp = new FakeIdp();
let t: TestApp;
let admin: Actor;
let providerId: string;

beforeAll(async () => {
  await idp.start();
  t = await createTestApp({ COURSECRAFT_LOGIN_RATE_LIMIT: '1000' });
  admin = await t.actor(['admin']);
});
afterAll(async () => {
  await t.close();
  await idp.stop();
});
beforeEach(() => {
  idp.tamper = {};
});

const body = (extra: Record<string, unknown> = {}) => ({
  kind: 'oidc',
  name: 'Firmen-Login',
  enabled: true,
  issuer: idp.issuer,
  clientId: idp.clientId,
  clientSecret: idp.clientSecret,
  scopes: 'openid email profile',
  allowedDomains: [],
  autoCreate: true,
  defaultRole: 'learner',
  emailTrusted: false,
  ...extra,
});

async function configure(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await t.request(admin, 'POST', '/api/sso/providers', body(extra));
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ id: string }>().id;
}

/** Runs the whole browser round trip and returns the callback response. */
async function signIn(
  id: string,
  user: IdpUser,
  mutate?: (callback: URL, binder: string) => { url: URL; binder: string | undefined },
) {
  const start = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${id}/start` });
  expect(start.statusCode).toBe(302);
  const binder = start.cookies.find((c) => c.name === BINDER)?.value ?? '';
  const back = new URL(idp.authorize(start.headers.location as string, user));
  const { url, binder: sent } = mutate ? mutate(back, binder) : { url: back, binder };
  return t.app.inject({
    method: 'GET',
    url: `${url.pathname}${url.search}`,
    ...(sent ? { cookies: { [BINDER]: sent } } : {}),
  });
}

const errorOf = (res: { headers: Record<string, unknown> }) =>
  new URL(String(res.headers['location']), 'http://x').searchParams.get('sso_error');

describe('OpenID Connect', () => {
  it('stores the client secret sealed and offers only enabled providers on the login page', async () => {
    providerId = await configure();
    const row = await t.ctx.db
      .selectFrom('sso_providers')
      .select('secret')
      .where('id', '=', providerId)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row.secret)).not.toContain(idp.clientSecret);
    const listed = await t.request(admin, 'GET', '/api/sso/providers');
    expect(listed.body).not.toContain(idp.clientSecret);
    expect(
      listed
        .json<{ items: { id: string; secret: unknown; callbackUrl: string }[] }>()
        .items.find((p) => p.id === providerId),
    ).toMatchObject({
      secret: { set: true, last4: '9876' },
      callbackUrl: expect.stringContaining('/api/auth/sso/callback') as string,
    });
    const off = await configure({ name: 'Aus', enabled: false });
    const pub = (await t.request(null, 'GET', '/api/auth/sso/providers'))
      .json<{ items: { id: string }[] }>()
      .items.map((p) => p.id);
    expect(pub).toContain(providerId);
    expect(pub).not.toContain(off);
  });

  it('signs a new person in with PKCE, creates the account with the default role and reuses it later', async () => {
    const start = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${providerId}/start` });
    const auth = new URL(start.headers.location as string);
    expect(auth.origin).toBe(idp.issuer);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('scope')).toBe('openid email profile');
    expect(auth.searchParams.get('redirect_uri')).toContain('/api/auth/sso/callback');
    const cookie = start.cookies.find((c) => c.name === BINDER);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });

    const user = { sub: 'u-1', email: 'Neu.Person@Example.org', email_verified: true, name: 'Neu Person' };
    const res = await signIn(providerId, user);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const session = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    expect(session).not.toBe('');
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(
      me.json<{ session: { user: { email: string; roles: string[]; mustChangePassword: boolean } } }>()
        .session.user,
    ).toMatchObject({
      email: 'neu.person@example.org',
      roles: ['learner'],
      mustChangePassword: false,
    });

    const again = await signIn(providerId, { ...user, email: 'changed@example.org' });
    expect(again.headers.location).toBe('/');
    const users = await t.ctx.db
      .selectFrom('users')
      .select('id')
      .where('email', 'in', ['neu.person@example.org', 'changed@example.org'])
      .execute();
    expect(users).toHaveLength(1);
  });

  it('links an existing account by verified e-mail, but not by an unverified one', async () => {
    const mine = await t.createUser(['author']);
    const unverified = await signIn(providerId, { sub: 'u-2', email: mine.email, email_verified: false });
    expect(errorOf(unverified)).toBe('no_email');
    const verified = await signIn(providerId, { sub: 'u-2', email: mine.email, email_verified: true });
    expect(verified.headers.location).toBe('/');
    const session = verified.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(me.json<{ session: { user: { id: string; roles: string[] } } }>().session.user).toMatchObject({
      id: mine.id,
      roles: ['author'],
    });

    const trusting = await configure({ name: 'Vertraut', emailTrusted: true });
    const other = await t.createUser(['learner']);
    expect((await signIn(trusting, { sub: 'x-1', email: other.email })).headers.location).toBe('/');
  });

  it('applies domain, account-creation and disabled-user rules', async () => {
    const restricted = await configure({
      name: 'Domain',
      allowedDomains: ['example.org'],
      autoCreate: false,
    });
    expect(
      errorOf(await signIn(restricted, { sub: 'd-1', email: 'x@evil.test', email_verified: true })),
    ).toBe('domain');
    expect(
      errorOf(await signIn(restricted, { sub: 'd-2', email: 'nobody@example.org', email_verified: true })),
    ).toBe('no_account');
    const blocked = await t.createUser(['learner']);
    await t.ctx.db.updateTable('users').set({ status: 'disabled' }).where('id', '=', blocked.id).execute();
    expect(
      errorOf(await signIn(restricted, { sub: 'd-3', email: blocked.email, email_verified: true })),
    ).toBe('disabled');
  });

  it('refuses logins that were not started in this browser, replays, wrong nonce, tampering and provider errors', async () => {
    // Started elsewhere (attacker's flow completed in the victim's browser): no binder cookie, or someone else's.
    expect(
      errorOf(
        await signIn(providerId, { sub: 'a-1', email: 'a@example.org', email_verified: true }, (u) => ({
          url: u,
          binder: undefined,
        })),
      ),
    ).toBe('expired');
    expect(
      errorOf(
        await signIn(providerId, { sub: 'a-1', email: 'a@example.org', email_verified: true }, (u) => ({
          url: u,
          binder: 'x'.repeat(43),
        })),
      ),
    ).toBe('expired');

    // State is single use.
    const start = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${providerId}/start` });
    const binder = start.cookies.find((c) => c.name === BINDER)?.value ?? '';
    const back = new URL(
      idp.authorize(start.headers.location as string, {
        sub: 'r-1',
        email: 'r@example.org',
        email_verified: true,
      }),
    );
    const call = () =>
      t.app.inject({ method: 'GET', url: `${back.pathname}${back.search}`, cookies: { [BINDER]: binder } });
    expect((await call()).headers.location).toBe('/');
    expect(errorOf(await call())).toBe('expired');

    // ID token with another nonce / audience, forged state, error from the provider.
    idp.tamper = { nonce: 'not-mine' };
    expect(
      errorOf(await signIn(providerId, { sub: 'n-1', email: 'n@example.org', email_verified: true })),
    ).toBe('failed');
    idp.tamper = { aud: 'someone-else' };
    expect(
      errorOf(await signIn(providerId, { sub: 'n-2', email: 'n2@example.org', email_verified: true })),
    ).toBe('failed');
    idp.tamper = {};
    expect(
      errorOf(
        await signIn(providerId, { sub: 'n-3' }, (u, b) => ({
          url: new URL(u.toString().replace(/state=[^&]+/, 'state=forged')),
          binder: b,
        })),
      ),
    ).toBe('expired');
    expect(
      errorOf(
        await signIn(providerId, { sub: 'n-4' }, (u, b) => {
          const e = new URL(u.origin + u.pathname);
          e.searchParams.set('state', u.searchParams.get('state') ?? '');
          e.searchParams.set('error', 'access_denied');
          return { url: e, binder: b };
        }),
      ),
    ).toBe('denied');
    const audit = await t.ctx.db
      .selectFrom('audit_log')
      .select('meta')
      .where('action', '=', 'auth.sso_failed')
      .execute();
    expect(audit.length).toBeGreaterThanOrEqual(6);
  });

  it('sends the browser back to the login page when the provider is unreachable or disabled', async () => {
    const broken = await configure({ name: 'Kaputt', issuer: 'http://127.0.0.1:9' });
    const start = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${broken}/start` });
    expect(errorOf(start)).toBe('failed');
    await t.request(
      admin,
      'PUT',
      `/api/sso/providers/${providerId}`,
      body({ enabled: false, clientSecret: undefined }),
    );
    expect(errorOf(await t.app.inject({ method: 'GET', url: `/api/auth/sso/${providerId}/start` }))).toBe(
      'failed',
    );
  });
});
