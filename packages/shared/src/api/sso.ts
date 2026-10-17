// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

export const SSO_KINDS = ['oidc', 'saml'] as const;
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

export const ssoProviderInputSchema = z.discriminatedUnion('kind', [oidcInput, samlInput]);
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

export const publicSsoProvidersSchema = z.object({
  items: z.array(z.object({ id: uuidSchema, name: z.string(), kind: z.enum(SSO_KINDS) })),
});
