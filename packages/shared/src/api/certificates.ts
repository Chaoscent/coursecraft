// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

export const certificateSchema = z.object({
  id: uuidSchema,
  serial: z.string(),
  itemTitle: z.string(),
  completedAt: z.string(),
  issuedAt: z.string(),
  /** False: completion reported by the course content, not scored by the server (F-07). */
  verified: z.boolean(),
});
export type Certificate = z.infer<typeof certificateSchema>;

/** Serial as printed: CC-XXXX-XXXX-XXXX (letters without I/O, digits without 0/1). */
export const certificateSerialSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

/** What anyone with the serial may see: enough to confirm the certificate, nothing more. */
export const certificateVerificationSchema = z.object({
  serial: z.string(),
  learnerName: z.string(),
  itemTitle: z.string(),
  completedAt: z.string(),
  issuedAt: z.string(),
  /** False: completion reported by the course content, not scored by the server (F-07). */
  verified: z.boolean(),
});
