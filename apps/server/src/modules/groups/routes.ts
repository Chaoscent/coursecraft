// SPDX-License-Identifier: Apache-2.0
import {
  createGroupRequestSchema,
  groupMembersRequestSchema,
  groupSchema,
  idParamSchema,
  listGroupsResponseSchema,
  okSchema,
  updateGroupRequestSchema,
} from '@lernwerk/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { requireAuth } from '../../auth/plugin.js';
import type { Database } from '../../db/schema.js';
import type { AppContext } from '../../http/context.js';
import { AppError, conflict, notFound } from '../../http/errors.js';

async function listGroups(db: Kysely<Database>, ids?: string[]) {
  let query = db
    .selectFrom('groups')
    .leftJoin('group_members', 'group_members.group_id', 'groups.id')
    .select((eb) => [
      'groups.id',
      'groups.name',
      'groups.parent_id',
      eb.fn.count<string>('group_members.user_id').as('members'),
    ])
    .groupBy('groups.id')
    .orderBy('groups.name');
  if (ids) query = query.where('groups.id', 'in', ids);
  const rows = await query.execute();
  return rows.map((g) => ({ id: g.id, name: g.name, parentId: g.parent_id, memberCount: Number(g.members) }));
}

/** A group may not become its own ancestor. */
async function assertNoCycle(db: Kysely<Database>, groupId: string, parentId: string | null): Promise<void> {
  let current = parentId;
  for (let depth = 0; current && depth < 100; depth++) {
    if (current === groupId) throw new AppError('bad_request', 'A group cannot be inside itself');
    const row = await db
      .selectFrom('groups')
      .select('parent_id')
      .where('id', '=', current)
      .executeTakeFirst();
    if (!row) throw new AppError('bad_request', 'Unknown parent group');
    current = row.parent_id;
  }
}

async function nameTaken(db: Kysely<Database>, name: string, exceptId?: string) {
  let query = db
    .selectFrom('groups')
    .select('id')
    .where((eb) => eb(eb.fn('lower', ['name']), '=', name.toLowerCase()));
  if (exceptId) query = query.where('id', '!=', exceptId);
  return !!(await query.executeTakeFirst());
}

export function groupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const config = { permission: 'groups.manage' as const };

  r.get(
    '/api/groups',
    { config: { permission: 'assignments.manage' }, schema: { response: { 200: listGroupsResponseSchema } } },
    async () => ({
      items: await listGroups(ctx.db),
    }),
  );

  r.post(
    '/api/groups',
    { config, schema: { body: createGroupRequestSchema, response: { 200: groupSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      if (await nameTaken(ctx.db, request.body.name)) throw conflict('A group with this name exists');
      if (request.body.parentId) await assertNoCycle(ctx.db, '', request.body.parentId);
      const row = await ctx.db
        .insertInto('groups')
        .values({ name: request.body.name, parent_id: request.body.parentId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'group.created',
        targetType: 'group',
        targetId: row.id,
        ipHmac: request.ipHmac,
      });
      const [group] = await listGroups(ctx.db, [row.id]);
      if (!group) throw notFound();
      return group;
    },
  );

  r.patch(
    '/api/groups/:id',
    {
      config,
      schema: { params: idParamSchema, body: updateGroupRequestSchema, response: { 200: groupSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = request.params;
      const [existing] = await listGroups(ctx.db, [id]);
      if (!existing) throw notFound('Group not found');
      const { name, parentId } = request.body;
      if (name && (await nameTaken(ctx.db, name, id))) throw conflict('A group with this name exists');
      if (parentId !== undefined) await assertNoCycle(ctx.db, id, parentId);
      await ctx.db
        .updateTable('groups')
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(parentId !== undefined ? { parent_id: parentId } : {}),
        })
        .where('id', '=', id)
        .execute();
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'group.updated',
        targetType: 'group',
        targetId: id,
        ipHmac: request.ipHmac,
      });
      const [group] = await listGroups(ctx.db, [id]);
      if (!group) throw notFound();
      return group;
    },
  );

  r.delete(
    '/api/groups/:id',
    { config, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      const members = await ctx.db
        .selectFrom('group_members')
        .select('user_id')
        .where('group_id', '=', request.params.id)
        .execute();
      const result = await ctx.db.deleteFrom('groups').where('id', '=', request.params.id).executeTakeFirst();
      if (!Number(result.numDeletedRows)) throw notFound('Group not found');
      for (const m of members) await ctx.sessions.markRotate(m.user_id);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'group.deleted',
        targetType: 'group',
        targetId: request.params.id,
        ipHmac: request.ipHmac,
      });
      return { ok: true as const };
    },
  );

  r.post(
    '/api/groups/:id/members',
    {
      config,
      schema: { params: idParamSchema, body: groupMembersRequestSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = request.params;
      const [group] = await listGroups(ctx.db, [id]);
      if (!group) throw notFound('Group not found');
      const userIds = [...new Set(request.body.userIds)];
      const users = await ctx.db
        .selectFrom('users')
        .select('id')
        .where('id', 'in', userIds)
        .where('deleted_at', 'is', null)
        .execute();
      if (users.length !== userIds.length) throw new AppError('bad_request', 'Unknown user');
      await ctx.db
        .insertInto('group_members')
        .values(userIds.map((user_id) => ({ group_id: id, user_id })))
        .onConflict((oc) => oc.doNothing())
        .execute();
      for (const userId of userIds) await ctx.sessions.markRotate(userId);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'group.members_added',
        targetType: 'group',
        targetId: id,
        meta: { count: userIds.length },
        ipHmac: request.ipHmac,
      });
      return { ok: true as const };
    },
  );

  r.post(
    '/api/groups/:id/members/remove',
    {
      config,
      schema: { params: idParamSchema, body: groupMembersRequestSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = request.params;
      const userIds = [...new Set(request.body.userIds)];
      await ctx.db
        .deleteFrom('group_members')
        .where('group_id', '=', id)
        .where('user_id', 'in', userIds)
        .execute();
      for (const userId of userIds) await ctx.sessions.markRotate(userId);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'group.members_removed',
        targetType: 'group',
        targetId: id,
        meta: { count: userIds.length },
        ipHmac: request.ipHmac,
      });
      return { ok: true as const };
    },
  );
}
