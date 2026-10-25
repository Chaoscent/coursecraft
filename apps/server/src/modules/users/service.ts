// SPDX-License-Identifier: Apache-2.0
import { assertUserQuota } from '../../tenancy/quotas.js';
import { ROLES, emailSchema, displayNameSchema, localeSchema, type Role } from '@coursecraft/shared';
import { parse } from 'csv-parse/sync';
import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { hashPassword } from '../../auth/passwords.js';
import type { Database } from '../../db/schema.js';
import type { AppContext } from '../../http/context.js';
import { AppError, conflict, notFound } from '../../http/errors.js';
import { countActiveAdmins } from './repo.js';

export interface UserChanges {
  email?: string | undefined;
  displayName?: string | undefined;
  locale?: 'de' | 'en' | undefined;
  status?: 'active' | 'disabled' | undefined;
  roles?: Role[] | undefined;
  groupIds?: string[] | undefined;
}

async function existingUser(db: Kysely<Database>, id: string) {
  const user = await db
    .selectFrom('users')
    .select(['id', 'status', 'email'])
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) throw notFound('User not found');
  return user;
}

async function setGroups(tx: Kysely<Database>, userId: string, groupIds: string[]): Promise<void> {
  const unique = [...new Set(groupIds)];
  if (unique.length) {
    const found = await tx.selectFrom('groups').select('id').where('id', 'in', unique).execute();
    if (found.length !== unique.length) throw new AppError('bad_request', 'Unknown group');
  }
  await tx.deleteFrom('group_members').where('user_id', '=', userId).execute();
  if (unique.length) {
    await tx
      .insertInto('group_members')
      .values(unique.map((group_id) => ({ group_id, user_id: userId })))
      .execute();
  }
}

async function emailTaken(db: Kysely<Database>, email: string, exceptId?: string): Promise<boolean> {
  let query = db.selectFrom('users').select('id').where('email', '=', email);
  if (exceptId) query = query.where('id', '!=', exceptId);
  return !!(await query.executeTakeFirst());
}

export async function createUser(
  ctx: AppContext,
  actorId: string,
  input: {
    email: string;
    displayName: string;
    locale: 'de' | 'en';
    roles: Role[];
    groupIds: string[];
    password: string;
  },
  ipHmac: string,
): Promise<string> {
  if (await emailTaken(ctx.db, input.email)) throw conflict('E-mail address already in use');
  await assertUserQuota(ctx);
  const passwordHash = await hashPassword(input.password);
  return ctx.db.transaction().execute(async (tx) => {
    const user = await tx
      .insertInto('users')
      .values({
        email: input.email,
        display_name: input.displayName,
        locale: input.locale,
        password_hash: passwordHash,
        must_change_password: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const roles = [...new Set(input.roles)];
    if (roles.length)
      await tx
        .insertInto('user_roles')
        .values(roles.map((role) => ({ user_id: user.id, role })))
        .execute();
    await setGroups(tx, user.id, input.groupIds);
    await ctx.audit.record(
      {
        actorUserId: actorId,
        action: 'user.created',
        targetType: 'user',
        targetId: user.id,
        meta: { roles },
        ipHmac,
      },
      tx,
    );
    return user.id;
  });
}

/**
 * Applies admin changes. Role or group changes rotate the user's sessions;
 * deactivation ends them. The last active admin cannot lose admin rights.
 */
export async function updateUser(
  ctx: AppContext,
  actorId: string,
  id: string,
  changes: UserChanges,
  ipHmac: string,
) {
  const user = await existingUser(ctx.db, id);
  if (changes.email && changes.email !== user.email && (await emailTaken(ctx.db, changes.email, id))) {
    throw conflict('E-mail address already in use');
  }
  const losesAdmin = (changes.roles && !changes.roles.includes('admin')) || changes.status === 'disabled';
  if (losesAdmin) {
    const isAdmin = await ctx.db
      .selectFrom('user_roles')
      .select('role')
      .where('user_id', '=', id)
      .where('role', '=', 'admin')
      .executeTakeFirst();
    if (isAdmin && (await countActiveAdmins(ctx.db, id)) === 0) {
      throw conflict('At least one active administrator must remain');
    }
  }

  await ctx.db.transaction().execute(async (tx) => {
    const set = {
      ...(changes.email !== undefined ? { email: changes.email } : {}),
      ...(changes.displayName !== undefined ? { display_name: changes.displayName } : {}),
      ...(changes.locale !== undefined ? { locale: changes.locale } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      updated_at: new Date(),
    };
    await tx.updateTable('users').set(set).where('id', '=', id).execute();
    if (changes.roles) {
      await tx.deleteFrom('user_roles').where('user_id', '=', id).execute();
      const roles = [...new Set(changes.roles)];
      if (roles.length)
        await tx
          .insertInto('user_roles')
          .values(roles.map((role) => ({ user_id: id, role })))
          .execute();
    }
    if (changes.groupIds) await setGroups(tx, id, changes.groupIds);
    await ctx.audit.record(
      {
        actorUserId: actorId,
        action: 'user.updated',
        targetType: 'user',
        targetId: id,
        meta: { fields: Object.keys(changes).filter((k) => changes[k as keyof UserChanges] !== undefined) },
        ipHmac,
      },
      tx,
    );
  });

  if (changes.status === 'disabled') await ctx.sessions.revokeAll(id);
  else if (changes.roles || changes.groupIds) await ctx.sessions.markRotate(id);
}

/**
 * Admin removal of a user's second factor (SECURITY_AUDIT.md F-09): the
 * recovery path when a learner loses their authenticator, since self-disable
 * now needs a current code. Clears the secret and the lockout and ends the
 * user's sessions.
 */
export async function resetTotp(ctx: AppContext, actorId: string, id: string, ipHmac: string) {
  await existingUser(ctx.db, id);
  await ctx.db
    .updateTable('users')
    .set({
      totp_secret: null,
      totp_last_step: null,
      totp_failed: 0,
      totp_locked_until: null,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .execute();
  await ctx.sessions.revokeAll(id);
  await ctx.audit.record({
    actorUserId: actorId,
    action: 'user.totp_reset',
    targetType: 'user',
    targetId: id,
    ipHmac,
  });
}

export async function resetPassword(
  ctx: AppContext,
  actorId: string,
  id: string,
  password: string,
  ipHmac: string,
) {
  await existingUser(ctx.db, id);
  await ctx.db
    .updateTable('users')
    .set({
      password_hash: await hashPassword(password),
      must_change_password: true,
      failed_logins: 0,
      locked_until: null,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .execute();
  await ctx.sessions.revokeAll(id);
  await ctx.audit.record({
    actorUserId: actorId,
    action: 'user.password_reset',
    targetType: 'user',
    targetId: id,
    ipHmac,
  });
}

export async function deleteUser(
  ctx: AppContext,
  actorId: string,
  id: string,
  ipHmac: string,
  erase: (tx: Kysely<Database>, id: string) => Promise<void>,
) {
  if (id === actorId) throw conflict('You cannot delete your own account here');
  await existingUser(ctx.db, id);
  if ((await countActiveAdmins(ctx.db, id)) === 0) {
    const isAdmin = await ctx.db
      .selectFrom('user_roles')
      .select('role')
      .where('user_id', '=', id)
      .where('role', '=', 'admin')
      .executeTakeFirst();
    if (isAdmin) throw conflict('At least one active administrator must remain');
  }
  await ctx.db.transaction().execute(async (tx) => {
    await erase(tx, id);
    await ctx.audit.record(
      { actorUserId: actorId, action: 'user.deleted', targetType: 'user', targetId: id, ipHmac },
      tx,
    );
  });
}

const MAX_IMPORT_ROWS = 5000;

interface ImportRow {
  line: number;
  email: string;
  status: 'created' | 'exists' | 'error';
  message?: string;
  initialPassword?: string;
}

/**
 * CSV columns: email, display_name, roles (separated by ";"), groups (names,
 * separated by ";"), locale. Created users get a one-time initial password
 * and must change it on first login.
 */
export async function importUsers(
  ctx: AppContext,
  actorId: string,
  csv: string,
  dryRun: boolean,
  ipHmac: string,
) {
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch {
    throw new AppError('bad_request', 'CSV could not be parsed');
  }
  if (records.length > MAX_IMPORT_ROWS)
    throw new AppError('payload_too_large', `At most ${MAX_IMPORT_ROWS} rows`);

  const groups = await ctx.db.selectFrom('groups').select(['id', 'name']).execute();
  const groupByName = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));
  const seen = new Set<string>();
  const rows: ImportRow[] = [];

  for (const [index, record] of records.entries()) {
    const line = index + 2;
    const email = emailSchema.safeParse(record['email'] ?? '');
    const name = displayNameSchema.safeParse(record['display_name'] ?? '');
    const locale = localeSchema.safeParse(record['locale'] || 'de');
    const roleNames = (record['roles'] || 'learner')
      .split(';')
      .map((r) => r.trim())
      .filter(Boolean);
    const groupNames = (record['groups'] ?? '')
      .split(';')
      .map((g) => g.trim())
      .filter(Boolean);
    const rawEmail = record['email'] ?? '';
    if (!email.success || !name.success || !locale.success) {
      rows.push({ line, email: rawEmail, status: 'error', message: 'Invalid e-mail, name or locale' });
      continue;
    }
    const roles = roleNames.filter((r): r is Role => (ROLES as readonly string[]).includes(r));
    if (roles.length !== roleNames.length) {
      rows.push({ line, email: email.data, status: 'error', message: 'Unknown role' });
      continue;
    }
    const groupIds = groupNames.map((g) => groupByName.get(g.toLowerCase()));
    if (groupIds.some((g) => !g)) {
      rows.push({ line, email: email.data, status: 'error', message: 'Unknown group' });
      continue;
    }
    if (seen.has(email.data) || (await emailTaken(ctx.db, email.data))) {
      rows.push({ line, email: email.data, status: 'exists' });
      continue;
    }
    seen.add(email.data);
    if (dryRun) {
      rows.push({ line, email: email.data, status: 'created' });
      continue;
    }
    const initialPassword = randomBytes(12).toString('base64url');
    await createUser(
      ctx,
      actorId,
      {
        email: email.data,
        displayName: name.data,
        locale: locale.data,
        roles,
        groupIds: groupIds.filter((g): g is string => !!g),
        password: initialPassword,
      },
      ipHmac,
    );
    rows.push({ line, email: email.data, status: 'created', initialPassword });
  }
  if (!dryRun) {
    await ctx.audit.record({
      actorUserId: actorId,
      action: 'user.imported',
      meta: { created: rows.filter((r) => r.status === 'created').length, rows: rows.length },
      ipHmac,
    });
  }
  return { dryRun, rows };
}
