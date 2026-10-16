// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { colorSchema, langSchema } from './primitives.js';

/**
 * Restricted ProseMirror-compatible document. Rich text is never stored as
 * HTML; renderers build DOM nodes from this structure.
 */

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

export const linkHrefSchema = z
  .string()
  .max(2000)
  .refine((href) => SAFE_LINK.test(href), { message: 'Only http, https and mailto links' });

const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }).strict(),
  z.object({ type: z.literal('italic') }).strict(),
  z.object({ type: z.literal('underline') }).strict(),
  z.object({ type: z.literal('strike') }).strict(),
  z.object({ type: z.literal('subscript') }).strict(),
  z.object({ type: z.literal('superscript') }).strict(),
  z.object({ type: z.literal('link'), attrs: z.object({ href: linkHrefSchema }).strict() }).strict(),
  z.object({ type: z.literal('textColor'), attrs: z.object({ color: colorSchema }).strict() }).strict(),
]);

const textNodeSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1).max(20_000),
    marks: z.array(markSchema).max(8).optional(),
  })
  .strict();

const hardBreakSchema = z.object({ type: z.literal('hardBreak') }).strict();

const inlineSchema = z.discriminatedUnion('type', [textNodeSchema, hardBreakSchema]);

const alignSchema = z.enum(['left', 'center', 'right', 'justify']);

const paragraphSchema = z
  .object({
    type: z.literal('paragraph'),
    attrs: z.object({ align: alignSchema }).strict().optional(),
    content: z.array(inlineSchema).max(2000).optional(),
  })
  .strict();

const headingSchema = z
  .object({
    type: z.literal('heading'),
    attrs: z
      .object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), align: alignSchema.optional() })
      .strict(),
    content: z.array(inlineSchema).max(2000).optional(),
  })
  .strict();

export interface ListItem {
  type: 'listItem';
  content: Block[];
}
export interface BulletList {
  type: 'bulletList';
  content: ListItem[];
}
export interface OrderedList {
  type: 'orderedList';
  attrs?: { start: number } | undefined;
  content: ListItem[];
}
export type Block =
  z.infer<typeof paragraphSchema> | z.infer<typeof headingSchema> | BulletList | OrderedList;

const listItemSchema: z.ZodType<ListItem> = z
  .object({
    type: z.literal('listItem'),
    get content() {
      return z.array(blockSchema).min(1).max(100);
    },
  })
  .strict();

const bulletListSchema: z.ZodType<BulletList> = z
  .object({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1).max(500) })
  .strict();

const orderedListSchema: z.ZodType<OrderedList> = z
  .object({
    type: z.literal('orderedList'),
    attrs: z
      .object({ start: z.number().int().min(0) })
      .strict()
      .optional(),
    content: z.array(listItemSchema).min(1).max(500),
  })
  .strict();

const blockSchema: z.ZodType<Block> = z.union([
  paragraphSchema,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
]);

export const richTextSchema = z
  .object({ type: z.literal('doc'), content: z.array(blockSchema).max(1000) })
  .strict();
export type RichText = z.infer<typeof richTextSchema>;

/** Translatable rich text: one document per course language. */
export const localizedRichTextSchema = z.record(langSchema, richTextSchema);
export type LocalizedRichText = z.infer<typeof localizedRichTextSchema>;
