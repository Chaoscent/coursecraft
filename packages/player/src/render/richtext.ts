// SPDX-License-Identifier: Apache-2.0
import type { Block, RichText } from '@lernwerk/course-model';
import { h } from './dom.js';
import { color, type RenderContext } from './context.js';

type Inline = NonNullable<Extract<Block, { type: 'paragraph' }>['content']>[number];
type Mark = NonNullable<Extract<Inline, { type: 'text' }>['marks']>[number];

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function renderInline(node: Inline, ctx: RenderContext): Node {
  if (node.type === 'hardBreak') return h('br');
  let el: Node = document.createTextNode(node.text);
  for (const mark of node.marks ?? []) el = wrap(el, mark, ctx);
  return el;
}

function wrap(inner: Node, mark: Mark, ctx: RenderContext): Node {
  switch (mark.type) {
    case 'bold':
      return h('strong', {}, [inner]);
    case 'italic':
      return h('em', {}, [inner]);
    case 'underline':
      return h('u', {}, [inner]);
    case 'strike':
      return h('s', {}, [inner]);
    case 'subscript':
      return h('sub', {}, [inner]);
    case 'superscript':
      return h('sup', {}, [inner]);
    case 'link': {
      // Validated by the schema; checked again because this is the last line of defense.
      if (!SAFE_LINK.test(mark.attrs.href)) return inner;
      return h('a', { attrs: { href: mark.attrs.href, target: '_blank', rel: 'noopener noreferrer' } }, [
        inner,
      ]);
    }
    case 'textColor': {
      const span = h('span', {}, [inner]);
      const c = color(ctx, mark.attrs.color);
      if (c) span.style.color = c;
      return span;
    }
  }
}

function renderBlock(block: Block, ctx: RenderContext): HTMLElement {
  switch (block.type) {
    case 'paragraph': {
      const p = h(
        'p',
        {},
        (block.content ?? []).map((n) => renderInline(n, ctx)),
      );
      if (block.attrs?.align) p.style.textAlign = block.attrs.align;
      return p;
    }
    case 'heading': {
      const tag = block.attrs.level === 1 ? 'h2' : block.attrs.level === 2 ? 'h3' : 'h4';
      const el = h(
        tag,
        { class: `lw-h${block.attrs.level}` },
        (block.content ?? []).map((n) => renderInline(n, ctx)),
      );
      if (block.attrs.align) el.style.textAlign = block.attrs.align;
      return el;
    }
    case 'bulletList':
    case 'orderedList': {
      const list = h(block.type === 'bulletList' ? 'ul' : 'ol');
      if (block.type === 'orderedList' && block.attrs?.start !== undefined)
        list.setAttribute('start', String(block.attrs.start));
      for (const item of block.content)
        list.append(
          h(
            'li',
            {},
            item.content.map((b) => renderBlock(b, ctx)),
          ),
        );
      return list;
    }
  }
}

export function renderRichText(doc: RichText | undefined, ctx: RenderContext): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of doc?.content ?? []) fragment.append(renderBlock(block, ctx));
  return fragment;
}

/** Plain text of a rich-text document, e.g. for titles and screen-reader labels. */
export function plainText(doc: RichText | undefined): string {
  const parts: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === 'paragraph' || block.type === 'heading') {
        parts.push((block.content ?? []).map((n) => (n.type === 'text' ? n.text : ' ')).join(''));
      } else {
        for (const item of block.content) walk(item.content);
      }
    }
  };
  walk(doc?.content ?? []);
  return parts.join('\n').trim();
}
