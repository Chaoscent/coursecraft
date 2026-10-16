// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const LOCALES = ['de', 'en'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const uuidSchema = z.uuid();
export const isoDateSchema = z.iso.datetime({ offset: true });

/** E-mail addresses are compared and stored in lower case. */
export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((value) => value.toLowerCase());

export const displayNameSchema = z.string().trim().min(1).max(120);

/** NIST SP 800-63B: length matters, composition rules do not. */
export const PASSWORD_MIN_LENGTH = 10;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(256);

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const sortDirSchema = z.enum(['asc', 'desc']).default('asc');

export const idParamSchema = z.object({ id: uuidSchema });

export const okSchema = z.object({ ok: z.literal(true) });
