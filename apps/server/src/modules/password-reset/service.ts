// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '../../auth/passwords.js';
import type { AppContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { mailEnabled, queueMail } from '../mail/service.js';
import { getSsoPolicy } from '../sso/policy.js';

export const RESET_MINUTES = 60;
// Per-account throttle (SECURITY_AUDIT.md F-10): at most one mail every few
// minutes and a handful per day, on top of the existing per-IP limit.
const RESET_THROTTLE_MINUTES = 5;
const RESET_MAX_PER_DAY = 5;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Queues a reset mail if the address belongs to an active account. The
 * answer and its timing do not depend on that (no account enumeration).
 * Refuses silently for accounts that only sign in through an identity
 * provider, and throttles per account (F-10).
 */
export async function requestReset(ctx: AppContext, email: string, ipHmac: string): Promise<void> {
  if (!(await mailEnabled(ctx))) return;
  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'status', 'password_hash', 'reset_requested_at', 'reset_count', 'reset_count_since'])
    .where('email', '=', email.toLowerCase())
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user || user.status !== 'active') return;

  // An account provisioned by an identity provider with no local password must
  // not gain one through a reset (it would survive IdP deprovisioning), unless
  // the operator allows it (F-10).
  if (user.password_hash === null) {
    const identity = await ctx.db
      .selectFrom('user_identities')
      .select('user_id')
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (identity && !(await getSsoPolicy(ctx)).allowPasswordResetForSsoUsers) return;
  }

  // Per-account throttle: one mail per window and a daily cap.
  const now = new Date();
  if (
    user.reset_requested_at &&
    now.getTime() - user.reset_requested_at.getTime() < RESET_THROTTLE_MINUTES * 60_000
  )
    return;
  const dayOpen =
    user.reset_count_since && now.getTime() - user.reset_count_since.getTime() < 24 * 60 * 60_000;
  const countToday = dayOpen ? user.reset_count : 0;
  if (countToday >= RESET_MAX_PER_DAY) return;

  const token = randomBytes(32).toString('base64url');
  await ctx.db.deleteFrom('password_resets').where('user_id', '=', user.id).execute();
  await ctx.db
    .insertInto('password_resets')
    .values({
      token_hash: sha256(token),
      user_id: user.id,
      expires_at: new Date(Date.now() + RESET_MINUTES * 60_000),
    })
    .execute();
  // The job table only ever sees the sealed token.
  await ctx.db
    .updateTable('users')
    .set({
      reset_requested_at: now,
      reset_count: countToday + 1,
      reset_count_since: dayOpen ? user.reset_count_since : now,
    })
    .where('id', '=', user.id)
    .execute();
  const sealed = ctx.box.seal(token, `password-reset:${user.id}`);
  await queueMail(ctx, {
    kind: 'passwordReset',
    userId: user.id,
    params: { token: JSON.stringify(sealed), minutes: String(RESET_MINUTES) },
  });
  await ctx.audit.record({
    actorUserId: user.id,
    action: 'user.password_reset_requested',
    targetType: 'user',
    targetId: user.id,
    ipHmac,
  });
}

/** Sets the new password with a valid token; the token is single-use and all sessions end. */
export async function confirmReset(
  ctx: AppContext,
  token: string,
  newPassword: string,
  ipHmac: string,
): Promise<void> {
  const row = await ctx.db
    .deleteFrom('password_resets')
    .where('token_hash', '=', sha256(token))
    .returning(['user_id', 'expires_at'])
    .executeTakeFirst();
  if (!row || row.expires_at < new Date())
    throw new AppError('bad_request', 'The link is invalid or has expired');
  await ctx.db
    .updateTable('users')
    .set({
      password_hash: await hashPassword(newPassword),
      must_change_password: false,
      failed_logins: 0,
      locked_until: null,
      updated_at: new Date(),
    })
    .where('id', '=', row.user_id)
    .where('status', '=', 'active')
    .execute();
  await ctx.sessions.revokeAll(row.user_id);
  await ctx.audit.record({
    actorUserId: row.user_id,
    action: 'user.password_reset_completed',
    targetType: 'user',
    targetId: row.user_id,
    ipHmac,
  });
}
