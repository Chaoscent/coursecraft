// SPDX-License-Identifier: Apache-2.0
import type { Course, CourseNode, SlideElement, SlideNode } from '@lernwerk/course-model';
import type { Draft } from 'immer';
import { newId } from './ids.js';
import {
  audioElement,
  blankSlide,
  hotspotElement,
  imageElement,
  shapeElement,
  slideOf,
  textElement,
  videoElement,
} from './model.js';
import type { EditorStore } from './store.js';
import { chooseFile, imageSize, uploadAsset } from './upload.js';

type DraftSlide = Draft<SlideNode>;

function withSlide(
  store: EditorStore,
  recipe: (slide: DraftSlide, draft: Draft<Course>) => void,
  key?: string,
): void {
  const { nodeId } = store.getState();
  if (!nodeId) return;
  store.getState().change((draft) => {
    const slide = draft.nodes[nodeId];
    if (slide?.kind === 'slide') recipe(slide, draft);
  }, key);
}

export function addElement(store: EditorStore, element: SlideElement): void {
  withSlide(store, (slide) => {
    slide.elements.push(element);
  });
  store.getState().select([element.id]);
}

/** Inserts a text box and starts editing it right away. */
export function insertText(store: EditorStore, text: string): void {
  const element = textElement(store.getState().lang, text);
  addElement(store, element);
  store.getState().editText(element.id);
}

export function insertShape(
  store: EditorStore,
  shape: 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow',
): void {
  addElement(store, shapeElement(shape));
}

export function insertHotspot(store: EditorStore): void {
  addElement(store, hotspotElement(store.getState().lang));
}

/** Uploads a file and registers it in the course's asset table. */
async function uploadInto(store: EditorStore, accept: string) {
  const file = await chooseFile(accept);
  if (!file) return null;
  const asset = await uploadAsset(store.getState().courseId, file);
  store.getState().change((draft) => {
    draft.assets[asset.sha256] = { mime: asset.mime, size: asset.size, name: asset.name };
  });
  return { asset, file };
}

export async function insertImage(store: EditorStore): Promise<void> {
  const result = await uploadInto(store, 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml');
  if (!result) return;
  const size = await imageSize(result.file);
  addElement(store, imageElement(result.asset.sha256, size, store.getState().course.settings.canvas));
}

export async function insertMedia(store: EditorStore, kind: 'video' | 'audio'): Promise<void> {
  const result = await uploadInto(
    store,
    kind === 'video' ? 'video/mp4,video/webm' : 'audio/mpeg,audio/mp4,audio/ogg,audio/wav',
  );
  if (!result) return;
  const lang = store.getState().lang;
  addElement(
    store,
    kind === 'video' ? videoElement(lang, result.asset.sha256) : audioElement(lang, result.asset.sha256),
  );
}

/** Uploads a file and returns its hash (replace image, captions, logo). */
export async function uploadFile(store: EditorStore, accept: string): Promise<string | null> {
  return (await uploadInto(store, accept))?.asset.sha256 ?? null;
}

/** Inserts any node after the current one (same chapter). */
export function insertNode(store: EditorStore, node: CourseNode): void {
  const { nodeId, course } = store.getState();
  const chapterIndex = Math.max(
    0,
    course.structure.chapters.findIndex((c) => nodeId && c.nodeIds.includes(nodeId)),
  );
  store.getState().change((draft) => {
    draft.nodes[node.id] = node;
    const chapter = draft.structure.chapters[chapterIndex];
    if (!chapter) return;
    const at = nodeId ? chapter.nodeIds.indexOf(nodeId) + 1 : chapter.nodeIds.length;
    chapter.nodeIds.splice(at, 0, node.id);
  });
  store.getState().selectNode(node.id);
}

export function addSlide(store: EditorStore, title: string): void {
  const { nodeId, lang, course } = store.getState();
  const slide = blankSlide(lang, title);
  const chapterIndex = Math.max(
    0,
    course.structure.chapters.findIndex((c) => nodeId && c.nodeIds.includes(nodeId)),
  );
  store.getState().change((draft) => {
    draft.nodes[slide.id] = slide;
    const chapter = draft.structure.chapters[chapterIndex];
    if (!chapter) return;
    const at = nodeId ? chapter.nodeIds.indexOf(nodeId) + 1 : chapter.nodeIds.length;
    chapter.nodeIds.splice(at, 0, slide.id);
  });
  store.getState().selectNode(slide.id);
}

export function duplicateSlide(store: EditorStore): void {
  const { nodeId, course } = store.getState();
  const slide = slideOf(course, nodeId);
  if (!slide || !nodeId) return;
  const copy = structuredClone(slide);
  copy.id = newId('s');
  const renew = (els: SlideElement[]) =>
    els.forEach((e) => {
      e.id = newId('e');
      if (e.type === 'group') renew(e.children);
    });
  renew(copy.elements);
  copy.layers.forEach((l) => renew(l.elements));
  store.getState().change((draft) => {
    draft.nodes[copy.id] = copy;
    for (const chapter of draft.structure.chapters) {
      const index = chapter.nodeIds.indexOf(nodeId);
      if (index >= 0) chapter.nodeIds.splice(index + 1, 0, copy.id);
    }
  });
  store.getState().selectNode(copy.id);
}

export function deleteSlide(store: EditorStore): void {
  const { nodeId, course } = store.getState();
  const all = course.structure.chapters.flatMap((c) => c.nodeIds);
  if (!nodeId || all.length <= 1) return;
  const next = all[all.indexOf(nodeId) + 1] ?? all[all.indexOf(nodeId) - 1] ?? null;
  store.getState().change((draft) => {
    for (const chapter of draft.structure.chapters)
      chapter.nodeIds = chapter.nodeIds.filter((id) => id !== nodeId);
    delete draft.nodes[nodeId];
    // The completion rule must not point at a deleted quiz.
    if (draft.settings.completion.type === 'quizPassed' && draft.settings.completion.quizId === nodeId) {
      draft.settings.completion = { type: 'viewedPercent', percent: 100 };
    }
  });
  if (next) store.getState().selectNode(next);
}

export function moveSlide(store: EditorStore, direction: -1 | 1): void {
  const { nodeId } = store.getState();
  if (!nodeId) return;
  store.getState().change((draft) => {
    const chapters = draft.structure.chapters;
    const ci = chapters.findIndex((c) => c.nodeIds.includes(nodeId));
    const chapter = chapters[ci];
    if (!chapter) return;
    const i = chapter.nodeIds.indexOf(nodeId);
    const j = i + direction;
    if (j >= 0 && j < chapter.nodeIds.length) {
      chapter.nodeIds.splice(i, 1);
      chapter.nodeIds.splice(j, 0, nodeId);
    } else {
      // Move across the chapter boundary.
      const target = chapters[ci + direction];
      if (!target) return;
      chapter.nodeIds.splice(i, 1);
      if (direction < 0) target.nodeIds.push(nodeId);
      else target.nodeIds.unshift(nodeId);
    }
  });
}

export function addChapter(store: EditorStore, title: string): void {
  const { lang } = store.getState();
  const slide = blankSlide(lang, title);
  store.getState().change((draft) => {
    draft.nodes[slide.id] = slide;
    draft.structure.chapters.push({ id: newId('ch'), title: { [lang]: title }, nodeIds: [slide.id] });
  });
  store.getState().selectNode(slide.id);
}

export function reorder(store: EditorStore, where: 'front' | 'back' | 'forward' | 'backward'): void {
  const { selection } = store.getState();
  if (!selection.length) return;
  withSlide(store, (slide) => {
    const picked = slide.elements.filter((e) => selection.includes(e.id));
    if (where === 'front' || where === 'back') {
      const rest = slide.elements.filter((e) => !selection.includes(e.id));
      slide.elements = where === 'front' ? [...rest, ...picked] : [...picked, ...rest];
      return;
    }
    const step = where === 'forward' ? 1 : -1;
    const order = where === 'forward' ? [...slide.elements.keys()].reverse() : [...slide.elements.keys()];
    for (const i of order) {
      const el = slide.elements[i];
      const j = i + step;
      const neighbor = slide.elements[j];
      if (el && neighbor && selection.includes(el.id) && !selection.includes(neighbor.id)) {
        slide.elements[i] = neighbor;
        slide.elements[j] = el;
      }
    }
  });
}

export type Alignment = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Aligns the selection to its bounding box, or a single object to the slide. */
export function align(store: EditorStore, how: Alignment): void {
  const { selection, course } = store.getState();
  if (!selection.length) return;
  withSlide(store, (slide) => {
    const els = slide.elements.filter((e) => selection.includes(e.id) && !e.locked);
    if (!els.length) return;
    const ref =
      els.length === 1
        ? { x: 0, y: 0, width: course.settings.canvas.width, height: course.settings.canvas.height }
        : {
            x: Math.min(...els.map((e) => e.frame.x)),
            y: Math.min(...els.map((e) => e.frame.y)),
            width:
              Math.max(...els.map((e) => e.frame.x + e.frame.width)) - Math.min(...els.map((e) => e.frame.x)),
            height:
              Math.max(...els.map((e) => e.frame.y + e.frame.height)) -
              Math.min(...els.map((e) => e.frame.y)),
          };
    for (const el of els) {
      const f = el.frame;
      if (how === 'left') f.x = ref.x;
      if (how === 'hcenter') f.x = Math.round(ref.x + (ref.width - f.width) / 2);
      if (how === 'right') f.x = ref.x + ref.width - f.width;
      if (how === 'top') f.y = ref.y;
      if (how === 'vcenter') f.y = Math.round(ref.y + (ref.height - f.height) / 2);
      if (how === 'bottom') f.y = ref.y + ref.height - f.height;
    }
  });
}

export function nudge(store: EditorStore, dx: number, dy: number): void {
  const { selection } = store.getState();
  withSlide(
    store,
    (slide) => {
      for (const el of slide.elements) {
        if (selection.includes(el.id) && !el.locked) {
          el.frame.x += dx;
          el.frame.y += dy;
        }
      }
    },
    'nudge',
  );
}

export function group(store: EditorStore): void {
  const { selection } = store.getState();
  if (selection.length < 2) return;
  const id = newId('g');
  withSlide(store, (slide) => {
    const picked = slide.elements.filter((e) => selection.includes(e.id));
    const x = Math.min(...picked.map((e) => e.frame.x));
    const y = Math.min(...picked.map((e) => e.frame.y));
    const width = Math.max(...picked.map((e) => e.frame.x + e.frame.width)) - x;
    const height = Math.max(...picked.map((e) => e.frame.y + e.frame.height)) - y;
    const index = slide.elements.findIndex((e) => selection.includes(e.id));
    const children = picked.map((e) => ({ ...e, frame: { ...e.frame, x: e.frame.x - x, y: e.frame.y - y } }));
    slide.elements = slide.elements.filter((e) => !selection.includes(e.id));
    slide.elements.splice(index, 0, {
      id,
      name: 'Group',
      type: 'group',
      frame: { x, y, width, height, rotation: 0 },
      hidden: false,
      locked: false,
      timing: { startMs: 0 },
      triggers: [],
      children,
    } as Draft<SlideElement>);
  });
  store.getState().select([id]);
}

export function ungroup(store: EditorStore): void {
  const { selection } = store.getState();
  const ids: string[] = [];
  withSlide(store, (slide) => {
    const index = slide.elements.findIndex((e) => selection.includes(e.id) && e.type === 'group');
    const groupEl = slide.elements[index];
    if (!groupEl || groupEl.type !== 'group') return;
    const children = groupEl.children.map((c) => ({
      ...c,
      frame: { ...c.frame, x: c.frame.x + groupEl.frame.x, y: c.frame.y + groupEl.frame.y },
    }));
    ids.push(...children.map((c) => c.id));
    slide.elements.splice(index, 1, ...children);
  });
  store.getState().select(ids);
}
