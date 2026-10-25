// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { PERMISSIONS } from '../permissions.js';
import { roleSchema } from '../roles.js';
import {
  displayNameSchema,
  emailSchema,
  isoDateSchema,
  localeSchema,
  passwordSchema,
  uuidSchema,
} from './common.js';

export const sessionUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  displayName: z.string(),
  locale: localeSchema,
  roles: z.array(roleSchema),
  permissions: z.array(z.enum(PERMISSIONS)),
  mustChangePassword: z.boolean(),
  totpEnabled: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionInfoSchema = z.object({ user: sessionUserSchema, csrfToken: z.string() });
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const getSessionResponseSchema = z.object({
  session: sessionInfoSchema.nullable(),
  setupRequired: z.boolean(),
});

/** After signing out: where the browser goes next (the identity provider's logout), if anywhere. */
export const logoutResponseSchema = z.object({ ok: z.literal(true), redirect: z.string().nullable() });

export const loginRequestSchema = z
  .object({ email: z.string().trim().max(254), password: z.string().min(1).max(1024) })
  .strict();

export const loginResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), session: sessionInfoSchema }),
  z.object({ status: z.literal('totp_required'), challenge: z.string() }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const totpCodeSchema = z.string().regex(/^\d{6}$/);

export const totpLoginRequestSchema = z
  .object({ challenge: z.string().min(1).max(100), code: totpCodeSchema })
  .strict();

export const sessionResponseSchema = z.object({ session: sessionInfoSchema });

export const changePasswordRequestSchema = z
  .object({ currentPassword: z.string().min(1).max(1024), newPassword: passwordSchema })
  .strict();

export const setupStatusResponseSchema = z.object({ required: z.boolean() });

export const setupRequestSchema = z
  .object({
    token: z.string().min(1).max(100),
    email: emailSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    locale: localeSchema,
  })
  .strict();

export const accountSessionSchema = z.object({
  id: uuidSchema,
  createdAt: isoDateSchema,
  lastSeenAt: isoDateSchema,
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export const accountSessionsResponseSchema = z.object({ items: z.array(accountSessionSchema) });

export const totpSetupResponseSchema = z.object({ secret: z.string(), uri: z.string() });
export const totpConfirmRequestSchema = z.object({ code: totpCodeSchema }).strict();
export const totpDisableRequestSchema = z
  .object({ password: z.string().min(1).max(1024), code: totpCodeSchema })
  .strict();

export const updateProfileRequestSchema = z
  .object({ displayName: displayNameSchema.optional(), locale: localeSchema.optional() })
  .strict();
