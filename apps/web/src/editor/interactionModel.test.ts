// SPDX-License-Identifier: Apache-2.0
import { interactionNodeSchema } from '@lernwerk/course-model';
import { describe, expect, it } from 'vitest';
import { convertContent, entriesOf, newInteraction } from './interactionModel.js';

const labels = { title: 'Interaktion', entry: 'Eintrag', body: 'Inhalt' };

describe('interaction model', () => {
  it('creates a valid accordion', () => {
    expect(interactionNodeSchema.safeParse(newInteraction('de', labels)).success).toBe(true);
  });

  it('keeps entries across every variant and stays valid', () => {
    const node = newInteraction('de', labels);
    const ids = entriesOf(node.content).map((e) => e.id);
    let content = node.content;
    for (const variant of ['timeline', 'glossary', 'tabs', 'labeledGraphic', 'cycle', 'steps'] as const) {
      content = convertContent(content, variant, 'de', { sha256: 'c'.repeat(64), altText: 'Bild' });
      expect(content.variant).toBe(variant);
      expect(entriesOf(content).map((e) => e.id)).toEqual(ids);
      expect(interactionNodeSchema.safeParse({ ...node, content }).success).toBe(true);
    }
  });

  it('pads a cycle to two entries and needs an image for a labeled graphic', () => {
    const single = { variant: 'accordion' as const, items: [] };
    const cycle = convertContent(single, 'cycle', 'de');
    expect(entriesOf(cycle)).toHaveLength(2);
    expect(() => convertContent(single, 'labeledGraphic', 'de')).toThrow();
  });
});
