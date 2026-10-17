// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.js';

export const SMTP_SECURITY = ['tls', 'starttls', 'none'] as const;

/** SMTP settings as administrators see them; the password never leaves the server. */
export const smtpSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.number().int(),
  security: z.enum(SMTP_SECURITY),
  username: z.string(),
  password: z.object({ set: z.boolean() }),
  from: z.string(),
  updatedAt: z.string().nullable(),
});
export type SmtpSettings = z.infer<typeof smtpSettingsSchema>;

const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$|^\[[0-9a-fA-F:.]+\]$/, 'Host name or address');

export const smtpSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    host: hostSchema,
    port: z.number().int().min(1).max(65535),
    security: z.enum(SMTP_SECURITY),
    username: z.string().max(320),
    /** New password; omitted keeps the stored one, null removes it. */
    password: z.string().max(500).nullable().optional(),
    from: z.string().trim().min(3).max(320),
  })
  .strict();
export type SmtpSettingsInput = z.infer<typeof smtpSettingsInputSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema }).strict();
export const passwordResetConfirmSchema = z
  .object({ token: z.string().min(20).max(200), newPassword: passwordSchema })
  .strict();
