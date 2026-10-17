// SPDX-License-Identifier: Apache-2.0
import type { LockInfo } from '@coursecraft/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { AuthState } from '../../http/context.js';
import { conflict } from '../../http/errors.js';

/** A lock without heartbeat for this long is free again (closed tab, crash). */
export const LOCK_TIMEOUT_MS = 60_000;

const fresh = (heartbeat: Date) => Date.now() - heartbeat.getTime() < LOCK_TIMEOUT_MS;

export async function currentLock(
  db: Kysely<Database>,
  courseId: string,
  auth: AuthState,
): Promise<LockInfo | null> {
  const row = await db
    .selectFrom('course_locks')
    .innerJoin('users', 'users.id', 'course_locks.user_id')
    .select([
      'course_locks.user_id',
      'course_locks.session_id',
      'course_locks.heartbeat_at',
      'users.display_name',
    ])
    .where('course_locks.course_id', '=', courseId)
    .executeTakeFirst();
  if (!row || !fresh(row.heartbeat_at)) return null;
  return {
    userId: row.user_id,
    userName: row.display_name,
    mine: row.session_id === auth.sessionId,
    heartbeatAt: row.heartbeat_at.toISOString(),
  };
}

/** Acquires or renews the soft lock for this session. Returns false if someone else holds it. */
export async function acquireLock(db: Kysely<Database>, courseId: string, auth: AuthState): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('course_locks')
      .select(['session_id', 'heartbeat_at'])
      .where('course_id', '=', courseId)
      .forUpdate()
      .executeTakeFirst();
    if (row && row.session_id !== auth.sessionId && fresh(row.heartbeat_at)) return false;
    const now = new Date();
    await tx
      .insertInto('course_locks')
      .values({
        course_id: courseId,
        user_id: auth.userId,
        session_id: auth.sessionId,
        acquired_at: now,
        heartbeat_at: now,
      })
      .onConflict((oc) =>
        oc
          .column('course_id')
          .doUpdateSet(
            row?.session_id === auth.sessionId
              ? { heartbeat_at: now }
              : { user_id: auth.userId, session_id: auth.sessionId, acquired_at: now, heartbeat_at: now },
          ),
      )
      .execute();
    return true;
  });
}

export async function releaseLock(db: Kysely<Database>, courseId: string, auth: AuthState): Promise<void> {
  await db
    .deleteFrom('course_locks')
    .where('course_id', '=', courseId)
    .where('session_id', '=', auth.sessionId)
    .execute();
}

export async function breakLock(db: Kysely<Database>, courseId: string): Promise<void> {
  await db.deleteFrom('course_locks').where('course_id', '=', courseId).execute();
}

/** Every change requires the caller's session to hold the lock. */
export async function assertLockHeld(db: Kysely<Database>, courseId: string, auth: AuthState): Promise<void> {
  const lock = await currentLock(db, courseId, auth);
  if (!lock?.mine)
    throw conflict(
      lock ? `The course is being edited by ${lock.userName}` : 'Open the course for editing first',
    );
}
