// SPDX-License-Identifier: Apache-2.0
import {
  COURSE_FORMAT,
  CURRENT_FORMAT_VERSION,
  courseSettingsSchema,
  slideNodeSchema,
  type CourseNode,
} from '@coursecraft/course-model';
import type { Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { Database } from '../../db/schema.js';
import { notFound } from '../../http/errors.js';

export const newId = (prefix: string) => `${prefix}-${randomBytes(6).toString('base64url')}`;

export interface CourseDocument {
  course: Record<string, unknown>;
  rev: number;
  nodeRevs: Record<string, number>;
}

/** Assembles the course document (course-model format) from its rows. */
export async function loadDocument(db: Kysely<Database>, courseId: string): Promise<CourseDocument> {
  const row = await db.selectFrom('courses').selectAll().where('id', '=', courseId).executeTakeFirst();
  if (!row) throw notFound('Course not found');
  const nodes = await db
    .selectFrom('course_nodes')
    .select(['node_id', 'doc', 'rev'])
    .where('course_id', '=', courseId)
    .execute();
  const assets = await db
    .selectFrom('course_assets')
    .innerJoin('assets', 'assets.sha256', 'course_assets.sha256')
    .select(['assets.sha256', 'assets.mime', 'assets.size', 'course_assets.name'])
    .where('course_assets.course_id', '=', courseId)
    .execute();
  return {
    rev: row.rev,
    nodeRevs: Object.fromEntries(nodes.map((n) => [n.node_id, n.rev])),
    course: {
      format: COURSE_FORMAT,
      formatVersion: row.format_version,
      id: row.id,
      meta: row.meta,
      languages: row.languages,
      settings: row.settings,
      assets: Object.fromEntries(
        assets.map((a) => [a.sha256, { mime: a.mime, size: Number(a.size), name: a.name }]),
      ),
      structure: row.structure,
      nodes: Object.fromEntries(nodes.map((n) => [n.node_id, n.doc])),
    },
  };
}

const DEFAULT_CHAPTER: Record<string, string> = { de: 'Kapitel 1', en: 'Chapter 1' };

export function blankSlide(lang: string, title: string): CourseNode {
  const id = newId('s');
  return slideNodeSchema.parse({
    kind: 'slide',
    id,
    title: { [lang]: title },
    elements: [
      {
        id: newId('e'),
        name: 'Title',
        type: 'text',
        frame: { x: 80, y: 60, width: 1120, height: 100 },
        content: {
          [lang]: {
            type: 'doc',
            content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }],
          },
        },
        style: { sizePx: 40, color: 'theme:accent' },
      },
    ],
  });
}

export interface NewCourse {
  title: string;
  lang: string;
  canvas?: { width: number; height: number };
  chapters: { id: string; title: string; nodeIds: string[] }[];
  nodes: CourseNode[];
}

/** Inserts a complete course inside an open transaction; returns its id. */
export async function insertCourse(
  tx: Kysely<Database>,
  owner: { id: string; displayName: string },
  input: NewCourse,
): Promise<string> {
  const now = new Date().toISOString();
  const settings = courseSettingsSchema.parse(input.canvas ? { canvas: input.canvas } : {});
  const course = await tx
    .insertInto('courses')
    .values({
      title: input.title,
      owner_id: owner.id,
      format_version: CURRENT_FORMAT_VERSION,
      meta: JSON.stringify({
        title: { [input.lang]: input.title },
        authors: [owner.displayName],
        createdAt: now,
        updatedAt: now,
      }),
      languages: JSON.stringify({ default: input.lang, available: [input.lang] }),
      settings: JSON.stringify(settings),
      structure: JSON.stringify({
        chapters: input.chapters.map((c) => ({
          id: c.id,
          title: { [input.lang]: c.title },
          nodeIds: c.nodeIds,
        })),
      }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (input.nodes.length)
    await tx
      .insertInto('course_nodes')
      .values(
        input.nodes.map((node) => ({
          course_id: course.id,
          node_id: node.id,
          kind: node.kind,
          doc: JSON.stringify(node),
          updated_by: owner.id,
        })),
      )
      .execute();
  return course.id;
}

export async function createCourse(
  db: Kysely<Database>,
  owner: { id: string; displayName: string },
  title: string,
  lang: string,
): Promise<string> {
  const slide = blankSlide(lang, title);
  const short = lang.slice(0, 2);
  return db.transaction().execute((tx) =>
    insertCourse(tx, owner, {
      title,
      lang,
      chapters: [{ id: newId('ch'), title: DEFAULT_CHAPTER[short] ?? 'Chapter 1', nodeIds: [slide.id] }],
      nodes: [slide],
    }),
  );
}
