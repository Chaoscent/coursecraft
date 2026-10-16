// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { roleSchema } from '../roles.js';
import {
  displayNameSchema,
  emailSchema,
  isoDateSchema,
  localeSchema,
  pageQuerySchema,
  passwordSchema,
  sortDirSchema,
  uuidSchema,
} from './common.js';

export const USER_STATUS = ['active', 'disabled'] as const;
export const userStatusSchema = z.enum(USER_STATUS);

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  displayName: z.string(),
  status: userStatusSchema,
  locale: localeSchema,
  roles: z.array(roleSchema),
  groups: z.array(z.object({ id: uuidSchema, name: z.string() })),
  totpEnabled: z.boolean(),
  lastLoginAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
});
export type User = z.infer<typeof userSchema>;

/** Sort keys map to columns on the server (whitelist). */
export const USER_SORT_KEYS = ['name', 'email', 'created', 'lastLogin'] as const;

export const listUsersQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  groupId: uuidSchema.optional(),
  sort: z.enum(USER_SORT_KEYS).default('name'),
  dir: sortDirSchema,
});

export const listUsersResponseSchema = z.object({ items: z.array(userSchema), total: z.number().int() });

export const createUserRequestSchema = z
  .object({
    email: emailSchema,
    displayName: displayNameSchema,
    locale: localeSchema.default('de'),
    roles: z.array(roleSchema).max(4).default(['learner']),
    groupIds: z.array(uuidSchema).max(100).default([]),
    password: passwordSchema,
  })
  .strict();

export const updateUserRequestSchema = z
  .object({
    email: emailSchema.optional(),
    displayName: displayNameSchema.optional(),
    locale: localeSchema.optional(),
    status: userStatusSchema.optional(),
    roles: z.array(roleSchema).max(4).optional(),
    groupIds: z.array(uuidSchema).max(100).optional(),
  })
  .strict();

export const resetPasswordRequestSchema = z.object({ password: passwordSchema }).strict();

export const importUsersResponseSchema = z.object({
  dryRun: z.boolean(),
  rows: z.array(
    z.object({
      line: z.number().int(),
      email: z.string(),
      status: z.enum(['created', 'exists', 'error']),
      message: z.string().optional(),
      /** One-time initial password, only for created users and only in this response. */
      initialPassword: z.string().optional(),
    }),
  ),
});
