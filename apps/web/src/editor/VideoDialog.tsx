// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { Checkbox } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { useEditor, useEditorStore } from './context.js';
import { convertMedia, describeMediaError, insertConvertedVideo } from './media.js';
import { videoElement } from './model.js';
import { chooseFile, uploadAsset } from './upload.js';
import styles from './Editor.module.css';

/** Codec lists must match the tracks: some browsers refuse an audio codec for a video-only stream. */
const RECORDING_TYPES = {
  withAudio: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
  videoOnly: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'],
};
/** Played directly by every supported browser; anything else is converted. */
const DIRECT_VIDEO = 'video/mp4';

interface Clip {
  blob: Blob;
  name: string;
  /** Known length (recordings declare none in their WebM header). */
  durationMs: number | null;
}

/** Screen (and optionally tab or system) video plus an optional microphone, mixed to one audio track. */
async function captureScreen(withMic: boolean, withSystemAudio: boolean) {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: withSystemAudio,
  });
  const mic = withMic
    ? await navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .catch((e: unknown) => {
          display.getTracks().forEach((t) => t.stop());
          throw e;
        })
    : null;
  const audio = [...display.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])];
  let context: AudioContext | null = null;
  let mixed = audio;
  if (audio.length > 1) {
    context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    for (const track of audio) context.createMediaStreamSource(new MediaStream([track])).connect(destination);
    mixed = destination.stream.getAudioTracks();
  }
  return {
    stream: new MediaStream([...display.getVideoTracks(), ...mixed]),
    stop: () => {
      display.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      void context?.close();
    },
  };
}

function useScreenRecorder(onDone: (clip: Clip) => void, onError: () => void) {
  const recorder = useRef<{ rec: MediaRecorder; stop: () => void } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  useEffect(() => () => recorder.current?.stop(), []);

  const start = async (withMic: boolean, withSystemAudio: boolean, name: string) => {
    const capture = await captureScreen(withMic, withSystemAudio);
    const candidates = capture.stream.getAudioTracks().length
      ? RECORDING_TYPES.withAudio
      : RECORDING_TYPES.videoOnly;
    const type = candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(capture.stream, type ? { mimeType: type } : {});
    const chunks: Blob[] = [];
    const began = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      capture.stop();
      recorder.current = null;
      setStartedAt(null);
      const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
      onDone({
        blob: new Blob(chunks, { type: rec.mimeType }),
        name: `${name}.${ext}`,
        durationMs: Date.now() - began,
      });
    };
    rec.onerror = () => {
      capture.stop();
      recorder.current = null;
      setStartedAt(null);
      onError();
    };
    // Ending the share in the browser's own bar stops the recording, too.
    capture.stream
      .getVideoTracks()[0]
      ?.addEventListener('ended', () => rec.state !== 'inactive' && rec.stop());
    rec.start(1000);
    recorder.current = { rec, stop: capture.stop };
    setStartedAt(began);
    setNow(began);
  };
  const stop = () => {
    const current = recorder.current;
    if (!current) return;
    if (current.rec.state !== 'inactive') {
      current.rec.stop();
    } else {
      current.stop();
      recorder.current = null;
      setStartedAt(null);
    }
  };
  return { recording: startedAt !== null, elapsedMs: startedAt === null ? 0 : now - startedAt, start, stop };
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/**
 * Inserts a video on the current slide: a screen recording or a file. Both
 * can be trimmed; anything that is not a plain MP4 goes through the converter
 * (MP4 + WebM + poster frame).
 */
export function VideoDialog({ mode, onClose }: { mode: 'record' | 'file'; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const courseId = useEditor((s) => s.courseId);
  const [clip, setClip] = useState<(Clip & { url: string }) | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [trim, setTrim] = useState({ start: '0', end: '' });
  const [withMic, setWithMic] = useState(true);
  const [withSystemAudio, setWithSystemAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const objectUrl = useRef<string | null>(null);
  const load = (next: Clip) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(next.blob);
    setClip({ ...next, url: objectUrl.current });
    setDurationMs(next.durationMs);
    setTrim({ start: '0', end: '' });
  };
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  const recorder = useScreenRecorder(load, () => setError(t('video.recordFailed')));

  const startMs = Math.max(0, Number(trim.start.replace(',', '.')) * 1000 || 0);
  const endMs = trim.end.trim() ? Number(trim.end.replace(',', '.')) * 1000 : undefined;
  const trimInvalid =
    endMs !== undefined &&
    (!Number.isFinite(endMs) || endMs <= startMs || (durationMs !== null && startMs >= durationMs));
  const trimmed = startMs > 0 || endMs !== undefined;

  const record = async () => {
    setError(null);
    try {
      await recorder.start(withMic, withSystemAudio, t('video.recordingName'));
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError' ? t('video.denied') : describeMediaError(e),
      );
    }
  };

  const pick = async () => {
    const file = await chooseFile('video/*');
    if (file) load({ blob: file, name: file.name, durationMs: null });
  };

  const markPosition = (which: 'start' | 'end') => {
    const position = preview.current?.currentTime ?? 0;
    setTrim((prev) => ({ ...prev, [which]: position.toFixed(1) }));
  };

  const insert = async () => {
    if (!clip || trimInvalid) return;
    setBusy(true);
    setError(null);
    const video = preview.current;
    const size =
      video && video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : undefined;
    try {
      if (clip.blob instanceof File && clip.blob.type === DIRECT_VIDEO && !trimmed) {
        const asset = await uploadAsset(courseId, clip.blob);
        const { lang, course, nodeId } = store.getState();
        const element = videoElement(
          lang,
          asset.sha256,
          size ? { size, canvas: course.settings.canvas } : {},
        );
        store.getState().change((draft) => {
          draft.assets[asset.sha256] = { mime: asset.mime, size: asset.size, name: asset.name };
          const slide = nodeId ? draft.nodes[nodeId] : undefined;
          if (slide?.kind === 'slide') slide.elements.push(element);
        });
        store.getState().select([element.id]);
      } else {
        const media = await convertMedia(
          courseId,
          clip.blob,
          clip.name,
          { target: 'video', trimStartMs: startMs, ...(endMs !== undefined ? { trimEndMs: endMs } : {}) },
          t('video.failed'),
        );
        insertConvertedVideo(store, media, size);
      }
      onClose();
    } catch (e) {
      setError(describeMediaError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={mode === 'record' ? t('video.recordTitle') : t('video.fileTitle')}
      isOpen
      width="lg"
      onClose={() => {
        recorder.stop();
        onClose();
      }}
      footer={
        <>
          <Button onPress={onClose} isDisabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon="video"
            isDisabled={!clip || busy || trimInvalid || recorder.recording}
            onPress={() => void insert()}
          >
            {busy ? t('video.processing') : t('video.insert')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {busy ? <Notice tone="info">{t('video.processingHint')}</Notice> : null}
      <div className={styles.videoDialog}>
        {mode === 'record' ? (
          <div className={styles.inline}>
            <Checkbox isSelected={withMic} onChange={setWithMic} isDisabled={recorder.recording}>
              {t('video.microphone')}
            </Checkbox>
            <Checkbox
              isSelected={withSystemAudio}
              onChange={setWithSystemAudio}
              isDisabled={recorder.recording}
            >
              {t('video.systemAudio')}
            </Checkbox>
            {recorder.recording ? (
              <>
                <Button icon="square" variant="primary" onPress={recorder.stop}>
                  {t('video.stop')}
                </Button>
                <span role="status" className={styles.recording}>
                  {t('video.recordingFor', { s: seconds(recorder.elapsedMs) })}
                </span>
              </>
            ) : (
              <Button icon="monitor-up" isDisabled={busy} onPress={() => void record()}>
                {clip ? t('video.recordAgain') : t('video.record')}
              </Button>
            )}
          </div>
        ) : (
          <div className={styles.inline}>
            <Button icon="file-up" isDisabled={busy} onPress={() => void pick()}>
              {clip ? t('video.otherFile') : t('video.chooseFile')}
            </Button>
            {clip ? <span className={styles.ellipsis}>{clip.name}</span> : null}
          </div>
        )}
        {clip ? (
          <>
            <video
              ref={preview}
              className={styles.videoPreview}
              src={clip.url}
              controls
              aria-label={t('video.preview')}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0) setDurationMs(d * 1000);
              }}
            />
            <div className={styles.trimRow}>
              <label className={styles.inline}>
                {t('video.trimStart')}
                <input
                  className={styles.smallNumber}
                  inputMode="decimal"
                  value={trim.start}
                  onChange={(e) => setTrim((p) => ({ ...p, start: e.target.value }))}
                />
              </label>
              <Button onPress={() => markPosition('start')}>{t('video.startHere')}</Button>
              <label className={styles.inline}>
                {t('video.trimEnd')}
                <input
                  className={styles.smallNumber}
                  inputMode="decimal"
                  placeholder={durationMs ? seconds(durationMs) : ''}
                  value={trim.end}
                  onChange={(e) => setTrim((p) => ({ ...p, end: e.target.value }))}
                />
              </label>
              <Button onPress={() => markPosition('end')}>{t('video.endHere')}</Button>
              {durationMs ? (
                <span className={styles.hint}>{t('video.length', { s: seconds(durationMs) })}</span>
              ) : null}
            </div>
            {trimInvalid ? <Notice tone="danger">{t('video.trimInvalid')}</Notice> : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
