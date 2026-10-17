// SPDX-License-Identifier: Apache-2.0
import type { SlideElement, SlideNode } from '@lernwerk/course-model';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleTool, ToolButton } from '../components/Button.js';
import { fetchBytes } from '../api/client.js';
import { Icon } from '../components/Icon.js';
import { useEditor, useEditorStore } from './context.js';
import { ICONS } from './Properties.js';
import type { EditorStore } from './store.js';
import { assetUrl } from './upload.js';
import styles from './Editor.module.css';

const SNAP_MS = 100;
const MIN_LENGTH_MS = 100;
const ZOOMS = [20, 40, 80, 160, 320];
const snap = (ms: number) => Math.max(0, Math.round(ms / SNAP_MS) * SNAP_MS);
const fmt = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

/** Total length shown on the timeline: slide duration, element times, narration. */
export function timelineLength(slide: SlideNode, audioMs: number): number {
  const ends = slide.elements.map((e) => Math.max(e.timing.endMs ?? 0, e.timing.startMs + 1000));
  return Math.max(slide.durationMs ?? 0, audioMs, 5000, ...ends);
}

function setTiming(store: EditorStore, slideId: string, id: string, timing: SlideElement['timing']) {
  store.getState().change((draft) => {
    const slide = draft.nodes[slideId];
    const el = slide?.kind === 'slide' ? slide.elements.find((e) => e.id === id) : undefined;
    if (!el) return;
    el.timing.startMs = timing.startMs;
    if (timing.endMs === undefined) delete el.timing.endMs;
    else el.timing.endMs = timing.endMs;
  }, `timeline-${id}`);
}

/** Peaks (0..1) of an audio file, decoded in the browser. */
function usePeaks(url: string | null): { peaks: Float32Array | null; durationMs: number } {
  const [state, setState] = useState<{ url: string; peaks: Float32Array; durationMs: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const context = new AudioContext();
    fetchBytes(url)
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        const channel = buffer.getChannelData(0);
        const buckets = Math.min(4000, Math.max(1, Math.ceil(buffer.duration * 100)));
        const size = Math.max(1, Math.floor(channel.length / buckets));
        const peaks = new Float32Array(buckets);
        for (let b = 0; b < buckets; b++) {
          let max = 0;
          for (let i = b * size; i < Math.min(channel.length, (b + 1) * size); i++)
            max = Math.max(max, Math.abs(channel[i] ?? 0));
          peaks[b] = max;
        }
        if (!cancelled) setState({ url, peaks, durationMs: buffer.duration * 1000 });
      })
      .catch(() => undefined)
      .finally(() => void context.close());
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state && state.url === url ? state : { peaks: null, durationMs: 0 };
}

function Waveform({ peaks, width, label }: { peaks: Float32Array; width: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const ratio = window.devicePixelRatio || 1;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    g.scale(ratio, ratio);
    g.fillStyle = getComputedStyle(canvas).getPropertyValue('color');
    const mid = height / 2;
    // Scaled to the loudest peak so quiet recordings remain visible.
    const loudest = Math.max(0.05, ...peaks);
    for (let x = 0; x < width; x++) {
      const peak = peaks[Math.floor((x / width) * peaks.length)] ?? 0;
      const h = Math.max(1, (peak / loudest) * (height - 4));
      g.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, width]);
  return <canvas ref={ref} className={styles.waveform} style={{ width }} role="img" aria-label={label} />;
}

/** Start or end of a bar: a slider for keyboard users, a drag handle for the pointer. */
function Handle({
  edge,
  label,
  valueMs,
  minMs,
  maxMs,
  onChange,
  onDrag,
}: {
  edge: 'start' | 'end';
  label: string;
  valueMs: number;
  minMs: number;
  maxMs: number;
  onChange: (ms: number) => void;
  onDrag: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    <span
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={minMs / 1000}
      aria-valuemax={maxMs / 1000}
      aria-valuenow={valueMs / 1000}
      aria-valuetext={fmt(valueMs)}
      className={`${styles.barHandle} ${edge === 'start' ? styles.barStart : styles.barEnd}`}
      onPointerDown={onDrag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 1000 : SNAP_MS;
        const delta =
          e.key === 'ArrowLeft' || e.key === 'ArrowDown'
            ? -step
            : e.key === 'ArrowRight' || e.key === 'ArrowUp'
              ? step
              : 0;
        if (e.key === 'Home') onChange(minMs);
        else if (e.key === 'End') onChange(maxMs);
        else if (delta) onChange(Math.min(maxMs, Math.max(minMs, valueMs + delta)));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}

function Bar({
  slide,
  element,
  lengthMs,
  pxPerMs,
}: {
  slide: SlideNode;
  element: SlideElement;
  lengthMs: number;
  pxPerMs: number;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const { startMs, endMs } = element.timing;
  const end = endMs ?? lengthMs;
  const name = element.name || t(`editor.types.${element.type}`);

  const drag = (mode: 'move' | 'start' | 'end') => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    store.getState().select([element.id]);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - x0) / pxPerMs;
      if (mode === 'move') {
        const start = snap(startMs + delta);
        setTiming(store, slide.id, element.id, {
          startMs: start,
          ...(endMs !== undefined ? { endMs: start + (endMs - startMs) } : {}),
        });
      } else if (mode === 'start') {
        setTiming(store, slide.id, element.id, {
          startMs: Math.min(snap(startMs + delta), end - MIN_LENGTH_MS),
          ...(endMs !== undefined ? { endMs } : {}),
        });
      } else {
        const next = Math.max(snap(end + delta), startMs + MIN_LENGTH_MS);
        // Dragging to the slide end means "until the end of the slide".
        setTiming(store, slide.id, element.id, next >= lengthMs ? { startMs } : { startMs, endMs: next });
      }
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div
      className={styles.bar}
      style={{ left: startMs * pxPerMs, width: Math.max(4, (end - startMs) * pxPerMs) }}
      onPointerDown={drag('move')}
      title={`${name}: ${fmt(startMs)} – ${endMs === undefined ? t('editor.timeline.slideEnd') : fmt(endMs)}`}
    >
      <Handle
        edge="start"
        label={t('editor.timeline.start', { name })}
        valueMs={startMs}
        minMs={0}
        maxMs={end - MIN_LENGTH_MS}
        onDrag={drag('start')}
        onChange={(ms) =>
          setTiming(store, slide.id, element.id, { startMs: ms, ...(endMs !== undefined ? { endMs } : {}) })
        }
      />
      {element.entrance ? (
        <span className={styles.barEntrance} style={{ width: element.entrance.durationMs * pxPerMs }} />
      ) : null}
      <Handle
        edge="end"
        label={t('editor.timeline.end', { name })}
        valueMs={end}
        minMs={startMs + MIN_LENGTH_MS}
        maxMs={lengthMs}
        onDrag={drag('end')}
        onChange={(ms) =>
          setTiming(store, slide.id, element.id, ms >= lengthMs ? { startMs } : { startMs, endMs: ms })
        }
      />
    </div>
  );
}

/** Slide timeline: when elements appear and disappear, synchronised with the narration. */
export function Timeline({ slide }: { slide: SlideNode }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const courseId = useEditor((s) => s.courseId);
  const lang = useEditor((s) => s.lang);
  const playhead = useEditor((s) => s.playheadMs);
  const selection = useEditor((s) => s.selection);
  const [zoom, setZoom] = useState(2);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const narration = slide.narration?.sources[lang]?.$asset ?? null;
  const url = narration ? assetUrl(courseId, narration) : null;
  const { peaks, durationMs: audioMs } = usePeaks(url);
  const lengthMs = timelineLength(slide, audioMs);
  const pxPerMs = (ZOOMS[zoom] ?? 80) / 1000;
  const width = Math.ceil(lengthMs * pxPerMs) + 24;
  const rows = useMemo(() => [...slide.elements].reverse(), [slide.elements]);

  useEffect(() => {
    if (!playing) return;
    const audio = audioRef.current;
    let frame = 0;
    const origin = performance.now() - store.getState().playheadMs;
    if (audio) {
      audio.currentTime = store.getState().playheadMs / 1000;
      void audio.play().catch(() => setPlaying(false));
    }
    const tick = () => {
      const ms = audio && !audio.paused ? audio.currentTime * 1000 : performance.now() - origin;
      store.getState().setPlayhead(Math.min(ms, lengthMs));
      if (ms >= lengthMs || (audio && audio.ended && ms >= audioMs)) return setPlaying(false);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      audio?.pause();
    };
  }, [playing, lengthMs, audioMs, store]);

  const seek = (e: ReactPointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    store.getState().setPlayhead(snap((e.clientX - rect.left) / pxPerMs));
  };

  return (
    <section className={styles.timeline} aria-label={t('editor.timeline.title')}>
      <div className={styles.timelineToolbar}>
        <ToggleTool
          icon={playing ? 'pause' : 'play'}
          aria-label={playing ? t('editor.timeline.pause') : t('editor.timeline.play')}
          isSelected={playing}
          onChange={setPlaying}
        />
        <ToolButton
          icon="skip-back"
          aria-label={t('editor.timeline.toStart')}
          onPress={() => store.getState().setPlayhead(0)}
        />
        <span className={styles.timecode} aria-live="off">
          {fmt(playhead)} / {fmt(lengthMs)}
        </span>
        <span className={styles.toolbarSpacer} />
        <ToolButton
          icon="zoom-out"
          aria-label={t('editor.timeline.zoomOut')}
          isDisabled={zoom === 0}
          onPress={() => setZoom(zoom - 1)}
        />
        <ToolButton
          icon="zoom-in"
          aria-label={t('editor.timeline.zoomIn')}
          isDisabled={zoom === ZOOMS.length - 1}
          onPress={() => setZoom(zoom + 1)}
        />
      </div>
      {url ? <audio ref={audioRef} src={url} preload="auto" onEnded={() => setPlaying(false)} /> : null}
      <div className={styles.timelineBody}>
        <div className={styles.timelineGrid} style={{ gridTemplateColumns: `160px ${width}px` }}>
          <span className={styles.timelineCorner} />
          <div className={styles.ruler} onPointerDown={seek} aria-hidden="true">
            {Array.from({ length: Math.floor(lengthMs / 1000) + 1 }, (_, s) =>
              zoom > 0 || s % 5 === 0 ? (
                <span key={s} className={styles.tick} style={{ left: s * 1000 * pxPerMs }}>
                  {s}
                </span>
              ) : null,
            )}
          </div>
          {url ? (
            <>
              <span className={styles.trackLabel}>
                <Icon name="mic" />
                {t('editor.timeline.narration')}
              </span>
              <div className={styles.track} onPointerDown={seek}>
                {peaks ? (
                  <Waveform
                    peaks={peaks}
                    width={audioMs * pxPerMs}
                    label={t('editor.timeline.waveform', { time: fmt(audioMs) })}
                  />
                ) : null}
              </div>
            </>
          ) : null}
          {rows.map((el) => (
            <div
              key={el.id}
              className={styles.trackRow}
              data-selected={selection.includes(el.id) || undefined}
            >
              <button
                type="button"
                className={styles.trackLabel}
                onClick={() => store.getState().select([el.id])}
              >
                <Icon name={ICONS[el.type]} />
                <span className={styles.ellipsis}>{el.name || t(`editor.types.${el.type}`)}</span>
              </button>
              <div className={styles.track} onPointerDown={seek}>
                <Bar slide={slide} element={el} lengthMs={lengthMs} pxPerMs={pxPerMs} />
              </div>
            </div>
          ))}
          <span className={styles.playhead} style={{ left: 160 + playhead * pxPerMs }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
