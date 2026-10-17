// SPDX-License-Identifier: Apache-2.0
import type { InteractionNode } from '@coursecraft/course-model';
import type { Draft } from 'immer';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Checkbox } from '../components/Field.js';
import { uploadFile } from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import { ListEditor, move, Row, TextInput } from './FormControls.js';
import {
  convertContent,
  entriesOf,
  INTERACTION_VARIANTS,
  markerPosition,
  newEntry,
  type InteractionContent,
  type InteractionVariant,
} from './interactionModel.js';
import { plainToRich, richToPlain } from './quizModel.js';
import { assetUrl } from './upload.js';
import styles from './Editor.module.css';

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml';
type DraftEntry = Draft<ReturnType<typeof entriesOf>[number]>;

function useInteractionChange(nodeId: string) {
  const store = useEditorStore();
  return (recipe: (node: Draft<InteractionNode>) => void, key = `node-${nodeId}`) =>
    store.getState().change((draft) => {
      const node = draft.nodes[nodeId];
      if (node?.kind === 'interaction') recipe(node);
    }, key);
}

/** The mutable entry list of the current variant (glossary has no generic entries). */
function draftEntries(content: Draft<InteractionContent>): DraftEntry[] | null {
  switch (content.variant) {
    case 'timeline':
      return content.events;
    case 'labeledGraphic':
      return content.markers;
    case 'glossary':
      return null;
    default:
      return content.items;
  }
}

function MarkerPlacer({ node, selected }: { node: InteractionNode; selected: number }) {
  const { t } = useTranslation();
  const courseId = useEditor((s) => s.courseId);
  const readOnly = useEditor((s) => s.readOnly);
  const change = useInteractionChange(node.id);
  const content = node.content;
  if (content.variant !== 'labeledGraphic') return null;
  return (
    <div
      className={styles.hotspotDrawer}
      role="group"
      aria-label={t('interaction.placeMarker')}
      onPointerDown={(e) => {
        if (readOnly) return;
        const r = e.currentTarget.getBoundingClientRect();
        const position = {
          x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
          y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
        };
        change((n) => {
          const marker = n.content.variant === 'labeledGraphic' ? n.content.markers[selected] : undefined;
          if (marker) marker.position = position;
        }, 'struct');
      }}
    >
      <img src={assetUrl(courseId, content.image.image.$asset)} alt="" draggable={false} />
      {content.markers.map((marker, i) => (
        <span
          key={marker.id}
          className={i === selected ? styles.markerSelected : styles.marker}
          style={{ left: `${marker.position.x * 100}%`, top: `${marker.position.y * 100}%` }}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}

/** Form editor for accordion, tabs, steps, cycle, timeline, glossary and labeled graphic. */
export function InteractionEditor({ node }: { node: InteractionNode }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const courseId = useEditor((s) => s.courseId);
  const readOnly = useEditor((s) => s.readOnly);
  const store = useEditorStore();
  const change = useInteractionChange(node.id);
  const [marker, setMarker] = useState(0);
  const loc = (v: Record<string, string> | undefined) => v?.[lang] ?? '';
  const content = node.content;
  const entries = entriesOf(content);
  const maxEntries =
    content.variant === 'glossary'
      ? 1000
      : content.variant === 'labeledGraphic'
        ? 30
        : content.variant === 'cycle'
          ? 12
          : 50;
  const minEntries = content.variant === 'cycle' ? 2 : 1;

  const switchVariant = async (variant: InteractionVariant) => {
    if (variant === content.variant) return;
    let image: { sha256: string; altText: string } | undefined;
    if (variant === 'labeledGraphic') {
      const sha = await uploadFile(store, IMAGE_TYPES);
      if (!sha) return;
      image = { sha256: sha, altText: '' };
    }
    change((n) => {
      n.content = convertContent(n.content, variant, lang, image);
    }, 'struct');
  };

  const addEntry = () =>
    change((n) => {
      const entry = newEntry(lang, `${t('interaction.entry')} ${entries.length + 1}`, '');
      const c = n.content;
      if (c.variant === 'glossary') c.terms.push({ id: entry.id, term: entry.title, definition: entry.body });
      else if (c.variant === 'timeline') c.events.push({ ...entry, dateLabel: { [lang]: '' } });
      else if (c.variant === 'labeledGraphic')
        c.markers.push({ ...entry, position: markerPosition(c.markers.length) });
      else c.items.push(entry);
    }, 'struct');

  const removeEntry = (i: number) =>
    change((n) => {
      const c = n.content;
      if (c.variant === 'glossary') c.terms.splice(i, 1);
      else draftEntries(c)?.splice(i, 1);
    }, 'struct');

  const moveEntry = (a: number, b: number) =>
    change((n) => {
      const c = n.content;
      if (c.variant === 'glossary') move(c.terms, a, b);
      else {
        const list = draftEntries(c);
        if (list) move(list, a, b);
      }
    }, 'struct');

  const updateEntry = (i: number, recipe: (e: DraftEntry) => void, key: string) =>
    change((n) => {
      const c = n.content;
      if (c.variant === 'glossary') {
        const term = c.terms[i];
        if (!term) return;
        const view: DraftEntry = { id: term.id, title: term.term, body: term.definition };
        recipe(view);
        term.term = view.title;
        term.definition = view.body;
      } else {
        const entry = draftEntries(c)?.[i];
        if (entry) recipe(entry);
      }
    }, `${key}-${i}`);

  return (
    <div className={styles.questionPane}>
      <div className={styles.form}>
        <Row label={t('editor.props.title')}>
          <TextInput
            label={t('editor.props.title')}
            value={loc(node.title)}
            onChange={(v) => change((n) => void (n.title[lang] = v), 'title')}
          />
        </Row>
        <Row label={t('interaction.variant')}>
          <select
            className={styles.select}
            aria-label={t('interaction.variant')}
            value={content.variant}
            disabled={readOnly}
            onChange={(e) => void switchVariant(e.target.value as InteractionVariant)}
          >
            {INTERACTION_VARIANTS.map((v) => (
              <option key={v} value={v}>
                {t(`interaction.variants.${v}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('interaction.intro')}>
          <TextInput
            label={t('interaction.intro')}
            multiline
            value={richToPlain(node.intro?.[lang])}
            onChange={(v) =>
              change((n) => {
                n.intro = { ...(n.intro ?? {}), [lang]: plainToRich(v) };
              }, 'intro')
            }
          />
        </Row>
        {content.variant !== 'glossary' ? (
          <Row label="">
            <Checkbox
              isSelected={node.requireAllViewed}
              isDisabled={readOnly}
              onChange={(v) => change((n) => void (n.requireAllViewed = v), 'struct')}
            >
              {t('interaction.requireAllViewed')}
            </Checkbox>
          </Row>
        ) : null}
        {content.variant === 'labeledGraphic' ? (
          <>
            <Row label={t('quiz.image')}>
              <MarkerPlacer node={node} selected={marker} />
              <p className={styles.hint}>{t('interaction.placeHint', { n: marker + 1 })}</p>
              <Button
                icon="image"
                isDisabled={readOnly}
                onPress={() =>
                  void uploadFile(store, IMAGE_TYPES).then(
                    (sha) =>
                      sha &&
                      change((n) => {
                        if (n.content.variant === 'labeledGraphic') n.content.image.image = { $asset: sha };
                      }, 'struct'),
                  )
                }
              >
                {t('editor.props.replaceImage')}
              </Button>
            </Row>
            <Row label={t('editor.props.altText')}>
              <TextInput
                label={t('editor.props.altText')}
                value={loc(content.image.altText)}
                onChange={(v) =>
                  change((n) => {
                    if (n.content.variant === 'labeledGraphic') n.content.image.altText[lang] = v;
                  }, 'alt')
                }
              />
            </Row>
          </>
        ) : null}
        <Row label={t(content.variant === 'glossary' ? 'interaction.terms' : 'interaction.entries')}>
          <ListEditor
            items={entries}
            min={minEntries}
            addLabel={t(content.variant === 'glossary' ? 'interaction.addTerm' : 'interaction.addEntry')}
            {...(entries.length < maxEntries ? { onAdd: addEntry } : {})}
            onRemove={removeEntry}
            onMove={moveEntry}
            render={(entry, i) => (
              <div className={styles.entryFields}>
                {content.variant === 'labeledGraphic' ? (
                  <Button icon="mouse-pointer-click" onPress={() => setMarker(i)}>
                    {t('interaction.marker', { n: i + 1 })}
                  </Button>
                ) : null}
                {content.variant === 'timeline' ? (
                  <TextInput
                    label={`${t('interaction.dateLabel')} ${i + 1}`}
                    value={loc(content.events[i]?.dateLabel)}
                    onChange={(v) =>
                      change((n) => {
                        const ev = n.content.variant === 'timeline' ? n.content.events[i] : undefined;
                        if (ev) ev.dateLabel[lang] = v;
                      }, `date-${i}`)
                    }
                  />
                ) : null}
                <TextInput
                  label={`${t(content.variant === 'glossary' ? 'interaction.term' : 'interaction.entryTitle')} ${i + 1}`}
                  value={loc(entry.title)}
                  onChange={(v) => updateEntry(i, (e) => void (e.title[lang] = v), 'title')}
                />
                <TextInput
                  label={`${t(content.variant === 'glossary' ? 'interaction.definition' : 'interaction.entryBody')} ${i + 1}`}
                  multiline
                  value={richToPlain(entry.body[lang])}
                  onChange={(v) => updateEntry(i, (e) => void (e.body[lang] = plainToRich(v)), 'body')}
                />
                {content.variant !== 'glossary' ? (
                  <div className={styles.inline}>
                    {entry.media ? (
                      <>
                        <img
                          className={styles.entryImage}
                          src={assetUrl(courseId, entry.media.image.$asset)}
                          alt=""
                        />
                        <TextInput
                          label={`${t('editor.props.altText')} ${i + 1}`}
                          value={loc(entry.media.altText)}
                          onChange={(v) =>
                            updateEntry(i, (e) => e.media && void (e.media.altText[lang] = v), 'alt')
                          }
                        />
                        <Button
                          icon="trash-2"
                          isDisabled={readOnly}
                          onPress={() => updateEntry(i, (e) => void delete e.media, 'struct')}
                        >
                          {t('interaction.removeImage')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        icon="image-plus"
                        isDisabled={readOnly}
                        onPress={() =>
                          void uploadFile(store, IMAGE_TYPES).then(
                            (sha) =>
                              sha &&
                              updateEntry(
                                i,
                                (e) => void (e.media = { image: { $asset: sha }, altText: { [lang]: '' } }),
                                'struct',
                              ),
                          )
                        }
                      >
                        {t('interaction.addImage')}
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          />
        </Row>
      </div>
    </div>
  );
}
