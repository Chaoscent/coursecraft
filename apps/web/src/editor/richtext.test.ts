// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { fromTiptap, toTiptap } from './richtext.js';

describe('rich text conversion', () => {
  it('keeps supported structure and marks', () => {
    const tiptap = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'center' },
          content: [{ type: 'text', text: 'Titel', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Punkt' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'rot', marks: [{ type: 'textStyle', attrs: { color: '#FF0000' } }] },
          ],
        },
      ],
    };
    const doc = fromTiptap(tiptap);
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 2, align: 'center' },
      content: [{ type: 'text', text: 'Titel', marks: [{ type: 'bold' }] }],
    });
    expect(doc.content[2]).toMatchObject({
      content: [{ marks: [{ type: 'textColor', attrs: { color: '#ff0000' } }] }],
    });
    expect(fromTiptap(toTiptap(doc))).toEqual(doc);
  });

  it('drops unsafe links and unknown content', () => {
    const doc = fromTiptap({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'klick',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'code' }],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] },
      ],
    });
    expect(JSON.stringify(doc)).not.toContain('javascript');
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'klick' }] });
    expect(doc.content[1]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] });
  });
});
