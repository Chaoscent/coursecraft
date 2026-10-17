// SPDX-License-Identifier: Apache-2.0
import '@lernwerk/player/player.css';
import { loadCourse } from '@lernwerk/course-model';
import { courseDocumentResponseSchema, lockResponseSchema } from '@lernwerk/shared';
import { useCallback, useEffect, useState } from 'react';
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
  type Key,
} from 'react-aria-components';
import { useTranslation } from 'react-i18next';
import { Group as PanelGroup, Panel, Separator as PanelSeparator } from 'react-resizable-panels';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { Notice } from '../components/Notice.js';
import { ShortcutHelp } from '../layout/ShortcutHelp.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import {
  addSlide,
  group,
  insertHotspot,
  insertImage,
  insertMedia,
  insertText,
  nudge,
  reorder,
  ungroup,
} from './actions.js';
import { Canvas } from './Canvas.js';
import { Timeline } from './Timeline.js';
import { EditorContext, useEditor, useEditorStore } from './context.js';
import { ExportDialog, PreviewDialog, SettingsDialog, VersionsDialog } from './dialogs.js';
import { Properties } from './Properties.js';
import { QuizEditor, SurveyEditor } from './QuizEditor.js';
import { Ribbon } from './Ribbon.js';
import { SlideList } from './SlideList.js';
import { createEditorStore, type EditorStore } from './store.js';
import { startSync } from './sync.js';
import styles from './Editor.module.css';

type DialogKind = 'export' | 'versions' | 'settings' | 'preview' | 'shortcuts' | null;

interface MenuEntry {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

function TopMenu({ label, items }: { label: string; items: (MenuEntry | 'separator')[] }) {
  return (
    <MenuTrigger>
      <AriaButton className={styles.menuButton}>{label}</AriaButton>
      <Popover className={styles.menuPopover} placement="bottom start" offset={0}>
        <Menu
          className={styles.menu}
          disabledKeys={items
            .filter((i): i is MenuEntry => i !== 'separator' && !!i.disabled)
            .map((i) => i.id)}
          onAction={(key: Key) => items.find((i): i is MenuEntry => i !== 'separator' && i.id === key)?.run()}
        >
          {items.map((item, i) =>
            item === 'separator' ? (
              <Separator key={`s${i}`} className={styles.menuSeparator} />
            ) : (
              <MenuItem key={item.id} id={item.id} className={styles.menuItem}>
                <span>{item.label}</span>
                <kbd className={styles.shortcut}>{item.shortcut ?? ''}</kbd>
              </MenuItem>
            ),
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** Canvas for slides, form editors for quizzes and surveys. */
function Center() {
  const node = useEditor((s) => (s.nodeId ? s.course.nodes[s.nodeId] : undefined));
  if (node?.kind === 'quiz') return <QuizEditor key={node.id} quiz={node} />;
  if (node?.kind === 'survey') return <SurveyEditor key={node.id} survey={node} />;
  if (node?.kind !== 'slide') return <Canvas />;
  return (
    <PanelGroup orientation="vertical" disableCursor>
      <Panel minSize={200}>
        <Canvas />
      </Panel>
      <PanelSeparator className={styles.splitterH} />
      <Panel defaultSize={170} minSize={72} maxSize={480}>
        <Timeline slide={node} />
      </Panel>
    </PanelGroup>
  );
}

function StatusBar() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const save = useEditor((s) => s.save);
  const course = useEditor((s) => s.course);
  const nodeId = useEditor((s) => s.nodeId);
  const zoom = useEditor((s) => s.zoom);
  const lang = useEditor((s) => s.lang);
  const readOnly = useEditor((s) => s.readOnly);
  const all = course.structure.chapters.flatMap((c) => c.nodeIds);
  const saveText =
    save.kind === 'saved'
      ? t('editor.status.saved', { time: formatDateTime(save.at.toISOString()) })
      : save.kind === 'saving'
        ? t('editor.status.saving')
        : save.kind === 'dirty'
          ? t('editor.status.dirty')
          : save.kind === 'conflict'
            ? t('editor.status.conflict')
            : t('editor.status.error', { message: save.message });
  return (
    <footer className={styles.statusbar}>
      <span className={styles.statusItem}>
        {t('editor.status.slide', { index: all.indexOf(nodeId ?? '') + 1, total: all.length })}
      </span>
      <span className={styles.statusItem} role="status">
        <span
          className={
            save.kind === 'saved'
              ? styles.dotOk
              : save.kind === 'error' || save.kind === 'conflict'
                ? styles.dotError
                : styles.dotBusy
          }
          aria-hidden="true"
        />
        {saveText}
      </span>
      {readOnly ? <span className={styles.statusItem}>{t('editor.status.readOnly')}</span> : null}
      <span className={`${styles.statusItem} ${styles.statusEnd}`}>
        {course.settings.canvas.width} × {course.settings.canvas.height}
      </span>
      <label className={styles.statusItem}>
        {t('editor.zoom')}
        <select
          className={styles.statusSelect}
          value={String(zoom)}
          onChange={(e) =>
            store.getState().setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))
          }
        >
          <option value="fit">{t('editor.zoomFit')}</option>
          {[0.5, 0.75, 1, 1.5].map((z) => (
            <option key={z} value={z}>
              {z * 100} %
            </option>
          ))}
        </select>
      </label>
      <span className={styles.statusItem}>{lang.toUpperCase()}</span>
      <span className={styles.statusItem}>
        <kbd>?</kbd> {t('menu.shortcuts')}
      </span>
    </footer>
  );
}

function useEditorKeys(store: EditorStore, open: (d: DialogKind) => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const s = store.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const handled = () => event.preventDefault();
      if (mod && key === 'z' && !event.shiftKey) return (handled(), s.undo());
      if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) return (handled(), s.redo());
      if (mod && key === 'c') return s.copy();
      if (mod && key === 'x') return (s.copy(), s.removeSelection());
      if (mod && key === 'v') return (handled(), s.paste());
      if (mod && key === 'd') return (handled(), s.duplicate());
      if (mod && key === 'a') {
        handled();
        const node = s.nodeId ? s.course.nodes[s.nodeId] : undefined;
        if (node?.kind === 'slide') s.select(node.elements.map((e) => e.id));
        return;
      }
      if (mod && key === 'g') return (handled(), event.shiftKey ? ungroup(store) : group(store));
      if (mod && event.key === ']') return (handled(), reorder(store, event.shiftKey ? 'front' : 'forward'));
      if (mod && event.key === '[') return (handled(), reorder(store, event.shiftKey ? 'back' : 'backward'));
      if (mod && key === 's') return (handled(), open('versions'));
      if (event.key === 'F5') return (handled(), open('preview'));
      if (event.key === '?') return (handled(), open('shortcuts'));
      if (event.key === 'Delete' || event.key === 'Backspace') return (handled(), s.removeSelection());
      if (event.key === 'Escape') return s.editingTextId ? s.editText(null) : s.select([]);
      if (event.key === 'Enter' && s.selection.length === 1) {
        const node = s.nodeId ? s.course.nodes[s.nodeId] : undefined;
        const el = node?.kind === 'slide' ? node.elements.find((e) => e.id === s.selection[0]) : undefined;
        if (el?.type === 'text' || el?.type === 'shape') return (handled(), s.editText(el.id));
      }
      const step = event.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (move && s.selection.length) return (handled(), nudge(store, move[0], move[1]));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, open]);
}

function EditorShell({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const navigate = useNavigate();
  const readOnly = useEditor((s) => s.readOnly);
  const save = useEditor((s) => s.save);
  const title = useEditor((s) => s.course.meta.title[s.lang] ?? '');
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [lockHolder, setLockHolder] = useState<string | null>(null);
  const open = useCallback((d: DialogKind) => setDialog(d), []);
  useEditorKeys(store, open);
  useEffect(() => startSync(store, (holder) => setLockHolder(holder ?? '?')), [store]);

  return (
    <div className={styles.app}>
      <nav className={styles.menubar} aria-label={t('shell.mainMenu')}>
        <span className={styles.brand}>{t('app.name')}</span>
        <TopMenu
          label={t('menu.file')}
          items={[
            { id: 'settings', label: t('editor.settings'), run: () => open('settings') },
            { id: 'versions', label: t('editor.versions'), shortcut: 'Ctrl+S', run: () => open('versions') },
            { id: 'export', label: t('editor.exportMenu'), run: () => open('export') },
            'separator',
            { id: 'close', label: t('editor.close'), run: () => void navigate('/author') },
          ]}
        />
        <TopMenu
          label={t('editor.menu.edit')}
          items={[
            {
              id: 'undo',
              label: t('editor.undo'),
              shortcut: 'Ctrl+Z',
              disabled: !canUndo || readOnly,
              run: () => store.getState().undo(),
            },
            {
              id: 'redo',
              label: t('editor.redo'),
              shortcut: 'Ctrl+Y',
              disabled: !canRedo || readOnly,
              run: () => store.getState().redo(),
            },
            'separator',
            { id: 'copy', label: t('editor.copy'), shortcut: 'Ctrl+C', run: () => store.getState().copy() },
            {
              id: 'paste',
              label: t('editor.paste'),
              shortcut: 'Ctrl+V',
              disabled: readOnly,
              run: () => store.getState().paste(),
            },
            {
              id: 'duplicate',
              label: t('editor.duplicate'),
              shortcut: 'Ctrl+D',
              disabled: readOnly,
              run: () => store.getState().duplicate(),
            },
            {
              id: 'delete',
              label: t('editor.delete'),
              shortcut: 'Entf',
              disabled: readOnly,
              run: () => store.getState().removeSelection(),
            },
          ]}
        />
        <TopMenu
          label={t('editor.menu.insert')}
          items={[
            {
              id: 'slide',
              label: t('editor.newSlide'),
              disabled: readOnly,
              run: () => addSlide(store, t('editor.untitledSlide')),
            },
            'separator',
            {
              id: 'text',
              label: t('editor.insert.text'),
              disabled: readOnly,
              run: () => insertText(store, t('editor.newText')),
            },
            {
              id: 'image',
              label: t('editor.insert.imageMenu'),
              disabled: readOnly,
              run: () => void insertImage(store),
            },
            {
              id: 'video',
              label: t('editor.insert.videoMenu'),
              disabled: readOnly,
              run: () => void insertMedia(store, 'video'),
            },
            {
              id: 'audio',
              label: t('editor.insert.audioMenu'),
              disabled: readOnly,
              run: () => void insertMedia(store, 'audio'),
            },
            {
              id: 'hotspot',
              label: t('editor.insert.hotspot'),
              disabled: readOnly,
              run: () => insertHotspot(store),
            },
          ]}
        />
        <TopMenu
          label={t('menu.view')}
          items={[
            { id: 'preview', label: t('editor.preview'), shortcut: 'F5', run: () => open('preview') },
            { id: 'grid', label: t('editor.grid'), run: () => store.getState().toggleGrid() },
          ]}
        />
        <TopMenu
          label={t('menu.help')}
          items={[
            { id: 'shortcuts', label: t('menu.shortcuts'), shortcut: '?', run: () => open('shortcuts') },
          ]}
        />
        <span className={styles.spacer} />
        <span className={styles.docTitle}>{title}</span>
      </nav>
      <Ribbon onPreview={() => open('preview')} onExport={() => open('export')} />
      <div className={styles.bannerSlot}>
        {lockHolder !== null || save.kind === 'conflict' || readOnly ? (
          <div className={styles.banner}>
            <Notice tone="warning">
              {save.kind === 'conflict'
                ? t('editor.conflict')
                : t('editor.readOnlyLocked', { name: lockHolder ?? '' })}{' '}
              <Button onPress={onReload}>{t('editor.reload')}</Button>
            </Notice>
          </div>
        ) : null}
      </div>
      <PanelGroup orientation="horizontal" className={styles.workbench} disableCursor>
        <Panel defaultSize={200} minSize={150} maxSize={360}>
          <SlideList />
        </Panel>
        <PanelSeparator className={styles.splitter} />
        <Panel minSize={300}>
          <Center />
        </Panel>
        <PanelSeparator className={styles.splitter} />
        <Panel defaultSize={290} minSize={240} maxSize={480}>
          <Properties />
        </Panel>
      </PanelGroup>
      <StatusBar />
      {dialog === 'export' ? <ExportDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'versions' ? (
        <VersionsDialog
          onClose={() => setDialog(null)}
          onRestored={() => {
            setDialog(null);
            onReload();
          }}
        />
      ) : null}
      {dialog === 'settings' ? <SettingsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'preview' ? <PreviewDialog onClose={() => setDialog(null)} /> : null}
      <ShortcutHelp isOpen={dialog === 'shortcuts'} onClose={() => setDialog(null)} editor />
    </div>
  );
}

/** Loads a course, takes the edit lock and opens the editor. */
export function EditorPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [store, setStore] = useState<EditorStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const lock = await api(lockResponseSchema, `/api/courses/${id}/lock`, { method: 'POST' });
      const doc = await api(courseDocumentResponseSchema, `/api/courses/${id}`);
      const course = loadCourse(doc.course);
      if (active)
        setStore(createEditorStore({ courseId: id, course, rev: doc.rev, readOnly: !lock.acquired }));
    })().catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [id, version]);

  if (error) {
    return (
      <div className={styles.loading}>
        <Notice tone="danger">{error}</Notice>
      </div>
    );
  }
  if (!store) return <div className={styles.loading}>{t('editor.loading')}</div>;
  return (
    <EditorContext.Provider value={store}>
      <EditorShell
        key={version}
        onReload={() => {
          setStore(null);
          setVersion((v) => v + 1);
        }}
      />
    </EditorContext.Provider>
  );
}
