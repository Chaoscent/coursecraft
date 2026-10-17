// SPDX-License-Identifier: Apache-2.0
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { EditorState, EditorStore } from './store.js';

export const EditorContext = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext);
  if (!store) throw new Error('useEditor outside EditorContext');
  return store;
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}
