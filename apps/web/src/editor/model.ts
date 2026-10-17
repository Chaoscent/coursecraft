// SPDX-License-Identifier: Apache-2.0
import type { Course, RichText, SlideElement, SlideNode } from '@lernwerk/course-model';
import { newId } from './ids.js';

export type ElementType = SlideElement['type'];
export type Frame = SlideElement['frame'];

const base = (name: string, frame: Omit<Frame, 'rotation'>) => ({
  id: newId('e'),
  name,
  frame: { ...frame, rotation: 0 },
  hidden: false,
  locked: false,
  timing: { startMs: 0 },
  triggers: [],
});

export function paragraphDoc(text: string): RichText {
  return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] };
}

export function textElement(
  lang: string,
  text: string,
  frame = { x: 160, y: 200, width: 640, height: 120 },
): SlideElement {
  return {
    ...base('Text', frame),
    type: 'text',
    content: { [lang]: paragraphDoc(text) },
    style: {
      font: 'sans',
      sizePx: 24,
      lineHeight: 1.3,
      color: 'theme:text',
      verticalAlign: 'top',
      paddingPx: 8,
    },
  };
}

/** Slide title: heading in the accent color, like new courses get from the server. */
export function titleElement(lang: string, title: string): SlideElement {
  return {
    ...base('Title', { x: 80, y: 60, width: 1120, height: 100 }),
    type: 'text',
    content: {
      [lang]: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: title ? [{ type: 'text', text: title }] : [] },
        ],
      },
    },
    style: {
      font: 'sans',
      sizePx: 40,
      lineHeight: 1.3,
      color: 'theme:accent',
      verticalAlign: 'top',
      paddingPx: 8,
    },
  };
}

export function shapeElement(shape: 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow'): SlideElement {
  const line = shape === 'line' || shape === 'arrow';
  return {
    ...base(shape, { x: 320, y: 240, width: line ? 320 : 240, height: line ? 40 : 160 }),
    type: 'shape',
    shape,
    decorative: true,
    ...(line
      ? { stroke: { color: 'theme:text', widthPx: 3 } }
      : { fill: '#dbe6f3', stroke: { color: 'theme:accent', widthPx: 2 } }),
  };
}

export function imageElement(
  sha256: string,
  size: { width: number; height: number },
  canvas: { width: number; height: number },
): SlideElement {
  const scale = Math.min(1, (canvas.width * 0.6) / size.width, (canvas.height * 0.6) / size.height);
  const width = Math.max(20, Math.round(size.width * scale));
  const height = Math.max(20, Math.round(size.height * scale));
  return {
    ...base('Image', {
      x: Math.round((canvas.width - width) / 2),
      y: Math.round((canvas.height - height) / 2),
      width,
      height,
    }),
    type: 'image',
    image: { $asset: sha256 },
    fit: 'contain',
    decorative: false,
    altText: {},
  };
}

export function videoElement(lang: string, sha256: string): SlideElement {
  return {
    ...base('Video', { x: 240, y: 140, width: 800, height: 450 }),
    type: 'video',
    sources: { [lang]: { $asset: sha256 } },
    captions: {},
    title: { [lang]: '' },
    autoplay: false,
    loop: false,
    controls: true,
  };
}

export function audioElement(lang: string, sha256: string): SlideElement {
  return {
    ...base('Audio', { x: 400, y: 600, width: 480, height: 54 }),
    type: 'audio',
    sources: { [lang]: { $asset: sha256 } },
    title: { [lang]: '' },
    autoplay: false,
    loop: false,
    controls: true,
  };
}

export function hotspotElement(lang: string): SlideElement {
  return {
    ...base('Hotspot', { x: 560, y: 300, width: 160, height: 120 }),
    type: 'hotspot',
    shape: 'rectangle',
    label: { [lang]: '' },
  };
}

export function blankSlide(lang: string, title: string): SlideNode {
  return {
    kind: 'slide',
    id: newId('s'),
    title: { [lang]: title },
    background: {},
    elements: [titleElement(lang, title)],
    layers: [],
    advance: 'manual',
    useFallbackImage: false,
  };
}

/** Deep copy with fresh ids for the element and all children. */
export function cloneElement(el: SlideElement, offset = 16): SlideElement {
  const copy = structuredClone(el);
  const renew = (e: SlideElement) => {
    e.id = newId('e');
    e.triggers = e.triggers.map((t) => ({ ...t, id: newId('t') }));
    if (e.type === 'group') e.children.forEach(renew);
  };
  renew(copy);
  copy.frame = { ...copy.frame, x: copy.frame.x + offset, y: copy.frame.y + offset };
  return copy;
}

export function findElement(slide: SlideNode, id: string): SlideElement | undefined {
  const walk = (els: SlideElement[]): SlideElement | undefined => {
    for (const el of els) {
      if (el.id === id) return el;
      if (el.type === 'group') {
        const found = walk(el.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(slide.elements) ?? slide.layers.map((l) => walk(l.elements)).find(Boolean);
}

/** The array that contains the element (slide, layer or group), for reordering and deletion. */
export function containerOf(slide: SlideNode, id: string): SlideElement[] | undefined {
  const walk = (els: SlideElement[]): SlideElement[] | undefined => {
    if (els.some((e) => e.id === id)) return els;
    for (const el of els)
      if (el.type === 'group') {
        const found = walk(el.children);
        if (found) return found;
      }
    return undefined;
  };
  return walk(slide.elements) ?? slide.layers.map((l) => walk(l.elements)).find(Boolean);
}

export function orderedNodes(course: Course): string[] {
  return course.structure.chapters.flatMap((c) => c.nodeIds);
}

export function slideOf(course: Course, nodeId: string | null): SlideNode | null {
  const node = nodeId ? course.nodes[nodeId] : undefined;
  return node?.kind === 'slide' ? node : null;
}
