// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { loadCourse, type Course } from '@coursecraft/course-model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportXliff, importXliff, XliffError } from './xliff.js';

const sample = (): Course =>
  loadCourse(
    JSON.parse(
      readFileSync(join(process.cwd(), 'packages/course-model/fixtures/v1-sample.json'), 'utf8'),
    ) as unknown,
  );

/** Replaces every target with "[FR] " + source, keeping inline markup. */
function pseudoTranslate(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const source of Array.from(doc.getElementsByTagNameNS('*', 'source'))) {
    const parent = source.parentElement;
    if (!parent) continue;
    for (const old of Array.from(parent.getElementsByTagNameNS('*', 'target'))) old.remove();
    const target = source.cloneNode(true) as Element;
    const renamed = doc.createElementNS(source.namespaceURI, 'target');
    renamed.append(...Array.from(target.childNodes));
    const firstText = Array.from(renamed.childNodes).find((n) => n.nodeType === 3);
    if (firstText) firstText.nodeValue = `[FR] ${firstText.nodeValue ?? ''}`;
    else renamed.prepend(doc.createTextNode('[FR] '));
    parent.append(renamed);
  }
  return new XMLSerializer().serializeToString(doc);
}

function withMarkup(): Course {
  const course = sample();
  const node = course.nodes['s1'];
  if (node?.kind !== 'slide') throw new Error('fixture');
  node.elements.push({
    id: 'rt',
    name: 'Rich',
    type: 'text',
    frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    hidden: false,
    locked: false,
    timing: { startMs: 0 },
    triggers: [],
    style: {
      font: 'sans',
      sizePx: 20,
      lineHeight: 1.3,
      color: 'theme:text',
      verticalAlign: 'top',
      paddingPx: 8,
    },
    content: {
      de: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Fett', marks: [{ type: 'bold' }] },
              { type: 'hardBreak' },
              {
                type: 'text',
                text: 'Link',
                marks: [{ type: 'link', attrs: { href: 'https://example.org/a?b=1&c=2' } }],
              },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Punkt <1>' }] }],
              },
            ],
          },
        ],
      },
    },
  } as never);
  return course;
}

describe.each(['2.1', '1.2'] as const)('XLIFF %s', (version) => {
  it('round-trips every translatable text, keeping marks, links and list structure', () => {
    const course = withMarkup();
    const xml = exportXliff(course, 'fr', version);
    expect(xml).toContain(version === '2.1' ? 'srcLang="de"' : 'source-language="de"');
    expect(xml).not.toContain('<script');
    const result = importXliff(course, pseudoTranslate(xml));
    expect(result.lang).toBe('fr');
    expect(result.skipped).toBe(0);
    expect(result.updated).toBeGreaterThan(5);
    expect(result.course.languages.available).toContain('fr');
    expect(result.course.meta.title['fr']).toBe(`[FR] ${course.meta.title['de'] ?? ''}`);
    const slide = result.course.nodes['s1'];
    const el = slide?.kind === 'slide' ? slide.elements.find((e) => e.id === 'rt') : undefined;
    expect(el?.type === 'text' ? el.content['fr'] : null).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '[FR] ' },
            { type: 'text', text: 'Fett', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: 'Link',
              marks: [{ type: 'link', attrs: { href: 'https://example.org/a?b=1&c=2' } }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '[FR] Punkt <1>' }] }],
            },
          ],
        },
      ],
    });
  });

  it('skips units that no longer match and refuses foreign or broken files', () => {
    const course = withMarkup();
    const xml = pseudoTranslate(exportXliff(course, 'en', version));
    const changed = structuredClone(course);
    delete changed.nodes['faq'];
    for (const chapter of changed.structure.chapters)
      chapter.nodeIds = chapter.nodeIds.filter((n) => n !== 'faq');
    expect(importXliff(changed, xml).skipped).toBeGreaterThan(0);
    expect(() => importXliff(course, '<html/>')).toThrow(XliffError);
    expect(() => importXliff(course, 'not xml')).toThrow(XliffError);
    expect(() => importXliff(course, xml.replace(/"de"/g, '"es"'))).toThrow('source-language-mismatch');
  });
});
