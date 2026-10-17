// SPDX-License-Identifier: Apache-2.0
import { constants } from 'node:fs';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { safeEntryPath, type ZipArchive, type ZipLimits } from '../../lib/zip.js';

export const PACKAGE_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxTotalBytes: 4 * 1024 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxRatio: 200,
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Media types for files inside learning packages, by extension. */
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  xml: 'application/xml',
  xsd: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
};

export function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}

export interface PackageFile {
  path: string;
  size: number;
  type: string;
}

/**
 * Extracted learning packages: `<data>/packages/<id>/…`. Served only on the
 * content origin, after the launch token was checked.
 */
export class PackageStore {
  readonly #root: string;

  constructor(dataDir: string) {
    this.#root = join(dataDir, 'packages');
  }

  dir(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid package id');
    return join(this.#root, id);
  }

  async extract(id: string, zip: ZipArchive): Promise<number> {
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true, mode: 0o750 });
    try {
      return await zip.extractTo(dir);
    } catch (error) {
      await this.remove(id);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }

  /** A regular file inside the package, or null (missing, directory, symlink, unsafe path). */
  async file(id: string, relative: string): Promise<PackageFile | null> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(relative);
    } catch {
      return null;
    }
    const safe = safeEntryPath(decoded);
    if (!safe) return null;
    const full = join(this.dir(id), safe);
    if (!full.startsWith(this.dir(id) + sep)) return null;
    try {
      const stat = await lstat(full);
      if (!stat.isFile()) return null;
      // Refuse symlinks anywhere on the way (none are extracted, but be strict).
      const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      await handle.close();
      return { path: full, size: stat.size, type: contentType(safe) };
    } catch {
      return null;
    }
  }
}
