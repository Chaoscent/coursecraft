// SPDX-License-Identifier: Apache-2.0
import { dialogNodeSchema, type DialogNode } from '@coursecraft/course-model';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { newDialog, newScene, removeCharacter, removeScene, unreachableScenes } from './dialogModel.js';

const labels = {
  title: 'Dialog',
  character: 'Figur',
  altText: '',
  speech: 'Hallo',
  good: 'Gut',
  bad: 'Schlecht',
  passed: 'Bestanden',
  failed: 'Nicht bestanden',
};

function withSecondScene(): DialogNode {
  const dialog = newDialog('de', labels, 'd'.repeat(64));
  return produce(dialog, (d) => {
    const next = newScene('de', d.characters[0]?.id ?? '', 'Weiter', 1);
    d.scenes.push(next);
    const first = d.scenes[0]?.responses[0];
    if (first) first.next = { type: 'scene', sceneId: next.id };
  });
}

describe('dialog model', () => {
  it('creates a valid dialog', () => {
    expect(dialogNodeSchema.safeParse(newDialog('de', labels, 'd'.repeat(64))).success).toBe(true);
  });

  it('removing a scene redirects responses to the end and moves the start', () => {
    const dialog = withSecondScene();
    const second = dialog.scenes[1]?.id ?? '';
    const removed = produce(dialog, (d) => removeScene(d, second));
    expect(removed.scenes).toHaveLength(1);
    expect(removed.scenes[0]?.responses[0]?.next).toEqual({ type: 'end' });
    expect(dialogNodeSchema.safeParse(removed).success).toBe(true);
    const startGone = produce(dialog, (d) => removeScene(d, dialog.startSceneId));
    expect(startGone.startSceneId).toBe(second);
  });

  it('finds unreachable scenes', () => {
    const dialog = withSecondScene();
    expect(unreachableScenes(dialog).size).toBe(0);
    const cut = produce(dialog, (d) => {
      const first = d.scenes[0]?.responses[0];
      if (first) first.next = { type: 'end' };
    });
    expect([...unreachableScenes(cut)]).toEqual([dialog.scenes[1]?.id]);
  });

  it('keeps characters that scenes still use', () => {
    const dialog = newDialog('de', labels, 'd'.repeat(64));
    const id = dialog.characters[0]?.id ?? '';
    expect(produce(dialog, (d) => void removeCharacter(d, id)).characters).toHaveLength(1);
  });
});
