// SPDX-License-Identifier: Apache-2.0
import { ssoPolicySchema, type SsoPolicy } from '@coursecraft/shared';
import type { AppContext, AuthState } from '../../http/context.js';

const KEY = 'sso_policy';

export async function getSsoPolicy(ctx: AppContext): Promise<SsoPolicy> {
  const row = await ctx.db.selectFrom('settings').select('value').where('key', '=', KEY).executeTakeFirst();
  const parsed = ssoPolicySchema.safeParse(row?.value);
  return parsed.success ? parsed.data : { localLoginAdminOnly: false, allowPasswordResetForSsoUsers: false };
}

export async function saveSsoPolicy(ctx: AppContext, auth: AuthState, input: SsoPolicy): Promise<void> {
  await ctx.db
    .insertInto('settings')
    .values({ key: KEY, value: JSON.stringify(input) })
    .onConflict((oc) =>
      oc.constraint('settings_pkey').doUpdateSet({ value: JSON.stringify(input), updated_at: new Date() }),
    )
    .execute();
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'settings.sso_policy_updated',
    targetType: 'settings',
    targetId: KEY,
    meta: { ...input },
  });
}
