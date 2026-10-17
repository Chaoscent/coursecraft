// SPDX-License-Identifier: Apache-2.0
import { Transformer } from '@napi-rs/image';
import createDOMPurify from 'dompurify';
import { fileTypeFromBuffer } from 'file-type';
import { JSDOM } from 'jsdom';
import { AppError } from '../../http/errors.js';
import { EXTENSIONS } from './store.js';

export interface CleanFile {
  bytes: Buffer;
  mime: string;
}

const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PASS_THROUGH = new Set([
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
]);
const MP4_AUDIO_BRANDS = /^M4A |^M4B /;

let purify: ReturnType<typeof createDOMPurify> | undefined;
function svgPurifier() {
  purify ??= createDOMPurify(new JSDOM('').window);
  return purify;
}

function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

function isWebVtt(bytes: Buffer): boolean {
  const text = bytes.toString('utf8');
  return /^\uFEFF?WEBVTT(\s|$)/.test(text) && !text.includes('\u0000');
}

/**
 * Accepts only known media types, identified by content (magic bytes), never
 * by file name or client-supplied type. Raster images are re-encoded, which
 * drops metadata (EXIF, GPS) and anything appended to the image; SVG is
 * sanitized to plain vector content.
 */
export async function sanitizeUpload(bytes: Buffer): Promise<CleanFile> {
  if (looksLikeSvg(bytes)) {
    const clean = svgPurifier().sanitize(bytes.toString('utf8'), {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['foreignObject', 'script', 'style', 'a'],
      FORBID_ATTR: ['href', 'xlink:href'],
    });
    if (!clean.trim().startsWith('<svg'))
      throw new AppError('unsupported_media_type', 'SVG could not be read');
    return { bytes: Buffer.from(clean, 'utf8'), mime: 'image/svg+xml' };
  }
  if (isWebVtt(bytes)) return { bytes, mime: 'text/vtt' };

  const detected = await fileTypeFromBuffer(bytes);
  let mime: string | undefined = detected?.mime;
  if (
    mime === 'audio/x-m4a' ||
    (mime === 'video/mp4' && MP4_AUDIO_BRANDS.test(bytes.subarray(8, 12).toString('latin1')))
  ) {
    mime = 'audio/mp4';
  }
  if (mime === 'audio/x-wav' || mime === 'audio/vnd.wave') mime = 'audio/wav';
  if (!mime) throw new AppError('unsupported_media_type', 'Unknown file type');

  if (RASTER.has(mime)) {
    try {
      const image = new Transformer(bytes);
      const out =
        mime === 'image/jpeg'
          ? await image.jpeg(90)
          : mime === 'image/webp'
            ? await image.webpLossless()
            : await image.png();
      return { bytes: Buffer.from(out), mime };
    } catch {
      throw new AppError('unsupported_media_type', 'Image could not be read');
    }
  }
  if (PASS_THROUGH.has(mime) && EXTENSIONS[mime]) return { bytes, mime };
  throw new AppError('unsupported_media_type', `File type ${mime} is not supported`);
}
