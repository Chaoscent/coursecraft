// SPDX-License-Identifier: Apache-2.0
import { verifySync } from 'otplib';
import type { AppContext } from '../../http/context.js';
import { hashToken, randomToken } from '../../crypto/tokens.js';
import { verifyPassword } from '../../auth/passwords.js';
import type { SealedJson } from '../../db/schema.js';

const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;
const CHALLENGE_MINUTES = 5;
const MAX_CHALLENGE_ATTEMPTS = 5;
/** Accept codes from the previous and next 30 s step (clock drift). */
const TOTP_TOLERANCE_SECONDS = 30;

export type LoginOutcome =
  | { kind: 'ok'; userId: string }
  | { kind: 'totp'; challenge: string; userId: string }
  | { kind: 'failed'; userId: string | null; reason: 'password' | 'locked' | 'disabled' | 'unknown' };

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

export async function passwordLogin(ctx: AppContext, email: string, password: string): Promise<LoginOutcome> {
  const now = new Date();
  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'password_hash', 'status', 'locked_until', 'failed_logins', 'totp_last_step'])
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

  await ctx.db
    .updateTable('users')
    .set({ failed_logins: 0, locked_until: null })
    .where('id', '=', user.id)
    .execute();

  if (user.totp_last_step !== null) {
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
      'users.status',
    ])
    .where('login_challenges.token_hash', '=', hashToken(challenge))
    .executeTakeFirst();
  if (!row) return { failedUserId: null };
  if (
    row.expiresAt <= new Date() ||
    row.attempts >= MAX_CHALLENGE_ATTEMPTS ||
    row.status !== 'active' ||
    !row.totpSecret
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
    return { failedUserId: row.userId };
  }
  await ctx.db.deleteFrom('login_challenges').where('id', '=', row.id).execute();
  await ctx.db.updateTable('users').set({ totp_last_step: step }).where('id', '=', row.userId).execute();
  return { userId: row.userId };
}
