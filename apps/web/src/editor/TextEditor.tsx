// SPDX-License-Identifier: Apache-2.0
import type { RichText, SlideElement } from '@lernwerk/course-model';
import { color as resolveColor } from '@lernwerk/player';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, useEditor as useTiptap, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { useRenderContext } from './Canvas.js';
import { useEditor, useEditorStore } from './context.js';
import { fromTiptap, toTiptap } from './richtext.js';
import styles from './Editor.module.css';

/** The TipTap instance currently editing, for the ribbon's text tools. */
export const useActiveTextEditor = create<{ editor: Editor | null; set: (editor: Editor | null) => void }>(
  (set) => ({
    editor: null,
    set: (editor) => set({ editor }),
  }),
);

const FONTS = {
  sans: 'var(--lw-font-sans)',
  serif: 'var(--lw-font-serif)',
  mono: 'var(--lw-font-mono)',
} as const;
const SAFE = /^(https?:\/\/|mailto:)/i;

type TextLike = Extract<SlideElement, { type: 'text' | 'shape' }>;

/** In-place rich-text editing of a text box or shape label. */
export function TextEditor({ element, slideId }: { element: TextLike; slideId: string }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const lang = useEditor((s) => s.lang);
  const ctx = useRenderContext();
  const setActive = useActiveTextEditor((s) => s.set);
  const [initial] = useState(() => element.content?.[lang]);

  const editor = useTiptap({
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false, isAllowedUri: (url) => SAFE.test(url) },
      }),
      Subscript,
      Superscript,
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: toTiptap(initial),
    // No injected <style> element (CSP); the needed rules are in Editor.module.css.
    injectCSS: false,
    autofocus: 'end',
    editorProps: { attributes: { 'aria-label': t('editor.textContent'), class: styles.prose ?? '' } },
    onUpdate: ({ editor: e }) => {
      const doc: RichText = fromTiptap(e.getJSON());
      store.getState().change((draft) => {
        const slide = draft.nodes[slideId];
        if (slide?.kind !== 'slide') return;
        const target = slide.elements.find((el) => el.id === element.id);
        if (target && (target.type === 'text' || target.type === 'shape'))
          target.content = { ...(target.content ?? {}), [lang]: doc };
      }, `text-${element.id}`);
    },
  });

  useEffect(() => {
    setActive(editor);
    return () => setActive(null);
  }, [editor, setActive]);

  const style =
    element.type === 'text'
      ? element.style
      : (element.textStyle ?? {
          font: 'sans',
          sizePx: 24,
          lineHeight: 1.3,
          color: 'theme:text',
          verticalAlign: 'middle',
          paddingPx: 8,
        });
  return (
    <div
      data-text-editor
      className={`lw-text ${styles.textEditor}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          store.getState().editText(null);
        }
      }}
      style={{
        left: element.frame.x,
        top: element.frame.y,
        width: element.frame.width,
        height: element.frame.height,
        fontFamily: FONTS[style.font],
        fontSize: style.sizePx,
        lineHeight: style.lineHeight,
        padding: style.paddingPx,
        color: resolveColor(ctx, style.color),
        justifyContent:
          style.verticalAlign === 'middle'
            ? 'center'
            : style.verticalAlign === 'bottom'
              ? 'flex-end'
              : 'flex-start',
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
