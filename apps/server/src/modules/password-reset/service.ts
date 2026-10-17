// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '../../auth/passwords.js';
import type { AppContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { mailEnabled, queueMail } from '../mail/service.js';

export const RESET_MINUTES = 60;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Queues a reset mail if the address belongs to an active account. The
 * answer and its timing do not depend on that (no account enumeration).
 */
export async function requestReset(ctx: AppContext, email: string, ipHmac: string): Promise<void> {
  if (!(await mailEnabled(ctx))) return;
  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'status'])
    .where('email', '=', email.toLowerCase())
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user || user.status !== 'active') return;
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
