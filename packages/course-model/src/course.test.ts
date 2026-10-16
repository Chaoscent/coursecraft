// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { collectAssetRefs, courseSchema } from './course.js';
import { CourseFormatError, loadCourse } from './migrations/index.js';
import { richTextSchema } from './rich-text.js';

const fixture = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('../fixtures/v1-sample.json', import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

describe('course format v1', () => {
  it('loads the sample course and applies defaults', () => {
    const course = loadCourse(fixture());
    expect(course.settings.canvas).toEqual({ width: 1280, height: 720 });
    expect(Object.keys(course.nodes)).toHaveLength(5);
  });

  it('rejects documents from a newer format version', () => {
    expect(() => loadCourse({ ...fixture(), formatVersion: 99 })).toThrow(CourseFormatError);
  });

  it('rejects foreign documents', () => {
    expect(() => loadCourse({ hello: 'world' })).toThrow('Not a Lernwerk course document');
  });

  it('rejects unknown properties', () => {
    expect(courseSchema.safeParse({ ...fixture(), script: 'alert(1)' }).success).toBe(false);
  });

  it('rejects nodes missing from the structure', () => {
    const doc = fixture();
    const structure = doc['structure'] as { chapters: { nodeIds: string[] }[] };
    structure.chapters[0]?.nodeIds.pop();
    const result = courseSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it('rejects references to assets that are not in the asset table', () => {
    const doc = fixture();
    doc['assets'] = {};
    expect(courseSchema.safeParse(doc).success).toBe(false);
  });

  it('collects asset references from nested structures', () => {
    expect(collectAssetRefs(fixture()).size).toBe(1);
  });

  it('produces a JSON Schema', () => {
    expect(() => z.toJSONSchema(courseSchema, { unrepresentable: 'any' })).not.toThrow();
  });
});

describe('rich text', () => {
  const doc = (href: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
      },
    ],
  });

  it.each(['https://example.org', 'mailto:a@example.org'])('accepts %s links', (href) => {
    expect(richTextSchema.safeParse(doc(href)).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', ' javascript:x', 'vbscript:x'])(
    'rejects %s links',
    (href) => {
      expect(richTextSchema.safeParse(doc(href)).success).toBe(false);
    },
  );

  it('rejects HTML node types', () => {
    const html = { type: 'doc', content: [{ type: 'html', value: '<script>x</script>' }] };
    expect(richTextSchema.safeParse(html).success).toBe(false);
  });
});
