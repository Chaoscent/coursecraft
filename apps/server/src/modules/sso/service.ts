// SPDX-License-Identifier: Apache-2.0
import { assertUserQuota } from '../../tenancy/quotas.js';
import { publicUrl } from '../../tenancy/origins.js';
import type { SsoProvider, SsoProviderInput } from '@coursecraft/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SAML, type Profile as SamlProfile } from '@node-saml/node-saml';
import * as client from 'openid-client';
import { hashPassword } from '../../auth/passwords.js';
import { hashToken, randomToken, safeEqual } from '../../crypto/tokens.js';
import type { SealedJson } from '../../db/schema.js';
import type { AppContext, AuthState } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';

export const BINDER_COOKIE = '__Host-cc_sso';
const STATE_MINUTES = 10;
const HTTP_TIMEOUT_MS = 15_000;

export type SsoError = 'failed' | 'denied' | 'domain' | 'no_account' | 'disabled' | 'no_email' | 'expired';

export const secretAad = (id: string) => `sso-secret:${id}`;
const verifierAad = (stateHash: string) => `sso-verifier:${stateHash}`;
export const callbackUrl = (ctx: AppContext) =>
  new URL('/api/auth/sso/callback', publicUrl(ctx.config)).toString();
export const acsUrl = (ctx: AppContext) =>
  new URL('/api/auth/sso/saml/acs', publicUrl(ctx.config)).toString();
export const metadataUrl = (ctx: AppContext, id: string) =>
  new URL(`/api/auth/sso/${id}/metadata`, publicUrl(ctx.config)).toString();

export type Row = {
  id: string;
  kind: 'oidc' | 'saml' | 'ldap' | 'proxy';
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secret: SealedJson | null;
  secret_last4: string | null;
  allowed_domains: string[];
  auto_create: boolean;
  default_role: 'learner' | 'author' | 'trainer';
  email_trusted: boolean;
  updated_at: Date;
};

const toProvider = (ctx: AppContext, r: Row): SsoProvider => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  enabled: r.enabled,
  allowedDomains: r.allowed_domains,
  autoCreate: r.auto_create,
  defaultRole: r.default_role,
  emailTrusted: r.email_trusted,
  config: r.config,
  secret: { set: r.secret !== null, last4: r.secret_last4 },
  callbackUrl:
    r.kind === 'saml'
      ? acsUrl(ctx)
      : r.kind === 'proxy'
        ? new URL(`/api/auth/proxy/${r.id}/login`, publicUrl(ctx.config)).toString()
        : r.kind === 'ldap'
          ? ''
          : callbackUrl(ctx),
  metadataUrl: r.kind === 'saml' ? metadataUrl(ctx, r.id) : null,
  updatedAt: r.updated_at.toISOString(),
});

export async function listProviders(ctx: AppContext): Promise<SsoProvider[]> {
  const rows = await ctx.db.selectFrom('sso_providers').selectAll().orderBy('name').execute();
  return rows.map((r) => toProvider(ctx, r));
}

export async function publicProviders(ctx: AppContext) {
  const rows = await ctx.db
    .selectFrom('sso_providers')
    .select(['id', 'name', 'kind'])
    .where('enabled', '=', true)
    .orderBy('name')
    .execute();
  return rows;
}

function providerConfig(input: SsoProviderInput): Record<string, unknown> {
  switch (input.kind) {
    case 'oidc':
      return { issuer: input.issuer.replace(/\/+$/, ''), clientId: input.clientId, scopes: input.scopes };
    case 'saml':
      return {
        entryPoint: input.entryPoint,
        idpIssuer: input.idpIssuer,
        idpCert: input.idpCert,
        spEntityId: input.spEntityId,
      };
    case 'proxy':
      return {
        header: input.header,
        trustedProxies: input.trustedProxies,
        secretHeader: input.secretHeader,
        stripRealm: input.stripRealm,
        directoryProviderId: input.directoryProviderId,
      };
    case 'ldap':
      return {
        url: input.url,
        startTls: input.startTls,
        caCert: input.caCert,
        tlsServerName: input.tlsServerName,
        bindDn: input.bindDn,
        userBase: input.userBase,
        userFilter: input.userFilter,
        subjectAttribute: input.subjectAttribute,
        emailAttribute: input.emailAttribute,
        nameAttribute: input.nameAttribute,
        groupAttribute: input.groupAttribute,
        requiredGroup: input.requiredGroup,
        syncEnabled: input.syncEnabled,
        syncFilter: input.syncFilter,
        groupRoles: input.groupRoles,
      };
  }
}

export async function saveProvider(
  ctx: AppContext,
  auth: AuthState,
  id: string | null,
  input: SsoProviderInput,
): Promise<string> {
  const config = providerConfig(input);
  const secret =
    input.kind === 'oidc'
      ? input.clientSecret
      : input.kind === 'ldap'
        ? input.bindPassword
        : input.kind === 'proxy'
          ? input.sharedSecret
          : undefined;
  const fields = {
    kind: input.kind,
    name: input.name,
    enabled: input.enabled,
    config: JSON.stringify(config),
    allowed_domains: JSON.stringify(input.allowedDomains),
    auto_create: input.autoCreate,
    default_role: input.defaultRole,
    email_trusted: input.emailTrusted,
  };
  return ctx.db.transaction().execute(async (tx) => {
    let target = id;
    if (target) {
      const existing = await tx
        .selectFrom('sso_providers')
        .select('kind')
        .where('id', '=', target)
        .executeTakeFirst();
      if (!existing) throw notFound('Provider not found');
      if (existing.kind !== input.kind)
        throw new AppError('bad_request', 'The kind of a provider cannot change');
      await tx
        .updateTable('sso_providers')
        .set({ ...fields, updated_at: new Date() })
        .where('id', '=', target)
        .execute();
    } else {
      target = (await tx.insertInto('sso_providers').values(fields).returning('id').executeTakeFirstOrThrow())
        .id;
    }
    if (secret !== undefined) {
      await tx
        .updateTable('sso_providers')
        .set(
          secret === null
            ? { secret: null, secret_last4: null }
            : {
                secret: JSON.stringify(ctx.box.seal(secret, secretAad(target))),
                secret_last4: secret.slice(-4),
              },
        )
        .where('id', '=', target)
        .execute();
    }
    await ctx.audit.record(
      {
        actorUserId: auth.userId,
        action: id ? 'sso.provider_updated' : 'sso.provider_created',
        targetType: 'sso_provider',
        targetId: target,
        meta: { kind: input.kind, enabled: input.enabled, secretChanged: secret !== undefined },
      },
      tx,
    );
    return target;
  });
}

export async function deleteProvider(ctx: AppContext, auth: AuthState, id: string): Promise<void> {
  const deleted = await ctx.db.deleteFrom('sso_providers').where('id', '=', id).executeTakeFirst();
  if (!deleted.numDeletedRows) throw notFound('Provider not found');
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'sso.provider_deleted',
    targetType: 'sso_provider',
    targetId: id,
  });
}

/* ---------- OpenID Connect ---------- */

const configurations = new Map<string, { stamp: number; config: client.Configuration }>();

/** Every request to the identity provider has a timeout. */
const timeoutFetch: client.CustomFetch = (url, options) =>
  fetch(url, {
    method: options.method,
    headers: options.headers,
    redirect: options.redirect,
    ...(options.body === undefined || options.body === null ? {} : { body: options.body as BodyInit }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

async function oidcConfiguration(ctx: AppContext, row: Row): Promise<client.Configuration> {
  const cached = configurations.get(row.id);
  const stamp = row.updated_at.getTime();
  if (cached && cached.stamp === stamp) return cached.config;
  const cfg = row.config as { issuer: string; clientId: string };
  const secret = row.secret ? ctx.box.open(row.secret, secretAad(row.id)) : null;
  const issuer = new URL(cfg.issuer);
  const config = await client.discovery(
    issuer,
    cfg.clientId,
    secret ?? {},
    secret ? undefined : client.None(),
    {
      [client.customFetch]: timeoutFetch,
      // Plain HTTP only where the administrator entered an http address (local identity providers).
      ...(issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : {}),
    },
  );
  configurations.set(row.id, { stamp, config });
  return config;
}

export async function enabledProvider(
  ctx: AppContext,
  id: string,
  kind: 'oidc' | 'saml' | 'ldap' | 'proxy',
): Promise<Row> {
  const row = await ctx.db
    .selectFrom('sso_providers')
    .selectAll()
    .where('id', '=', id)
    .where('enabled', '=', true)
    .where('kind', '=', kind)
    .executeTakeFirst();
  if (!row) throw notFound('Provider not found');
  return row;
}

export function setBinderCookie(reply: FastifyReply, binder: string, sameSite: 'lax' | 'none'): void {
  reply.setCookie(BINDER_COOKIE, binder, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite,
    maxAge: STATE_MINUTES * 60,
  });
}

/** Stores a pending login and returns the secrets the browser needs (state, binder). */
export async function createState(
  ctx: AppContext,
  providerId: string,
  extra: { nonce?: string; verifier?: string } = {},
): Promise<{ state: string; binder: string }> {
  const state = randomToken();
  const binder = randomToken();
  const stateHash = hashToken(state);
  await ctx.db.deleteFrom('sso_states').where('expires_at', '<', new Date()).execute();
  await ctx.db
    .insertInto('sso_states')
    .values({
      state_hash: stateHash,
      provider_id: providerId,
      binder_hash: hashToken(binder),
      nonce: extra.nonce ?? null,
      code_verifier: extra.verifier
        ? JSON.stringify(ctx.box.seal(extra.verifier, verifierAad(stateHash)))
        : null,
      expires_at: new Date(Date.now() + STATE_MINUTES * 60_000),
    })
    .execute();
  return { state, binder };
}

/** Consumes a pending login: single use, only from the browser that started it. */
export async function takeState(ctx: AppContext, state: string | undefined, binder: string | undefined) {
  if (!state || !binder) return null;
  const stateHash = hashToken(state);
  const row = await ctx.db
    .deleteFrom('sso_states')
    .where('state_hash', '=', stateHash)
    .where('expires_at', '>', new Date())
    .returningAll()
    .executeTakeFirst();
  if (!row || !safeEqual(row.binder_hash, hashToken(binder))) return null;
  return {
    providerId: row.provider_id,
    nonce: row.nonce,
    verifier: row.code_verifier ? ctx.box.open(row.code_verifier, verifierAad(stateHash)) : null,
  };
}

export async function startOidc(ctx: AppContext, reply: FastifyReply, providerId: string): Promise<string> {
  const row = await enabledProvider(ctx, providerId, 'oidc');
  const config = await oidcConfiguration(ctx, row);
  const verifier = client.randomPKCECodeVerifier();
  const nonce = randomToken();
  const { state, binder } = await createState(ctx, row.id, { nonce, verifier });
  setBinderCookie(reply, binder, 'lax');
  return client
    .buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl(ctx),
      scope: String((row.config as { scopes?: string }).scopes ?? 'openid email profile'),
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    .toString();
}

/** The raw query string (with `?`) of a request URL; empty if there is none. */
const queryOf = (url: string): string => {
  const at = url.indexOf('?');
  return at < 0 ? '' : url.slice(at);
};

export interface Profile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  locale: string | null;
}

export type Outcome = { userId: string } | { error: SsoError };

export async function finishOidc(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Outcome> {
  const query = request.query as Record<string, string | undefined>;
  const binder = request.cookies[BINDER_COOKIE];
  reply.clearCookie(BINDER_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
  const pending = await takeState(ctx, query['state'], binder);
  if (!pending) return { error: 'expired' };
  if (query['error']) return { error: 'denied' };
  try {
    const row = await enabledProvider(ctx, pending.providerId, 'oidc');
    const config = await oidcConfiguration(ctx, row);
    const current = new URL(`/api/auth/sso/callback${queryOf(request.url)}`, publicUrl(ctx.config));
    const tokens = await client.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: pending.verifier ?? '',
      expectedState: query['state'] ?? '',
      expectedNonce: pending.nonce ?? '',
    });
    const claims = tokens.claims();
    if (!claims?.sub) return { error: 'failed' };
    return resolveUser(ctx, row, {
      subject: claims.sub,
      email: typeof claims['email'] === 'string' ? claims['email'] : null,
      emailVerified: claims['email_verified'] === true,
      name:
        typeof claims['name'] === 'string'
          ? claims['name']
          : typeof claims['preferred_username'] === 'string'
            ? claims['preferred_username']
            : null,
      locale: typeof claims['locale'] === 'string' ? claims['locale'] : null,
    });
  } catch (error) {
    // Details stay in the log; the browser only learns that it failed.
    ctx.log.warn({ err: error, provider: pending.providerId }, 'single sign-on failed');
    return { error: 'failed' };
  }
}

/* ---------- Mapping to local accounts ---------- */

/**
 * Finds or creates the local account for an identity: known identity first,
 * then an existing account with the same (trusted) e-mail address, then
 * optionally a new account with the provider's default role.
 */
export async function resolveUser(ctx: AppContext, row: Row, profile: Profile): Promise<Outcome> {
  const email = profile.email?.trim().toLowerCase() || null;
  if (email && row.allowed_domains.length) {
    const domain = email.split('@')[1] ?? '';
    if (!row.allowed_domains.includes(domain)) return { error: 'domain' };
  }
  const known = await ctx.db
    .selectFrom('user_identities')
    .innerJoin('users', 'users.id', 'user_identities.user_id')
    .select(['users.id', 'users.status'])
    .where('user_identities.provider_id', '=', row.id)
    .where('user_identities.subject', '=', profile.subject)
    .where('users.deleted_at', 'is', null)
    .executeTakeFirst();
  if (known) return known.status === 'active' ? { userId: known.id } : { error: 'disabled' };

  if (!email || !(row.email_trusted || profile.emailVerified)) return { error: 'no_email' };
  const link = (userId: string) =>
    ctx.db
      .insertInto('user_identities')
      .values({ provider_id: row.id, subject: profile.subject, user_id: userId })
      .execute();

  const existing = await ctx.db
    .selectFrom('users')
    .select(['id', 'status'])
    .where('email', '=', email)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (existing) {
    if (existing.status !== 'active') return { error: 'disabled' };
    await link(existing.id);
    await ctx.audit.record({
      actorUserId: existing.id,
      action: 'auth.sso_linked',
      targetType: 'sso_provider',
      targetId: row.id,
    });
    return { userId: existing.id };
  }
  if (!row.auto_create) return { error: 'no_account' };
  try {
    await assertUserQuota(ctx);
  } catch {
    return { error: 'no_account' };
  }
  const userId = await ctx.db.transaction().execute(async (tx) => {
    const user = await tx
      .insertInto('users')
      .values({
        email,
        display_name: (profile.name?.trim() || email).slice(0, 100),
        locale: profile.locale?.toLowerCase().startsWith('en') ? 'en' : 'de',
        // No password sign-in until the person sets one (e.g. through a reset mail).
        password_hash: await hashPassword(randomToken()),
        must_change_password: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx.insertInto('user_roles').values({ user_id: user.id, role: row.default_role }).execute();
    await tx
      .insertInto('user_identities')
      .values({ provider_id: row.id, subject: profile.subject, user_id: user.id })
      .execute();
    await ctx.audit.record(
      {
        actorUserId: user.id,
        action: 'user.created_sso',
        targetType: 'user',
        targetId: user.id,
        meta: { provider: row.id, role: row.default_role },
      },
      tx,
    );
    return user.id;
  });
  return { userId };
}

/* ---------- SAML 2.0 (HTTP-Redirect request, HTTP-POST response) ---------- */

type SamlConfig = { entryPoint: string; idpIssuer: string; idpCert: string; spEntityId: string };

function samlFor(ctx: AppContext, row: Row): SAML {
  const c = row.config as unknown as SamlConfig;
  return new SAML({
    entryPoint: c.entryPoint,
    callbackUrl: acsUrl(ctx),
    issuer: c.spEntityId,
    // The assertion must be addressed to us and signed by the provider's certificate.
    audience: c.spEntityId,
    idpCert: c.idpCert,
    idpIssuer: c.idpIssuer,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 60_000,
    maxAssertionAgeMs: 10 * 60_000,
    disableRequestedAuthnContext: true,
    signatureAlgorithm: 'sha256',
  });
}

/** Starts a login with whichever protocol the provider speaks. */
export async function startLogin(ctx: AppContext, reply: FastifyReply, providerId: string): Promise<string> {
  const row = await ctx.db
    .selectFrom('sso_providers')
    .select('kind')
    .where('id', '=', providerId)
    .where('enabled', '=', true)
    .executeTakeFirst();
  if (!row || row.kind === 'ldap' || row.kind === 'proxy') throw notFound('Provider not found');
  return row.kind === 'saml' ? startSaml(ctx, reply, providerId) : startOidc(ctx, reply, providerId);
}

export async function startSaml(ctx: AppContext, reply: FastifyReply, providerId: string): Promise<string> {
  const row = await enabledProvider(ctx, providerId, 'saml');
  const { state, binder } = await createState(ctx, row.id);
  // The provider answers with a cross-site POST, which only carries cookies marked SameSite=None.
  setBinderCookie(reply, binder, 'none');
  return samlFor(ctx, row).getAuthorizeUrlAsync(state, undefined, {});
}

export function spMetadata(ctx: AppContext, row: Row): string {
  return samlFor(ctx, row).generateServiceProviderMetadata(null, null);
}

export async function providerMetadata(ctx: AppContext, id: string): Promise<string> {
  return spMetadata(ctx, await enabledProvider(ctx, id, 'saml'));
}

const MAIL_ATTRIBUTES = [
  'email',
  'mail',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
];
const NAME_ATTRIBUTES = [
  'displayName',
  'name',
  'cn',
  'urn:oid:2.16.840.1.113730.3.1.241',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];

const first = (value: unknown): string | null => {
  const v: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

export function samlProfile(p: SamlProfile): Profile {
  const fromAttributes = (names: string[]) => names.map((n) => first(p[n])).find((v) => v !== null) ?? null;
  const nameIdEmail = p.nameIDFormat?.endsWith('emailAddress') && p.nameID.includes('@') ? p.nameID : null;
  return {
    // The same person keeps the same identifier, whichever attributes the provider sends.
    subject: p.nameID,
    email: fromAttributes(MAIL_ATTRIBUTES) ?? nameIdEmail,
    // The assertion is signed by the provider: its attributes are the provider's statement.
    emailVerified: true,
    name: fromAttributes(NAME_ATTRIBUTES),
    locale: first(p['locale']),
  };
}

export async function finishSaml(
  ctx: AppContext,
  body: { SAMLResponse: string; RelayState?: string | undefined },
  binder: string | undefined,
  reply: FastifyReply,
): Promise<Outcome> {
  reply.clearCookie(BINDER_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'none' });
  const pending = await takeState(ctx, body.RelayState, binder);
  if (!pending) return { error: 'expired' };
  try {
    const row = await enabledProvider(ctx, pending.providerId, 'saml');
    const { profile } = await samlFor(ctx, row).validatePostResponseAsync({
      SAMLResponse: body.SAMLResponse,
      ...(body.RelayState ? { RelayState: body.RelayState } : {}),
    });
    if (!profile?.nameID) return { error: 'failed' };
    // node-saml checks the issuer for logout messages only. The signing key may belong to a
    // provider that serves several parties, so the issuer has to be pinned here.
    const expected = (row.config as unknown as SamlConfig).idpIssuer;
    if (profile.issuer !== expected) {
      ctx.log.warn({ provider: row.id }, 'SAML assertion from an unexpected issuer');
      return { error: 'failed' };
    }
    return resolveUser(ctx, row, samlProfile(profile));
  } catch (error) {
    ctx.log.warn({ err: error, provider: pending.providerId }, 'SAML sign-in failed');
    return { error: 'failed' };
  }
}
