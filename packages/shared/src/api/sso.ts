// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

export const SSO_KINDS = ['oidc', 'saml', 'ldap', 'proxy'] as const;
export const SSO_ROLES = ['learner', 'author', 'trainer'] as const;
/** Reasons the login page can show after a failed single sign-on. */
export const SSO_ERRORS = [
  'failed',
  'denied',
  'domain',
  'no_account',
  'disabled',
  'no_email',
  'expired',
] as const;

const common = {
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  /** E-mail domains that may sign in (empty = all). */
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/)
        .max(253),
    )
    .max(50),
  autoCreate: z.boolean(),
  defaultRole: z.enum(SSO_ROLES),
  /** The administrator vouches that the provider verifies e-mail addresses. */
  emailTrusted: z.boolean(),
};

const urlSchema = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((v) => {
    const u = new URL(v);
    return !u.username && !u.password && !u.hash;
  }, 'No credentials or fragment in the address');

const oidcInput = z
  .object({
    kind: z.literal('oidc'),
    ...common,
    issuer: urlSchema,
    clientId: z.string().trim().min(1).max(500),
    /** New secret; omitted keeps the stored one, null removes it. */
    clientSecret: z.string().trim().min(1).max(2000).nullable().optional(),
    scopes: z.string().trim().max(300).default('openid email profile'),
  })
  .strict();

const samlInput = z
  .object({
    kind: z.literal('saml'),
    ...common,
    /** The provider's single sign-on address (HTTP-Redirect binding). */
    entryPoint: urlSchema,
    /** Entity ID of the provider; assertions from other issuers are refused. */
    idpIssuer: z.string().trim().min(1).max(500),
    /** The provider's signing certificate (PEM, public). */
    idpCert: z
      .string()
      .trim()
      .max(20_000)
      .refine(
        (v) => /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(v),
        'PEM certificate',
      ),
    /** Our entity ID towards the provider. */
    spEntityId: z.string().trim().min(1).max(500),
  })
  .strict();

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;
const attribute = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9-]*$/)
  .max(64);

const ldapInput = z
  .object({
    kind: z.literal('ldap'),
    ...common,
    /** `ldaps://host[:port]`, or `ldap://host[:port]` together with StartTLS. */
    url: z
      .string()
      .trim()
      .regex(/^ldaps?:\/\/[^\s/?#@]+$/)
      .max(300),
    startTls: z.boolean(),
    /** Certificate authority of the directory server (PEM); empty uses the system store. */
    caCert: z
      .string()
      .trim()
      .max(50_000)
      .refine((v) => v === '' || PEM.test(v), 'PEM certificate'),
    /** Name the server certificate is issued for, when it differs from the host in the address. */
    tlsServerName: z.union([
      z.literal(''),
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/)
        .max(253),
    ]),
    /** Service account that looks up users; empty searches anonymously. */
    bindDn: z.string().trim().max(500),
    /** New bind password; omitted keeps the stored one, null removes it. */
    bindPassword: z.string().min(1).max(2000).nullable().optional(),
    userBase: z.string().trim().min(1).max(500),
    /** Search filter; `{username}` stands for the escaped name typed at sign-in. */
    userFilter: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((v) => v.includes('{username}'), 'Contains {username}'),
    /** Attribute that never changes for a person (objectGUID in Active Directory). */
    subjectAttribute: attribute,
    emailAttribute: attribute,
    nameAttribute: attribute,
    groupAttribute: attribute,
    /** Distinguished name of a group; only its members may sign in (empty = everyone found). */
    requiredGroup: z.string().trim().max(500),
    /** Deactivate accounts that no longer appear in the directory (hourly and on demand). */
    syncEnabled: z.boolean(),
    /** Filter listing every account that may use Coursecraft; empty derives it from the user filter. */
    syncFilter: z.string().trim().max(500),
    /** Directory group (distinguished name) to Coursecraft role; never administrator. */
    groupRoles: z
      .array(z.object({ group: z.string().trim().min(1).max(500), role: z.enum(SSO_ROLES) }))
      .max(50),
  })
  .strict()
  .refine((v) => v.url.startsWith('ldaps://') || v.startTls, {
    path: ['startTls'],
    message: 'Passwords are only sent over ldaps:// or StartTLS',
  });

const headerName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{0,63}$/);

const proxyInput = z
  .object({
    kind: z.literal('proxy'),
    ...common,
    /** Header in which the reverse proxy passes the authenticated Windows account. */
    header: headerName,
    /** Addresses or networks (CIDR) of the reverse proxies; requests from elsewhere are refused. */
    trustedProxies: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/),
      )
      .min(1)
      .max(20),
    /** Header that must carry the shared secret (empty = no secret check). */
    secretHeader: z.union([z.literal(''), headerName]),
    /** New shared secret; omitted keeps the stored one, null removes it. */
    sharedSecret: z.string().min(16).max(500).nullable().optional(),
    /** `user@REALM` and `DOMAIN\\user` become `user`. */
    stripRealm: z.boolean(),
    /** Directory provider that supplies e-mail, name and groups for the account (optional). */
    directoryProviderId: uuidSchema.nullable(),
  })
  .strict()
  .refine((v) => v.secretHeader === '' || v.sharedSecret !== null, {
    path: ['sharedSecret'],
    message: 'A secret header needs a shared secret',
  });

export const ssoProviderInputSchema = z.discriminatedUnion('kind', [
  oidcInput,
  samlInput,
  ldapInput,
  proxyInput,
]);
export type SsoProviderInput = z.infer<typeof ssoProviderInputSchema>;

export const ssoProviderSchema = z.object({
  id: uuidSchema,
  kind: z.enum(SSO_KINDS),
  name: z.string(),
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()),
  autoCreate: z.boolean(),
  defaultRole: z.enum(SSO_ROLES),
  emailTrusted: z.boolean(),
  /** Kind-specific settings without secrets. */
  config: z.record(z.string(), z.unknown()),
  secret: z.object({ set: z.boolean(), last4: z.string().nullable() }),
  /** Address the provider sends the browser back to (redirect URI / assertion consumer service). */
  callbackUrl: z.string(),
  /** SAML: address of our service provider metadata. */
  metadataUrl: z.string().nullable(),
  updatedAt: z.string(),
});
export type SsoProvider = z.infer<typeof ssoProviderSchema>;
export const ssoProvidersResponseSchema = z.object({ items: z.array(ssoProviderSchema) });

/** Rules for signing in with a local password. */
export const ssoPolicySchema = z.object({
  /** Only administrators (the break-glass accounts) may use a local password. */
  localLoginAdminOnly: z.boolean(),
});
export type SsoPolicy = z.infer<typeof ssoPolicySchema>;

export const directorySyncResultSchema = z.object({
  checked: z.number().int(),
  deactivated: z.number().int(),
  /** Why nothing was changed (the directory answered with too few accounts), or null. */
  skipped: z.enum(['empty', 'too_many']).nullable(),
});
export type DirectorySyncResult = z.infer<typeof directorySyncResultSchema>;

export const ldapLoginRequestSchema = z
  .object({
    providerId: uuidSchema,
    username: z.string().trim().min(1).max(256),
    password: z.string().min(1).max(1024),
  })
  .strict();

export const publicSsoProvidersSchema = z.object({
  items: z.array(z.object({ id: uuidSchema, name: z.string(), kind: z.enum(SSO_KINDS) })),
});
