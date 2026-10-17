// SPDX-License-Identifier: Apache-2.0
import { slideNodeSchema, type CourseNode } from '@coursecraft/course-model';
import type { ImportWarning } from '@coursecraft/shared';
import { Transformer } from '@napi-rs/image';
import type { Kysely } from 'kysely';
import { posix } from 'node:path';
import type { Database } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { ZipArchive, type ZipLimits } from '../../lib/zip.js';
import { storeAsset, type StoredAsset } from '../assets/service.js';
import type { AssetStore } from '../assets/store.js';
import { newId } from '../courses/document.js';
import { parsePresentation, type PendingImage } from './parse.js';

export const PPTX_LIMITS: ZipLimits = {
  maxEntries: 20_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 200 * 1024 * 1024,
  maxRatio: 200,
};

/** Everything needed to create the course once the slide images are rendered. */
export interface ImportPayload {
  title: string;
  lang: string;
  canvas: { width: number; height: number };
  chapters: { id: string; title: string; nodeIds: string[] }[];
  nodes: CourseNode[];
  /** Per node: page of the rendering (slide position incl. hidden slides) and whether content was skipped. */
  pages: { nodeId: string; index: number; lossy: boolean }[];
  assets: { sha256: string; name: string }[];
  warnings: ImportWarning[];
  totalSlides: number;
}

type Json = Record<string, unknown>;

async function imageBytes(zip: ZipArchive, image: PendingImage): Promise<Buffer> {
  const bytes = await zip.read(image.part);
  const ext = posix.extname(image.part).slice(1).toLowerCase();
  if (!image.crop && ext !== 'bmp') return bytes;
  const transformer = new Transformer(bytes);
  if (image.crop) {
    const { width, height } = await transformer.metadata();
    const c = image.crop;
    const x = Math.max(0, Math.round(width * c.left));
    const y = Math.max(0, Math.round(height * c.top));
    const w = Math.max(1, Math.min(width - x, Math.round(width * (1 - c.left - c.right))));
    const h = Math.max(1, Math.min(height - y, Math.round(height * (1 - c.top - c.bottom))));
    transformer.crop(x, y, w, h);
  }
  return transformer.png();
}

/** Replaces pending image keys with stored assets; drops elements whose image failed. */
function resolveImages(node: Json, stored: Map<string, StoredAsset>): boolean {
  let dropped = false;
  const fix = (elements: Json[]): Json[] =>
    elements.flatMap((el) => {
      const image = el['image'] as { $asset: string } | undefined;
      if (image) {
        const asset = stored.get(image.$asset);
        if (!asset) {
          dropped = true;
          return [];
        }
        el['image'] = { $asset: asset.sha256 };
      }
      if (Array.isArray(el['children'])) {
        const kids = fix(el['children'] as Json[]);
        if (!kids.length) return [];
        el['children'] = kids;
      }
      return [el];
    });
  node['elements'] = fix(node['elements'] as Json[]);
  const background = node['background'] as { image?: { $asset: string } };
  if (background.image) {
    const asset = stored.get(background.image.$asset);
    if (asset) background.image = { $asset: asset.sha256 };
    else {
      delete background.image;
      dropped = true;
    }
  }
  return dropped;
}

/**
 * Parses a presentation and stores its pictures. The course itself is
 * created later, together with the rendered slide images.
 */
export async function preparePresentation(
  db: Kysely<Database>,
  store: AssetStore,
  bytes: Buffer,
  options: { lang: string; fileName: string; userId: string },
): Promise<ImportPayload> {
  const zip = await ZipArchive.open(bytes, PPTX_LIMITS);
  try {
    const fileTitle =
      posix
        .basename(options.fileName)
        .replace(/\.(pptx|ppsx|potx)$/i, '')
        .slice(0, 200) || 'Import';
    const parsed = await parsePresentation(zip, { lang: options.lang, fileTitle });
    const stored = new Map<string, StoredAsset>();
    const byPart = new Map<string, StoredAsset>();
    for (const image of parsed.images) {
      const cacheKey = `${image.part}|${JSON.stringify(image.crop ?? null)}`;
      const cached = byPart.get(cacheKey);
      if (cached) {
        stored.set(image.key, cached);
        continue;
      }
      try {
        const asset = await storeAsset(
          db,
          store,
          await imageBytes(zip, image),
          posix.basename(image.part).slice(0, 200),
          options.userId,
        );
        stored.set(image.key, asset);
        byPart.set(cacheKey, asset);
      } catch {
        // Unreadable picture: left out; the rendered slide image still shows it.
      }
    }
    const warnings = [...parsed.warnings];
    const nodes: CourseNode[] = [];
    const pages: ImportPayload['pages'] = [];
    for (const [i, slide] of parsed.slides.entries()) {
      const dropped = resolveImages(slide.node, stored);
      if (dropped) warnings.push({ code: 'unsupported_image', slide: i + 1 });
      const result = slideNodeSchema.safeParse(slide.node);
      if (!result.success) throw new AppError('invalid_file', `Slide ${i + 1} could not be converted`);
      nodes.push(result.data);
      pages.push({ nodeId: result.data.id, index: slide.index, lossy: slide.lossy || dropped });
    }
    const unique = new Map([...stored.values()].map((a) => [a.sha256, { sha256: a.sha256, name: a.name }]));
    return {
      title: parsed.title,
      lang: options.lang,
      canvas: parsed.canvas,
      chapters: parsed.chapters.map((c) => ({ id: newId('ch'), title: c.title, nodeIds: c.slideIds })),
      nodes,
      pages,
      assets: [...unique.values()],
      warnings,
      totalSlides: parsed.totalSlides,
    };
  } finally {
    zip.close();
  }
}

/** Adds rendered slide images (by page index) to the parsed slides. */
export function withRenderedPages(payload: ImportPayload, pages: ReadonlyMap<number, string>): CourseNode[] {
  return payload.nodes.map((node) => {
    const page = payload.pages.find((p) => p.nodeId === node.id);
    const sha = page ? pages.get(page.index) : undefined;
    if (node.kind !== 'slide' || !sha) return node;
    return { ...node, fallbackImage: { $asset: sha }, useFallbackImage: page?.lossy ?? false };
  });
}
