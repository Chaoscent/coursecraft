// SPDX-License-Identifier: Apache-2.0
import {
  createUserRequestSchema,
  idParamSchema,
  importUsersResponseSchema,
  listUsersQuerySchema,
  listUsersResponseSchema,
  okSchema,
  resetPasswordRequestSchema,
  updateUserRequestSchema,
  userSchema,
} from '@coursecraft/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { notFound } from '../../http/errors.js';
import { eraseUser, exportUserData } from './privacy.js';
import { listUsers, loadUsers } from './repo.js';
import { createUser, deleteUser, importUsers, resetPassword, updateUser } from './service.js';

export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const config = { permission: 'users.manage' as const };

  r.get(
    '/api/users',
    { config, schema: { querystring: listUsersQuerySchema, response: { 200: listUsersResponseSchema } } },
    async (request) => listUsers(ctx.db, request.query),
  );

  r.get(
    '/api/users/:id',
    { config, schema: { params: idParamSchema, response: { 200: userSchema } } },
    async (request) => {
      const [user] = await loadUsers(ctx.db, [request.params.id]);
      if (!user) throw notFound('User not found');
      return user;
    },
  );

  r.post(
    '/api/users',
    { config, schema: { body: createUserRequestSchema, response: { 200: userSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      const id = await createUser(ctx, auth.userId, request.body, request.ipHmac);
      const [user] = await loadUsers(ctx.db, [id]);
      if (!user) throw notFound();
      return user;
    },
  );

  r.patch(
    '/api/users/:id',
    {
      config,
      schema: { params: idParamSchema, body: updateUserRequestSchema, response: { 200: userSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      await updateUser(ctx, auth.userId, request.params.id, request.body, request.ipHmac);
      const [user] = await loadUsers(ctx.db, [request.params.id]);
      if (!user) throw notFound();
      return user;
    },
  );

  r.post(
    '/api/users/:id/reset-password',
    {
      config,
      schema: { params: idParamSchema, body: resetPasswordRequestSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      await resetPassword(ctx, auth.userId, request.params.id, request.body.password, request.ipHmac);
      return { ok: true as const };
    },
  );

  r.delete(
    '/api/users/:id',
    { config, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      await deleteUser(ctx, auth.userId, request.params.id, request.ipHmac, eraseUser);
      return { ok: true as const };
    },
  );

  r.get(
    '/api/users/:id/export',
    { config, schema: { params: idParamSchema, response: { 200: z.record(z.string(), z.unknown()) } } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const [user] = await loadUsers(ctx.db, [request.params.id]);
      if (!user) throw notFound('User not found');
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'privacy.export',
        targetType: 'user',
        targetId: user.id,
        ipHmac: request.ipHmac,
      });
      void reply.header('Content-Disposition', 'attachment; filename="coursecraft-personal-data.json"');
      return exportUserData(ctx, user.id);
    },
  );

  r.post(
    '/api/users/import',
    {
      config,
      bodyLimit: 2 * 1024 * 1024,
      schema: {
        querystring: z.object({ dryRun: z.enum(['true', 'false']).default('true') }),
        body: z.string().max(2 * 1024 * 1024),
        response: { 200: importUsersResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return importUsers(ctx, auth.userId, request.body, request.query.dryRun === 'true', request.ipHmac);
    },
  );
}
