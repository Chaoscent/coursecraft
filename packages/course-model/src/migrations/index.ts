// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { COURSE_FORMAT, CURRENT_FORMAT_VERSION, courseSchema, type Course } from '../course.js';

/**
 * `MIGRATIONS[n]` upgrades a document from version n-1 to n. Migrations are
 * pure functions on plain JSON and must never be changed once released.
 */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONS: Readonly<Record<number, Migration>> = {};

const envelopeSchema = z
  .object({ format: z.literal(COURSE_FORMAT), formatVersion: z.number().int().min(1) })
  .loose();

export class CourseFormatError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(message);
    this.name = 'CourseFormatError';
    this.issues = issues;
  }
}

/** Upgrades a course document of any released version and validates it. */
export function loadCourse(raw: unknown): Course {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new CourseFormatError('Not a Lernwerk course document', envelope.error.issues);
  }
  let doc: Record<string, unknown> = envelope.data;
  const from = envelope.data.formatVersion;
  if (from > CURRENT_FORMAT_VERSION) {
    throw new CourseFormatError(
      `Course format ${from} is newer than supported version ${CURRENT_FORMAT_VERSION}`,
    );
  }
  for (let version = from + 1; version <= CURRENT_FORMAT_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new CourseFormatError(`Missing migration to format ${version}`);
    doc = { ...migrate(doc), formatVersion: version };
  }
  const parsed = courseSchema.safeParse(doc);
  if (!parsed.success) throw new CourseFormatError('Invalid course document', parsed.error.issues);
  return parsed.data;
}
