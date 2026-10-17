// SPDX-License-Identifier: Apache-2.0
import type { InteractionNode } from '@lernwerk/course-model';
import { newId } from './ids.js';
import { paragraphDoc } from './model.js';

export type InteractionContent = InteractionNode['content'];
export type InteractionVariant = InteractionContent['variant'];
type Entry = Extract<InteractionContent, { variant: 'accordion' }>['items'][number];

export const INTERACTION_VARIANTS: readonly InteractionVariant[] = [
  'accordion',
  'tabs',
  'steps',
  'cycle',
  'timeline',
  'glossary',
  'labeledGraphic',
];

const toEntry = (e: Entry): Entry => ({
  id: e.id,
  title: e.title,
  body: e.body,
  ...(e.media ? { media: e.media } : {}),
});

/** Common view of the entries of any variant (glossary terms become title/body). */
export function entriesOf(content: InteractionContent): Entry[] {
  switch (content.variant) {
    case 'timeline':
      return content.events.map(toEntry);
    case 'labeledGraphic':
      return content.markers.map(toEntry);
    case 'glossary':
      return content.terms.map((term) => ({ id: term.id, title: term.term, body: term.definition }));
    default:
      return content.items;
  }
}

export function newEntry(lang: string, title: string, body: string): Entry {
  return { id: newId('e'), title: { [lang]: title }, body: { [lang]: paragraphDoc(body) } };
}

/** Grid position for the n-th marker, so new markers do not overlap. */
export function markerPosition(n: number): { x: number; y: number } {
  return { x: 0.15 + ((n % 4) * 0.7) / 3, y: 0.2 + ((Math.floor(n / 4) % 4) * 0.6) / 3 };
}

/**
 * Converts content to another variant and keeps the entries. A labeled
 * graphic needs an image: pass the asset hash.
 */
export function convertContent(
  content: InteractionContent,
  variant: InteractionVariant,
  lang: string,
  image?: { sha256: string; altText: string },
): InteractionContent {
  const entries = entriesOf(content);
  const items = entries.length ? entries : [newEntry(lang, '…', '')];
  switch (variant) {
    case 'timeline':
      return {
        variant,
        events: items.map((entry, i) => ({
          ...entry,
          dateLabel: content.variant === 'timeline' ? (content.events[i]?.dateLabel ?? {}) : { [lang]: '' },
        })),
      };
    case 'glossary':
      return {
        variant,
        terms: items.map((entry) => ({ id: entry.id, term: entry.title, definition: entry.body })),
      };
    case 'labeledGraphic': {
      const previous = content.variant === 'labeledGraphic' ? content : undefined;
      const picture = image
        ? { image: { $asset: image.sha256 }, altText: { [lang]: image.altText } }
        : previous?.image;
      if (!picture) throw new Error('A labeled graphic needs an image');
      return {
        variant,
        image: picture,
        markers: items
          .slice(0, 30)
          .map((entry, i) => ({ ...entry, position: previous?.markers[i]?.position ?? markerPosition(i) })),
      };
    }
    case 'cycle':
      return {
        variant,
        items: items.length >= 2 ? items.slice(0, 12) : [...items, newEntry(lang, '…', '')],
      };
    default:
      return { variant, items };
  }
}

export function newInteraction(
  lang: string,
  labels: { title: string; entry: string; body: string },
): InteractionNode {
  return {
    kind: 'interaction',
    id: newId('ix'),
    title: { [lang]: labels.title },
    content: {
      variant: 'accordion',
      items: [1, 2, 3].map((n) => newEntry(lang, `${labels.entry} ${n}`, labels.body)),
    },
    requireAllViewed: false,
  };
}
