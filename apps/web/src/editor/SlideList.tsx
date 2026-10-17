// SPDX-License-Identifier: Apache-2.0
import type { SlideNode } from '@coursecraft/course-model';
import { renderSlide } from '@coursecraft/player';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToolButton } from '../components/Button.js';
import { Icon } from '../components/Icon.js';
import {
  addChapter,
  addSlide,
  deleteSlide,
  duplicateSlide,
  insertNode,
  moveSlide,
  uploadFile,
} from './actions.js';
import { newDialog } from './dialogModel.js';
import { newInteraction } from './interactionModel.js';
import { newQuestion, newQuiz, newSurvey } from './quizModel.js';
import { useRenderContext } from './Canvas.js';
import { useEditor, useEditorStore } from './context.js';
import styles from './Editor.module.css';

const THUMB_WIDTH = 148;

function Thumbnail({ slide }: { slide: SlideNode }) {
  const ctx = useRenderContext();
  const canvas = useEditor((s) => s.course.settings.canvas);
  const ref = useRef<HTMLDivElement>(null);
  const scale = THUMB_WIDTH / canvas.width;
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // Thumbnails skip media and fetch nothing but images.
    const rendered = renderSlide(slide, ctx, { width: canvas.width, height: canvas.height, static: true });
    for (const media of rendered.media.values()) media.preload = 'none';
    rendered.root.style.transform = `scale(${scale})`;
    host.replaceChildren(rendered.root);
  }, [slide, ctx, canvas.width, canvas.height, scale]);
  return (
    <div
      className={styles.thumbFrame}
      style={{ width: THUMB_WIDTH, height: canvas.height * scale }}
      ref={ref}
      aria-hidden="true"
    />
  );
}

export function SlideList() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const course = useEditor((s) => s.course);
  const nodeId = useEditor((s) => s.nodeId);
  const lang = useEditor((s) => s.lang);
  const readOnly = useEditor((s) => s.readOnly);
  const [renaming, setRenaming] = useState<string | null>(null);
  const numbers = new Map(course.structure.chapters.flatMap((c) => c.nodeIds).map((id, i) => [id, i + 1]));

  return (
    <aside className={styles.panel} aria-label={t('editor.slides')}>
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>{t('editor.slides')}</span>
        <ToolButton
          icon="plus"
          aria-label={t('editor.newSlide')}
          isDisabled={readOnly}
          onPress={() => addSlide(store, t('editor.untitledSlide'))}
        />
        <ToolButton
          icon="list-checks"
          aria-label={t('quiz.newQuiz')}
          isDisabled={readOnly}
          onPress={() =>
            insertNode(
              store,
              newQuiz(
                lang,
                t('quiz.newQuizTitle'),
                newQuestion('singleChoice', lang, {
                  prompt: t('quiz.newPrompt'),
                  option: t('quiz.option'),
                  blankText: t('quiz.newBlankText'),
                }),
              ),
            )
          }
        />
        <ToolButton
          icon="clipboard-list"
          aria-label={t('quiz.newSurvey')}
          isDisabled={readOnly}
          onPress={() => insertNode(store, newSurvey(lang, t('quiz.newSurveyTitle'), t('quiz.newPrompt')))}
        />
        <ToolButton
          icon="layout-grid"
          aria-label={t('interaction.new')}
          isDisabled={readOnly}
          onPress={() =>
            insertNode(
              store,
              newInteraction(lang, {
                title: t('interaction.newTitle'),
                entry: t('interaction.entry'),
                body: t('interaction.newBody'),
              }),
            )
          }
        />
        <ToolButton
          icon="message-circle"
          aria-label={t('dialog.new')}
          isDisabled={readOnly}
          onPress={() =>
            void uploadFile(store, 'image/png,image/jpeg,image/webp,image/svg+xml').then(
              (sha) =>
                sha &&
                insertNode(
                  store,
                  newDialog(
                    lang,
                    {
                      title: t('dialog.newTitle'),
                      character: t('dialog.character'),
                      altText: '',
                      speech: t('dialog.newSpeech'),
                      good: t('dialog.goodResponse'),
                      bad: t('dialog.badResponse'),
                      passed: t('dialog.passedTitle'),
                      failed: t('dialog.failedTitle'),
                    },
                    sha,
                  ),
                ),
            )
          }
        />
        <ToolButton
          icon="copy"
          aria-label={t('editor.duplicateSlide')}
          isDisabled={readOnly}
          onPress={() => duplicateSlide(store)}
        />
        <ToolButton
          icon="chevron-up"
          aria-label={t('editor.moveUp')}
          isDisabled={readOnly}
          onPress={() => moveSlide(store, -1)}
        />
        <ToolButton
          icon="chevron-down"
          aria-label={t('editor.moveDown')}
          isDisabled={readOnly}
          onPress={() => moveSlide(store, 1)}
        />
        <ToolButton
          icon="trash-2"
          aria-label={t('editor.deleteSlide')}
          isDisabled={readOnly}
          onPress={() => deleteSlide(store)}
        />
      </header>
      <div className={styles.panelBody}>
        {course.structure.chapters.map((chapter, ci) => (
          <section key={chapter.id} aria-label={chapter.title[lang] ?? ''}>
            <div className={styles.chapter}>
              <Icon name="chevron-down" />
              {renaming === chapter.id ? (
                <input
                  className={styles.textInput}
                  aria-label={t('editor.chapterTitle')}
                  autoFocus
                  defaultValue={chapter.title[lang] ?? ''}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value)
                      store
                        .getState()
                        .change(
                          (d) =>
                            void (d.structure.chapters[ci] && (d.structure.chapters[ci].title[lang] = value)),
                        );
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <button
                  type="button"
                  className={styles.chapterTitle}
                  onDoubleClick={() => !readOnly && setRenaming(chapter.id)}
                  title={t('editor.renameHint')}
                >
                  {ci + 1} {chapter.title[lang] ?? ''}
                </button>
              )}
            </div>
            <ol className={styles.slideList}>
              {chapter.nodeIds.map((id) => {
                const node = course.nodes[id];
                if (!node) return null;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={styles.slideThumb}
                      aria-current={id === nodeId ? 'true' : undefined}
                      onClick={() => store.getState().selectNode(id)}
                    >
                      <span className={styles.thumbIndex}>{numbers.get(id)}</span>
                      {node.kind === 'slide' ? (
                        <Thumbnail slide={node} />
                      ) : (
                        <span className={styles.thumbPlaceholder} style={{ width: THUMB_WIDTH }}>
                          <Icon
                            name={
                              node.kind === 'quiz'
                                ? 'list-checks'
                                : node.kind === 'survey'
                                  ? 'clipboard-list'
                                  : node.kind === 'dialog'
                                    ? 'message-circle'
                                    : 'layout-grid'
                            }
                            size="lg"
                          />
                          {t(`quiz.kinds.${node.kind}`)}
                        </span>
                      )}
                      <span className={styles.thumbCaption}>{node.title[lang] ?? ''}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        <div className={styles.panelFooter}>
          <ToolButton
            icon="folder-plus"
            isDisabled={readOnly}
            onPress={() => addChapter(store, t('editor.newChapter'))}
          >
            {t('editor.newChapter')}
          </ToolButton>
        </div>
      </div>
    </aside>
  );
}
