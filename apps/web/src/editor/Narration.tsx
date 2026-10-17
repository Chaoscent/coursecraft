// SPDX-License-Identifier: Apache-2.0
import type { SlideNode } from '@coursecraft/course-model';
import { assetSchema } from '@coursecraft/shared';
import type { Draft } from 'immer';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { Checkbox } from '../components/Field.js';
import { useEditor, useEditorStore } from './context.js';
import { convertMedia, describeMediaError as describe, MediaError } from './media.js';
import { Row, Section } from './PropertyControls.js';
import type { EditorStore } from './store.js';
import { assetUrl, chooseFile } from './upload.js';
import styles from './Editor.module.css';

/** Formats the browser can play everywhere; other audio goes through the converter. */
const DIRECT_AUDIO = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
]);
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];

type Asset = { sha256: string; mime: string; size: number; name: string };

function updateSlide(store: EditorStore, id: string, recipe: (s: Draft<SlideNode>) => void, key?: string) {
  store.getState().change((draft) => {
    const slide = draft.nodes[id];
    if (slide?.kind === 'slide') recipe(slide);
  }, key);
}

/** Sets the narration for the current language; the slide lasts at least as long as the audio. */
export function applyNarration(store: EditorStore, slideId: string, asset: Asset, durationMs: number | null) {
  const lang = store.getState().lang;
  store.getState().change((draft) => {
    draft.assets[asset.sha256] = { mime: asset.mime, size: asset.size, name: asset.name };
    const slide = draft.nodes[slideId];
    if (slide?.kind !== 'slide') return;
    slide.narration = {
      sources: { ...(slide.narration?.sources ?? {}), [lang]: { $asset: asset.sha256 } },
      captions: slide.narration?.captions ?? {},
    };
    if (durationMs) {
      const rounded = Math.ceil(durationMs / 100) * 100;
      slide.durationMs = Math.max(slide.durationMs ?? 0, rounded);
    }
  });
}

export function audioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration * 1000 : null);
    audio.onerror = () => resolve(null);
    audio.src = url;
  });
}

/** Sends a recording or an uncommon audio file to the converter and waits for the result. */
const convert = (courseId: string, file: Blob, name: string, normalize: boolean, failed: string) =>
  convertMedia(courseId, file, name, { target: 'audio', normalize }, failed);

function useRecorder(onDone: (blob: Blob, type: string) => void) {
  const recorder = useRef<MediaRecorder | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const type = RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setStartedAt(null);
      onDone(new Blob(chunks, { type: rec.mimeType }), rec.mimeType);
    };
    rec.start(1000);
    recorder.current = rec;
    setStartedAt(Date.now());
    setNow(Date.now());
  };
  const stop = () => recorder.current?.stop();
  return { recording: startedAt !== null, elapsedMs: startedAt === null ? 0 : now - startedAt, start, stop };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

/** Voice-over per slide and language: upload, record, captions. */
export function NarrationSection({ slide }: { slide: SlideNode }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const lang = useEditor((s) => s.lang);
  const courseId = useEditor((s) => s.courseId);
  const assets = useEditor((s) => s.course.assets);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [normalize, setNormalize] = useState(true);
  const current = slide.narration?.sources[lang]?.$asset;
  const captions = slide.narration?.captions[lang]?.$asset;

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  };

  const recorder = useRecorder((blob, type) => {
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    void run(t('editor.narration.processing'), async () => {
      const asset = await convert(
        courseId,
        blob,
        `${t('editor.narration.recordingName')}.${ext}`,
        normalize,
        t('editor.narration.failed'),
      );
      applyNarration(store, slide.id, asset, asset.durationMs);
    });
  });

  const upload = () =>
    void chooseFile('audio/*').then(
      (file) =>
        file &&
        run(t('editor.narration.processing'), async () => {
          if (DIRECT_AUDIO.has(file.type) && !normalize) {
            const form = new FormData();
            form.append('file', file, file.name);
            const asset = await api(assetSchema, `/api/courses/${courseId}/assets`, { method: 'POST', form });
            applyNarration(store, slide.id, asset, await audioDuration(assetUrl(courseId, asset.sha256)));
          } else {
            const asset = await convert(courseId, file, file.name, normalize, t('editor.narration.failed'));
            applyNarration(store, slide.id, asset, asset.durationMs);
          }
        }),
    );

  const uploadCaptions = () =>
    void chooseFile('text/vtt,.vtt').then(
      (file) =>
        file &&
        run(t('editor.narration.processing'), async () => {
          const form = new FormData();
          form.append('file', file, file.name);
          const asset = await api(assetSchema, `/api/courses/${courseId}/assets`, { method: 'POST', form });
          if (asset.mime !== 'text/vtt') throw new MediaError(t('editor.narration.notVtt'));
          store.getState().change((draft) => {
            draft.assets[asset.sha256] = { mime: asset.mime, size: asset.size, name: asset.name };
            const s = draft.nodes[slide.id];
            if (s?.kind === 'slide' && s.narration) s.narration.captions[lang] = { $asset: asset.sha256 };
          });
        }),
    );

  return (
    <Section title={t('editor.narration.title')}>
      <Row label={t('editor.narration.audio')}>
        <span className={styles.ellipsis}>
          {current ? (assets[current]?.name ?? current.slice(0, 8)) : t('editor.narration.none')}
        </span>
      </Row>
      {current ? (
        <Row label={t('editor.narration.preview')}>
          {/* Native controls: keyboard and screen reader friendly. */}
          <audio
            className={styles.audioPreview}
            controls
            preload="metadata"
            src={assetUrl(courseId, current)}
          />
        </Row>
      ) : null}
      <Row label="">
        <div className={styles.buttonRow}>
          {recorder.recording ? (
            <Button icon="pause" onPress={recorder.stop}>
              {t('editor.narration.stop', { time: seconds(recorder.elapsedMs) })}
            </Button>
          ) : (
            <Button
              icon="mic"
              isDisabled={busy !== null}
              onPress={() => void recorder.start().catch(() => setError(t('editor.narration.micDenied')))}
            >
              {t('editor.narration.record')}
            </Button>
          )}
          <Button icon="upload" isDisabled={busy !== null || recorder.recording} onPress={upload}>
            {t('editor.narration.upload')}
          </Button>
          {current ? (
            <Button
              icon="trash-2"
              isDisabled={busy !== null || recorder.recording}
              onPress={() =>
                updateSlide(store, slide.id, (s) => {
                  if (!s.narration) return;
                  delete s.narration.sources[lang];
                  delete s.narration.captions[lang];
                  if (!Object.keys(s.narration.sources).length) delete s.narration;
                })
              }
            >
              {t('editor.narration.remove')}
            </Button>
          ) : null}
        </div>
      </Row>
      <Row label="">
        <Checkbox isSelected={normalize} onChange={setNormalize}>
          {t('editor.narration.normalize')}
        </Checkbox>
      </Row>
      {current ? (
        <Row label={t('editor.narration.captions')}>
          <div className={styles.buttonRow}>
            <span className={styles.ellipsis}>
              {captions ? (assets[captions]?.name ?? 'VTT') : t('editor.narration.none')}
            </span>
            <Button icon="upload" isDisabled={busy !== null} onPress={uploadCaptions}>
              {t('editor.narration.uploadCaptions')}
            </Button>
          </div>
        </Row>
      ) : null}
      {busy ? (
        <p className={styles.status} role="status">
          {busy}
        </p>
      ) : null}
      {error ? (
        <p className={styles.hint} role="alert">
          {error}
        </p>
      ) : null}
      {current && !captions ? <p className={styles.hint}>{t('editor.narration.captionsMissing')}</p> : null}
    </Section>
  );
}

/** Rendered slide image from a presentation import: preview and switch. */
export function SlideImageSection({ slide }: { slide: SlideNode }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const courseId = useEditor((s) => s.courseId);
  if (!slide.fallbackImage) return null;
  return (
    <Section title={t('editor.slideImage.title')}>
      <Row label="">
        <img
          className={styles.slideImagePreview}
          src={assetUrl(courseId, slide.fallbackImage.$asset)}
          alt=""
        />
      </Row>
      <Row label="">
        <Checkbox
          isSelected={slide.useFallbackImage}
          onChange={(v) => updateSlide(store, slide.id, (s) => void (s.useFallbackImage = v))}
        >
          {t('editor.slideImage.use')}
        </Checkbox>
      </Row>
      <p className={styles.note}>{t('editor.slideImage.explain')}</p>
    </Section>
  );
}
