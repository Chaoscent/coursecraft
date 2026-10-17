// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { AuthState } from '../http/context.js';
import { notFound } from '../http/errors.js';

export interface CourseAccess {
  courseId: string;
  ownerId: string;
  /** Owner or administrator: may manage members, break locks, delete. */
  canManage: boolean;
}

/**
 * Course-level authorization: administrators, the owner and listed editors
 * may edit. Everyone else gets "not found", so course ids do not leak.
 */
export async function assertCourseEditor(
  db: Kysely<Database>,
  auth: AuthState,
  courseId: string,
): Promise<CourseAccess> {
  const course = await db
    .selectFrom('courses')
    .select(['id', 'owner_id'])
    .where('id', '=', courseId)
    .executeTakeFirst();
  if (!course) throw notFound('Course not found');
  const isAdmin = auth.roles.includes('admin');
  const isOwner = course.owner_id === auth.userId;
  if (!isAdmin && !isOwner) {
    const member = await db
      .selectFrom('course_members')
      .select('user_id')
      .where('course_id', '=', courseId)
      .where('user_id', '=', auth.userId)
      .executeTakeFirst();
    if (!member) throw notFound('Course not found');
  }
  return { courseId, ownerId: course.owner_id, canManage: isAdmin || isOwner };
}

/** Restricts a course list query to courses the caller may edit. */
export function editableCourseIds(db: Kysely<Database>, auth: AuthState) {
  if (auth.roles.includes('admin')) return null;
  return db
    .selectFrom('courses')
    .select('id')
    .where((eb) =>
      eb.or([
        eb('owner_id', '=', auth.userId),
        eb.exists(
          eb
            .selectFrom('course_members')
            .select('user_id')
            .whereRef('course_members.course_id', '=', 'courses.id')
            .where('course_members.user_id', '=', auth.userId),
        ),
      ]),
    );
}
