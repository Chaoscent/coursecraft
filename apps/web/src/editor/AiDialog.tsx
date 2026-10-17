// SPDX-License-Identifier: Apache-2.0
import type { SlideNode } from '@lernwerk/course-model';
import {
  AI_LIMITS,
  aiPreviewSchema,
  aiRunResponseSchema,
  REWRITE_MODES,
  type AiPreview,
  type AiRunResponse,
  type AiStatus,
} from '@lernwerk/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { Checkbox, FormGrid, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { errorMessage } from '../lib/errors.js';
import { insertNode } from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import { newQuiz, plainToRich, questionFromDraft, richToPlain } from './quizModel.js';
import styles from './Editor.module.css';

type Task = 'rewrite' | 'questions';
type Mode = (typeof REWRITE_MODES)[number];

function slideText(slide: SlideNode, lang: string, only?: string): string {
  return slide.elements
    .filter((e) => e.type === 'text' && (!only || e.id === only))
    .map((e) => (e.type === 'text' ? richToPlain(e.content[lang]) : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Optional AI help: the author sees the exact request (endpoint and body)
 * before anything leaves the server, and every result is a draft to accept.
 */
export function AiDialog({ status, onClose }: { status: AiStatus; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const lang = useEditor((s) => s.lang);
  const courseId = useEditor((s) => s.courseId);
  const node = useEditor((s) => (s.nodeId ? s.course.nodes[s.nodeId] : undefined));
  const selection = useEditor((s) => s.selection);
  const slide = node?.kind === 'slide' ? node : undefined;
  const selectedText =
    slide && selection.length === 1 && slide.elements.some((e) => e.id === selection[0] && e.type === 'text')
      ? selection[0]
      : undefined;
  const ready = status.providers.filter((p) => p.ready);

  const [task, setTask] = useState<Task>(selectedText ? 'rewrite' : 'questions');
  const [providerId, setProviderId] = useState(ready[0]?.id ?? '');
  const [mode, setMode] = useState<Mode>('simplify');
  const [targetLang, setTargetLang] = useState(lang === 'de' ? 'en' : 'de');
  const [count, setCount] = useState('3');
  const [text, setText] = useState(() => (slide ? slideText(slide, lang, selectedText) : ''));
  const [preview, setPreview] = useState<AiPreview | null>(null);
  const [result, setResult] = useState<AiRunResponse | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = result ? 'result' : preview ? 'preview' : 'input';
  const tooLong = text.length > AI_LIMITS.inputChars;

  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const makePreview = () =>
    attempt(async () => {
      const body =
        task === 'rewrite'
          ? { task, providerId, courseId, mode, text, ...(mode === 'translate' ? { targetLang } : {}) }
          : {
              task,
              providerId,
              courseId,
              lang,
              count: Math.min(AI_LIMITS.questions, Math.max(1, Number(count) || 1)),
              text,
            };
      setPreview(await api(aiPreviewSchema, '/api/ai/preview', { method: 'POST', body }));
    });

  const send = () =>
    attempt(async () => {
      if (!preview) return;
      const r = await api(aiRunResponseSchema, '/api/ai/run', {
        method: 'POST',
        body: { previewId: preview.previewId },
      });
      setResult(r);
      if (r.task === 'questions') setPicked(new Set(r.questions.map((_, i) => i)));
    });

  const accept = () => {
    if (!result) return;
    if (result.task === 'rewrite') {
      const target = selectedText;
      const nodeId = slide?.id;
      if (!target || !nodeId) return;
      store.getState().change((draft) => {
        const s = draft.nodes[nodeId];
        const el = s?.kind === 'slide' ? s.elements.find((e) => e.id === target) : undefined;
        if (el?.type === 'text') el.content[lang] = plainToRich(result.text);
      });
    } else {
      const questions = result.questions
        .filter((_, i) => picked.has(i))
        .map((q) => questionFromDraft(lang, q));
      const [first, ...rest] = questions;
      if (!first) return;
      const quiz = newQuiz(lang, t('ai.quizTitle'), first);
      quiz.items.push(...rest.map((question) => ({ type: 'question' as const, question })));
      insertNode(store, quiz);
    }
    onClose();
  };

  return (
    <Dialog
      title={t('ai.assistant')}
      isOpen
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          {step === 'input' ? (
            <Button
              variant="primary"
              icon="eye"
              isDisabled={busy || !providerId || !text.trim() || tooLong}
              onPress={() => void makePreview()}
            >
              {t('ai.showPreview')}
            </Button>
          ) : null}
          {step === 'preview' ? (
            <>
              <Button isDisabled={busy} onPress={() => setPreview(null)}>
                {t('ai.back')}
              </Button>
              <Button variant="primary" icon="arrow-right" isDisabled={busy} onPress={() => void send()}>
                {busy ? t('ai.sending') : t('ai.send')}
              </Button>
            </>
          ) : null}
          {step === 'result' ? (
            <Button
              variant="primary"
              icon="check"
              isDisabled={
                (result?.task === 'rewrite' && !selectedText) ||
                (result?.task === 'questions' && picked.size === 0)
              }
              onPress={accept}
            >
              {result?.task === 'rewrite' ? t('ai.replaceText') : t('ai.insertQuiz')}
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {step === 'input' ? (
        <FormGrid wide>
          <SelectField
            label={t('ai.provider')}
            value={providerId}
            onChange={setProviderId}
            options={ready.map((p) => ({
              id: p.id,
              label:
                p.remainingToday === null
                  ? `${p.name} (${p.model})`
                  : t('ai.providerRemaining', { name: p.name, model: p.model, n: p.remainingToday }),
            }))}
          />
          <SelectField
            label={t('ai.task')}
            value={task}
            onChange={setTask}
            options={[
              { id: 'rewrite', label: t('ai.tasks.rewrite') },
              { id: 'questions', label: t('ai.tasks.questions') },
            ]}
          />
          {task === 'rewrite' ? (
            <>
              <SelectField
                label={t('ai.mode')}
                value={mode}
                onChange={setMode}
                options={REWRITE_MODES.map((m) => ({ id: m, label: t(`ai.modes.${m}`) }))}
              />
              {mode === 'translate' ? (
                <SelectField
                  label={t('ai.targetLang')}
                  value={targetLang}
                  onChange={setTargetLang}
                  options={['de', 'en', 'fr', 'es', 'it', 'nl', 'pl', 'tr'].map((l) => ({
                    id: l,
                    label: t(`ai.langs.${l}`),
                  }))}
                />
              ) : null}
              {!selectedText ? <Notice tone="info">{t('ai.selectTextHint')}</Notice> : null}
            </>
          ) : (
            <TextField label={t('ai.count')} value={count} onChange={setCount} />
          )}
          <TextField
            label={t('ai.sourceText')}
            multiline
            value={text}
            onChange={setText}
            description={t('ai.sourceHint', { n: text.length, max: AI_LIMITS.inputChars })}
            errorMessage={tooLong ? t('ai.tooLong') : undefined}
          />
        </FormGrid>
      ) : null}
      {step === 'preview' && preview ? (
        <div className={styles.aiPreview}>
          <Notice tone="warning">{t('ai.previewNotice', { provider: preview.provider })}</Notice>
          <dl className={styles.aiMeta}>
            <dt>{t('ai.endpoint')}</dt>
            <dd>
              <code>{preview.endpoint}</code>
            </dd>
          </dl>
          <textarea
            className={styles.aiBody}
            readOnly
            aria-label={t('ai.requestBody')}
            value={JSON.stringify(JSON.parse(preview.body), null, 2)}
          />
        </div>
      ) : null}
      {step === 'result' && result ? (
        <div className={styles.aiPreview}>
          <Notice tone="info">{t('ai.draftNotice')}</Notice>
          {result.task === 'rewrite' ? (
            <textarea className={styles.aiBody} readOnly aria-label={t('ai.result')} value={result.text} />
          ) : (
            <ol className={styles.aiQuestions} aria-label={t('ai.result')}>
              {result.questions.map((q, i) => (
                <li key={i}>
                  <Checkbox
                    isSelected={picked.has(i)}
                    onChange={(on) =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(i);
                        else next.delete(i);
                        return next;
                      })
                    }
                  >
                    {q.prompt}
                  </Checkbox>
                  <ul>
                    {q.choices.map((c, ci) => (
                      <li key={ci} className={c.correct ? styles.aiCorrect : ''}>
                        {c.text}
                        {c.correct ? ` (${t('ai.correct')})` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
