// SPDX-License-Identifier: Apache-2.0
import type { SlideElement, SlideNode } from '@coursecraft/course-model';
import type { Draft } from 'immer';
import { useTranslation } from 'react-i18next';
import { Button, ToggleTool, ToolButton } from '../components/Button.js';
import { Checkbox } from '../components/Field.js';
import { Icon } from '../components/Icon.js';
import { uploadFile } from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import { newId } from './ids.js';
import { slideOf } from './model.js';
import { QuizSettings } from './QuizEditor.js';
import { NarrationSection, SlideImageSection } from './Narration.js';
import { ColorInput, NumberInput, Row, Section } from './PropertyControls.js';
import styles from './Editor.module.css';

type Element = SlideElement;
type Action = Element['triggers'][number]['actions'][number];

function useUpdateElement(id: string) {
  const store = useEditorStore();
  return (recipe: (el: Draft<Element>) => void, key = `prop-${id}`) => {
    const { nodeId } = store.getState();
    if (!nodeId) return;
    store.getState().change((draft) => {
      const slide = draft.nodes[nodeId];
      if (slide?.kind !== 'slide') return;
      const el =
        slide.elements.find((e) => e.id === id) ??
        slide.layers.flatMap((l) => l.elements).find((e) => e.id === id);
      if (el) recipe(el);
    }, key);
  };
}

function ElementProperties({ element }: { element: Element }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const lang = useEditor((s) => s.lang);
  const slide = useEditor((s) => slideOf(s.course, s.nodeId));
  const update = useUpdateElement(element.id);
  const f = element.frame;

  return (
    <>
      <Section title={t('editor.props.general')}>
        <Row label={t('editor.props.name')}>
          <input
            className={styles.textInput}
            aria-label={t('editor.props.name')}
            value={element.name}
            onChange={(e) => update((el) => void (el.name = e.target.value))}
          />
        </Row>
        <Row label={t('editor.props.position')}>
          <div className={styles.pair}>
            <NumberInput
              label={`${t('editor.props.position')} X`}
              prefix="X"
              value={f.x}
              onChange={(v) => update((el) => void (el.frame.x = v))}
            />
            <NumberInput
              label={`${t('editor.props.position')} Y`}
              prefix="Y"
              value={f.y}
              onChange={(v) => update((el) => void (el.frame.y = v))}
            />
          </div>
        </Row>
        <Row label={t('editor.props.size')}>
          <div className={styles.pair}>
            <NumberInput
              label={t('editor.props.width')}
              prefix="B"
              min={8}
              value={f.width}
              onChange={(v) => update((el) => void (el.frame.width = v))}
            />
            <NumberInput
              label={t('editor.props.height')}
              prefix="H"
              min={8}
              value={f.height}
              onChange={(v) => update((el) => void (el.frame.height = v))}
            />
          </div>
        </Row>
        <Row label={t('editor.props.rotation')}>
          <NumberInput
            label={t('editor.props.rotation')}
            unit="°"
            min={-360}
            max={360}
            value={f.rotation}
            onChange={(v) => update((el) => void (el.frame.rotation = v))}
          />
        </Row>
        <Row label="">
          <div className={styles.checks}>
            <Checkbox isSelected={element.hidden} onChange={(v) => update((el) => void (el.hidden = v))}>
              {t('editor.props.hidden')}
            </Checkbox>
            <Checkbox isSelected={element.locked} onChange={(v) => update((el) => void (el.locked = v))}>
              {t('editor.props.locked')}
            </Checkbox>
          </div>
        </Row>
      </Section>

      {element.type === 'text' ? (
        <Section title={t('editor.props.text')}>
          <Row label={t('editor.props.font')}>
            <select
              className={styles.select}
              aria-label={t('editor.props.font')}
              value={element.style.font}
              onChange={(e) =>
                update((el) => el.type === 'text' && void (el.style.font = e.target.value as 'sans'))
              }
            >
              <option value="sans">{t('editor.props.fonts.sans')}</option>
              <option value="serif">{t('editor.props.fonts.serif')}</option>
              <option value="mono">{t('editor.props.fonts.mono')}</option>
            </select>
          </Row>
          <Row label={t('editor.props.fontSize')}>
            <NumberInput
              label={t('editor.props.fontSize')}
              unit="px"
              min={6}
              max={400}
              value={element.style.sizePx}
              onChange={(v) => update((el) => el.type === 'text' && void (el.style.sizePx = v))}
            />
          </Row>
          <Row label={t('editor.props.color')}>
            <ColorInput
              label={t('editor.props.color')}
              value={element.style.color}
              onChange={(v) =>
                update((el) => el.type === 'text' && void (el.style.color = v ?? 'theme:text'))
              }
            />
          </Row>
          <Row label={t('editor.props.verticalAlign')}>
            <select
              className={styles.select}
              aria-label={t('editor.props.verticalAlign')}
              value={element.style.verticalAlign}
              onChange={(e) =>
                update((el) => el.type === 'text' && void (el.style.verticalAlign = e.target.value as 'top'))
              }
            >
              <option value="top">{t('editor.props.top')}</option>
              <option value="middle">{t('editor.props.middle')}</option>
              <option value="bottom">{t('editor.props.bottom')}</option>
            </select>
          </Row>
          <Row label="">
            <Button onPress={() => store.getState().editText(element.id)}>
              {t('editor.props.editText')}
            </Button>
          </Row>
        </Section>
      ) : null}

      {element.type === 'shape' ? (
        <Section title={t('editor.props.appearance')}>
          <Row label={t('editor.props.shape')}>
            <select
              className={styles.select}
              aria-label={t('editor.props.shape')}
              value={element.shape}
              onChange={(e) =>
                update((el) => el.type === 'shape' && void (el.shape = e.target.value as 'rectangle'))
              }
            >
              {(['rectangle', 'ellipse', 'triangle', 'line', 'arrow'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`editor.shapes.${s}`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('editor.props.fill')}>
            <ColorInput
              label={t('editor.props.fill')}
              value={element.fill}
              onChange={(v) =>
                update((el) => {
                  if (el.type !== 'shape') return;
                  if (v) el.fill = v;
                  else delete el.fill;
                })
              }
            />
          </Row>
          <Row label={t('editor.props.stroke')}>
            <ColorInput
              label={t('editor.props.stroke')}
              value={element.stroke?.color}
              onChange={(v) =>
                update((el) => {
                  if (el.type !== 'shape') return;
                  if (v) el.stroke = { color: v, widthPx: el.stroke?.widthPx ?? 2 };
                  else delete el.stroke;
                })
              }
            />
          </Row>
          <Row label={t('editor.props.strokeWidth')}>
            <NumberInput
              label={t('editor.props.strokeWidth')}
              unit="px"
              min={0}
              max={100}
              value={element.stroke?.widthPx ?? 0}
              onChange={(v) =>
                update((el) => el.type === 'shape' && el.stroke && void (el.stroke.widthPx = v))
              }
            />
          </Row>
          <Row label="">
            <Button onPress={() => store.getState().editText(element.id)}>
              {t('editor.props.editLabel')}
            </Button>
          </Row>
        </Section>
      ) : null}

      {element.type === 'image' ? (
        <Section title={t('editor.props.image')}>
          <Row label={t('editor.props.fit')}>
            <select
              className={styles.select}
              aria-label={t('editor.props.fit')}
              value={element.fit}
              onChange={(e) =>
                update((el) => el.type === 'image' && void (el.fit = e.target.value as 'contain'))
              }
            >
              <option value="contain">{t('editor.props.fitContain')}</option>
              <option value="cover">{t('editor.props.fitCover')}</option>
              <option value="fill">{t('editor.props.fitFill')}</option>
            </select>
          </Row>
          <Row label="">
            <Button
              icon="image"
              onPress={() =>
                void uploadFile(store, 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml').then(
                  (sha) => sha && update((el) => el.type === 'image' && void (el.image = { $asset: sha })),
                )
              }
            >
              {t('editor.props.replaceImage')}
            </Button>
          </Row>
        </Section>
      ) : null}

      {element.type === 'video' || element.type === 'audio' ? (
        <Section title={t(element.type === 'video' ? 'editor.props.video' : 'editor.props.audio')}>
          <Row label={t('editor.props.mediaTitle')}>
            <input
              className={styles.textInput}
              aria-label={t('editor.props.mediaTitle')}
              value={element.title[lang] ?? ''}
              onChange={(e) =>
                update(
                  (el) =>
                    (el.type === 'video' || el.type === 'audio') && void (el.title[lang] = e.target.value),
                )
              }
            />
          </Row>
          <Row label="">
            <div className={styles.checks}>
              <Checkbox
                isSelected={element.autoplay}
                onChange={(v) =>
                  update((el) => (el.type === 'video' || el.type === 'audio') && void (el.autoplay = v))
                }
              >
                {t('editor.props.autoplay')}
              </Checkbox>
              <Checkbox
                isSelected={element.loop}
                onChange={(v) =>
                  update((el) => (el.type === 'video' || el.type === 'audio') && void (el.loop = v))
                }
              >
                {t('editor.props.loop')}
              </Checkbox>
              <Checkbox
                isSelected={element.controls}
                onChange={(v) =>
                  update((el) => (el.type === 'video' || el.type === 'audio') && void (el.controls = v))
                }
              >
                {t('editor.props.controls')}
              </Checkbox>
            </div>
          </Row>
          {element.type === 'video' ? (
            <Row label={t('editor.props.captions')}>
              <div className={styles.inline}>
                <span>
                  {element.captions[lang] ? t('editor.props.captionsSet') : t('editor.props.captionsMissing')}
                </span>
                <Button
                  onPress={() =>
                    void uploadFile(store, '.vtt,text/vtt').then(
                      (sha) =>
                        sha &&
                        update((el) => el.type === 'video' && void (el.captions[lang] = { $asset: sha })),
                    )
                  }
                >
                  {t('editor.props.uploadCaptions')}
                </Button>
              </div>
            </Row>
          ) : null}
        </Section>
      ) : null}

      {element.type === 'hotspot' ? (
        <Section title={t('editor.props.hotspot')}>
          <Row label={t('editor.props.hotspotLabel')}>
            <input
              className={styles.textInput}
              aria-label={t('editor.props.hotspotLabel')}
              value={element.label[lang] ?? ''}
              onChange={(e) =>
                update((el) => el.type === 'hotspot' && void (el.label[lang] = e.target.value))
              }
            />
          </Row>
          {!element.label[lang] ? (
            <p className={styles.hint}>{t('editor.props.hotspotLabelMissing')}</p>
          ) : null}
        </Section>
      ) : null}

      {element.type === 'image' || element.type === 'shape' ? (
        <Section title={t('editor.props.accessibility')}>
          <Row label={t('editor.props.altText')}>
            <textarea
              className={styles.textarea}
              aria-label={t('editor.props.altText')}
              value={element.altText?.[lang] ?? ''}
              disabled={element.decorative}
              onChange={(e) =>
                update(
                  (el) =>
                    (el.type === 'image' || el.type === 'shape') &&
                    void (el.altText = { ...(el.altText ?? {}), [lang]: e.target.value }),
                )
              }
            />
          </Row>
          <Row label="">
            <Checkbox
              isSelected={element.decorative}
              onChange={(v) =>
                update((el) => (el.type === 'image' || el.type === 'shape') && void (el.decorative = v))
              }
            >
              {t('editor.props.decorative')}
            </Checkbox>
          </Row>
          {!element.decorative && !element.altText?.[lang] ? (
            <p className={styles.hint}>{t('editor.props.altMissing')}</p>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('editor.props.animation')} open={false}>
        <Row label={t('editor.props.entrance')}>
          <select
            className={styles.select}
            aria-label={t('editor.props.entrance')}
            value={element.entrance?.effect ?? 'none'}
            onChange={(e) =>
              update((el) => {
                if (e.target.value === 'none') delete el.entrance;
                else
                  el.entrance = {
                    effect: e.target.value as 'fade',
                    durationMs: el.entrance?.durationMs ?? 400,
                    ...(e.target.value === 'fly' ? { direction: 'left' as const } : {}),
                  };
              })
            }
          >
            <option value="none">{t('editor.props.none')}</option>
            {(['fade', 'fly', 'wipe', 'zoom'] as const).map((fx) => (
              <option key={fx} value={fx}>
                {t(`editor.effects.${fx}`)}
              </option>
            ))}
          </select>
        </Row>
        {element.entrance ? (
          <Row label={t('editor.props.duration')}>
            <NumberInput
              label={t('editor.props.duration')}
              unit="ms"
              min={50}
              max={10000}
              value={element.entrance.durationMs}
              onChange={(v) => update((el) => el.entrance && void (el.entrance.durationMs = v))}
            />
          </Row>
        ) : null}
        <Row label={t('editor.props.appearAt')}>
          <NumberInput
            label={t('editor.props.appearAt')}
            unit="s"
            min={0}
            max={21600}
            value={element.timing.startMs / 1000}
            onChange={(v) => update((el) => void (el.timing.startMs = Math.round(v * 1000)))}
          />
        </Row>
        <Row label={t('editor.props.hideAt')}>
          <NumberInput
            label={t('editor.props.hideAt')}
            unit="s"
            min={0}
            max={21600}
            value={(element.timing.endMs ?? 0) / 1000}
            onChange={(v) =>
              update((el) => {
                const ms = Math.round(v * 1000);
                if (ms <= el.timing.startMs) delete el.timing.endMs;
                else el.timing.endMs = ms;
              })
            }
          />
        </Row>
      </Section>

      <Triggers element={element} slide={slide} />
    </>
  );
}

function Triggers({ element, slide }: { element: Element; slide: SlideNode | null }) {
  const { t } = useTranslation();
  const course = useEditor((s) => s.course);
  const lang = useEditor((s) => s.lang);
  const update = useUpdateElement(element.id);
  const others = slide?.elements.filter((e) => e.id !== element.id) ?? [];
  const nodes = course.structure.chapters
    .flatMap((c) => c.nodeIds)
    .map((id) => course.nodes[id])
    .filter((n) => n !== undefined);

  const actionValue = (a: Action): string => {
    switch (a.type) {
      case 'navigate':
        return a.target.type === 'node' ? `node:${a.target.nodeId}` : a.target.type;
      case 'showElement':
      case 'hideElement':
      case 'toggleElement':
        return `${a.type}:${a.elementId}`;
      case 'openLink':
        return 'openLink';
      default:
        return a.type;
    }
  };
  const parseAction = (value: string, previous?: Action): Action => {
    if (value === 'next' || value === 'previous' || value === 'finish')
      return { type: 'navigate', target: { type: value } };
    if (value.startsWith('node:'))
      return { type: 'navigate', target: { type: 'node', nodeId: value.slice(5) } };
    if (value === 'openLink')
      return { type: 'openLink', href: previous?.type === 'openLink' ? previous.href : 'https://' };
    const [type, elementId] = value.split(':') as ['showElement', string];
    return { type, elementId };
  };

  return (
    <Section
      title={`${t('editor.props.triggers')} (${element.triggers.length})`}
      open={element.triggers.length > 0}
    >
      {element.triggers.map((trigger, ti) => (
        <div key={trigger.id} className={styles.trigger}>
          <span className={styles.formLabel}>{t('editor.props.onClick')}</span>
          <div className={styles.formControl}>
            <div className={styles.inline}>
              <select
                className={styles.select}
                aria-label={t('editor.props.action')}
                value={trigger.actions[0] ? actionValue(trigger.actions[0]) : 'next'}
                onChange={(e) =>
                  update(
                    (el) =>
                      void (
                        el.triggers[ti] &&
                        (el.triggers[ti].actions = [parseAction(e.target.value, trigger.actions[0])])
                      ),
                    'trigger',
                  )
                }
              >
                <option value="next">{t('editor.actions.next')}</option>
                <option value="previous">{t('editor.actions.previous')}</option>
                <option value="finish">{t('editor.actions.finish')}</option>
                {nodes.map((n) => (
                  <option key={n.id} value={`node:${n.id}`}>
                    {t('editor.actions.goTo', { title: n.title[lang] ?? n.id })}
                  </option>
                ))}
                {others.flatMap((o) =>
                  (['showElement', 'hideElement', 'toggleElement'] as const).map((type) => (
                    <option key={`${type}${o.id}`} value={`${type}:${o.id}`}>
                      {t(`editor.actions.${type}`, { name: o.name })}
                    </option>
                  )),
                )}
                <option value="openLink">{t('editor.actions.openLink')}</option>
              </select>
              <ToolButton
                icon="trash-2"
                aria-label={t('editor.props.removeTrigger')}
                onPress={() => update((el) => void el.triggers.splice(ti, 1), 'trigger')}
              />
            </div>
            {trigger.actions[0]?.type === 'openLink' ? (
              <input
                className={styles.textInput}
                aria-label={t('editor.actions.url')}
                value={trigger.actions[0].href}
                onChange={(e) =>
                  update((el) => {
                    const action = el.triggers[ti]?.actions[0];
                    if (action?.type === 'openLink' && /^(https?:\/\/|mailto:)/i.test(e.target.value))
                      action.href = e.target.value;
                  }, 'trigger-url')
                }
              />
            ) : null}
          </div>
        </div>
      ))}
      <Row label="">
        <Button
          icon="plus"
          onPress={() =>
            update(
              (el) =>
                void el.triggers.push({
                  id: newId('t'),
                  event: { type: 'click' },
                  actions: [{ type: 'navigate', target: { type: 'next' } }],
                }),
              'trigger',
            )
          }
        >
          {t('editor.props.addTrigger')}
        </Button>
      </Row>
    </Section>
  );
}

function SlideProperties({ slide }: { slide: SlideNode }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const lang = useEditor((s) => s.lang);
  const update = (recipe: (s: Draft<SlideNode>) => void, key = `slide-${slide.id}`) =>
    store.getState().change((draft) => {
      const target = draft.nodes[slide.id];
      if (target?.kind === 'slide') recipe(target);
    }, key);
  return (
    <>
      <Section title={t('editor.props.slide')}>
        <Row label={t('editor.props.title')}>
          <input
            className={styles.textInput}
            aria-label={t('editor.props.title')}
            value={slide.title[lang] ?? ''}
            onChange={(e) => update((s) => void (s.title[lang] = e.target.value))}
          />
        </Row>
        <Row label={t('editor.props.background')}>
          <ColorInput
            label={t('editor.props.background')}
            value={slide.background.color}
            onChange={(v) =>
              update((s) => {
                if (v) s.background.color = v;
                else delete s.background.color;
              })
            }
          />
        </Row>
        <Row label={t('editor.props.advance')}>
          <select
            className={styles.select}
            aria-label={t('editor.props.advance')}
            value={slide.advance}
            onChange={(e) => update((s) => void (s.advance = e.target.value as 'manual'))}
          >
            <option value="manual">{t('editor.props.advanceManual')}</option>
            <option value="afterTimeline">{t('editor.props.advanceAuto')}</option>
          </select>
        </Row>
        <Row label={t('editor.props.slideDuration')}>
          <NumberInput
            label={t('editor.props.slideDuration')}
            unit="s"
            min={0}
            max={21600}
            value={(slide.durationMs ?? 0) / 1000}
            onChange={(v) => update((s) => void (s.durationMs = Math.round(v * 1000)))}
          />
        </Row>
      </Section>
      <NarrationSection slide={slide} />
      <SlideImageSection slide={slide} />
      <Section title={t('editor.props.notes')} open={false}>
        <Row label={t('editor.props.notes')}>
          <textarea
            className={styles.textarea}
            aria-label={t('editor.props.notes')}
            value={(slide.notes?.[lang]?.content ?? [])
              .map((b) =>
                b.type === 'paragraph'
                  ? (b.content ?? []).map((n) => (n.type === 'text' ? n.text : '\n')).join('')
                  : '',
              )
              .join('\n')}
            onChange={(e) =>
              update((s) => {
                const paragraphs = e.target.value.split('\n').map((line) => ({
                  type: 'paragraph' as const,
                  content: line ? [{ type: 'text' as const, text: line }] : [],
                }));
                s.notes = { ...(s.notes ?? {}), [lang]: { type: 'doc', content: paragraphs } };
              })
            }
          />
        </Row>
      </Section>
    </>
  );
}

/** Object list in stacking order (topmost first) with visibility and lock toggles. */
function ObjectList({ slide }: { slide: SlideNode }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const selection = useEditor((s) => s.selection);
  const toggle = (id: string, key: 'hidden' | 'locked') =>
    store.getState().change((draft) => {
      const s = draft.nodes[slide.id];
      const el = s?.kind === 'slide' ? s.elements.find((e) => e.id === id) : undefined;
      if (el) el[key] = !el[key];
    });
  return (
    <Section title={t('editor.props.objects')}>
      <ul className={styles.objectList} aria-label={t('editor.props.objects')}>
        {[...slide.elements].reverse().map((el) => (
          <li key={el.id} className={selection.includes(el.id) ? styles.objectSelected : ''}>
            <button
              type="button"
              className={styles.objectName}
              onClick={(e) => store.getState().select(e.shiftKey ? [...selection, el.id] : [el.id])}
            >
              <Icon name={ICONS[el.type]} />
              {el.name || t(`editor.types.${el.type}`)}
            </button>
            <ToggleTool
              icon={el.hidden ? 'eye-off' : 'eye'}
              aria-label={t('editor.props.hidden')}
              isSelected={el.hidden}
              onChange={() => toggle(el.id, 'hidden')}
            />
            <ToggleTool
              icon={el.locked ? 'lock' : 'lock-open'}
              aria-label={t('editor.props.locked')}
              isSelected={el.locked}
              onChange={() => toggle(el.id, 'locked')}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const ICONS: Record<Element['type'], string> = {
  text: 'type',
  image: 'image',
  shape: 'square',
  video: 'video',
  audio: 'music',
  hotspot: 'mouse-pointer-click',
  group: 'group',
};

export function Properties() {
  const { t } = useTranslation();
  const course = useEditor((s) => s.course);
  const nodeId = useEditor((s) => s.nodeId);
  const selection = useEditor((s) => s.selection);
  const slide = slideOf(course, nodeId);
  const node = nodeId ? course.nodes[nodeId] : undefined;
  const element =
    slide && selection.length === 1 ? slide.elements.find((e) => e.id === selection[0]) : undefined;
  return (
    <aside className={styles.panel} aria-label={t('editor.properties')}>
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>
          {t('editor.properties')}
          {element ? ` · ${t(`editor.types.${element.type}`)}` : ''}
        </span>
      </header>
      <div className={styles.panelBody}>
        {element ? <ElementProperties key={element.id} element={element} /> : null}
        {slide && selection.length > 1 ? (
          <p className={styles.hint}>{t('editor.props.multiple', { count: selection.length })}</p>
        ) : null}
        {slide && !selection.length ? <SlideProperties slide={slide} /> : null}
        {slide ? <ObjectList slide={slide} /> : null}
        {node?.kind === 'quiz' ? <QuizSettings quiz={node} /> : null}
      </div>
    </aside>
  );
}
