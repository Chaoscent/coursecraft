// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

const limit = z.number().int().min(1).max(10_000_000).nullable();

export const operatorLoginSchema = z.object({ password: z.string().min(1).max(500) }).strict();
export const operatorSessionSchema = z.object({
  authenticated: z.boolean(),
  csrfToken: z.string().nullable(),
});

export const operatorTenantSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  publicOrigin: z.string().nullable(),
  contentOrigin: z.string().nullable(),
  status: z.enum(['active', 'disabled']),
  isDefault: z.boolean(),
  maxUsers: limit,
  maxStorageMb: limit,
  users: z.number().int(),
  storageBytes: z.number(),
  createdAt: z.string(),
});
export type OperatorTenant = z.infer<typeof operatorTenantSchema>;
export const operatorTenantsSchema = z.object({ items: z.array(operatorTenantSchema) });

export const operatorNewTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    publicOrigin: z.string().trim().max(300),
    contentOrigin: z.string().trim().max(300),
    maxUsers: limit,
    maxStorageMb: limit,
  })
  .strict();

export const operatorUpdateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    maxUsers: limit.optional(),
    maxStorageMb: limit.optional(),
  })
  .strict();

export const operatorSetupTokenSchema = z.object({ token: z.string(), expiresAt: z.string() });
export const operatorCreatedSchema = operatorSetupTokenSchema.extend({ id: uuidSchema });

/** Deleting asks for the organisation's name, typed again. */
export const operatorDeleteSchema = z.object({ confirmName: z.string().max(200) }).strict();
