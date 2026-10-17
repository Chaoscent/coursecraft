// SPDX-License-Identifier: Apache-2.0
import type { SlideElement } from '@lernwerk/course-model';
import { renderSlide, type RenderContext, type RenderedSlide } from '@lernwerk/player';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, useEditorStore } from './context.js';
import {
  bounds,
  contains,
  GRID,
  HANDLES,
  intersects,
  resize,
  snapMove,
  type Guide,
  type Handle,
} from './geometry.js';
import type { Frame } from './model.js';
import { slideOf } from './model.js';
import { TextEditor } from './TextEditor.js';
import { assetUrl } from './upload.js';
import styles from './Editor.module.css';

type Drag =
  | { kind: 'move'; startX: number; startY: number; frames: Map<string, Frame>; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; startX: number; startY: number; frame: Frame }
  | { kind: 'marquee'; startX: number; startY: number; x: number; y: number; additive: boolean };

const SNAP_PX = 6;

export function useRenderContext(): RenderContext {
  const courseId = useEditor((s) => s.courseId);
  const lang = useEditor((s) => s.lang);
  const course = useEditor((s) => s.course);
  return useMemo(
    () => ({
      lang,
      fallbackLang: course.languages.default,
      assetUrl: (sha) => assetUrl(courseId, sha),
      assetMime: (sha) => course.assets[sha]?.mime,
      branding: course.settings.branding,
    }),
    [lang, course.languages.default, course.assets, course.settings.branding, courseId],
  );
}

export function Canvas() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const course = useEditor((s) => s.course);
  const nodeId = useEditor((s) => s.nodeId);
  const selection = useEditor((s) => s.selection);
  const showGrid = useEditor((s) => s.showGrid);
  const zoom = useEditor((s) => s.zoom);
  const editingTextId = useEditor((s) => s.editingTextId);
  const playheadMs = useEditor((s) => s.playheadMs);
  const readOnly = useEditor((s) => s.readOnly);
  const ctx = useRenderContext();
  const slide = slideOf(course, nodeId);
  const { width, height } = course.settings.canvas;

  const viewportRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<RenderedSlide | null>(null);
  const [fitScale, setFitScale] = useState(0.5);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Map<string, Frame> | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const scale = zoom === 'fit' ? fitScale : zoom;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fit = () =>
      setFitScale(
        Math.max(0.1, Math.min((viewport.clientWidth - 48) / width, (viewport.clientHeight - 48) / height)),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [width, height]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !slide) return;
    const rendered = renderSlide(slide, ctx, { width, height, static: true });
    renderedRef.current = rendered;
    host.replaceChildren(rendered.root);
  }, [slide, ctx, width, height]);

  // Elements not visible at the timeline playhead are dimmed.
  useEffect(() => {
    const rendered = renderedRef.current;
    if (!rendered || !slide) return;
    for (const el of slide.elements) {
      const node = rendered.elements.get(el.id);
      const visible =
        el.timing.startMs <= playheadMs && (el.timing.endMs === undefined || el.timing.endMs > playheadMs);
      node?.classList.toggle(styles.offTimeline ?? 'off-timeline', !visible);
    }
  }, [playheadMs, slide]);

  // Hide the rendered element while its text is edited in place.
  useEffect(() => {
    const node = editingTextId ? renderedRef.current?.elements.get(editingTextId) : undefined;
    if (node) node.style.visibility = 'hidden';
    return () => {
      if (node) node.style.visibility = '';
    };
  }, [editingTextId, slide]);

  if (!slide) return <div className={styles.viewport} />;
  const elements = slide.elements;
  const frameOf = (el: SlideElement) => preview?.get(el.id) ?? el.frame;

  const toLogical = (event: { clientX: number; clientY: number }) => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { x: (event.clientX - (rect?.left ?? 0)) / scale, y: (event.clientY - (rect?.top ?? 0)) / scale };
  };

  const hit = (x: number, y: number) =>
    [...elements].reverse().find((el) => !el.hidden && contains(el.frame, x, y));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || readOnly) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-text-editor]')) return;
    const { x, y } = toLogical(event);
    const handle = target.dataset['handle'] as Handle | undefined;
    const state = store.getState();
    if (handle && state.selection.length === 1) {
      const el = elements.find((e) => e.id === state.selection[0]);
      if (el && !el.locked) {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ kind: 'resize', id: el.id, handle, startX: x, startY: y, frame: el.frame });
      }
      return;
    }
    const element = hit(x, y);
    if (!element) {
      if (state.editingTextId) state.editText(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (!event.shiftKey) state.select([]);
      setDrag({ kind: 'marquee', startX: x, startY: y, x, y, additive: event.shiftKey });
      return;
    }
    let next = state.selection;
    if (event.shiftKey)
      next = next.includes(element.id) ? next.filter((id) => id !== element.id) : [...next, element.id];
    else if (!next.includes(element.id)) next = [element.id];
    if (state.editingTextId && state.editingTextId !== element.id) state.editText(null);
    state.select(next);
    const movable = elements.filter((e) => next.includes(e.id) && !e.locked);
    if (movable.length) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        kind: 'move',
        startX: x,
        startY: y,
        frames: new Map(movable.map((e) => [e.id, e.frame])),
        moved: false,
      });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const { x, y } = toLogical(event);
    if (drag.kind === 'marquee') {
      setDrag({ ...drag, x, y });
      return;
    }
    if (drag.kind === 'resize') {
      const frame = resize(drag.frame, drag.handle, x - drag.startX, y - drag.startY, event.shiftKey);
      setPreview(new Map([[drag.id, frame]]));
      applyToDom(drag.id, frame);
      return;
    }
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) * scale < 3) return;
    const moving = [...drag.frames.values()].map((f) => ({ ...f, x: f.x + dx, y: f.y + dy }));
    const others = elements.filter((e) => !drag.frames.has(e.id) && !e.hidden).map((e) => e.frame);
    const snap = event.altKey
      ? { dx: 0, dy: 0, guides: [] }
      : snapMove(bounds(moving), others, { width, height }, SNAP_PX / scale, showGrid);
    const next = new Map<string, Frame>();
    for (const [id, f] of drag.frames) {
      const frame = { ...f, x: Math.round(f.x + dx + snap.dx), y: Math.round(f.y + dy + snap.dy) };
      next.set(id, frame);
      applyToDom(id, frame);
    }
    setGuides(snap.guides);
    setPreview(next);
    if (!drag.moved) setDrag({ ...drag, moved: true });
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === 'marquee') {
      const box = bounds([
        { x: drag.startX, y: drag.startY, width: 0, height: 0, rotation: 0 },
        { x: drag.x, y: drag.y, width: 0, height: 0, rotation: 0 },
      ]);
      if (box.width > 2 || box.height > 2) {
        const inside = elements.filter((e) => !e.hidden && intersects(box, e.frame)).map((e) => e.id);
        const current = store.getState().selection;
        store.getState().select(drag.additive ? [...new Set([...current, ...inside])] : inside);
      }
    } else if (preview) {
      const frames = preview;
      store.getState().change((draft) => {
        const target = draft.nodes[slide.id];
        if (target?.kind !== 'slide') return;
        for (const el of target.elements) {
          const frame = frames.get(el.id);
          if (frame) el.frame = frame;
        }
      });
    }
    setDrag(null);
    setPreview(null);
    setGuides([]);
  };

  function applyToDom(id: string, frame: Frame) {
    const node = renderedRef.current?.elements.get(id);
    if (!node) return;
    node.style.left = `${frame.x}px`;
    node.style.top = `${frame.y}px`;
    node.style.width = `${frame.width}px`;
    node.style.height = `${frame.height}px`;
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const { x, y } = toLogical(event);
    const element = hit(x, y);
    if (element && (element.type === 'text' || element.type === 'shape'))
      store.getState().editText(element.id);
  };

  const selected = elements.filter((e) => selection.includes(e.id));
  const editing = elements.find((e) => e.id === editingTextId);

  return (
    <div className={styles.viewport} ref={viewportRef}>
      <div className={styles.stageFrame} style={{ width: width * scale, height: height * scale }}>
        <div
          className={styles.canvasHost}
          ref={hostRef}
          style={{ transform: `scale(${scale})`, width, height }}
          aria-hidden="true"
        />
        {showGrid ? (
          <div className={styles.grid} style={{ backgroundSize: `${GRID * scale}px ${GRID * scale}px` }} />
        ) : null}
        <div
          className={styles.overlay}
          style={{ transform: `scale(${scale})`, width, height, ['--scale' as string]: scale }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          role="application"
          aria-label={t('editor.canvas')}
        >
          {elements
            .filter((e) => e.type === 'hotspot' && !e.hidden)
            .map((e) => (
              <div key={`hs-${e.id}`} className={styles.hotspotOutline} style={frameStyle(frameOf(e))} />
            ))}
          {selected.map((el) => (
            <div
              key={el.id}
              className={`${styles.selection} ${el.locked ? styles.locked : ''}`}
              style={frameStyle(frameOf(el))}
            >
              {selected.length === 1 && !el.locked && !readOnly
                ? HANDLES.map((h) => (
                    <span
                      key={h}
                      data-handle={h}
                      className={`${styles.handle} ${styles[`h_${h}`]}`}
                      style={{ scale: String(1 / scale) }}
                    />
                  ))
                : null}
              {selected.length === 1 ? (
                <span className={styles.sizeTag} style={{ scale: String(1 / scale) }}>
                  {Math.round(frameOf(el).width)} × {Math.round(frameOf(el).height)}
                </span>
              ) : null}
            </div>
          ))}
          {guides.map((g) => (
            <div
              key={`${g.axis}${g.at}`}
              className={g.axis === 'x' ? styles.guideV : styles.guideH}
              style={g.axis === 'x' ? { left: g.at } : { top: g.at }}
            />
          ))}
          {drag?.kind === 'marquee' ? (
            <div
              className={styles.marquee}
              style={frameStyle(
                bounds([
                  { x: drag.startX, y: drag.startY, width: 0, height: 0, rotation: 0 },
                  { x: drag.x, y: drag.y, width: 0, height: 0, rotation: 0 },
                ]),
              )}
            />
          ) : null}
          {editing && (editing.type === 'text' || editing.type === 'shape') ? (
            <TextEditor element={editing} slideId={slide.id} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function frameStyle(frame: Frame) {
  return {
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
  };
}
