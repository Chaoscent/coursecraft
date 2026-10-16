// SPDX-License-Identifier: Apache-2.0
import { listAuditQuerySchema, listAuditResponseSchema } from '@lernwerk/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppContext } from '../../http/context.js';

export function auditRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/audit',
    {
      config: { permission: 'audit.read' },
      schema: { querystring: listAuditQuerySchema, response: { 200: listAuditResponseSchema } },
    },
    async (request) => {
      const { action, actorUserId, from, to, page, pageSize } = request.query;
      let query = ctx.db.selectFrom('audit_log').leftJoin('users', 'users.id', 'audit_log.actor_user_id');
      if (action) query = query.where('audit_log.action', '=', action);
      if (actorUserId) query = query.where('audit_log.actor_user_id', '=', actorUserId);
      if (from) query = query.where('audit_log.at', '>=', new Date(from));
      if (to) query = query.where('audit_log.at', '<', new Date(to));
      const { total } = await query
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow();
      const rows = await query
        .select([
          'audit_log.id',
          'audit_log.at',
          'audit_log.actor_user_id',
          'users.display_name',
          'audit_log.action',
          'audit_log.target_type',
          'audit_log.target_id',
          'audit_log.meta',
        ])
        .orderBy('audit_log.at', 'desc')
        .orderBy('audit_log.id', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute();
      return {
        total: Number(total),
        items: rows.map((e) => ({
          id: String(e.id),
          at: e.at.toISOString(),
          actorUserId: e.actor_user_id,
          actorName: e.display_name,
          action: e.action,
          targetType: e.target_type,
          targetId: e.target_id,
          meta: e.meta,
        })),
      };
    },
  );
}
