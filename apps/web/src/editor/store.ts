// SPDX-License-Identifier: Apache-2.0
import type { Course, SlideElement } from '@lernwerk/course-model';
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { createStore } from 'zustand/vanilla';
import { cloneElement, containerOf, findElement, orderedNodes, slideOf } from './model.js';

enablePatches();

interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
  key?: string | undefined;
  at: number;
}

export type SaveState =
  | { kind: 'saved'; at: Date }
  | { kind: 'saving' }
  | { kind: 'dirty' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict' };

export interface EditorState {
  courseId: string;
  course: Course;
  /** Last state acknowledged by the server (for diffing). */
  synced: Course;
  rev: number;
  readOnly: boolean;
  lang: string;
  nodeId: string | null;
  selection: string[];
  editingTextId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  save: SaveState;
  showGrid: boolean;
  zoom: 'fit' | number;
  /** Position on the slide timeline; the canvas dims elements not visible at this time. */
  playheadMs: number;
  clipboard: SlideElement[];

  /** Applies a change; changes with the same key within a second form one undo step. */
  change: (recipe: (draft: Draft<Course>) => void, key?: string) => void;
  undo: () => void;
  redo: () => void;
  selectNode: (id: string) => void;
  select: (ids: string[]) => void;
  editText: (id: string | null) => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  removeSelection: () => void;
  setSaveState: (state: SaveState) => void;
  acknowledge: (sent: Course, rev: number) => void;
  setReadOnly: (readOnly: boolean) => void;
  toggleGrid: () => void;
  setZoom: (zoom: 'fit' | number) => void;
  setPlayhead: (ms: number) => void;
}

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1000;

export interface InitialEditorData {
  courseId: string;
  course: Course;
  rev: number;
  readOnly: boolean;
}

export function createEditorStore(initial: InitialEditorData) {
  const first = orderedNodes(initial.course)[0] ?? null;
  return createStore<EditorState>()((set, get) => ({
    courseId: initial.courseId,
    course: initial.course,
    synced: initial.course,
    rev: initial.rev,
    readOnly: initial.readOnly,
    lang: initial.course.languages.default,
    nodeId: first,
    selection: [],
    editingTextId: null,
    past: [],
    future: [],
    save: { kind: 'saved', at: new Date() },
    showGrid: true,
    zoom: 'fit',
    playheadMs: 0,
    clipboard: [],

    change: (recipe, key) => {
      const state = get();
      if (state.readOnly) return;
      const [next, patches, inverse] = produceWithPatches(state.course, recipe);
      if (!patches.length) return;
      const now = Date.now();
      const last = state.past.at(-1);
      let past: HistoryEntry[];
      if (key && last?.key === key && now - last.at < COALESCE_MS) {
        past = [
          ...state.past.slice(0, -1),
          { patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], key, at: now },
        ];
      } else {
        past = [...state.past, { patches, inverse, key, at: now }].slice(-HISTORY_LIMIT);
      }
      set({
        course: next,
        past,
        future: [],
        save: state.save.kind === 'conflict' ? state.save : { kind: 'dirty' },
      });
    },

    undo: () => {
      const { past, future, course, readOnly } = get();
      const entry = past.at(-1);
      if (!entry || readOnly) return;
      const next = applyPatches(course, entry.inverse);
      set({
        course: next,
        past: past.slice(0, -1),
        future: [entry, ...future],
        save: { kind: 'dirty' },
        ...keepSelectionValid(next, get()),
      });
    },

    redo: () => {
      const { past, future, course, readOnly } = get();
      const entry = future[0];
      if (!entry || readOnly) return;
      const next = applyPatches(course, entry.patches);
      set({
        course: next,
        past: [...past, { ...entry, key: undefined }],
        future: future.slice(1),
        save: { kind: 'dirty' },
        ...keepSelectionValid(next, get()),
      });
    },

    selectNode: (id) => set({ nodeId: id, selection: [], editingTextId: null, playheadMs: 0 }),
    select: (ids) =>
      set({
        selection: ids,
        editingTextId:
          get().editingTextId && ids.includes(get().editingTextId ?? '') ? get().editingTextId : null,
      }),
    editText: (id) => set({ editingTextId: id, selection: id ? [id] : get().selection }),

    copy: () => {
      const { course, nodeId, selection } = get();
      const slide = slideOf(course, nodeId);
      if (!slide) return;
      set({
        clipboard: selection.flatMap((id) => findElement(slide, id) ?? []).map((el) => structuredClone(el)),
      });
    },

    paste: () => {
      const { clipboard, nodeId, change } = get();
      if (!clipboard.length || !nodeId) return;
      const copies = clipboard.map((el) => cloneElement(el));
      change((draft) => {
        const slide = draft.nodes[nodeId];
        if (slide?.kind === 'slide') slide.elements.push(...(copies as Draft<SlideElement>[]));
      });
      set({ selection: copies.map((c) => c.id) });
    },

    duplicate: () => {
      get().copy();
      get().paste();
    },

    removeSelection: () => {
      const { selection, nodeId, change } = get();
      if (!selection.length || !nodeId) return;
      change((draft) => {
        const slide = draft.nodes[nodeId];
        if (slide?.kind !== 'slide') return;
        for (const id of selection) {
          const container = containerOf(slide, id);
          const index = container?.findIndex((e) => e.id === id) ?? -1;
          if (container && index >= 0) container.splice(index, 1);
        }
      });
      set({ selection: [], editingTextId: null });
    },

    setSaveState: (save) => set({ save }),
    acknowledge: (sent, rev) =>
      set((s) => ({
        synced: sent,
        rev,
        save: s.course === sent ? { kind: 'saved', at: new Date() } : { kind: 'dirty' },
      })),
    setReadOnly: (readOnly) => set({ readOnly, editingTextId: null }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    setZoom: (zoom) => set({ zoom }),
    setPlayhead: (ms) => set({ playheadMs: Math.max(0, Math.round(ms)) }),
  }));
}

function keepSelectionValid(course: Course, state: EditorState): Partial<EditorState> {
  const nodeId =
    state.nodeId && course.nodes[state.nodeId] ? state.nodeId : (orderedNodes(course)[0] ?? null);
  const slide = slideOf(course, nodeId);
  return {
    nodeId,
    selection: slide ? state.selection.filter((id) => findElement(slide, id)) : [],
    editingTextId: null,
  };
}

export type EditorStore = ReturnType<typeof createEditorStore>;
