// SPDX-License-Identifier: Apache-2.0
import type { Question, QuizNode, SurveyNode } from '@lernwerk/course-model';
import type { Draft } from 'immer';
import { useState, type ReactNode } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { useTranslation } from 'react-i18next';
import { Button, ToolButton } from '../components/Button.js';
import { Checkbox } from '../components/Field.js';
import { uploadFile } from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import { newId } from './ids.js';
import {
  newHotspotQuestion,
  newQuestion,
  placeholders,
  plainToRich,
  QUESTION_TYPES,
  richToPlain,
  type QuestionType,
} from './quizModel.js';
import { assetUrl } from './upload.js';
import styles from './Editor.module.css';

type DraftQuestion = Draft<Question>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className={styles.formLabel}>{label}</span>
      <div className={styles.formControl}>{children}</div>
    </>
  );
}

function TextInput({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return multiline ? (
    <textarea
      className={styles.textarea}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input
      className={styles.textInput}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      className={styles.textInput}
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

/** Applies a change to the quiz/survey node; keyed so typing forms one undo step. */
function useNodeChange<T extends QuizNode | SurveyNode>(nodeId: string) {
  const store = useEditorStore();
  return (recipe: (node: Draft<T>) => void, key = `node-${nodeId}`) =>
    store.getState().change((draft) => {
      const node = draft.nodes[nodeId];
      if (node && (node.kind === 'quiz' || node.kind === 'survey')) recipe(node as Draft<T>);
    }, key);
}

function questionsOf(quiz: QuizNode | Draft<QuizNode>): (Question | DraftQuestion)[] {
  return quiz.items.flatMap((item) => (item.type === 'question' ? [item.question] : item.questions));
}

function findQuestion(quiz: Draft<QuizNode>, id: string): DraftQuestion | undefined {
  return questionsOf(quiz).find((q) => q.id === id);
}

function TypeMenu({ onPick, label }: { onPick: (type: QuestionType) => void; label: string }) {
  const { t } = useTranslation();
  const readOnly = useEditor((s) => s.readOnly);
  return (
    <MenuTrigger>
      <ToolButton icon="plus" isDisabled={readOnly}>
        {label}
      </ToolButton>
      <Popover className={styles.menuPopover} placement="bottom start">
        <Menu className={styles.menu} onAction={(key) => onPick(key as QuestionType)}>
          {QUESTION_TYPES.map((type) => (
            <MenuItem key={type} id={type} className={styles.menuItem}>
              {t(`quiz.types.${type}`)}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** Rows editor for lists (choices, pairs, items) with add/remove/move. */
function ListEditor<T>({
  items,
  render,
  onAdd,
  onRemove,
  onMove,
  addLabel,
  min = 1,
}: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
  onAdd?: () => void;
  onRemove: (index: number) => void;
  onMove?: (from: number, to: number) => void;
  addLabel: string;
  min?: number;
}) {
  const { t } = useTranslation();
  const readOnly = useEditor((s) => s.readOnly);
  return (
    <div className={styles.listEditor}>
      {items.map((item, i) => (
        <div className={styles.listRow} key={i}>
          <div className={styles.listRowMain}>{render(item, i)}</div>
          {onMove ? (
            <>
              <ToolButton
                icon="chevron-up"
                aria-label={t('editor.moveUp')}
                isDisabled={readOnly || i === 0}
                onPress={() => onMove(i, i - 1)}
              />
              <ToolButton
                icon="chevron-down"
                aria-label={t('editor.moveDown')}
                isDisabled={readOnly || i === items.length - 1}
                onPress={() => onMove(i, i + 1)}
              />
            </>
          ) : null}
          <ToolButton
            icon="trash-2"
            aria-label={t('editor.delete')}
            isDisabled={readOnly || items.length <= min}
            onPress={() => onRemove(i)}
          />
        </div>
      ))}
      {onAdd ? (
        <div>
          <Button icon="plus" isDisabled={readOnly} onPress={onAdd}>
            {addLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function move<T>(list: T[], from: number, to: number) {
  const [item] = list.splice(from, 1);
  if (item !== undefined) list.splice(to, 0, item);
}

/** Keeps blank definitions in sync with the {{placeholders}} of all templates. */
function syncBlanks(q: DraftQuestion, lang: string): void {
  if (q.type !== 'fillInBlanks' && q.type !== 'selectBlanks' && q.type !== 'wordBank') return;
  const used = new Set(Object.values(q.template).flatMap((tpl) => placeholders(tpl)));
  const present = new Set(q.blanks.map((b) => b.id));
  for (const id of placeholders(q.template[lang] ?? '')) {
    if (present.has(id)) continue;
    present.add(id);
    if (q.type === 'fillInBlanks') q.blanks.push({ id, accepted: { [lang]: ['…'] }, caseSensitive: false });
    if (q.type === 'selectBlanks')
      q.blanks.push({
        id,
        options: [
          { id: newId('o'), text: { [lang]: '…' }, correct: true },
          { id: newId('o'), text: { [lang]: '…' }, correct: false },
        ],
      });
    if (q.type === 'wordBank') q.blanks.push({ id, wordId: q.words[0]?.id ?? '' });
  }
  if (used.size) {
    const keep = (b: { id: string }) => used.has(b.id);
    if (q.type === 'fillInBlanks') q.blanks = q.blanks.filter(keep);
    if (q.type === 'selectBlanks') q.blanks = q.blanks.filter(keep);
    if (q.type === 'wordBank') q.blanks = q.blanks.filter(keep);
  }
}

function TypeFields({
  question,
  update,
}: {
  question: Question;
  update: (recipe: (q: DraftQuestion) => void, key?: string) => void;
}) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const store = useEditorStore();
  const courseId = useEditor((s) => s.courseId);
  const loc = (v: Record<string, string>) => v[lang] ?? '';
  const q = question;

  switch (q.type) {
    case 'singleChoice':
    case 'multipleChoice':
      return (
        <>
          <Row label={t('quiz.choices')}>
            <ListEditor
              items={q.choices}
              min={2}
              addLabel={t('quiz.addChoice')}
              onAdd={() =>
                update(
                  (d) =>
                    d.type === q.type &&
                    void d.choices.push({ id: newId('o'), text: { [lang]: '' }, correct: false }),
                  'struct',
                )
              }
              onRemove={(i) => update((d) => d.type === q.type && void d.choices.splice(i, 1), 'struct')}
              onMove={(a, b) => update((d) => d.type === q.type && move(d.choices, a, b), 'struct')}
              render={(choice, i) => (
                <div className={styles.inline}>
                  <input
                    type={q.type === 'singleChoice' ? 'radio' : 'checkbox'}
                    name={`correct-${q.id}`}
                    aria-label={t('quiz.correctChoice', { n: i + 1 })}
                    checked={choice.correct}
                    onChange={(e) =>
                      update((d) => {
                        if (d.type !== q.type) return;
                        if (d.type === 'singleChoice') d.choices.forEach((c, j) => (c.correct = j === i));
                        else if (d.choices[i]) d.choices[i].correct = e.target.checked;
                      }, 'struct')
                    }
                  />
                  <TextInput
                    label={t('quiz.choiceText', { n: i + 1 })}
                    value={loc(choice.text)}
                    onChange={(v) =>
                      update(
                        (d) => d.type === q.type && d.choices[i] && void (d.choices[i].text[lang] = v),
                        `choice-${i}`,
                      )
                    }
                  />
                </div>
              )}
            />
          </Row>
          <Row label="">
            <Checkbox
              isSelected={q.shuffle}
              onChange={(v) => update((d) => d.type === q.type && void (d.shuffle = v))}
            >
              {t('quiz.shuffle')}
            </Checkbox>
          </Row>
        </>
      );
    case 'trueFalse':
      return (
        <Row label={t('quiz.correctAnswer')}>
          <select
            className={styles.select}
            aria-label={t('quiz.correctAnswer')}
            value={String(q.correct)}
            onChange={(e) =>
              update((d) => d.type === 'trueFalse' && void (d.correct = e.target.value === 'true'))
            }
          >
            <option value="true">{t('quiz.true')}</option>
            <option value="false">{t('quiz.false')}</option>
          </select>
        </Row>
      );
    case 'shortAnswer':
      return (
        <>
          <Row label={t('quiz.acceptedAnswers')}>
            <TextInput
              multiline
              label={t('quiz.acceptedAnswers')}
              value={(q.accepted[lang] ?? []).join('\n')}
              onChange={(v) =>
                update(
                  (d) =>
                    d.type === 'shortAnswer' &&
                    void (d.accepted[lang] = v
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean)),
                )
              }
            />
          </Row>
          <Row label="">
            <Checkbox
              isSelected={q.caseSensitive}
              onChange={(v) => update((d) => d.type === 'shortAnswer' && void (d.caseSensitive = v))}
            >
              {t('quiz.caseSensitive')}
            </Checkbox>
          </Row>
        </>
      );
    case 'numeric':
      return (
        <Row label={t('quiz.acceptedValues')}>
          <ListEditor
            items={q.accepted}
            addLabel={t('quiz.addValue')}
            onAdd={() =>
              update(
                (d) => d.type === 'numeric' && void d.accepted.push({ type: 'range', min: 0, max: 10 }),
                'struct',
              )
            }
            onRemove={(i) => update((d) => d.type === 'numeric' && void d.accepted.splice(i, 1), 'struct')}
            render={(a, i) =>
              a.type === 'exact' ? (
                <div className={styles.pair}>
                  <NumberInput
                    label={t('quiz.value')}
                    value={a.value}
                    step={0.01}
                    onChange={(v) =>
                      update((d) => {
                        const x = d.type === 'numeric' ? d.accepted[i] : undefined;
                        if (x?.type === 'exact') x.value = v ?? 0;
                      })
                    }
                  />
                  <NumberInput
                    label={t('quiz.tolerance')}
                    value={a.tolerance}
                    min={0}
                    step={0.01}
                    onChange={(v) =>
                      update((d) => {
                        const x = d.type === 'numeric' ? d.accepted[i] : undefined;
                        if (x?.type === 'exact') x.tolerance = v ?? 0;
                      })
                    }
                  />
                </div>
              ) : (
                <div className={styles.pair}>
                  <NumberInput
                    label={t('quiz.min')}
                    value={a.min}
                    step={0.01}
                    onChange={(v) =>
                      update((d) => {
                        const x = d.type === 'numeric' ? d.accepted[i] : undefined;
                        if (x?.type === 'range') x.min = v ?? 0;
                      })
                    }
                  />
                  <NumberInput
                    label={t('quiz.max')}
                    value={a.max}
                    step={0.01}
                    onChange={(v) =>
                      update((d) => {
                        const x = d.type === 'numeric' ? d.accepted[i] : undefined;
                        if (x?.type === 'range') x.max = v ?? 0;
                      })
                    }
                  />
                </div>
              )
            }
          />
        </Row>
      );
    case 'essay':
      return (
        <>
          <Row label={t('quiz.maxLength')}>
            <NumberInput
              label={t('quiz.maxLength')}
              value={q.maxLength}
              min={1}
              max={50000}
              onChange={(v) => update((d) => d.type === 'essay' && void (d.maxLength = v ?? 5000))}
            />
          </Row>
          <Row label={t('quiz.gradingNotes')}>
            <TextInput
              multiline
              label={t('quiz.gradingNotes')}
              value={richToPlain(q.gradingNotes?.[lang])}
              onChange={(v) =>
                update(
                  (d) =>
                    d.type === 'essay' &&
                    void (d.gradingNotes = { ...(d.gradingNotes ?? {}), [lang]: plainToRich(v) }),
                )
              }
            />
          </Row>
        </>
      );
    case 'matching':
      return (
        <>
          <Row label={t('quiz.pairs')}>
            <ListEditor
              items={q.pairs}
              min={2}
              addLabel={t('quiz.addPair')}
              onAdd={() =>
                update(
                  (d) =>
                    d.type === 'matching' &&
                    void d.pairs.push({ id: newId('p'), left: { [lang]: '' }, right: { [lang]: '' } }),
                  'struct',
                )
              }
              onRemove={(i) => update((d) => d.type === 'matching' && void d.pairs.splice(i, 1), 'struct')}
              render={(pair, i) => (
                <div className={styles.pair}>
                  <TextInput
                    label={t('quiz.left', { n: i + 1 })}
                    value={loc(pair.left)}
                    onChange={(v) =>
                      update(
                        (d) => d.type === 'matching' && d.pairs[i] && void (d.pairs[i].left[lang] = v),
                        `pl-${i}`,
                      )
                    }
                  />
                  <TextInput
                    label={t('quiz.right', { n: i + 1 })}
                    value={loc(pair.right)}
                    onChange={(v) =>
                      update(
                        (d) => d.type === 'matching' && d.pairs[i] && void (d.pairs[i].right[lang] = v),
                        `pr-${i}`,
                      )
                    }
                  />
                </div>
              )}
            />
          </Row>
          <Row label={t('quiz.distractors')}>
            <ListEditor
              items={q.distractors}
              min={0}
              addLabel={t('quiz.addDistractor')}
              onAdd={() =>
                update(
                  (d) =>
                    d.type === 'matching' &&
                    void d.distractors.push({ id: newId('x'), text: { [lang]: '' } }),
                  'struct',
                )
              }
              onRemove={(i) =>
                update((d) => d.type === 'matching' && void d.distractors.splice(i, 1), 'struct')
              }
              render={(x, i) => (
                <TextInput
                  label={t('quiz.distractor', { n: i + 1 })}
                  value={loc(x.text)}
                  onChange={(v) =>
                    update(
                      (d) =>
                        d.type === 'matching' && d.distractors[i] && void (d.distractors[i].text[lang] = v),
                      `dx-${i}`,
                    )
                  }
                />
              )}
            />
          </Row>
        </>
      );
    case 'sequence':
      return (
        <Row label={t('quiz.correctOrder')}>
          <ListEditor
            items={q.items}
            min={2}
            addLabel={t('quiz.addItem')}
            onAdd={() =>
              update(
                (d) => d.type === 'sequence' && void d.items.push({ id: newId('i'), text: { [lang]: '' } }),
                'struct',
              )
            }
            onRemove={(i) => update((d) => d.type === 'sequence' && void d.items.splice(i, 1), 'struct')}
            onMove={(a, b) => update((d) => d.type === 'sequence' && move(d.items, a, b), 'struct')}
            render={(item, i) => (
              <TextInput
                label={t('quiz.item', { n: i + 1 })}
                value={loc(item.text)}
                onChange={(v) =>
                  update(
                    (d) => d.type === 'sequence' && d.items[i] && void (d.items[i].text[lang] = v),
                    `it-${i}`,
                  )
                }
              />
            )}
          />
        </Row>
      );
    case 'fillInBlanks':
    case 'selectBlanks':
    case 'wordBank':
      return (
        <>
          <Row label={t('quiz.template')}>
            <TextInput
              multiline
              label={t('quiz.template')}
              value={q.template[lang] ?? ''}
              onChange={(v) =>
                update((d) => {
                  if (d.type !== q.type) return;
                  d.template[lang] = v;
                  syncBlanks(d, lang);
                }, 'template')
              }
            />
            <p className={styles.fieldHint}>{t('quiz.templateHint')}</p>
            <Button
              onPress={() =>
                update((d) => {
                  if (d.type !== q.type) return;
                  const used = new Set(d.blanks.map((b) => b.id));
                  let n = d.blanks.length + 1;
                  while (used.has(`b${n}`)) n += 1;
                  d.template[lang] = `${d.template[lang] ?? ''} {{b${n}}}`;
                  syncBlanks(d, lang);
                }, 'struct')
              }
            >
              {t('quiz.insertBlank')}
            </Button>
          </Row>
          {q.type === 'wordBank' ? (
            <Row label={t('quiz.words')}>
              <ListEditor
                items={q.words}
                addLabel={t('quiz.addWord')}
                onAdd={() =>
                  update(
                    (d) =>
                      d.type === 'wordBank' && void d.words.push({ id: newId('w'), text: { [lang]: '' } }),
                    'struct',
                  )
                }
                onRemove={(i) => update((d) => d.type === 'wordBank' && void d.words.splice(i, 1), 'struct')}
                render={(w, i) => (
                  <TextInput
                    label={t('quiz.word', { n: i + 1 })}
                    value={loc(w.text)}
                    onChange={(v) =>
                      update(
                        (d) => d.type === 'wordBank' && d.words[i] && void (d.words[i].text[lang] = v),
                        `w-${i}`,
                      )
                    }
                  />
                )}
              />
            </Row>
          ) : null}
          {q.blanks.map((blank, bi) => (
            <Row key={blank.id} label={`${t('quiz.blank')} ${blank.id}`}>
              {q.type === 'fillInBlanks' && 'accepted' in blank ? (
                <TextInput
                  label={t('quiz.acceptedAnswers')}
                  value={(blank.accepted[lang] ?? []).join(', ')}
                  onChange={(v) =>
                    update((d) => {
                      const b = d.type === 'fillInBlanks' ? d.blanks[bi] : undefined;
                      if (b)
                        b.accepted[lang] = v
                          .split(',')
                          .map((x) => x.trim())
                          .filter(Boolean);
                    }, `blank-${bi}`)
                  }
                />
              ) : q.type === 'selectBlanks' && 'options' in blank ? (
                <ListEditor
                  items={blank.options}
                  min={2}
                  addLabel={t('quiz.addChoice')}
                  onAdd={() =>
                    update((d) => {
                      const b = d.type === 'selectBlanks' ? d.blanks[bi] : undefined;
                      b?.options.push({ id: newId('o'), text: { [lang]: '' }, correct: false });
                    }, 'struct')
                  }
                  onRemove={(i) =>
                    update((d) => {
                      const b = d.type === 'selectBlanks' ? d.blanks[bi] : undefined;
                      b?.options.splice(i, 1);
                    }, 'struct')
                  }
                  render={(o, i) => (
                    <div className={styles.inline}>
                      <input
                        type="radio"
                        name={`blank-${q.id}-${blank.id}`}
                        aria-label={t('quiz.correctChoice', { n: i + 1 })}
                        checked={o.correct}
                        onChange={() =>
                          update((d) => {
                            const b = d.type === 'selectBlanks' ? d.blanks[bi] : undefined;
                            b?.options.forEach((x, j) => (x.correct = j === i));
                          }, 'struct')
                        }
                      />
                      <TextInput
                        label={t('quiz.choiceText', { n: i + 1 })}
                        value={loc(o.text)}
                        onChange={(v) =>
                          update((d) => {
                            const x = d.type === 'selectBlanks' ? d.blanks[bi]?.options[i] : undefined;
                            if (x) x.text[lang] = v;
                          }, `bo-${bi}-${i}`)
                        }
                      />
                    </div>
                  )}
                />
              ) : q.type === 'wordBank' && 'wordId' in blank ? (
                <select
                  className={styles.select}
                  aria-label={t('quiz.correctWord')}
                  value={blank.wordId}
                  onChange={(e) =>
                    update((d) => {
                      const b = d.type === 'wordBank' ? d.blanks[bi] : undefined;
                      if (b) b.wordId = e.target.value;
                    })
                  }
                >
                  {q.words.map((w) => (
                    <option key={w.id} value={w.id}>
                      {loc(w.text) || w.id}
                    </option>
                  ))}
                </select>
              ) : null}
            </Row>
          ))}
        </>
      );
    case 'dragDrop':
      return (
        <>
          <Row label={t('quiz.zones')}>
            <ListEditor
              items={q.zones}
              addLabel={t('quiz.addZone')}
              onAdd={() =>
                update(
                  (d) =>
                    d.type === 'dragDrop' &&
                    void d.zones.push({
                      id: newId('z'),
                      frame: { x: 20, y: 260, width: 360, height: 160, rotation: 0 },
                      label: { [lang]: '' },
                    }),
                  'struct',
                )
              }
              onRemove={(i) =>
                update((d) => {
                  if (d.type !== 'dragDrop') return;
                  const [removed] = d.zones.splice(i, 1);
                  for (const item of d.items)
                    item.correctZoneIds = item.correctZoneIds.filter((z) => z !== removed?.id);
                }, 'struct')
              }
              render={(zone, i) => (
                <div className={styles.zoneRow}>
                  <TextInput
                    label={t('quiz.zone', { n: i + 1 })}
                    value={loc(zone.label)}
                    onChange={(v) =>
                      update(
                        (d) => d.type === 'dragDrop' && d.zones[i] && void (d.zones[i].label[lang] = v),
                        `z-${i}`,
                      )
                    }
                  />
                  {(['x', 'y', 'width', 'height'] as const).map((k) => (
                    <NumberInput
                      key={k}
                      label={t(`quiz.frame.${k}`)}
                      value={zone.frame[k]}
                      min={k === 'width' || k === 'height' ? 20 : 0}
                      onChange={(v) =>
                        update(
                          (d) => d.type === 'dragDrop' && d.zones[i] && void (d.zones[i].frame[k] = v ?? 0),
                          `zf-${i}`,
                        )
                      }
                    />
                  ))}
                </div>
              )}
            />
          </Row>
          <Row label={t('quiz.dragItems')}>
            <ListEditor
              items={q.items}
              addLabel={t('quiz.addItem')}
              onAdd={() =>
                update(
                  (d) =>
                    d.type === 'dragDrop' &&
                    void d.items.push({
                      id: newId('d'),
                      content: { type: 'text', text: { [lang]: '' } },
                      correctZoneIds: [],
                    }),
                  'struct',
                )
              }
              onRemove={(i) => update((d) => d.type === 'dragDrop' && void d.items.splice(i, 1), 'struct')}
              render={(item, i) => (
                <div className={styles.inline}>
                  {item.content.type === 'text' ? (
                    <TextInput
                      label={t('quiz.item', { n: i + 1 })}
                      value={loc(item.content.text)}
                      onChange={(v) =>
                        update((d) => {
                          const c = d.type === 'dragDrop' ? d.items[i]?.content : undefined;
                          if (c?.type === 'text') c.text[lang] = v;
                        }, `di-${i}`)
                      }
                    />
                  ) : null}
                  <select
                    className={styles.select}
                    aria-label={t('quiz.correctZone', { n: i + 1 })}
                    value={item.correctZoneIds[0] ?? ''}
                    onChange={(e) =>
                      update((d) => {
                        const it = d.type === 'dragDrop' ? d.items[i] : undefined;
                        if (it) it.correctZoneIds = e.target.value ? [e.target.value] : [];
                      })
                    }
                  >
                    <option value="">{t('quiz.noZone')}</option>
                    {q.zones.map((z, zi) => (
                      <option key={z.id} value={z.id}>
                        {loc(z.label) || t('quiz.zone', { n: zi + 1 })}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            />
          </Row>
        </>
      );
    case 'hotspot':
      return (
        <>
          <Row label={t('quiz.image')}>
            <HotspotDrawer question={q} courseId={courseId} update={update} />
            <Button
              icon="image"
              onPress={() =>
                void uploadFile(store, 'image/png,image/jpeg,image/webp,image/svg+xml').then(
                  (sha) =>
                    sha && update((d) => d.type === 'hotspot' && void (d.image.image = { $asset: sha })),
                )
              }
            >
              {t('editor.props.replaceImage')}
            </Button>
          </Row>
          <Row label={t('editor.props.altText')}>
            <TextInput
              label={t('editor.props.altText')}
              value={loc(q.image.altText)}
              onChange={(v) => update((d) => d.type === 'hotspot' && void (d.image.altText[lang] = v), 'alt')}
            />
          </Row>
          <Row label={t('quiz.areas')}>
            <ListEditor
              items={q.areas}
              addLabel={t('quiz.drawHint')}
              onRemove={(i) => update((d) => d.type === 'hotspot' && void d.areas.splice(i, 1), 'struct')}
              render={(area, i) => (
                <div className={styles.inline}>
                  <input
                    type="checkbox"
                    aria-label={t('quiz.correctChoice', { n: i + 1 })}
                    checked={area.correct}
                    onChange={(e) =>
                      update(
                        (d) =>
                          d.type === 'hotspot' && d.areas[i] && void (d.areas[i].correct = e.target.checked),
                      )
                    }
                  />
                  <TextInput
                    label={t('quiz.areaLabel', { n: i + 1 })}
                    value={loc(area.label)}
                    onChange={(v) =>
                      update(
                        (d) => d.type === 'hotspot' && d.areas[i] && void (d.areas[i].label[lang] = v),
                        `a-${i}`,
                      )
                    }
                  />
                </div>
              )}
            />
          </Row>
          <Row label="">
            <Checkbox
              isSelected={q.multiple}
              onChange={(v) => update((d) => d.type === 'hotspot' && void (d.multiple = v))}
            >
              {t('quiz.multipleAreas')}
            </Checkbox>
          </Row>
        </>
      );
    case 'likert':
      return (
        <>
          <Row label={t('quiz.statements')}>
            <ListEditor
              items={q.statements}
              addLabel={t('quiz.addStatement')}
              onAdd={() =>
                update(
                  (d) =>
                    d.type === 'likert' && void d.statements.push({ id: newId('s'), text: { [lang]: '' } }),
                  'struct',
                )
              }
              onRemove={(i) => update((d) => d.type === 'likert' && void d.statements.splice(i, 1), 'struct')}
              render={(st, i) => (
                <TextInput
                  label={t('quiz.statement', { n: i + 1 })}
                  value={loc(st.text)}
                  onChange={(v) =>
                    update(
                      (d) => d.type === 'likert' && d.statements[i] && void (d.statements[i].text[lang] = v),
                      `st-${i}`,
                    )
                  }
                />
              )}
            />
          </Row>
          <Row label={t('quiz.scale')}>
            <ListEditor
              items={q.scale}
              min={2}
              addLabel={t('quiz.addScale')}
              onAdd={() =>
                update(
                  (d) => d.type === 'likert' && void d.scale.push({ id: newId('l'), label: { [lang]: '' } }),
                  'struct',
                )
              }
              onRemove={(i) => update((d) => d.type === 'likert' && void d.scale.splice(i, 1), 'struct')}
              render={(p, i) => (
                <TextInput
                  label={t('quiz.scalePoint', { n: i + 1 })}
                  value={loc(p.label)}
                  onChange={(v) =>
                    update(
                      (d) => d.type === 'likert' && d.scale[i] && void (d.scale[i].label[lang] = v),
                      `sc-${i}`,
                    )
                  }
                />
              )}
            />
          </Row>
        </>
      );
  }
}

/** Draw hotspot areas by dragging on the image. */
function HotspotDrawer({
  question,
  courseId,
  update,
}: {
  question: Extract<Question, { type: 'hotspot' }>;
  courseId: string;
  update: (recipe: (q: DraftQuestion) => void, key?: string) => void;
}) {
  const lang = useEditor((s) => s.lang);
  const readOnly = useEditor((s) => s.readOnly);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const point = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  return (
    <div
      className={styles.hotspotDrawer}
      onPointerDown={(e) => {
        if (readOnly) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setStart(point(e));
        setCurrent(point(e));
      }}
      onPointerMove={(e) => start && setCurrent(point(e))}
      onPointerUp={() => {
        if (
          start &&
          current &&
          Math.abs(current.x - start.x) > 0.02 &&
          Math.abs(current.y - start.y) > 0.02
        ) {
          const tl = { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) };
          const br = { x: Math.max(start.x, current.x), y: Math.max(start.y, current.y) };
          update(
            (d) =>
              d.type === 'hotspot' &&
              void d.areas.push({
                id: newId('h'),
                shape: { type: 'rectangle', topLeft: tl, bottomRight: br },
                label: { [lang]: '' },
                correct: false,
              }),
            'struct',
          );
        }
        setStart(null);
        setCurrent(null);
      }}
    >
      <img src={assetUrl(courseId, question.image.image.$asset)} alt="" draggable={false} />
      {question.areas.map((area, i) => {
        const s = area.shape;
        const box =
          s.type === 'rectangle'
            ? {
                l: s.topLeft.x,
                t: s.topLeft.y,
                w: s.bottomRight.x - s.topLeft.x,
                h: s.bottomRight.y - s.topLeft.y,
              }
            : s.type === 'ellipse'
              ? { l: s.center.x - s.rx, t: s.center.y - s.ry, w: s.rx * 2, h: s.ry * 2 }
              : { l: 0, t: 0, w: 0, h: 0 };
        return (
          <span
            key={area.id}
            className={area.correct ? styles.areaCorrect : styles.area}
            style={{
              left: `${box.l * 100}%`,
              top: `${box.t * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          >
            {i + 1}
          </span>
        );
      })}
      {start && current ? (
        <span
          className={styles.area}
          style={{
            left: `${Math.min(start.x, current.x) * 100}%`,
            top: `${Math.min(start.y, current.y) * 100}%`,
            width: `${Math.abs(current.x - start.x) * 100}%`,
            height: `${Math.abs(current.y - start.y) * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

function QuestionForm({ quizId, question }: { quizId: string; question: Question }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const course = useEditor((s) => s.course);
  const change = useNodeChange<QuizNode>(quizId);
  const update = (recipe: (q: DraftQuestion) => void, key = `q-${question.id}`) =>
    change((quiz) => {
      const q = findQuestion(quiz, question.id);
      if (q) recipe(q);
    }, key);
  const nodes = course.structure.chapters
    .flatMap((c) => c.nodeIds)
    .map((id) => course.nodes[id])
    .filter((n) => n !== undefined);
  const graded = question.type !== 'likert';

  const branchSelect = (which: 'onCorrect' | 'onIncorrect') => {
    if (!graded) return null;
    const branch = question.branching?.[which];
    const value = !branch ? '' : branch.type === 'node' ? `node:${branch.nodeId}` : branch.type;
    return (
      <select
        className={styles.select}
        aria-label={t(`quiz.${which}`)}
        value={value}
        onChange={(e) =>
          update((q) => {
            if (q.type === 'likert') return;
            const v = e.target.value;
            const target =
              v === ''
                ? undefined
                : v.startsWith('node:')
                  ? { type: 'node' as const, nodeId: v.slice(5) }
                  : { type: v as 'next' | 'finish' };
            const next = { ...(q.branching ?? {}) };
            if (target) next[which] = target;
            else delete next[which];
            q.branching = next;
          })
        }
      >
        <option value="">{t('quiz.branchNone')}</option>
        <option value="finish">{t('quiz.branchFinish')}</option>
        {nodes.map((n) => (
          <option key={n.id} value={`node:${n.id}`}>
            {t('editor.actions.goTo', { title: n.title[lang] ?? n.id })}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className={styles.form}>
      <Row label={t('quiz.type')}>
        <strong>{t(`quiz.types.${question.type}`)}</strong>
      </Row>
      <Row label={t('quiz.prompt')}>
        <TextInput
          multiline
          label={t('quiz.prompt')}
          value={richToPlain(question.prompt[lang])}
          onChange={(v) => update((q) => void (q.prompt[lang] = plainToRich(v)))}
        />
      </Row>
      <TypeFields question={question} update={update} />
      {graded ? (
        <>
          <Row label={t('quiz.points')}>
            <div className={styles.pair}>
              <NumberInput
                label={t('quiz.points')}
                value={question.points}
                min={0}
                max={1000}
                onChange={(v) => update((q) => q.type !== 'likert' && void (q.points = v ?? 0))}
              />
              <NumberInput
                label={t('quiz.attemptsPerQuestion')}
                value={question.attempts}
                min={1}
                max={10}
                onChange={(v) => update((q) => q.type !== 'likert' && void (q.attempts = v ?? 1))}
              />
            </div>
          </Row>
          <Row label={t('quiz.scoring')}>
            <select
              className={styles.select}
              aria-label={t('quiz.scoring')}
              value={question.scoring}
              onChange={(e) =>
                update((q) => q.type !== 'likert' && void (q.scoring = e.target.value as 'partial'))
              }
            >
              <option value="allOrNothing">{t('quiz.allOrNothing')}</option>
              <option value="partial">{t('quiz.partialCredit')}</option>
            </select>
          </Row>
          <Row label={t('quiz.questionTime')}>
            <NumberInput
              label={t('quiz.questionTime')}
              value={question.timeLimitSec}
              min={5}
              max={7200}
              onChange={(v) =>
                update((q) => {
                  if (q.type === 'likert') return;
                  if (v) q.timeLimitSec = v;
                  else delete q.timeLimitSec;
                })
              }
            />
          </Row>
          {(['correct', 'incorrect', 'partial'] as const).map((k) => (
            <Row key={k} label={t(`quiz.feedback.${k}`)}>
              <TextInput
                multiline
                label={t(`quiz.feedback.${k}`)}
                value={richToPlain(question.feedback[k]?.[lang])}
                onChange={(v) =>
                  update(
                    (q) =>
                      q.type !== 'likert' &&
                      void (q.feedback[k] = { ...(q.feedback[k] ?? {}), [lang]: plainToRich(v) }),
                    `fb-${k}`,
                  )
                }
              />
            </Row>
          ))}
          <Row label={t('quiz.onCorrect')}>{branchSelect('onCorrect')}</Row>
          <Row label={t('quiz.onIncorrect')}>{branchSelect('onIncorrect')}</Row>
        </>
      ) : null}
    </div>
  );
}

export function QuizEditor({ quiz }: { quiz: QuizNode }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const store = useEditorStore();
  const readOnly = useEditor((s) => s.readOnly);
  const change = useNodeChange<QuizNode>(quiz.id);
  const all = questionsOf(quiz) as Question[];
  const [selectedId, setSelectedId] = useState<string | null>(all[0]?.id ?? null);
  const selected = all.find((q) => q.id === selectedId) ?? all[0];
  const labels = { prompt: t('quiz.newPrompt'), option: t('quiz.option'), blankText: t('quiz.newBlankText') };

  const add = async (type: QuestionType, poolIndex?: number) => {
    let question: Question;
    if (type === 'hotspot') {
      const sha = await uploadFile(store, 'image/png,image/jpeg,image/webp,image/svg+xml');
      if (!sha) return;
      question = newHotspotQuestion(lang, labels.prompt, sha);
    } else {
      question = newQuestion(type, lang, labels);
    }
    change((q) => {
      const pool = poolIndex !== undefined ? q.items[poolIndex] : undefined;
      if (pool?.type === 'pool') pool.questions.push(question);
      else q.items.push({ type: 'question', question: question });
    }, 'struct');
    setSelectedId(question.id);
  };

  const remove = (id: string) =>
    change((q) => {
      q.items = q.items
        .map((item) =>
          item.type === 'pool'
            ? {
                ...item,
                questions: item.questions.filter((x) => x.id !== id),
                draw: Math.min(item.draw, Math.max(1, item.questions.filter((x) => x.id !== id).length)),
              }
            : item,
        )
        .filter((item) => (item.type === 'question' ? item.question.id !== id : item.questions.length > 0));
    }, 'struct');

  let n = 0;
  return (
    <div className={styles.quizEditor}>
      <section className={styles.quizList} aria-label={t('quiz.questions')}>
        <header className={styles.panelHeader}>
          <span className={styles.panelTitle}>{t('quiz.questions')}</span>
        </header>
        <div className={styles.panelBody}>
          <ol className={styles.questionList}>
            {quiz.items.map((item, ii) =>
              item.type === 'question' ? (
                <li key={item.question.id}>
                  <button
                    type="button"
                    className={styles.questionItem}
                    aria-current={item.question.id === selected?.id ? 'true' : undefined}
                    onClick={() => setSelectedId(item.question.id)}
                  >
                    <span className={styles.thumbIndex}>{++n}</span>
                    <span>
                      {richToPlain(item.question.prompt[lang]).split('\n')[0] ||
                        t(`quiz.types.${item.question.type}`)}
                    </span>
                  </button>
                </li>
              ) : (
                <li key={item.id} className={styles.pool}>
                  <div className={styles.poolHeader}>
                    <input
                      className={styles.textInput}
                      aria-label={t('quiz.poolName')}
                      value={item.title}
                      disabled={readOnly}
                      onChange={(e) =>
                        change((q) => {
                          const p = q.items[ii];
                          if (p?.type === 'pool') p.title = e.target.value;
                        })
                      }
                    />
                    <label className={styles.inline}>
                      {t('quiz.draw')}
                      <input
                        className={styles.smallNumber}
                        type="number"
                        min={1}
                        max={item.questions.length}
                        value={item.draw}
                        disabled={readOnly}
                        onChange={(e) =>
                          change((q) => {
                            const p = q.items[ii];
                            if (p?.type === 'pool')
                              p.draw = Math.min(p.questions.length, Math.max(1, Number(e.target.value)));
                          })
                        }
                      />
                    </label>
                  </div>
                  <ol>
                    {item.questions.map((question) => (
                      <li key={question.id}>
                        <button
                          type="button"
                          className={styles.questionItem}
                          aria-current={question.id === selected?.id ? 'true' : undefined}
                          onClick={() => setSelectedId(question.id)}
                        >
                          <span className={styles.thumbIndex}>P</span>
                          <span>
                            {richToPlain(question.prompt[lang]).split('\n')[0] ||
                              t(`quiz.types.${question.type}`)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <TypeMenu label={t('quiz.addToPool')} onPick={(type) => void add(type, ii)} />
                </li>
              ),
            )}
          </ol>
          <div className={styles.panelFooter}>
            <TypeMenu label={t('quiz.addQuestion')} onPick={(type) => void add(type)} />
            <ToolButton
              icon="layers"
              isDisabled={readOnly}
              onPress={() =>
                change(
                  (q) =>
                    void q.items.push({
                      type: 'pool',
                      id: newId('pool'),
                      title: t('quiz.pool'),
                      draw: 1,
                      questions: [newQuestion('singleChoice', lang, labels)],
                    }),
                  'struct',
                )
              }
            >
              {t('quiz.addPool')}
            </ToolButton>
            <ToolButton
              icon="trash-2"
              isDisabled={readOnly || !selected || all.length <= 1}
              onPress={() => selected && remove(selected.id)}
            >
              {t('quiz.deleteQuestion')}
            </ToolButton>
          </div>
        </div>
      </section>
      <section className={styles.questionPane} aria-label={t('quiz.question')}>
        {selected ? <QuestionForm key={selected.id} quizId={quiz.id} question={selected} /> : null}
      </section>
    </div>
  );
}

export function QuizSettings({ quiz }: { quiz: QuizNode }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const change = useNodeChange<QuizNode>(quiz.id);
  const s = quiz.settings;
  return (
    <div className={styles.form}>
      <Row label={t('editor.props.title')}>
        <TextInput
          label={t('editor.props.title')}
          value={quiz.title[lang] ?? ''}
          onChange={(v) => change((q) => void (q.title[lang] = v))}
        />
      </Row>
      <Row label={t('quiz.intro')}>
        <TextInput
          multiline
          label={t('quiz.intro')}
          value={richToPlain(quiz.intro?.[lang])}
          onChange={(v) => change((q) => void (q.intro = { ...(q.intro ?? {}), [lang]: plainToRich(v) }))}
        />
      </Row>
      <Row label={t('quiz.passing')}>
        <NumberInput
          label={t('quiz.passing')}
          value={s.passingPercent}
          min={0}
          max={100}
          onChange={(v) => change((q) => void (q.settings.passingPercent = v ?? 80))}
        />
      </Row>
      <Row label={t('quiz.timeLimit')}>
        <NumberInput
          label={t('quiz.timeLimit')}
          value={s.timeLimitSec ? s.timeLimitSec / 60 : undefined}
          min={1}
          max={1440}
          onChange={(v) =>
            change((q) => {
              if (v) q.settings.timeLimitSec = Math.round(v * 60);
              else delete q.settings.timeLimitSec;
            })
          }
        />
      </Row>
      <Row label={t('quiz.attemptsAllowed')}>
        <NumberInput
          label={t('quiz.attemptsAllowed')}
          value={s.attemptsAllowed}
          min={1}
          max={100}
          onChange={(v) =>
            change((q) => {
              if (v) q.settings.attemptsAllowed = v;
              else delete q.settings.attemptsAllowed;
            })
          }
        />
      </Row>
      <Row label="">
        <div className={styles.checksColumn}>
          <Checkbox
            isSelected={s.shuffleItems}
            onChange={(v) => change((q) => void (q.settings.shuffleItems = v))}
          >
            {t('quiz.shuffleQuestions')}
          </Checkbox>
          <Checkbox
            isSelected={s.showResults}
            onChange={(v) => change((q) => void (q.settings.showResults = v))}
          >
            {t('quiz.showResults')}
          </Checkbox>
          <Checkbox
            isSelected={s.allowReview}
            onChange={(v) => change((q) => void (q.settings.allowReview = v))}
          >
            {t('quiz.allowReview')}
          </Checkbox>
        </div>
      </Row>
    </div>
  );
}

export function SurveyEditor({ survey }: { survey: SurveyNode }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const change = useNodeChange<SurveyNode>(survey.id);
  const loc = (v: Record<string, string>) => v[lang] ?? '';
  type SQ = SurveyNode['questions'][number];
  const addQ = (type: SQ['type']) =>
    change((s) => {
      const base = { id: newId('q'), prompt: { [lang]: plainToRich(t('quiz.newPrompt')) } };
      if (type === 'choice')
        s.questions.push({
          ...base,
          type,
          multiple: false,
          options: [1, 2].map((n) => ({ id: newId('o'), text: { [lang]: `${t('quiz.option')} ${n}` } })),
        });
      if (type === 'text') s.questions.push({ ...base, type, multiline: true, maxLength: 2000 });
      if (type === 'likert')
        s.questions.push({
          ...base,
          type,
          statements: [{ id: newId('s'), text: { [lang]: '' } }],
          scale: ['1', '2', '3', '4', '5'].map((x) => ({ id: newId('l'), label: { [lang]: x } })),
        });
    }, 'struct');

  return (
    <div className={styles.questionPane}>
      <div className={styles.form}>
        <Row label={t('editor.props.title')}>
          <TextInput
            label={t('editor.props.title')}
            value={survey.title[lang] ?? ''}
            onChange={(v) => change((s) => void (s.title[lang] = v))}
          />
        </Row>
        <Row label={t('quiz.intro')}>
          <TextInput
            multiline
            label={t('quiz.intro')}
            value={richToPlain(survey.intro?.[lang])}
            onChange={(v) => change((s) => void (s.intro = { ...(s.intro ?? {}), [lang]: plainToRich(v) }))}
          />
        </Row>
        <Row label="">
          <Checkbox isSelected={survey.anonymous} onChange={(v) => change((s) => void (s.anonymous = v))}>
            {t('quiz.anonymous')}
          </Checkbox>
        </Row>
      </div>
      {survey.questions.map((sq, i) => (
        <div key={sq.id} className={styles.surveyQuestion}>
          <div className={styles.form}>
            <Row label={`${t('quiz.question')} ${i + 1}`}>
              <div className={styles.inline}>
                <strong>{t(`quiz.surveyTypes.${sq.type}`)}</strong>
                <ToolButton
                  icon="trash-2"
                  aria-label={t('quiz.deleteQuestion')}
                  isDisabled={survey.questions.length <= 1}
                  onPress={() => change((s) => void s.questions.splice(i, 1), 'struct')}
                />
              </div>
            </Row>
            <Row label={t('quiz.prompt')}>
              <TextInput
                multiline
                label={t('quiz.prompt')}
                value={richToPlain(sq.prompt[lang])}
                onChange={(v) =>
                  change(
                    (s) => s.questions[i] && void (s.questions[i].prompt[lang] = plainToRich(v)),
                    `sq-${i}`,
                  )
                }
              />
            </Row>
            {sq.type === 'choice' ? (
              <>
                <Row label={t('quiz.choices')}>
                  <ListEditor
                    items={sq.options}
                    min={2}
                    addLabel={t('quiz.addChoice')}
                    onAdd={() =>
                      change((s) => {
                        const q = s.questions[i];
                        if (q?.type === 'choice') q.options.push({ id: newId('o'), text: { [lang]: '' } });
                      }, 'struct')
                    }
                    onRemove={(j) =>
                      change((s) => {
                        const q = s.questions[i];
                        if (q?.type === 'choice') q.options.splice(j, 1);
                      }, 'struct')
                    }
                    render={(o, j) => (
                      <TextInput
                        label={t('quiz.choiceText', { n: j + 1 })}
                        value={loc(o.text)}
                        onChange={(v) =>
                          change((s) => {
                            const q = s.questions[i];
                            if (q?.type === 'choice' && q.options[j]) q.options[j].text[lang] = v;
                          }, `so-${i}-${j}`)
                        }
                      />
                    )}
                  />
                </Row>
                <Row label="">
                  <Checkbox
                    isSelected={sq.multiple}
                    onChange={(v) =>
                      change((s) => {
                        const q = s.questions[i];
                        if (q?.type === 'choice') q.multiple = v;
                      })
                    }
                  >
                    {t('quiz.multipleAnswers')}
                  </Checkbox>
                </Row>
              </>
            ) : null}
            {sq.type === 'likert' ? (
              <Row label={t('quiz.statements')}>
                <ListEditor
                  items={sq.statements}
                  addLabel={t('quiz.addStatement')}
                  onAdd={() =>
                    change((s) => {
                      const q = s.questions[i];
                      if (q?.type === 'likert') q.statements.push({ id: newId('s'), text: { [lang]: '' } });
                    }, 'struct')
                  }
                  onRemove={(j) =>
                    change((s) => {
                      const q = s.questions[i];
                      if (q?.type === 'likert') q.statements.splice(j, 1);
                    }, 'struct')
                  }
                  render={(st, j) => (
                    <TextInput
                      label={t('quiz.statement', { n: j + 1 })}
                      value={loc(st.text)}
                      onChange={(v) =>
                        change((s) => {
                          const q = s.questions[i];
                          if (q?.type === 'likert' && q.statements[j]) q.statements[j].text[lang] = v;
                        }, `ss-${i}-${j}`)
                      }
                    />
                  )}
                />
              </Row>
            ) : null}
          </div>
        </div>
      ))}
      <div className={styles.inlinePadded}>
        {(['choice', 'text', 'likert'] as const).map((type) => (
          <Button key={type} icon="plus" onPress={() => addQ(type)}>
            {t(`quiz.surveyTypes.${type}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
