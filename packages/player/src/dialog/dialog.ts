// SPDX-License-Identifier: Apache-2.0
import type { DialogNode } from '@coursecraft/course-model';
import { h } from '../render/dom.js';
import { localized } from '../render/context.js';
import { renderRichText } from '../render/richtext.js';
import type { NodeApi } from '../runtime/player.js';
import type { InteractionRecord } from '../tracking/types.js';

type Scene = DialogNode['scenes'][number];

/** Highest reachable score (best response per scene, cycles cut off). */
export function maxScore(dialog: DialogNode): number {
  const scenes = new Map(dialog.scenes.map((s) => [s.id, s]));
  const memo = new Map<string, number>();
  const visit = (id: string, path: Set<string>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const scene = scenes.get(id);
    if (!scene || path.has(id)) return 0;
    path.add(id);
    const best = scene.responses.length
      ? Math.max(
          ...scene.responses.map(
            (r) => r.points + (r.next.type === 'scene' ? visit(r.next.sceneId, path) : 0),
          ),
        )
      : 0;
    path.delete(id);
    memo.set(id, best);
    return best;
  };
  return visit(dialog.startSceneId, new Set());
}

/** The outcome for a score: the highest `minScore` that is reached. */
export function outcomeFor(dialog: DialogNode, score: number): DialogNode['outcomes'][number] | undefined {
  const reached = dialog.outcomes.filter((o) => score >= o.minScore).sort((a, b) => b.minScore - a.minScore);
  return reached[0] ?? [...dialog.outcomes].sort((a, b) => a.minScore - b.minScore)[0];
}

/**
 * Branching conversation: a character speaks, the learner picks a response,
 * gets feedback and moves to the next scene; the score decides the outcome.
 */
export function renderDialog(
  dialog: DialogNode,
  api: NodeApi,
  track: (r: InteractionRecord) => void,
): HTMLElement {
  const { ctx, strings } = api;
  const characters = new Map(dialog.characters.map((c) => [c.id, c]));
  const scenes = new Map(dialog.scenes.map((s) => [s.id, s]));
  const best = maxScore(dialog);
  let score = 0;
  let shownAt = Date.now();
  const stage = h('div', { class: 'cc-dialog-stage' });
  const live = h('div', { class: 'cc-sr-only', attrs: { 'aria-live': 'polite' } });
  const root = h(
    'section',
    { class: 'cc-dialog', attrs: { 'aria-label': localized(ctx, dialog.title) ?? '' } },
    [h('h2', { class: 'cc-ix-title', text: localized(ctx, dialog.title) ?? '' }), stage, live],
  );

  const finish = () => {
    const outcome = outcomeFor(dialog, score);
    const scaled = best > 0 ? Math.min(1, Math.max(0, score / best)) : 1;
    const passed = outcome?.passed ?? true;
    api.reportScore(dialog.id, { scaled, passed });
    api.markViewed();
    api.allowNext();
    const heading = h('h3', {
      class: 'cc-dialog-outcome-title',
      text: localized(ctx, outcome?.title ?? {}) ?? '',
      attrs: { tabindex: '-1' },
    });
    const body = outcome ? localized(ctx, outcome.body) : undefined;
    const again = h('button', { class: 'cc-button', attrs: { type: 'button' }, text: strings.dialogRetry });
    again.addEventListener('click', () => {
      score = 0;
      show(dialog.startSceneId);
    });
    stage.replaceChildren(
      h('div', { class: `cc-dialog-outcome ${passed ? 'cc-passed' : 'cc-failed'}` }, [
        heading,
        ...(body ? [h('div', {}, [renderRichText(body, ctx)])] : []),
        h('p', {
          class: 'cc-dialog-score',
          text: strings.dialogScore.replace('{score}', String(score)).replace('{max}', String(best)),
        }),
        h('div', { class: 'cc-ix-step-nav' }, [again]),
      ]),
    );
    heading.focus();
  };

  const show = (sceneId: string) => {
    const scene: Scene | undefined = scenes.get(sceneId);
    if (!scene) {
      finish();
      return;
    }
    shownAt = Date.now();
    const character = characters.get(scene.characterId);
    const image = character ? (character.images[scene.mood] ?? character.images.neutral) : undefined;
    const name = character ? (localized(ctx, character.name) ?? '') : '';
    const speech = localized(ctx, scene.speech) ?? '';
    const audioRef = scene.audio ? localized(ctx, scene.audio) : undefined;
    const responses = h('div', {
      class: 'cc-dialog-responses',
      attrs: { role: 'group', 'aria-label': strings.yourAnswer },
    });
    const feedbackBox = h('div', { class: 'cc-dialog-feedback', attrs: { 'aria-live': 'polite' } });
    for (const response of scene.responses) {
      const button = h('button', {
        class: 'cc-button cc-dialog-response',
        attrs: { type: 'button' },
        text: localized(ctx, response.text) ?? '',
      });
      button.addEventListener('click', () => {
        score += response.points;
        track({
          id: scene.id,
          questionType: 'dialog',
          description: speech,
          response: response.id,
          result: response.points > 0 ? 'correct' : response.points < 0 ? 'incorrect' : 'neutral',
          latencyMs: Date.now() - shownAt,
          parentId: dialog.id,
        });
        const go = () => {
          if (response.next.type === 'scene') show(response.next.sceneId);
          else finish();
        };
        const feedback = response.feedback ? localized(ctx, response.feedback) : undefined;
        if (!feedback) {
          go();
          return;
        }
        responses.querySelectorAll('button').forEach((b) => (b.disabled = true));
        const cont = h('button', {
          class: 'cc-button cc-button-primary',
          attrs: { type: 'button' },
          text: strings.dialogContinue,
        });
        cont.addEventListener('click', go);
        feedbackBox.replaceChildren(h('div', {}, [renderRichText(feedback, ctx)]), cont);
        cont.focus();
      });
      responses.append(button);
    }
    if (!scene.responses.length) {
      const end = h('button', {
        class: 'cc-button cc-button-primary',
        attrs: { type: 'button' },
        text: strings.dialogContinue,
      });
      end.addEventListener('click', finish);
      responses.append(end);
    }
    const speechEl = h('blockquote', { class: 'cc-dialog-speech', attrs: { tabindex: '-1' } }, [
      h('p', { class: 'cc-dialog-name', text: name }),
      h('p', { text: speech }),
    ]);
    const view = h('div', { class: 'cc-dialog-scene' }, [
      ...(image
        ? [
            h('img', {
              class: 'cc-dialog-character',
              attrs: { src: ctx.assetUrl(image.$asset), alt: localized(ctx, character?.altText ?? {}) ?? '' },
            }),
          ]
        : []),
      h('div', { class: 'cc-dialog-main' }, [
        speechEl,
        ...(audioRef
          ? [h('audio', { attrs: { controls: '', src: ctx.assetUrl(audioRef.$asset), 'aria-label': name } })]
          : []),
        responses,
        feedbackBox,
      ]),
    ]);
    if (scene.background) view.style.backgroundImage = `url("${ctx.assetUrl(scene.background.$asset)}")`;
    stage.replaceChildren(view);
    live.textContent = `${name}: ${speech}`;
    speechEl.focus();
  };

  show(dialog.startSceneId);
  return root;
}
