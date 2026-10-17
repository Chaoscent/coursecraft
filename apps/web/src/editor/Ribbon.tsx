// SPDX-License-Identifier: Apache-2.0
import { useState, type ReactNode } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover, Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { useTranslation } from 'react-i18next';
import { ToggleTool, ToolButton } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { Button } from '../components/Button.js';
import { TextField } from '../components/Field.js';
import { Icon } from '../components/Icon.js';
import {
  addSlide,
  align,
  deleteSlide,
  duplicateSlide,
  group,
  insertHotspot,
  insertImage,
  insertAudio,
  insertShape,
  insertText,
  reorder,
  ungroup,
} from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import { useActiveTextEditor } from './TextEditor.js';
import styles from './Editor.module.css';

function Group({ label, children, grid }: { label: string; children: ReactNode; grid?: boolean }) {
  return (
    <div className={styles.ribbonGroup} role="group" aria-label={label}>
      <div className={grid ? styles.ribbonGrid : styles.ribbonItems}>{children}</div>
      <span className={styles.ribbonLabel}>{label}</span>
    </div>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.ribbonStack}>{children}</div>;
}

function ShapeMenu() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const readOnly = useEditor((s) => s.readOnly);
  return (
    <MenuTrigger>
      <ToolButton icon="square" isDisabled={readOnly}>
        {t('editor.insert.shape')}
      </ToolButton>
      <Popover className={styles.menuPopover} placement="bottom start">
        <Menu className={styles.menu} onAction={(key) => insertShape(store, key as 'rectangle')}>
          {(['rectangle', 'ellipse', 'triangle', 'line', 'arrow'] as const).map((shape) => (
            <MenuItem key={shape} id={shape} className={styles.menuItem}>
              {t(`editor.shapes.${shape}`)}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function LinkDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const editor = useActiveTextEditor((s) => s.editor);
  const [href, setHref] = useState(String(editor?.getAttributes('link')['href'] ?? 'https://'));
  const valid = /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(href);
  return (
    <Dialog
      title={t('editor.text.link')}
      isOpen
      onClose={onClose}
      width="sm"
      onSubmit={() => {
        if (!valid) return;
        editor?.chain().focus().extendMarkRange('link').setLink({ href }).run();
        onClose();
      }}
      footer={
        <>
          <Button
            onPress={() => {
              editor?.chain().focus().unsetLink().run();
              onClose();
            }}
          >
            {t('editor.text.removeLink')}
          </Button>
          <Button type="submit" variant="primary" isDisabled={!valid}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('editor.text.url')}
        value={href}
        onChange={setHref}
        autoFocus
        errorMessage={valid ? undefined : t('editor.text.urlHint')}
      />
    </Dialog>
  );
}

function TextTools() {
  const { t } = useTranslation();
  const editor = useActiveTextEditor((s) => s.editor);
  const [linkOpen, setLinkOpen] = useState(false);
  const [, force] = useState(0);
  if (!editor) return null;
  const run = (fn: () => void) => {
    fn();
    force((n) => n + 1);
  };
  const mark = (name: string, icon: string, toggle: () => void) => (
    <ToggleTool
      key={name}
      icon={icon}
      aria-label={t(`editor.text.${name}`)}
      isSelected={editor.isActive(name)}
      onChange={() => run(toggle)}
    />
  );
  return (
    <>
      <Group label={t('editor.text.format')} grid>
        {mark('bold', 'bold', () => editor.chain().focus().toggleBold().run())}
        {mark('italic', 'italic', () => editor.chain().focus().toggleItalic().run())}
        {mark('underline', 'underline', () => editor.chain().focus().toggleUnderline().run())}
        {mark('bulletList', 'list', () => editor.chain().focus().toggleBulletList().run())}
        {mark('orderedList', 'list-ordered', () => editor.chain().focus().toggleOrderedList().run())}
        <ToolButton icon="link" aria-label={t('editor.text.link')} onPress={() => setLinkOpen(true)} />
      </Group>
      <Group label={t('editor.text.paragraph')}>
        <Stack>
          <ToolButton
            icon="heading"
            onPress={() => run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
          >
            {t('editor.text.heading')}
          </ToolButton>
          <ToolButton icon="type" onPress={() => run(() => editor.chain().focus().setParagraph().run())}>
            {t('editor.text.body')}
          </ToolButton>
        </Stack>
        <div className={styles.ribbonGrid}>
          <ToolButton
            icon="align-left"
            aria-label={t('editor.text.alignLeft')}
            onPress={() => run(() => editor.chain().focus().setTextAlign('left').run())}
          />
          <ToolButton
            icon="align-center"
            aria-label={t('editor.text.alignCenter')}
            onPress={() => run(() => editor.chain().focus().setTextAlign('center').run())}
          />
          <ToolButton
            icon="align-right"
            aria-label={t('editor.text.alignRight')}
            onPress={() => run(() => editor.chain().focus().setTextAlign('right').run())}
          />
        </div>
        <label className={styles.colorTool}>
          <Icon name="type-outline" />
          <span className="visually-hidden">{t('editor.text.color')}</span>
          <input
            type="color"
            aria-label={t('editor.text.color')}
            onChange={(e) => run(() => editor.chain().focus().setColor(e.target.value).run())}
          />
        </label>
      </Group>
      {linkOpen ? <LinkDialog onClose={() => setLinkOpen(false)} /> : null}
    </>
  );
}

export function Ribbon({
  onPreview,
  onExport,
  onVideo,
}: {
  onPreview: () => void;
  onExport: () => void;
  onVideo: (mode: 'record' | 'file') => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const readOnly = useEditor((s) => s.readOnly);
  const selection = useEditor((s) => s.selection);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const showGrid = useEditor((s) => s.showGrid);
  const editingText = useEditor((s) => s.editingTextId !== null);
  const hasClipboard = useEditor((s) => s.clipboard.length > 0);
  const none = selection.length === 0 || readOnly;
  const [tab, setTab] = useState<string>('start');
  const selectedTab = editingText ? 'text' : tab === 'text' ? 'start' : tab;

  const view = (
    <>
      <Group label={t('editor.groups.view')}>
        <Stack>
          <ToggleTool icon="grid-3x3" isSelected={showGrid} onChange={() => store.getState().toggleGrid()}>
            {t('editor.grid')}
          </ToggleTool>
        </Stack>
        <ToolButton icon="play" large onPress={onPreview}>
          {t('editor.preview')}
        </ToolButton>
      </Group>
      <Group label={t('editor.groups.output')}>
        <ToolButton icon="upload" large onPress={onExport}>
          {t('editor.export')}
        </ToolButton>
      </Group>
    </>
  );

  return (
    <Tabs
      className={styles.ribbon}
      selectedKey={selectedTab}
      onSelectionChange={(key) => setTab(String(key))}
    >
      <TabList className={styles.tabstrip} aria-label={t('editor.tools')}>
        <Tab id="start" className={styles.tab}>
          {t('editor.tabs.start')}
        </Tab>
        <Tab id="insert" className={styles.tab}>
          {t('editor.tabs.insert')}
        </Tab>
        {editingText ? (
          <Tab id="text" className={styles.tab}>
            {t('editor.tabs.text')}
          </Tab>
        ) : null}
        <Tab id="view" className={styles.tab}>
          {t('editor.tabs.view')}
        </Tab>
      </TabList>
      <TabPanel id="start" className={styles.ribbonBody}>
        <Group label={t('editor.groups.clipboard')}>
          <ToolButton
            icon="clipboard-paste"
            large
            isDisabled={readOnly || !hasClipboard}
            onPress={() => store.getState().paste()}
          >
            {t('editor.paste')}
          </ToolButton>
          <Stack>
            <ToolButton
              icon="scissors"
              isDisabled={none}
              onPress={() => {
                store.getState().copy();
                store.getState().removeSelection();
              }}
            >
              {t('editor.cut')}
            </ToolButton>
            <ToolButton icon="copy" isDisabled={none} onPress={() => store.getState().copy()}>
              {t('editor.copy')}
            </ToolButton>
          </Stack>
        </Group>
        <Group label={t('editor.groups.slides')}>
          <ToolButton
            icon="file-plus"
            large
            isDisabled={readOnly}
            onPress={() => addSlide(store, t('editor.untitledSlide'))}
          >
            {t('editor.newSlide')}
          </ToolButton>
          <Stack>
            <ToolButton icon="copy-plus" isDisabled={readOnly} onPress={() => duplicateSlide(store)}>
              {t('editor.duplicate')}
            </ToolButton>
            <ToolButton icon="trash-2" isDisabled={readOnly} onPress={() => deleteSlide(store)}>
              {t('editor.delete')}
            </ToolButton>
          </Stack>
        </Group>
        <Group label={t('editor.groups.edit')}>
          <Stack>
            <ToolButton
              icon="undo-2"
              isDisabled={!canUndo || readOnly}
              onPress={() => store.getState().undo()}
            >
              {t('editor.undo')}
            </ToolButton>
            <ToolButton
              icon="redo-2"
              isDisabled={!canRedo || readOnly}
              onPress={() => store.getState().redo()}
            >
              {t('editor.redo')}
            </ToolButton>
          </Stack>
        </Group>
        <Group label={t('editor.groups.arrange')}>
          <Stack>
            <ToolButton icon="bring-to-front" isDisabled={none} onPress={() => reorder(store, 'front')}>
              {t('editor.toFront')}
            </ToolButton>
            <ToolButton icon="send-to-back" isDisabled={none} onPress={() => reorder(store, 'back')}>
              {t('editor.toBack')}
            </ToolButton>
          </Stack>
          <Stack>
            <ToolButton
              icon="group"
              isDisabled={readOnly || selection.length < 2}
              onPress={() => group(store)}
            >
              {t('editor.group')}
            </ToolButton>
            <ToolButton icon="ungroup" isDisabled={none} onPress={() => ungroup(store)}>
              {t('editor.ungroup')}
            </ToolButton>
          </Stack>
        </Group>
        <Group label={t('editor.groups.align')} grid>
          <ToolButton
            icon="align-start-vertical"
            aria-label={t('editor.align.left')}
            isDisabled={none}
            onPress={() => align(store, 'left')}
          />
          <ToolButton
            icon="align-center-vertical"
            aria-label={t('editor.align.hcenter')}
            isDisabled={none}
            onPress={() => align(store, 'hcenter')}
          />
          <ToolButton
            icon="align-end-vertical"
            aria-label={t('editor.align.right')}
            isDisabled={none}
            onPress={() => align(store, 'right')}
          />
          <ToolButton
            icon="align-start-horizontal"
            aria-label={t('editor.align.top')}
            isDisabled={none}
            onPress={() => align(store, 'top')}
          />
          <ToolButton
            icon="align-center-horizontal"
            aria-label={t('editor.align.vcenter')}
            isDisabled={none}
            onPress={() => align(store, 'vcenter')}
          />
          <ToolButton
            icon="align-end-horizontal"
            aria-label={t('editor.align.bottom')}
            isDisabled={none}
            onPress={() => align(store, 'bottom')}
          />
        </Group>
        {view}
      </TabPanel>
      <TabPanel id="insert" className={styles.ribbonBody}>
        <Group label={t('editor.groups.insert')}>
          <ToolButton
            icon="type"
            large
            isDisabled={readOnly}
            onPress={() => insertText(store, t('editor.newText'))}
          >
            {t('editor.insert.text')}
          </ToolButton>
          <ToolButton icon="image" large isDisabled={readOnly} onPress={() => void insertImage(store)}>
            {t('editor.insert.image')}
          </ToolButton>
          <Stack>
            <ShapeMenu />
            <ToolButton icon="mouse-pointer-click" isDisabled={readOnly} onPress={() => insertHotspot(store)}>
              {t('editor.insert.hotspot')}
            </ToolButton>
          </Stack>
          <Stack>
            <ToolButton icon="video" isDisabled={readOnly} onPress={() => onVideo('file')}>
              {t('editor.insert.video')}
            </ToolButton>
            <ToolButton icon="music" isDisabled={readOnly} onPress={() => void insertAudio(store)}>
              {t('editor.insert.audio')}
            </ToolButton>
          </Stack>
          <ToolButton icon="monitor-up" large isDisabled={readOnly} onPress={() => onVideo('record')}>
            {t('editor.insert.screen')}
          </ToolButton>
        </Group>
        {view}
      </TabPanel>
      {editingText ? (
        <TabPanel id="text" className={styles.ribbonBody}>
          <TextTools />
        </TabPanel>
      ) : null}
      <TabPanel id="view" className={styles.ribbonBody}>
        {view}
      </TabPanel>
    </Tabs>
  );
}
