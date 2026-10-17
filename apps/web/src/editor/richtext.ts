// SPDX-License-Identifier: Apache-2.0
/**
 * Conversion between TipTap/ProseMirror documents and the course format's
 * restricted rich text. Anything the format does not allow is dropped.
 */
import { richTextSchema, type RichText } from '@lernwerk/course-model';
import type { JSONContent } from '@tiptap/core';

type Mark = { type: string; attrs?: Record<string, unknown> };
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
const ALIGN = new Set(['left', 'center', 'right', 'justify']);

function marksFromTiptap(marks: JSONContent['marks']): Mark[] {
  const out: Mark[] = [];
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
      case 'subscript':
      case 'superscript':
        out.push({ type: mark.type });
        break;
      case 'link': {
        const href = String(mark.attrs?.['href'] ?? '');
        if (SAFE_LINK.test(href)) out.push({ type: 'link', attrs: { href } });
        break;
      }
      case 'textStyle': {
        const color = String(mark.attrs?.['color'] ?? '').toLowerCase();
        if (HEX.test(color)) out.push({ type: 'textColor', attrs: { color } });
        break;
      }
    }
  }
  return out;
}

function inlineFromTiptap(nodes: JSONContent[] | undefined): unknown[] {
  const out: unknown[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'text' && node.text) {
      const marks = marksFromTiptap(node.marks);
      out.push(marks.length ? { type: 'text', text: node.text, marks } : { type: 'text', text: node.text });
    } else if (node.type === 'hardBreak') out.push({ type: 'hardBreak' });
    else if (node.content) out.push(...inlineFromTiptap(node.content));
  }
  return out;
}

function alignOf(node: JSONContent): string | undefined {
  const align: unknown = node.attrs?.['textAlign'];
  return typeof align === 'string' && ALIGN.has(align) && align !== 'left' ? align : undefined;
}

function blocksFromTiptap(nodes: JSONContent[] | undefined): unknown[] {
  const out: unknown[] = [];
  for (const node of nodes ?? []) {
    const align = alignOf(node);
    switch (node.type) {
      case 'paragraph':
        out.push({
          type: 'paragraph',
          ...(align ? { attrs: { align } } : {}),
          content: inlineFromTiptap(node.content),
        });
        break;
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.['level'] ?? 1)));
        out.push({
          type: 'heading',
          attrs: { level, ...(align ? { align } : {}) },
          content: inlineFromTiptap(node.content),
        });
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const items = (node.content ?? [])
          .filter((i) => i.type === 'listItem')
          .map((i) => ({ type: 'listItem', content: blocksFromTiptap(i.content) }))
          .filter((i) => i.content.length);
        if (!items.length) break;
        const start = Number(node.attrs?.['start'] ?? 1);
        out.push(
          node.type === 'orderedList' && start !== 1
            ? { type: node.type, attrs: { start }, content: items }
            : { type: node.type, content: items },
        );
        break;
      }
      default:
        if (node.content) out.push({ type: 'paragraph', content: inlineFromTiptap(node.content) });
    }
  }
  return out;
}

export function fromTiptap(doc: JSONContent): RichText {
  const candidate = { type: 'doc', content: blocksFromTiptap(doc.content) };
  const parsed = richTextSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const text = JSON.stringify(doc)
    .replace(/.*?"text":"([^"]*)"/g, '$1 ')
    .trim();
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] };
}

function marksToTiptap(marks: Mark[] | undefined): NonNullable<JSONContent['marks']> {
  return (marks ?? []).map((m) =>
    m.type === 'textColor'
      ? { type: 'textStyle', attrs: { color: m.attrs?.['color'] } }
      : m.type === 'link'
        ? { type: 'link', attrs: { href: m.attrs?.['href'] } }
        : { type: m.type },
  );
}

type Block = RichText['content'][number];

function blockToTiptap(block: Block): JSONContent {
  switch (block.type) {
    case 'paragraph':
      return {
        type: 'paragraph',
        ...(block.attrs?.align ? { attrs: { textAlign: block.attrs.align } } : {}),
        content: (block.content ?? []).map((n) =>
          n.type === 'text'
            ? { type: 'text', text: n.text, marks: marksToTiptap(n.marks as Mark[] | undefined) }
            : { type: 'hardBreak' },
        ),
      };
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: block.attrs.level, ...(block.attrs.align ? { textAlign: block.attrs.align } : {}) },
        content: (block.content ?? []).map((n) =>
          n.type === 'text'
            ? { type: 'text', text: n.text, marks: marksToTiptap(n.marks as Mark[] | undefined) }
            : { type: 'hardBreak' },
        ),
      };
    case 'bulletList':
    case 'orderedList':
      return {
        type: block.type,
        ...(block.type === 'orderedList' && block.attrs?.start
          ? { attrs: { start: block.attrs.start } }
          : {}),
        content: block.content.map((item) => ({
          type: 'listItem',
          content: item.content.map(blockToTiptap),
        })),
      };
  }
}

export function toTiptap(doc: RichText | undefined): JSONContent {
  const content = (doc?.content ?? []).map(blockToTiptap);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
