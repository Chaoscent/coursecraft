// SPDX-License-Identifier: Apache-2.0
import {
  conversionResponseSchema,
  startConversionResponseSchema,
  type ConversionResponse,
} from '@coursecraft/shared';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/errors.js';
import { videoElement } from './model.js';
import type { EditorStore } from './store.js';

const POLL_MS = 1000;

export type ConvertedMedia = NonNullable<ConversionResponse['asset']>;

/** Error whose message is already translated for the author. */
export class MediaError extends Error {}
export const describeMediaError = (e: unknown) => (e instanceof MediaError ? e.message : errorMessage(e));

/** Sends a recording or media file to the converter and waits for the result. */
export async function convertMedia(
  courseId: string,
  file: Blob,
  name: string,
  options: { target: 'audio' | 'video'; normalize?: boolean; trimStartMs?: number; trimEndMs?: number },
  failedMessage: string,
): Promise<ConvertedMedia> {
  const form = new FormData();
  form.append('file', file, name);
  const query: Record<string, string> = {
    target: options.target,
    normalize: String(options.normalize ?? false),
  };
  if (options.trimStartMs) query['trimStartMs'] = String(Math.round(options.trimStartMs));
  if (options.trimEndMs !== undefined) query['trimEndMs'] = String(Math.round(options.trimEndMs));
  const { conversionId } = await api(startConversionResponseSchema, `/api/courses/${courseId}/media`, {
    method: 'POST',
    form,
    query,
  });
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const c = await api(conversionResponseSchema, `/api/conversions/${conversionId}`);
    if (c.status === 'failed') throw new MediaError(failedMessage);
    if (c.status === 'done' && c.asset) return c.asset;
  }
}

/** Registers a converted video (MP4, WebM, poster) and places it on the current slide. */
export function insertConvertedVideo(
  store: EditorStore,
  media: ConvertedMedia,
  size?: { width: number; height: number },
): string | null {
  const { lang, nodeId, course } = store.getState();
  const slide = nodeId ? course.nodes[nodeId] : undefined;
  if (slide?.kind !== 'slide') return null;
  const element = videoElement(lang, media.sha256, {
    ...(media.webm ? { webm: media.webm.sha256 } : {}),
    ...(media.poster ? { poster: media.poster.sha256 } : {}),
    ...(size ? { size, canvas: course.settings.canvas } : {}),
  });
  store.getState().change((draft) => {
    for (const a of [media, media.webm, media.poster]) {
      if (a) draft.assets[a.sha256] = { mime: a.mime, size: a.size, name: a.name };
    }
    const s = draft.nodes[slide.id];
    if (s?.kind === 'slide') s.elements.push(element);
  });
  store.getState().select([element.id]);
  return element.id;
}
