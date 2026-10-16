// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { assetRefSchema, idSchema, localizedTextSchema, relativePointSchema } from '../primitives.js';
import { localizedRichTextSchema } from '../rich-text.js';

const optionalImage = z.object({ image: assetRefSchema, altText: localizedTextSchema }).strict().optional();

const entrySchema = z
  .object({ id: idSchema, title: localizedTextSchema, body: localizedRichTextSchema, media: optionalImage })
  .strict();
const entries = z.array(entrySchema).min(1).max(50);

const variantSchema = z.discriminatedUnion('variant', [
  z
    .object({
      variant: z.literal('timeline'),
      events: z
        .array(entrySchema.extend({ dateLabel: localizedTextSchema }).strict())
        .min(1)
        .max(50),
    })
    .strict(),
  z.object({ variant: z.literal('accordion'), items: entries }).strict(),
  z
    .object({
      variant: z.literal('glossary'),
      terms: z
        .array(
          z.object({ id: idSchema, term: localizedTextSchema, definition: localizedRichTextSchema }).strict(),
        )
        .min(1)
        .max(1000),
    })
    .strict(),
  z.object({ variant: z.literal('tabs'), items: entries }).strict(),
  z
    .object({
      variant: z.literal('labeledGraphic'),
      image: z.object({ image: assetRefSchema, altText: localizedTextSchema }).strict(),
      markers: z
        .array(entrySchema.extend({ position: relativePointSchema }).strict())
        .min(1)
        .max(30),
    })
    .strict(),
  z.object({ variant: z.literal('steps'), items: entries }).strict(),
  z.object({ variant: z.literal('cycle'), items: z.array(entrySchema).min(2).max(12) }).strict(),
]);

export const interactionNodeSchema = z
  .object({
    kind: z.literal('interaction'),
    id: idSchema,
    title: localizedTextSchema,
    intro: localizedRichTextSchema.optional(),
    content: variantSchema,
    /** Learner must open every item before the node counts as viewed. */
    requireAllViewed: z.boolean().default(false),
  })
  .strict();
export type InteractionNode = z.infer<typeof interactionNodeSchema>;
