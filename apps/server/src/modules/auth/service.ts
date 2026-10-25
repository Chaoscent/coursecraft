// SPDX-License-Identifier: Apache-2.0
import { verifySync } from 'otplib';
import type { AppContext } from '../../http/context.js';
import { hashToken, randomToken } from '../../crypto/tokens.js';
import { verifyPassword } from '../../auth/passwords.js';
import type { SealedJson } from '../../db/schema.js';
import { getSsoPolicy } from '../sso/policy.js';

const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;
const CHALLENGE_MINUTES = 5;
const MAX_CHALLENGE_ATTEMPTS = 5;
// Second factor (F-09): total code guesses per account before a cool-down,
// counted across login challenges so repeated password logins cannot reset it.
const MAX_TOTP_FAILURES = 10;
const TOTP_LOCK_MINUTES = 60;
/** Accept codes from the previous and next 30 s step (clock drift). */
const TOTP_TOLERANCE_SECONDS = 30;

export type LoginOutcome =
  | { kind: 'ok'; userId: string }
  | { kind: 'totp'; challenge: string; userId: string }
  | {
      kind: 'failed';
      userId: string | null;
      reason: 'password' | 'locked' | 'disabled' | 'unknown' | 'local_disabled';
    };

export const totpAad = (userId: string) => `totp:${userId}`;

export function openTotpSecret(ctx: AppContext, userId: string, sealed: SealedJson): string {
  return ctx.box.open(sealed, totpAad(userId));
}

/**
 * Verifies a TOTP code and returns its time step, or null. Steps not newer
 * than the last accepted one are rejected (no replay within the window).
 */
export function checkTotp(secret: string, code: string, lastStep: string | null): number | null {
  const result = verifySync({ secret, token: code, epochTolerance: TOTP_TOLERANCE_SECONDS });
  if (!result.valid || !('timeStep' in result)) return null;
  const step = result.timeStep;
  if (lastStep !== null && step <= Number(lastStep)) return null;
  return step;
}

async function isAdministrator(ctx: AppContext, userId: string): Promise<boolean> {
  const row = await ctx.db
    .selectFrom('user_roles')
    .select('user_id')
    .where('user_id', '=', userId)
    .where('role', '=', 'admin')
    .executeTakeFirst();
  return !!row;
}

export async function passwordLogin(ctx: AppContext, email: string, password: string): Promise<LoginOutcome> {
  const now = new Date();
  const user = await ctx.db
    .selectFrom('users')
    .select([
      'id',
      'password_hash',
      'status',
      'locked_until',
      'failed_logins',
      'totp_last_step',
      'totp_locked_until',
    ])
    .where('email', '=', email.trim().toLowerCase())
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  const valid = await verifyPassword(user?.password_hash ?? null, password);
  if (!user) return { kind: 'failed', userId: null, reason: 'unknown' };
  if (user.locked_until && user.locked_until > now)
    return { kind: 'failed', userId: user.id, reason: 'locked' };
  if (!valid) {
    const failures = user.failed_logins + 1;
    const lock = failures >= MAX_FAILURES;
    await ctx.db
      .updateTable('users')
      .set({
        failed_logins: lock ? 0 : failures,
        locked_until: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.locked_until,
      })
      .where('id', '=', user.id)
      .execute();
    return { kind: 'failed', userId: user.id, reason: 'password' };
  }
  if (user.status !== 'active') return { kind: 'failed', userId: user.id, reason: 'disabled' };
  if ((await getSsoPolicy(ctx)).localLoginAdminOnly && !(await isAdministrator(ctx, user.id)))
    return { kind: 'failed', userId: user.id, reason: 'local_disabled' };

  await ctx.db
    .updateTable('users')
    .set({ failed_logins: 0, locked_until: null })
    .where('id', '=', user.id)
    .execute();

  if (user.totp_last_step !== null) {
    // The second factor is locked after too many wrong codes (F-09): no new challenge.
    if (user.totp_locked_until && user.totp_locked_until > now)
      return { kind: 'failed', userId: user.id, reason: 'locked' };
    const challenge = randomToken();
    await ctx.db
      .insertInto('login_challenges')
      .values({
        token_hash: hashToken(challenge),
        user_id: user.id,
        expires_at: new Date(now.getTime() + CHALLENGE_MINUTES * 60_000),
      })
      .execute();
    return { kind: 'totp', challenge, userId: user.id };
  }
  return { kind: 'ok', userId: user.id };
}

export async function totpLogin(
  ctx: AppContext,
  challenge: string,
  code: string,
): Promise<{ userId: string } | { failedUserId: string | null }> {
  const row = await ctx.db
    .selectFrom('login_challenges')
    .innerJoin('users', 'users.id', 'login_challenges.user_id')
    .select([
      'login_challenges.id',
      'login_challenges.user_id as userId',
      'login_challenges.expires_at as expiresAt',
      'login_challenges.attempts',
      'users.totp_secret as totpSecret',
      'users.totp_last_step as totpLastStep',
      'users.totp_failed as totpFailed',
      'users.totp_locked_until as totpLockedUntil',
      'users.status',
    ])
    .where('login_challenges.token_hash', '=', hashToken(challenge))
    .executeTakeFirst();
  if (!row) return { failedUserId: null };
  const now = new Date();
  if (
    row.expiresAt <= now ||
    row.attempts >= MAX_CHALLENGE_ATTEMPTS ||
    row.status !== 'active' ||
    !row.totpSecret ||
    (row.totpLockedUntil !== null && row.totpLockedUntil > now)
  ) {
    await ctx.db.deleteFrom('login_challenges').where('id', '=', row.id).execute();
    return { failedUserId: row.userId };
  }
  const step = checkTotp(openTotpSecret(ctx, row.userId, row.totpSecret), code, row.totpLastStep);
  if (step === null) {
    await ctx.db
      .updateTable('login_challenges')
      .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
      .where('id', '=', row.id)
      .execute();
    // Count the wrong code toward the per-account limit (F-09); lock after too many.
    const failed = row.totpFailed + 1;
    const lock = failed >= MAX_TOTP_FAILURES;
    await ctx.db
      .updateTable('users')
      .set({
        totp_failed: lock ? 0 : failed,
        totp_locked_until: lock ? new Date(now.getTime() + TOTP_LOCK_MINUTES * 60_000) : row.totpLockedUntil,
      })
      .where('id', '=', row.userId)
      .execute();
    return { failedUserId: row.userId };
  }
  await ctx.db.deleteFrom('login_challenges').where('id', '=', row.id).execute();
  await ctx.db
    .updateTable('users')
    .set({ totp_last_step: step, totp_failed: 0, totp_locked_until: null })
    .where('id', '=', row.userId)
    .execute();
  return { userId: row.userId };
}
