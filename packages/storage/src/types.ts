// SPDX-License-Identifier: Apache-2.0
import type { Readable } from 'node:stream';

/** Bytes to store: a buffer, or a stream whose length is known up front. */
export type BlobSource = Buffer | { stream: Readable; size: number };

export interface BlobRange {
  start: number;
  /** Inclusive, like an HTTP range. */
  end: number;
}

/**
 * Object storage as the application needs it: whole objects under slash
 * separated keys. Implemented by the file system (single node, Docker
 * Compose) and by S3-compatible services (Kubernetes, several replicas).
 */
export interface BlobStore {
  /** Size of the object, or null when it does not exist (or is not a regular file). */
  stat(key: string): Promise<{ size: number } | null>;
  /** Streams the object (or a byte range of it). Rejects with {@link BlobNotFound} when missing. */
  read(key: string, range?: BlobRange): Promise<Readable>;
  /** The whole object, or null when missing or larger than `maxBytes`. */
  readAll(key: string, maxBytes: number): Promise<Buffer | null>;
  /** Stores the object atomically (readers never see a partial file); replaces an existing one. */
  put(key: string, source: BlobSource): Promise<void>;
  remove(key: string): Promise<void>;
  /** Removes every object whose key starts with `prefix + '/'`. */
  removePrefix(prefix: string): Promise<void>;
  /** Names (not full keys) of the objects directly below `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

export class BlobNotFound extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'BlobNotFound';
  }
}

const MAX_KEY_LENGTH = 1000;

/**
 * Keys are relative, slash separated, and never leave their root: no empty,
 * `.` or `..` segments, no backslash, NUL or leading slash.
 */
export function assertKey(key: string): void {
  if (
    !key ||
    key.length > MAX_KEY_LENGTH ||
    key.includes('\0') ||
    key.includes('\\') ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw new Error(`Invalid storage key: ${key.slice(0, 80)}`);
}
