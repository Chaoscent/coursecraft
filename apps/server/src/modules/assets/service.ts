// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { basename } from 'node:path';
import type { Database } from '../../db/schema.js';
import { sanitizeUpload } from './sanitize.js';
import type { AssetStore } from './store.js';

export interface StoredAsset {
  sha256: string;
  mime: string;
  size: number;
  name: string;
}

/** Display name for an uploaded file: no directories, no control or markup characters. */
export function displayName(fileName: string | undefined, fallback = 'file'): string {
  return (
    basename(fileName || fallback)
      .replace(/[^\p{L}\p{N}._ -]/gu, '_')
      .slice(0, 200) || fallback
  );
}

/** Sanitises and stores a file, and records it in the asset table. */
export async function storeAsset(
  db: Kysely<Database>,
  store: AssetStore,
  bytes: Buffer,
  name: string,
  userId: string | null,
): Promise<StoredAsset> {
  const clean = await sanitizeUpload(bytes);
  const sha256 = await store.put(clean.bytes);
  await db
    .insertInto('assets')
    .values({ sha256, mime: clean.mime, size: clean.bytes.length, created_by: userId })
    .onConflict((oc) => oc.constraint('assets_pkey').doNothing())
    .execute();
  return { sha256, mime: clean.mime, size: clean.bytes.length, name };
}

export async function attachAssets(
  db: Kysely<Database>,
  courseId: string,
  assets: readonly { sha256: string; name: string }[],
): Promise<void> {
  if (!assets.length) return;
  await db
    .insertInto('course_assets')
    .values(assets.map((a) => ({ course_id: courseId, sha256: a.sha256, name: a.name })))
    .onConflict((oc) => oc.columns(['course_id', 'sha256']).doNothing())
    .execute();
}
