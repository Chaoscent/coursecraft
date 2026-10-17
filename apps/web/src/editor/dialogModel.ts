// SPDX-License-Identifier: Apache-2.0
import type { DialogNode } from '@coursecraft/course-model';
import type { Draft } from 'immer';
import { newId } from './ids.js';
import { paragraphDoc } from './model.js';

export type Scene = DialogNode['scenes'][number];
export type Response = Scene['responses'][number];
export const MOODS = ['neutral', 'positive', 'negative', 'thinking'] as const;
export const MAX_RESPONSES = 6;

interface Labels {
  title: string;
  character: string;
  altText: string;
  speech: string;
  good: string;
  bad: string;
  passed: string;
  failed: string;
}

export function newResponse(lang: string, text: string, points = 0): Response {
  return { id: newId('r'), text: { [lang]: text }, points, next: { type: 'end' } };
}

export function newScene(lang: string, characterId: string, speech: string, index: number): Scene {
  return {
    id: newId('scene'),
    characterId,
    mood: 'neutral',
    speech: { [lang]: speech },
    position: { x: (index % 4) * 240, y: Math.floor(index / 4) * 160 },
    responses: [],
  };
}

/** A dialog with one character (needs a portrait), one scene and two outcomes. */
export function newDialog(lang: string, labels: Labels, portrait: string): DialogNode {
  const characterId = newId('char');
  const scene = newScene(lang, characterId, labels.speech, 0);
  scene.responses = [newResponse(lang, labels.good, 1), newResponse(lang, labels.bad, 0)];
  return {
    kind: 'dialog',
    id: newId('dialog'),
    title: { [lang]: labels.title },
    characters: [
      {
        id: characterId,
        name: { [lang]: labels.character },
        images: { neutral: { $asset: portrait } },
        altText: { [lang]: labels.altText },
      },
    ],
    scenes: [scene],
    startSceneId: scene.id,
    outcomes: [
      {
        id: newId('out'),
        title: { [lang]: labels.passed },
        body: { [lang]: paragraphDoc('') },
        minScore: 1,
        passed: true,
      },
      {
        id: newId('out'),
        title: { [lang]: labels.failed },
        body: { [lang]: paragraphDoc('') },
        minScore: 0,
        passed: false,
      },
    ],
  };
}

/** Removes a scene; responses that led there end the dialog instead. */
export function removeScene(dialog: Draft<DialogNode>, sceneId: string): void {
  if (dialog.scenes.length <= 1) return;
  dialog.scenes = dialog.scenes.filter((s) => s.id !== sceneId);
  for (const scene of dialog.scenes)
    for (const response of scene.responses)
      if (response.next.type === 'scene' && response.next.sceneId === sceneId)
        response.next = { type: 'end' };
  if (dialog.startSceneId === sceneId) dialog.startSceneId = dialog.scenes[0]?.id ?? '';
}

/** Removes a character unless a scene still uses it. Returns false if it is in use. */
export function removeCharacter(dialog: Draft<DialogNode>, characterId: string): boolean {
  if (dialog.characters.length <= 1 || dialog.scenes.some((s) => s.characterId === characterId)) return false;
  dialog.characters = dialog.characters.filter((c) => c.id !== characterId);
  return true;
}

/** Scenes that cannot be reached from the start scene. */
export function unreachableScenes(dialog: DialogNode): Set<string> {
  const byId = new Map(dialog.scenes.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = [dialog.startSceneId];
  while (stack.length) {
    const id = stack.pop() ?? '';
    if (seen.has(id)) continue;
    seen.add(id);
    for (const r of byId.get(id)?.responses ?? []) if (r.next.type === 'scene') stack.push(r.next.sceneId);
  }
  return new Set(dialog.scenes.filter((s) => !seen.has(s.id)).map((s) => s.id));
}
