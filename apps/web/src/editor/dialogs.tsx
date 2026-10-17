// SPDX-License-Identifier: Apache-2.0
import type { Draft } from 'immer';
import type { Course } from '@lernwerk/course-model';
import { noTracking, Player } from '@lernwerk/player';
import { listVersionsResponseSchema, revResponseSchema, type EXPORT_FORMATS } from '@lernwerk/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, download } from '../api/client.js';
import { Button } from '../components/Button.js';
import { DataTable } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { Checkbox, FormGrid, FormRow, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import { uploadFile } from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import { flush } from './sync.js';
import { assetUrl } from './upload.js';
import styles from './Editor.module.css';

type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const [format, setFormat] = useState<ExportFormat>('scorm12');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await flush(store);
      const { courseId, course } = store.getState();
      const title = course.meta.title[course.languages.default] ?? 'course';
      await download(
        `/api/courses/${courseId}/export?format=${format}`,
        `${title.replace(/[^\p{L}\p{N}_-]+/gu, '-')}-${format}.zip`,
      );
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t('editor.exportTitle')}
      isOpen
      onClose={onClose}
      onSubmit={() => void run()}
      footer={
        <>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" icon="download" isDisabled={busy}>
            {t('editor.exportRun')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <FormGrid wide>
        <SelectField
          label={t('editor.exportFormat')}
          value={format}
          onChange={setFormat}
          options={[
            { id: 'scorm12', label: 'SCORM 1.2' },
            { id: 'scorm2004-4', label: 'SCORM 2004 (4th Edition)' },
            { id: 'scorm2004-3', label: 'SCORM 2004 (3rd Edition)' },
            { id: 'xapi', label: 'xAPI (Tin Can)' },
            { id: 'cmi5', label: 'cmi5' },
            { id: 'html5', label: t('editor.formats.html5') },
          ]}
        />
      </FormGrid>
      <p className={styles.dialogHint}>{t(`editor.formatHints.${format}`)}</p>
    </Dialog>
  );
}

export function VersionsDialog({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const courseId = useEditor((s) => s.courseId);
  const readOnly = useEditor((s) => s.readOnly);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fetcher = useCallback(
    () => api(listVersionsResponseSchema, `/api/courses/${courseId}/versions`).then((r) => r.items),
    [courseId],
  );
  const { data: versions = [], reload } = useApi(fetcher);

  const save = async () => {
    try {
      await flush(store);
      await api(z.object({ number: z.number() }), `/api/courses/${courseId}/versions`, {
        method: 'POST',
        body: { note },
      });
      setNote('');
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const restore = async (id: string) => {
    try {
      await flush(store);
      await api(revResponseSchema, `/api/courses/${courseId}/versions/${id}/restore`, { method: 'POST' });
      onRestored();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog title={t('editor.versions')} isOpen onClose={onClose} width="lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className={styles.inline}>
        <TextField label={t('editor.versionNote')} value={note} onChange={setNote} />
        <Button variant="primary" onPress={() => void save()}>
          {t('editor.saveVersion')}
        </Button>
      </div>
      <div className={styles.dialogTable}>
        <DataTable
          label={t('editor.versions')}
          rows={versions}
          empty={t('editor.noVersions')}
          columns={[
            { id: 'number', label: '#', numeric: true, render: (v) => v.number },
            { id: 'note', label: t('editor.versionNote'), isRowHeader: true, render: (v) => v.note || '–' },
            { id: 'by', label: t('editor.versionBy'), render: (v) => v.createdByName ?? '–' },
            {
              id: 'at',
              label: t('editor.versionAt'),
              numeric: true,
              render: (v) => formatDateTime(v.createdAt),
            },
            {
              id: 'restore',
              label: '',
              render: (v) => (
                <Button isDisabled={readOnly} onPress={() => void restore(v.id)}>
                  {t('editor.restore')}
                </Button>
              ),
            },
          ]}
        />
      </div>
    </Dialog>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const course = useEditor((s) => s.course);
  const lang = useEditor((s) => s.lang);
  const readOnly = useEditor((s) => s.readOnly);
  const set = (recipe: (draft: Draft<Course>) => void) => store.getState().change(recipe, 'settings');
  const s = course.settings;
  const percent = s.completion.type === 'viewedPercent' ? s.completion.percent : 100;
  return (
    <Dialog
      title={t('editor.settings')}
      isOpen
      onClose={onClose}
      width="md"
      footer={<Button onPress={onClose}>{t('common.close')}</Button>}
    >
      <FormGrid wide>
        <TextField
          label={t('editor.courseTitle')}
          value={course.meta.title[lang] ?? ''}
          isDisabled={readOnly}
          onChange={(v) => set((d) => void (d.meta.title[lang] = v))}
        />
        <TextField
          label={t('editor.description')}
          multiline
          value={course.meta.description?.[lang] ?? ''}
          isDisabled={readOnly}
          onChange={(v) =>
            set((d) => void (d.meta.description = { ...(d.meta.description ?? {}), [lang]: v }))
          }
        />
        <SelectField
          label={t('editor.navigation')}
          value={s.navigation}
          isDisabled={readOnly}
          onChange={(v) => set((d) => void (d.settings.navigation = v))}
          options={[
            { id: 'free', label: t('editor.navFree') },
            { id: 'linear', label: t('editor.navLinear') },
          ]}
        />
        <SelectField
          label={t('editor.completion')}
          value={s.completion.type === 'quizPassed' ? `quiz:${s.completion.quizId}` : 'viewed'}
          isDisabled={readOnly}
          onChange={(v) =>
            set(
              (d) =>
                void (d.settings.completion =
                  v === 'viewed'
                    ? { type: 'viewedPercent', percent }
                    : { type: 'quizPassed', quizId: v.slice(5) }),
            )
          }
          options={[
            { id: 'viewed', label: t('editor.completionViewed') },
            ...Object.values(course.nodes)
              .filter((n) => n.kind === 'quiz')
              .map((n) => ({
                id: `quiz:${n.id}`,
                label: t('editor.completionQuiz', { title: n.title[lang] ?? n.id }),
              })),
          ]}
        />
        {s.completion.type === 'viewedPercent' ? (
          <TextField
            label={t('editor.completionPercent')}
            value={String(percent)}
            isDisabled={readOnly}
            onChange={(v) => {
              const n = Math.round(Number(v));
              if (n >= 1 && n <= 100)
                set((d) => void (d.settings.completion = { type: 'viewedPercent', percent: n }));
            }}
          />
        ) : null}
        <SelectField
          label={t('editor.sidebar')}
          value={s.player.sidebar}
          isDisabled={readOnly}
          onChange={(v) => set((d) => void (d.settings.player.sidebar = v))}
          options={[
            { id: 'left', label: t('editor.sidebarLeft') },
            { id: 'right', label: t('editor.sidebarRight') },
            { id: 'none', label: t('editor.sidebarNone') },
          ]}
        />
        <FormRow label="">
          <Checkbox
            isSelected={s.player.showProgress}
            isDisabled={readOnly}
            onChange={(v) => set((d) => void (d.settings.player.showProgress = v))}
          >
            {t('editor.showProgress')}
          </Checkbox>
        </FormRow>
        <FormRow label={t('editor.accent')}>
          <input
            type="color"
            aria-label={t('editor.accent')}
            disabled={readOnly}
            value={s.branding.accent.startsWith('#') ? s.branding.accent.slice(0, 7) : '#1f5fa6'}
            onChange={(e) => set((d) => void (d.settings.branding.accent = e.target.value))}
          />
        </FormRow>
        <FormRow label={t('editor.logo')}>
          <div className={styles.inline}>
            {s.branding.logo ? <span>{course.assets[s.branding.logo.$asset]?.name}</span> : <span>–</span>}
            <Button
              isDisabled={readOnly}
              onPress={() =>
                void uploadFile(store, 'image/png,image/jpeg,image/svg+xml,image/webp').then(
                  (sha) => sha && set((d) => void (d.settings.branding.logo = { $asset: sha })),
                )
              }
            >
              {t('editor.chooseLogo')}
            </Button>
          </div>
        </FormRow>
      </FormGrid>
    </Dialog>
  );
}

const DEVICES = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
} as const;

/** Runs the real player on the unsaved course at a chosen device size. */
export function PreviewDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const course = useEditor((s) => s.course);
  const courseId = useEditor((s) => s.courseId);
  const [device, setDevice] = useState<keyof typeof DEVICES>('desktop');
  const host = useRef<HTMLDivElement>(null);
  const size = DEVICES[device];
  const scale = Math.min(1, (window.innerWidth - 120) / size.width, (window.innerHeight - 200) / size.height);

  useEffect(() => {
    if (!host.current) return;
    const player = new Player(host.current, {
      course,
      tracker: noTracking,
      assetUrl: (sha) => assetUrl(courseId, sha),
    });
    return () => player.destroy();
  }, [course, courseId, device]);

  return (
    <Dialog title={t('editor.preview')} isOpen onClose={onClose} width="xl">
      <div className={styles.inline}>
        <SelectField
          label={t('editor.device')}
          value={device}
          onChange={setDevice}
          options={[
            { id: 'desktop', label: t('editor.devices.desktop') },
            { id: 'tablet', label: t('editor.devices.tablet') },
            { id: 'phone', label: t('editor.devices.phone') },
          ]}
        />
      </div>
      <div className={styles.previewArea} style={{ width: size.width * scale, height: size.height * scale }}>
        <div
          className={styles.previewDevice}
          style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
          ref={host}
        />
      </div>
    </Dialog>
  );
}
