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
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  plan: z.string().nullable(),
  notes: z.string().nullable(),
  planId: uuidSchema.nullable(),
  billingState: z.enum(['active', 'past_due', 'canceled']).nullable(),
  stripeCustomerId: z.string().nullable(),
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

const text = (max: number) => z.string().trim().max(max).nullable();

export const operatorUpdateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    publicOrigin: z.string().trim().max(300).optional(),
    contentOrigin: z.string().trim().max(300).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    maxUsers: limit.optional(),
    maxStorageMb: limit.optional(),
    contactName: text(200).optional(),
    contactEmail: z
      .union([z.literal(''), z.email().max(254)])
      .nullable()
      .optional(),
    plan: text(100).optional(),
    notes: text(5000).optional(),
  })
  .strict();

/** Figures and people of one organisation, for the details panel. */
export const operatorTenantDetailSchema = z.object({
  users: z.number().int(),
  activeUsers30d: z.number().int(),
  courses: z.number().int(),
  libraryItems: z.number().int(),
  storageBytes: z.number(),
  lastSignInAt: z.string().nullable(),
  admins: z.array(
    z.object({
      id: uuidSchema,
      displayName: z.string(),
      email: z.string(),
      lastLoginAt: z.string().nullable(),
    }),
  ),
});

export const operatorResetLinkSchema = z.object({ link: z.string(), expiresAt: z.string() });

export const operatorInstallationSchema = z.object({
  version: z.string(),
  tenancy: z.enum(['single', 'multi']),
  storage: z.enum(['fs', 's3']),
  migration: z.string(),
  organisations: z.number().int(),
  activeOrganisations: z.number().int(),
  users: z.number().int(),
  storageBytes: z.number(),
  /** Stripe is configured for the operator (secret key present). */
  billing: z.boolean(),
});

export const operatorLogSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      action: z.string(),
      tenantName: z.string().nullable(),
      details: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
});

export const operatorSetupTokenSchema = z.object({ token: z.string(), expiresAt: z.string() });
export const operatorCreatedSchema = operatorSetupTokenSchema.extend({ id: uuidSchema });

/** Deleting asks for the organisation's name, typed again. */
export const operatorDeleteSchema = z.object({ confirmName: z.string().max(200) }).strict();

/** A plan: one Stripe price and the limits that come with it. */
export const billingPlanSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  stripePriceId: z.string(),
  maxUsers: limit,
  maxStorageMb: limit,
});
export const billingPlansSchema = z.object({ items: z.array(billingPlanSchema) });
export type BillingPlan = z.infer<typeof billingPlanSchema>;
export const billingPlanInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    stripePriceId: z
      .string()
      .trim()
      .regex(/^price_[A-Za-z0-9]+$/)
      .max(255),
    maxUsers: limit,
    maxStorageMb: limit,
  })
  .strict();

export const operatorPaymentLinkRequestSchema = z.object({ planId: uuidSchema }).strict();
export const operatorUrlSchema = z.object({ url: z.string() });
