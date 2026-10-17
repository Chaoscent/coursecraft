// SPDX-License-Identifier: Apache-2.0
// SAML 2.0 sign-in with assertions signed by a throwaway identity provider key.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { newKeyPair, samlResponse, type AssertionOptions, type KeyPair } from '../support/saml-idp.js';
import { createTestApp, ORIGIN, type Actor, type TestApp } from '../support/test-app.js';

const BINDER = '__Host-cc_sso';
const IDP = 'https://idp.example.org/metadata';
const SP = 'https://coursecraft.example.org/sp';
let t: TestApp;
let admin: Actor;
let keys: KeyPair;
let providerId: string;
let acs = '';

beforeAll(async () => {
  keys = newKeyPair();
  t = await createTestApp({ COURSECRAFT_LOGIN_RATE_LIMIT: '1000' });
  admin = await t.actor(['admin']);
});
afterAll(async () => t.close());

const input = (extra: Record<string, unknown> = {}) => ({
  kind: 'saml',
  name: 'Firmen-IdP',
  enabled: true,
  entryPoint: 'https://idp.example.org/sso',
  idpIssuer: IDP,
  idpCert: keys.certificate,
  spEntityId: SP,
  allowedDomains: [],
  autoCreate: true,
  defaultRole: 'learner',
  emailTrusted: false,
  ...extra,
});

async function configure(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await t.request(admin, 'POST', '/api/sso/providers', input(extra));
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ id: string }>().id;
}

/** Starts a login, lets the "provider" answer, and posts the response like the browser would. */
async function signIn(
  id: string,
  assertion: Partial<AssertionOptions> & { nameId: string },
  options: { binder?: string | null; relayState?: string; signingKeys?: KeyPair } = {},
) {
  const start = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${id}/start` });
  expect(start.statusCode).toBe(302);
  const location = new URL(start.headers.location as string);
  const binder = start.cookies.find((c) => c.name === BINDER);
  expect(binder).toMatchObject({ sameSite: 'None', secure: true, httpOnly: true });
  const response = samlResponse(options.signingKeys ?? keys, {
    idpEntityId: IDP,
    audience: SP,
    destination: acs,
    attributes: {},
    ...assertion,
  });
  const form = new URLSearchParams({
    SAMLResponse: response,
    RelayState: options.relayState ?? location.searchParams.get('RelayState') ?? '',
  });
  const cookie = options.binder === null ? undefined : (options.binder ?? binder?.value);
  return t.app.inject({
    method: 'POST',
    url: '/api/auth/sso/saml/acs',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://idp.example.org' },
    payload: form.toString(),
    ...(cookie ? { cookies: { [BINDER]: cookie } } : {}),
  });
}

const errorOf = (res: { headers: Record<string, unknown> }) =>
  new URL(String(res.headers['location']), 'http://localhost').searchParams.get('sso_error');

describe('SAML', () => {
  it('offers metadata and starts the login at the provider with the state as relay state', async () => {
    providerId = await configure();
    acs =
      (await t.request(admin, 'GET', '/api/sso/providers'))
        .json<{ items: { id: string; callbackUrl: string }[] }>()
        .items.find((p) => p.id === providerId)?.callbackUrl ?? '';
    expect(acs).toMatch(/\/api\/auth\/sso\/saml\/acs$/);
    const meta = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${providerId}/metadata` });
    expect(meta.statusCode).toBe(200);
    expect(meta.headers['content-type']).toContain('samlmetadata+xml');
    expect(meta.body).toContain(`entityID="${SP}"`);
    expect(meta.body).toContain(acs);
    const start = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${providerId}/start` });
    const url = new URL(start.headers.location as string);
    expect(url.origin + url.pathname).toBe('https://idp.example.org/sso');
    expect(url.searchParams.get('SAMLRequest')).toBeTruthy();
    expect(url.searchParams.get('RelayState')).toHaveLength(43);
  });

  it('signs a person in from a signed assertion and creates the account', async () => {
    const res = await signIn(providerId, {
      nameId: 'person-1',
      attributes: { mail: 'Saml.Person@Example.org', displayName: 'Saml Person' },
    });
    expect(res.statusCode, res.body).toBe(302);
    expect(res.headers.location).toBe('/');
    const session = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(
      me.json<{ session: { user: { email: string; displayName: string; roles: string[] } } }>().session.user,
    ).toMatchObject({
      email: 'saml.person@example.org',
      displayName: 'Saml Person',
      roles: ['learner'],
    });
    // The same subject keeps its account even if the e-mail attribute changes.
    const again = await signIn(providerId, { nameId: 'person-1', attributes: { mail: 'other@example.org' } });
    expect(again.headers.location).toBe('/');
    expect(
      await t.ctx.db.selectFrom('users').select('id').where('email', '=', 'other@example.org').execute(),
    ).toHaveLength(0);
  });

  it('links an existing account through the provider-asserted e-mail address', async () => {
    const mine = await t.createUser(['trainer']);
    const res = await signIn(providerId, { nameId: 'person-2', attributes: { email: mine.email } });
    const session = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(me.json<{ session: { user: { id: string; roles: string[] } } }>().session.user).toMatchObject({
      id: mine.id,
      roles: ['trainer'],
    });
  });

  it('refuses forged, unsigned, expired and misaddressed assertions', async () => {
    const attributes = { mail: 'forged@example.org' };
    const attacker = newKeyPair('attacker');
    const cases: [string, ReturnType<typeof signIn>][] = [
      ['unsigned', signIn(providerId, { nameId: 'f-1', attributes, sign: false })],
      [
        'signed with another key',
        signIn(providerId, { nameId: 'f-2', attributes }, { signingKeys: attacker }),
      ],
      [
        'changed after signing',
        signIn(providerId, {
          nameId: 'f-3',
          attributes,
          tamper: (xml) => xml.replace('forged@example.org', 'admin@example.org'),
        }),
      ],
      [
        'wrong audience',
        signIn(providerId, { nameId: 'f-4', attributes, audience: 'https://other.example.org/sp' }),
      ],
      ['expired', signIn(providerId, { nameId: 'f-5', attributes, notBefore: -3600, notOnOrAfter: -1800 })],
      [
        'wrong issuer',
        signIn(providerId, { nameId: 'f-6', attributes, idpEntityId: 'https://evil.example.org' }),
      ],
    ];
    for (const [label, pending] of cases) expect(errorOf(await pending), label).toBe('failed');
    expect(
      await t.ctx.db
        .selectFrom('users')
        .select('id')
        .where('email', 'in', ['forged@example.org', 'admin@example.org'])
        .execute(),
    ).toHaveLength(0);
  });

  it('accepts a response only from the browser that started the login, once', async () => {
    expect(
      errorOf(
        await signIn(providerId, { nameId: 'b-1', attributes: { mail: 'b1@example.org' } }, { binder: null }),
      ),
    ).toBe('expired');
    expect(
      errorOf(
        await signIn(
          providerId,
          { nameId: 'b-2', attributes: { mail: 'b2@example.org' } },
          { binder: 'y'.repeat(43) },
        ),
      ),
    ).toBe('expired');
    expect(
      errorOf(
        await signIn(
          providerId,
          { nameId: 'b-3', attributes: { mail: 'b3@example.org' } },
          { relayState: 'made-up' },
        ),
      ),
    ).toBe('expired');

    const start = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${providerId}/start` });
    const relay = new URL(start.headers.location as string).searchParams.get('RelayState') ?? '';
    const binder = start.cookies.find((c) => c.name === BINDER)?.value ?? '';
    const payload = new URLSearchParams({
      SAMLResponse: samlResponse(keys, {
        idpEntityId: IDP,
        audience: SP,
        destination: acs,
        nameId: 'r-1',
        attributes: { mail: 'r1@example.org' },
      }),
      RelayState: relay,
    }).toString();
    const post = () =>
      t.app.inject({
        method: 'POST',
        url: '/api/auth/sso/saml/acs',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload,
        cookies: { [BINDER]: binder },
      });
    expect((await post()).headers.location).toBe('/');
    expect(errorOf(await post())).toBe('expired');
  });

  it('keeps the origin and CSRF checks for every other route and content type', async () => {
    const foreign = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://idp.example.org', 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@example.org', password: 'x'.repeat(12) }),
    });
    expect(foreign.statusCode).toBe(403);
    const form = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=a%40example.org&password=xxxxxxxxxxxx',
    });
    expect(form.statusCode).toBe(415);
  });
});
