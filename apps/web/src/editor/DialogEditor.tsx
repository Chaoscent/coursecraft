// SPDX-License-Identifier: Apache-2.0
import type { DialogNode } from '@lernwerk/course-model';
import type { Draft } from 'immer';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ToolButton } from '../components/Button.js';
import { Checkbox } from '../components/Field.js';
import { uploadFile } from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import {
  MAX_RESPONSES,
  MOODS,
  newResponse,
  newScene,
  removeCharacter,
  removeScene,
  unreachableScenes,
  type Scene,
} from './dialogModel.js';
import { ListEditor, move, NumberInput, Row, TextInput } from './FormControls.js';
import { newId } from './ids.js';
import { plainToRich, richToPlain } from './quizModel.js';
import { assetUrl } from './upload.js';
import styles from './Editor.module.css';

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml';
type Selection = { type: 'scene'; id: string } | { type: 'characters' } | { type: 'outcomes' };

function useDialogChange(nodeId: string) {
  const store = useEditorStore();
  return (recipe: (node: Draft<DialogNode>) => void, key = `node-${nodeId}`) =>
    store.getState().change((draft) => {
      const node = draft.nodes[nodeId];
      if (node?.kind === 'dialog') recipe(node);
    }, key);
}

function Characters({ dialog }: { dialog: DialogNode }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const courseId = useEditor((s) => s.courseId);
  const readOnly = useEditor((s) => s.readOnly);
  const store = useEditorStore();
  const change = useDialogChange(dialog.id);
  const [inUse, setInUse] = useState(false);
  const pick = (apply: (sha: string) => void) =>
    void uploadFile(store, IMAGE_TYPES).then((sha) => sha && apply(sha));
  return (
    <div className={styles.form}>
      <Row label={t('dialog.characters')}>
        <ListEditor
          items={dialog.characters}
          addLabel={t('dialog.addCharacter')}
          {...(dialog.characters.length < 10
            ? {
                onAdd: () =>
                  pick((sha) =>
                    change(
                      (d) =>
                        void d.characters.push({
                          id: newId('char'),
                          name: { [lang]: `${t('dialog.character')} ${d.characters.length + 1}` },
                          images: { neutral: { $asset: sha } },
                          altText: { [lang]: '' },
                        }),
                      'struct',
                    ),
                  ),
              }
            : {})}
          onRemove={(i) => {
            const id = dialog.characters[i]?.id ?? '';
            const used = dialog.scenes.some((s) => s.characterId === id);
            setInUse(used);
            if (!used) change((d) => void removeCharacter(d, id), 'struct');
          }}
          render={(character, i) => (
            <div className={styles.entryFields}>
              <TextInput
                label={`${t('dialog.characterName')} ${i + 1}`}
                value={character.name[lang] ?? ''}
                onChange={(v) =>
                  change((d) => void (d.characters[i] && (d.characters[i].name[lang] = v)), `cn-${i}`)
                }
              />
              <TextInput
                label={`${t('editor.props.altText')} ${i + 1}`}
                value={character.altText[lang] ?? ''}
                onChange={(v) =>
                  change((d) => void (d.characters[i] && (d.characters[i].altText[lang] = v)), `ca-${i}`)
                }
              />
              <div className={styles.moodRow}>
                {MOODS.map((mood) => {
                  const image = character.images[mood];
                  return (
                    <div key={mood} className={styles.mood}>
                      {image ? (
                        <img className={styles.entryImage} src={assetUrl(courseId, image.$asset)} alt="" />
                      ) : (
                        <span className={styles.entryImage} />
                      )}
                      <Button
                        icon="image"
                        isDisabled={readOnly}
                        onPress={() =>
                          pick((sha) =>
                            change((d) => {
                              const c = d.characters[i];
                              if (c) c.images[mood] = { $asset: sha };
                            }, 'struct'),
                          )
                        }
                      >
                        {t(`dialog.moods.${mood}`)}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        />
        {inUse ? <p className={styles.hint}>{t('dialog.characterInUse')}</p> : null}
      </Row>
    </div>
  );
}

function Outcomes({ dialog }: { dialog: DialogNode }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const change = useDialogChange(dialog.id);
  return (
    <div className={styles.form}>
      <Row label={t('dialog.outcomes')}>
        <p className={styles.hint}>{t('dialog.outcomesHint')}</p>
        <ListEditor
          items={dialog.outcomes}
          addLabel={t('dialog.addOutcome')}
          {...(dialog.outcomes.length < 10
            ? {
                onAdd: () =>
                  change(
                    (d) =>
                      void d.outcomes.push({
                        id: newId('out'),
                        title: { [lang]: t('dialog.outcome') },
                        body: { [lang]: plainToRich('') },
                        minScore: 0,
                        passed: false,
                      }),
                    'struct',
                  ),
              }
            : {})}
          onRemove={(i) => change((d) => void d.outcomes.splice(i, 1), 'struct')}
          render={(outcome, i) => (
            <div className={styles.entryFields}>
              <TextInput
                label={`${t('dialog.outcomeTitle')} ${i + 1}`}
                value={outcome.title[lang] ?? ''}
                onChange={(v) =>
                  change((d) => void (d.outcomes[i] && (d.outcomes[i].title[lang] = v)), `ot-${i}`)
                }
              />
              <TextInput
                label={`${t('dialog.outcomeBody')} ${i + 1}`}
                multiline
                value={richToPlain(outcome.body[lang])}
                onChange={(v) =>
                  change(
                    (d) => void (d.outcomes[i] && (d.outcomes[i].body[lang] = plainToRich(v))),
                    `ob-${i}`,
                  )
                }
              />
              <div className={styles.inline}>
                <span className={styles.formLabel}>{t('dialog.minScore')}</span>
                <NumberInput
                  label={`${t('dialog.minScore')} ${i + 1}`}
                  value={outcome.minScore}
                  onChange={(v) =>
                    change((d) => void (d.outcomes[i] && (d.outcomes[i].minScore = v ?? 0)), `om-${i}`)
                  }
                />
                <Checkbox
                  isSelected={outcome.passed}
                  onChange={(v) =>
                    change((d) => void (d.outcomes[i] && (d.outcomes[i].passed = v)), 'struct')
                  }
                >
                  {t('dialog.passed')}
                </Checkbox>
              </div>
            </div>
          )}
        />
      </Row>
    </div>
  );
}

function SceneForm({
  dialog,
  scene,
  onSelect,
}: {
  dialog: DialogNode;
  scene: Scene;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const readOnly = useEditor((s) => s.readOnly);
  const store = useEditorStore();
  const change = useDialogChange(dialog.id);
  const update = (recipe: (s: Draft<Scene>) => void, key = `scene-${scene.id}`) =>
    change((d) => {
      const s = d.scenes.find((x) => x.id === scene.id);
      if (s) recipe(s);
    }, key);
  const sceneLabel = (s: Scene, i: number) => `${i + 1}: ${(s.speech[lang] ?? '').slice(0, 40)}`;

  return (
    <div className={styles.form}>
      <Row label={t('dialog.character')}>
        <div className={styles.pair}>
          <select
            className={styles.select}
            aria-label={t('dialog.character')}
            value={scene.characterId}
            disabled={readOnly}
            onChange={(e) => update((s) => void (s.characterId = e.target.value), 'struct')}
          >
            {dialog.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name[lang] ?? c.id}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            aria-label={t('dialog.mood')}
            value={scene.mood}
            disabled={readOnly}
            onChange={(e) => update((s) => void (s.mood = e.target.value as Scene['mood']), 'struct')}
          >
            {MOODS.map((m) => (
              <option key={m} value={m}>
                {t(`dialog.moods.${m}`)}
              </option>
            ))}
          </select>
        </div>
      </Row>
      <Row label={t('dialog.speech')}>
        <TextInput
          label={t('dialog.speech')}
          multiline
          value={scene.speech[lang] ?? ''}
          onChange={(v) => update((s) => void (s.speech[lang] = v), `speech-${scene.id}`)}
        />
      </Row>
      <Row label={t('dialog.background')}>
        <div className={styles.inline}>
          <Button
            icon="image"
            isDisabled={readOnly}
            onPress={() =>
              void uploadFile(store, IMAGE_TYPES).then(
                (sha) => sha && update((s) => void (s.background = { $asset: sha }), 'struct'),
              )
            }
          >
            {scene.background ? t('editor.props.replaceImage') : t('dialog.chooseBackground')}
          </Button>
          {scene.background ? (
            <Button
              icon="trash-2"
              isDisabled={readOnly}
              onPress={() => update((s) => void delete s.background, 'struct')}
            >
              {t('dialog.removeBackground')}
            </Button>
          ) : null}
        </div>
      </Row>
      <Row label={t('dialog.audio')}>
        <div className={styles.inline}>
          <Button
            icon="volume-2"
            isDisabled={readOnly}
            onPress={() =>
              void uploadFile(store, 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm').then(
                (sha) =>
                  sha &&
                  update((s) => {
                    s.audio = { ...(s.audio ?? {}), [lang]: { $asset: sha } };
                  }, 'struct'),
              )
            }
          >
            {scene.audio?.[lang] ? t('dialog.replaceAudio') : t('dialog.chooseAudio')}
          </Button>
          {scene.audio?.[lang] ? (
            <Button
              icon="trash-2"
              isDisabled={readOnly}
              onPress={() =>
                update((s) => {
                  if (!s.audio) return;
                  delete s.audio[lang];
                  if (!Object.keys(s.audio).length) delete s.audio;
                }, 'struct')
              }
            >
              {t('dialog.removeAudio')}
            </Button>
          ) : null}
        </div>
      </Row>
      <Row label={t('dialog.responses')}>
        <ListEditor
          items={scene.responses}
          min={0}
          addLabel={t('dialog.addResponse')}
          {...(scene.responses.length < MAX_RESPONSES
            ? {
                onAdd: () =>
                  update((s) => void s.responses.push(newResponse(lang, t('dialog.newResponse'))), 'struct'),
              }
            : {})}
          onRemove={(i) => update((s) => void s.responses.splice(i, 1), 'struct')}
          onMove={(a, b) => update((s) => move(s.responses, a, b), 'struct')}
          render={(response, i) => {
            const nextValue = response.next.type === 'scene' ? response.next.sceneId : '';
            return (
              <div className={styles.entryFields}>
                <TextInput
                  label={`${t('dialog.responseText')} ${i + 1}`}
                  value={response.text[lang] ?? ''}
                  onChange={(v) =>
                    update((s) => void (s.responses[i] && (s.responses[i].text[lang] = v)), `rt-${i}`)
                  }
                />
                <TextInput
                  label={`${t('dialog.feedback')} ${i + 1}`}
                  multiline
                  value={richToPlain(response.feedback?.[lang])}
                  onChange={(v) =>
                    update((s) => {
                      const r = s.responses[i];
                      if (!r) return;
                      if (v) r.feedback = { ...(r.feedback ?? {}), [lang]: plainToRich(v) };
                      else delete r.feedback;
                    }, `rf-${i}`)
                  }
                />
                <div className={styles.inline}>
                  <span className={styles.formLabel}>{t('dialog.points')}</span>
                  <NumberInput
                    label={`${t('dialog.points')} ${i + 1}`}
                    min={-1000}
                    max={1000}
                    value={response.points}
                    onChange={(v) =>
                      update((s) => void (s.responses[i] && (s.responses[i].points = v ?? 0)), `rp-${i}`)
                    }
                  />
                  <select
                    className={styles.select}
                    aria-label={`${t('dialog.next')} ${i + 1}`}
                    value={nextValue}
                    disabled={readOnly}
                    onChange={(e) =>
                      update((s) => {
                        const r = s.responses[i];
                        if (r)
                          r.next = e.target.value
                            ? { type: 'scene', sceneId: e.target.value }
                            : { type: 'end' };
                      }, 'struct')
                    }
                  >
                    <option value="">{t('dialog.end')}</option>
                    {dialog.scenes.map((s, si) => (
                      <option key={s.id} value={s.id}>
                        {sceneLabel(s, si)}
                      </option>
                    ))}
                  </select>
                  <Button
                    icon="plus"
                    isDisabled={readOnly}
                    onPress={() => {
                      const next = newScene(
                        lang,
                        scene.characterId,
                        t('dialog.newSpeech'),
                        dialog.scenes.length,
                      );
                      change((d) => {
                        d.scenes.push(next);
                        const r = d.scenes.find((x) => x.id === scene.id)?.responses[i];
                        if (r) r.next = { type: 'scene', sceneId: next.id };
                      }, 'struct');
                      onSelect(next.id);
                    }}
                  >
                    {t('dialog.newFollowUp')}
                  </Button>
                </div>
              </div>
            );
          }}
        />
      </Row>
    </div>
  );
}

/** Branching dialog: scene list on the left, the selected scene or settings on the right. */
export function DialogEditor({ dialog }: { dialog: DialogNode }) {
  const { t } = useTranslation();
  const lang = useEditor((s) => s.lang);
  const readOnly = useEditor((s) => s.readOnly);
  const change = useDialogChange(dialog.id);
  const [selection, setSelection] = useState<Selection>({ type: 'scene', id: dialog.startSceneId });
  const scene = selection.type === 'scene' ? dialog.scenes.find((s) => s.id === selection.id) : undefined;
  const unreachable = unreachableScenes(dialog);
  const names = new Map(dialog.characters.map((c) => [c.id, c.name[lang] ?? '']));

  return (
    <div className={styles.quizEditor}>
      <section className={styles.quizList} aria-label={t('dialog.scenes')}>
        <header className={styles.panelHeader}>
          <span className={styles.panelTitle}>{t('dialog.scenes')}</span>
        </header>
        <div className={styles.panelBody}>
          <div className={styles.form}>
            <Row label={t('editor.props.title')}>
              <TextInput
                label={t('editor.props.title')}
                value={dialog.title[lang] ?? ''}
                onChange={(v) => change((d) => void (d.title[lang] = v), 'title')}
              />
            </Row>
          </div>
          <ol className={styles.questionList}>
            {(['characters', 'outcomes'] as const).map((type) => (
              <li key={type}>
                <button
                  type="button"
                  className={styles.questionItem}
                  aria-current={selection.type === type ? 'true' : undefined}
                  onClick={() => setSelection({ type })}
                >
                  <span className={styles.thumbIndex}>{type === 'characters' ? '◎' : '★'}</span>
                  <span>{t(`dialog.${type}`)}</span>
                </button>
              </li>
            ))}
            {dialog.scenes.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={styles.questionItem}
                  aria-current={scene?.id === s.id ? 'true' : undefined}
                  onClick={() => setSelection({ type: 'scene', id: s.id })}
                >
                  <span className={styles.thumbIndex}>{i + 1}</span>
                  <span>
                    {s.id === dialog.startSceneId ? `${t('dialog.start')} · ` : ''}
                    {unreachable.has(s.id) ? `${t('dialog.unreachable')} · ` : ''}
                    {names.get(s.characterId)}: {s.speech[lang] ?? ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className={styles.panelFooter}>
            <ToolButton
              icon="plus"
              isDisabled={readOnly || dialog.scenes.length >= 500}
              onPress={() => {
                const next = newScene(
                  lang,
                  dialog.characters[0]?.id ?? '',
                  t('dialog.newSpeech'),
                  dialog.scenes.length,
                );
                change((d) => void d.scenes.push(next), 'struct');
                setSelection({ type: 'scene', id: next.id });
              }}
            >
              {t('dialog.addScene')}
            </ToolButton>
            <ToolButton
              icon="play"
              isDisabled={readOnly || !scene || scene.id === dialog.startSceneId}
              onPress={() => scene && change((d) => void (d.startSceneId = scene.id), 'struct')}
            >
              {t('dialog.makeStart')}
            </ToolButton>
            <ToolButton
              icon="trash-2"
              isDisabled={readOnly || !scene || dialog.scenes.length <= 1}
              onPress={() => {
                if (!scene) return;
                change((d) => removeScene(d, scene.id), 'struct');
                setSelection({
                  type: 'scene',
                  id:
                    dialog.startSceneId === scene.id
                      ? (dialog.scenes.find((s) => s.id !== scene.id)?.id ?? '')
                      : dialog.startSceneId,
                });
              }}
            >
              {t('dialog.deleteScene')}
            </ToolButton>
          </div>
        </div>
      </section>
      <section className={styles.questionPane} aria-label={t('dialog.details')}>
        {selection.type === 'characters' ? <Characters dialog={dialog} /> : null}
        {selection.type === 'outcomes' ? <Outcomes dialog={dialog} /> : null}
        {scene ? (
          <SceneForm
            key={scene.id}
            dialog={dialog}
            scene={scene}
            onSelect={(id) => setSelection({ type: 'scene', id })}
          />
        ) : null}
      </section>
    </div>
  );
}
