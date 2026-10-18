// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertKey, BlobNotFound, type BlobRange, type BlobSource, type BlobStore } from './types.js';

/** Objects as files below one directory. Never follows symbolic links. */
export class FsBlobStore implements BlobStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #path(key: string): string {
    assertKey(key);
    const full = join(this.#root, key);
    if (!full.startsWith(this.#root + sep)) throw new Error('Invalid storage key');
    return full;
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const stat = await lstat(this.#path(key));
      return stat.isFile() ? { size: stat.size } : null;
    } catch {
      return null;
    }
  }

  async read(key: string, range?: BlobRange): Promise<Readable> {
    let handle;
    try {
      handle = await open(this.#path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new BlobNotFound(key);
    }
    if (!(await handle.stat()).isFile()) {
      await handle.close();
      throw new BlobNotFound(key);
    }
    return handle.createReadStream(range ? { start: range.start, end: range.end } : {});
  }

  async readAll(key: string, maxBytes: number): Promise<Buffer | null> {
    let handle;
    try {
      handle = await open(this.#path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return null;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) return null;
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async put(key: string, source: BlobSource): Promise<void> {
    const target = this.#path(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o750 });
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      if (Buffer.isBuffer(source)) await writeFile(temp, source, { mode: 0o640 });
      else await pipeline(source.stream, createWriteStream(temp, { flags: 'wx', mode: 0o640 }));
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }

  async removePrefix(prefix: string): Promise<void> {
    await rm(this.#path(prefix), { recursive: true, force: true });
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const entries = await readdir(this.#path(prefix), { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && !e.name.endsWith('.tmp'))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }
}
