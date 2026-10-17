// SPDX-License-Identifier: Apache-2.0
// No dependencies: imported by the player, which must stay small.

/** File extension per stored MIME type (exports, downloads). */
export const ASSET_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'text/vtt': 'vtt',
};

/** Path of an asset inside an exported package. */
export function assetFileName(sha256: string, mime: string): string {
  return `assets/${sha256}.${ASSET_EXTENSIONS[mime] ?? 'bin'}`;
}
