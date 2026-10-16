// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { isoDateSchema, pageQuerySchema, uuidSchema } from './common.js';

export const auditEntrySchema = z.object({
  id: z.string(),
  at: isoDateSchema,
  actorUserId: uuidSchema.nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const listAuditQuerySchema = pageQuerySchema.extend({
  action: z.string().max(100).optional(),
  actorUserId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const listAuditResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  total: z.number().int(),
});
