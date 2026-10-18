// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { BlobRange, BlobStore } from '@coursecraft/storage';

export { ASSET_EXTENSIONS as EXTENSIONS } from '@coursecraft/course-model';

/**
 * Content-addressed file storage outside any served directory:
 * `assets/<sha[0:2]>/<sha>`. Identical files are stored once.
 */
export class AssetStore {
  readonly #blobs: BlobStore;

  constructor(blobs: BlobStore) {
    this.#blobs = blobs;
  }

  #key(sha256: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid asset hash');
    return `assets/${sha256.slice(0, 2)}/${sha256}`;
  }

  async has(sha256: string): Promise<boolean> {
    return (await this.#blobs.stat(this.#key(sha256))) !== null;
  }

  async size(sha256: string): Promise<number> {
    const stat = await this.#blobs.stat(this.#key(sha256));
    if (!stat) throw new Error('Asset is missing');
    return stat.size;
  }

  /** Stores bytes; returns the hash. Writes are atomic, and an existing file is left alone. */
  async put(bytes: Buffer): Promise<string> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!(await this.has(sha256))) await this.#blobs.put(this.#key(sha256), bytes);
    return sha256;
  }

  open(sha256: string, range?: BlobRange): Promise<Readable> {
    return this.#blobs.read(this.#key(sha256), range);
  }
}
