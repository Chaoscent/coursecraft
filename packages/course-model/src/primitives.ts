// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

/** Stable identifier inside one course (slides, elements, questions, ...). */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export type Id = z.infer<typeof idSchema>;

/** BCP 47 language tag, restricted to the common `ll` / `ll-RR` forms. */
export const langSchema = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/);
export type Lang = z.infer<typeof langSchema>;

/** Plain translatable text: one value per course language. */
export const localizedTextSchema = z.record(langSchema, z.string().max(10_000));
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** Translatable list of strings, e.g. accepted answers per language. */
export const localizedStringListSchema = z.record(langSchema, z.array(z.string().min(1).max(500)).max(50));

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Reference to a file in the course's asset table. The `$asset` key makes
 * references discoverable by a generic walk over the document.
 */
export const assetRefSchema = z.object({ $asset: sha256Schema }).strict();
export type AssetRef = z.infer<typeof assetRefSchema>;

/** Hex color or a reference to a theme color. */
export const colorSchema = z.union([
  z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/),
  z.enum(['theme:text', 'theme:muted', 'theme:accent', 'theme:surface', 'theme:background']),
]);

/** Rectangle on the slide canvas in logical pixels; rotation in degrees. */
export const frameSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number().min(-360).max(360).default(0),
  })
  .strict();

/** Point relative to an image, 0..1 on both axes. */
export const relativePointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();

export const durationMsSchema = z
  .number()
  .int()
  .min(0)
  .max(6 * 60 * 60 * 1000);
